/**
 * Webhook and REST sends (docs/protocol.md §3.1, §4): an intent body goes through the same inbox operations as the MCP
 * tools (inform, progress), so key, cooldown and stopped-reporting rules hold for every sender.
 */
import { IntentSendInput, type IntentSendResult, type Notification } from "@oyee/schema";
import type { InboxDO } from "../inbox/do";
import type { Actor } from "../inbox/model";
import { progressReason } from "../inbox/progress";
import { badRequest, parseOrThrow, rpc } from "../lib/errors";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const ASK_REJECTED =
  'intent: "ask" is for agents over MCP, which poll for the answer with wait_for_response. ' +
  'Webhooks and REST send "inform" (the default) or "progress".';

/**
 * Protocol v1 card fields that no intent has, with what to send instead. A body (or query parameter) using one is
 * rejected rather than silently ignored: dropping `replaceKey` would turn updates into duplicates, dropping `actions`
 * would lose buttons the sender expects.
 */
export const REMOVED_FIELDS: Record<string, string> = {
  replaceKey: "replaceKey is no longer supported: use key (a later send with the same key updates the notification)",
  template:
    "template is no longer supported: send the fields themselves (title, body, severity…), with a key to update one " +
    "notification instead of creating another",
  vars: "vars (templates) is no longer supported: send the fields themselves (title, body, severity…)",
  actions:
    'actions is no longer supported: use links ([{"label", "url"}], up to 3) for link buttons; questions with answer ' +
    "buttons are asks, which agents send over MCP",
  reply: "reply is no longer supported: questions that take a typed answer are asks, which agents send over MCP",
  progress: 'progress is no longer a card field: send {"intent": "progress", "key", "title", "value", "max"}',
  threadId: "threadId is no longer supported: use key to update one notification, or source to group them",
  tags: "tags are no longer supported: use source to group notifications, or fields for structured facts",
  silent: "silent is no longer supported: every severity alerts (the receiver decides what to mute)",
};

/** Validates a send body: `intent` defaults to inform; ask is rejected with a message saying where it belongs. */
export function parseIntentSend(body: unknown): IntentSendInput {
  if (!isObj(body)) return parseOrThrow(IntentSendInput, body);
  const intent = body.intent ?? "inform";
  if (intent === "ask") throw badRequest(ASK_REJECTED);
  if (intent !== "inform" && intent !== "progress") throw badRequest('intent: expected "inform" or "progress"');
  for (const [field, message] of Object.entries(REMOVED_FIELDS)) if (body[field] !== undefined) throw badRequest(message);
  if (body.severity === "debug") throw badRequest('severity: "debug" is no longer supported: use "info" (every severity alerts)');
  return parseOrThrow(IntentSendInput, { ...body, intent });
}

export type IntentSent = IntentSendResult & { notification: Notification };

/** Sends one intent and reports what happened (`outcome`, `reason`) alongside the notification's id and version. */
export async function sendIntent(stub: DurableObjectStub<InboxDO>, actor: Actor, input: IntentSendInput): Promise<IntentSent> {
  if (input.intent === "progress") {
    const { intent: _, ...progress } = input;
    const report = await rpc(stub.progress(actor, progress));
    const n = report.notification;
    return { id: n.id, version: n.version, outcome: report.outcome, reason: progressReason(report, "Send again"), notification: n };
  }
  const { intent: _, ...inform } = input;
  const r = await rpc(stub.inform(actor, inform));
  const n = r.notification;
  return { id: n.id, version: n.version, outcome: r.outcome, reason: r.reason, notification: n };
}
