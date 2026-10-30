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

/** Validates a send body: `intent` defaults to inform; ask is rejected with a message saying where it belongs. */
export function parseIntentSend(body: unknown): IntentSendInput {
  if (!isObj(body)) return parseOrThrow(IntentSendInput, body);
  const intent = body.intent ?? "inform";
  if (intent === "ask") throw badRequest(ASK_REJECTED);
  if (intent !== "inform" && intent !== "progress") throw badRequest('intent: expected "inform" or "progress"');
  return parseOrThrow(IntentSendInput, { ...body, intent });
}

/**
 * Protocol v1 card fields that no intent has. A body without `intent` that uses any of them still takes the flat send
 * path until the flat card is removed (ticket 15); everything else is an intent.
 */
const FLAT_ONLY = ["actions", "reply", "progress", "template", "vars", "tags", "threadId", "silent", "replaceKey"];

export function isFlatCard(body: unknown): boolean {
  return isObj(body) && body.intent === undefined && FLAT_ONLY.some((k) => body[k] !== undefined);
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
