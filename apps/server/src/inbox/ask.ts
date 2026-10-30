/**
 * Ask (GLOSSARY.md): a question an agent sends and polls the answer of. Pure logic used by the InboxDO: building the
 * stored ask, deciding whether an ask can be reused by key, and recording the first answer.
 */
import {
  LIMITS,
  durationMs,
  isLinkAction,
  type AskAnswer,
  type AskInput,
  type Notification,
  type RespondInput,
  type Response as OyeeResponse,
} from "@oyee/schema";
import { badRequest, conflict } from "../lib/errors";
import { appendResponse, type Actor } from "./model";

export type AskNotification = Extract<Notification, { intent: "ask" }>;

/** What `ask` did: created a new ask, or returned the open ask that already has this key (no new alert). */
export interface AskResult {
  outcome: "created" | "reused";
  notification: AskNotification;
}

const REPLY_PLACEHOLDER = "Reply…";

/** A new open ask. It always alerts at `warning`; with neither options nor allowText it gets a reply box. */
export function buildAsk(
  id: string,
  input: AskInput,
  actor: Actor,
  now: string,
  targetDeviceIds: string[] | null,
): AskNotification {
  const options = input.options ?? [];
  const duplicate = options.find((o, i) => options.indexOf(o) !== i);
  if (duplicate) throw badRequest(`options: "${duplicate}" appears twice; each answer button needs its own label`);
  const allowText = input.allowText === true || options.length === 0;
  return {
    id,
    intent: "ask",
    key: input.key ?? null,
    source: input.source ?? actor.defaultSource,
    title: input.title,
    body: input.body ?? null,
    severity: "warning",
    status: "active",
    url: input.url ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    readAt: null,
    resolvedAt: null,
    targetDeviceIds,
    ask: {
      options,
      allowText,
      replyPlaceholder: allowText ? REPLY_PLACEHOLDER : null,
      expiresAt: new Date(Date.parse(now) + durationMs(LIMITS.defaultAskExpiry)).toISOString(),
      answer: null,
      state: "open",
    },
    // The flat v1 card, so app builds that don't know intents yet still show answer buttons (removed in ticket 15).
    threadId: null,
    icon: null,
    image: null,
    fields: [],
    progress: null,
    actions: options.map((label, i) => ({
      id: `option_${i + 1}`,
      label,
      style: i === 0 ? "primary" : "default",
      resolves: true,
    })),
    reply: allowText ? { placeholder: REPLY_PLACEHOLDER, buttonLabel: "Send" } : null,
    tags: [],
    silent: false,
    template: null,
    responses: [],
  };
}

/** An ask with this key is reused while it is still open and unexpired. */
export function isOpenAsk(n: Notification, now: number): n is AskNotification {
  return n.intent === "ask" && n.ask.state === "open" && n.status === "active" && Date.parse(n.ask.expiresAt) > now;
}

/** "Approve · Pixel 9", as every device shows it after "Answered: ". */
export function describeAnswer(a: AskAnswer): string {
  const what = [a.option, a.text].filter((s): s is string => !!s).join(": ");
  return a.deviceName ? `${what} · ${a.deviceName}` : what;
}

/**
 * Records the first answer (an option, text, or both) from any device: it sets the answer, resolves the ask and marks
 * it read. A later answer is a conflict. Also appends the v1 `responses` entry for older app builds and callbacks.
 */
export function answerAsk(
  n: AskNotification,
  input: RespondInput,
  actor: Actor,
  now: string,
): { n: AskNotification; response: OyeeResponse; action: Notification["actions"][number] | undefined } {
  if (n.ask.answer) {
    throw conflict(`This ask was already answered: ${describeAnswer(n.ask.answer)}`);
  }
  const answerButtons = n.actions.filter((a) => !isLinkAction(a));
  let action: Notification["actions"][number] | undefined;
  if (input.option !== undefined) {
    action = answerButtons.find((a) => a.label === input.option);
    if (!action) {
      throw badRequest(`option: "${input.option}" is not an answer to this ask (${n.ask.options.map((o) => `"${o}"`).join(", ") || "it takes text only"})`);
    }
  } else if (input.actionId !== undefined) {
    action = answerButtons.find((a) => a.id === input.actionId);
    if (!action) throw badRequest(`actionId: unknown action "${input.actionId}"`);
  }
  if (input.text !== undefined && !n.ask.allowText) {
    throw badRequest(`text: this ask takes one of its answer buttons (${n.ask.options.map((o) => `"${o}"`).join(", ")})`);
  }
  const answer: AskAnswer = {
    option: action?.label ?? null,
    text: input.text ?? null,
    deviceId: actor.deviceId,
    deviceName: actor.deviceName,
    at: now,
  };
  const response: OyeeResponse = {
    actionId: action?.id ?? null,
    text: answer.text,
    deviceId: answer.deviceId,
    deviceName: answer.deviceName,
    at: now,
  };
  return {
    n: {
      ...n,
      responses: appendResponse(n, response),
      version: n.version + 1,
      updatedAt: now,
      readAt: n.readAt ?? now,
      status: "resolved",
      resolvedAt: n.resolvedAt ?? now,
      ask: { ...n.ask, answer, state: "answered" },
    },
    response,
    action,
  };
}

/** The answer wait_for_response reports: the ask's answer, or a v1 response on a card that isn't an ask. */
export function answerOf(n: Notification): AskAnswer | null {
  if (n.intent === "ask") return n.ask.answer;
  const last = n.responses[n.responses.length - 1];
  if (!last) return null;
  const option = last.actionId === null ? null : (n.actions.find((a) => a.id === last.actionId)?.label ?? last.actionId);
  return { option, text: last.text, deviceId: last.deviceId, deviceName: last.deviceName, at: last.at };
}
