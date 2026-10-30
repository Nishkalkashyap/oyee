/**
 * Ask (GLOSSARY.md): a question an agent sends and polls the answer of. Pure logic used by the InboxDO: building the
 * stored ask, deciding whether an ask can be reused by key, recording the first answer, expiring it (Expiry),
 * withdrawing it, and what wait_for_response reports.
 */
import { LIMITS, durationMs, type AskAnswer, type AskInput, type McpWaitResult, type Notification, type RespondInput } from "@oyee/schema";
import { badRequest, conflict } from "../lib/errors";
import type { Actor } from "./model";

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
      expiresAt: new Date(Date.parse(now) + durationMs(input.expiresIn ?? LIMITS.defaultAskExpiry)).toISOString(),
      answer: null,
      state: "open",
    },
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

const optionList = (n: AskNotification) => n.ask.options.map((o) => `"${o}"`).join(", ");

/**
 * Records the first answer (an option, text, or both) from any device: it sets the answer, resolves the ask and marks
 * it read. A later answer is a conflict.
 */
export function answerAsk(n: AskNotification, input: RespondInput, actor: Actor, now: string): AskNotification {
  if (n.ask.answer) {
    throw conflict(`This ask was already answered: ${describeAnswer(n.ask.answer)}`);
  }
  if (n.ask.state === "withdrawn") throw conflict("This ask was withdrawn by its sender; there is nothing left to answer");
  if (n.ask.state === "expired" || Date.parse(n.ask.expiresAt) <= Date.parse(now)) {
    throw conflict("This ask expired before it was answered");
  }
  if (input.option !== undefined && !n.ask.options.includes(input.option)) {
    throw badRequest(`option: "${input.option}" is not an answer to this ask (${optionList(n) || "it takes text only"})`);
  }
  if (input.text !== undefined && !n.ask.allowText) {
    throw badRequest(`text: this ask takes one of its answer buttons (${optionList(n)})`);
  }
  const answer: AskAnswer = {
    option: input.option ?? null,
    text: input.text ?? null,
    deviceId: actor.deviceId,
    deviceName: actor.deviceName,
    at: now,
  };
  return {
    ...n,
    version: n.version + 1,
    updatedAt: now,
    readAt: n.readAt ?? now,
    status: "resolved",
    resolvedAt: n.resolvedAt ?? now,
    ask: { ...n.ask, answer, state: "answered" },
  };
}

/** Resolving an ask that is still open withdraws it: it can no longer be answered. Closed asks keep their state. */
export function withdrawIfOpen(n: AskNotification): AskNotification {
  return n.ask.state === "open" ? { ...n, ask: { ...n.ask, state: "withdrawn" } } : n;
}

/** When the scheduler should expire this ask, or null once it is answered, expired or withdrawn. */
export function expiryDue(n: Notification): number | null {
  return n.intent === "ask" && n.ask.state === "open" && n.status === "active" ? Date.parse(n.ask.expiresAt) : null;
}

/**
 * Expires an open ask whose time is up: state expired, status resolved (so every device takes it out of the tray).
 * Returns null when there is nothing to expire yet (answered, withdrawn, or not due at `now`).
 */
export function expireAsk(n: Notification, now: number): AskNotification | null {
  const due = expiryDue(n);
  if (due === null || due > now || n.intent !== "ask") return null;
  const at = new Date(now).toISOString();
  return {
    ...n,
    version: n.version + 1,
    updatedAt: at,
    status: "resolved",
    resolvedAt: n.resolvedAt ?? at,
    ask: { ...n.ask, state: "expired" },
  };
}

/** What wait_for_response reports for this ask right now. An ask past its expiry counts as expired. */
export function waitResult(n: AskNotification, now: number): McpWaitResult {
  if (n.ask.answer) return { status: "answered", answer: n.ask.answer, askedAt: n.createdAt };
  const { state, expiresAt } = n.ask;
  const status =
    state === "withdrawn" ? "withdrawn" : state === "expired" || Date.parse(expiresAt) <= now ? "expired" : "pending";
  return { status, askedAt: n.createdAt, expiresAt };
}
