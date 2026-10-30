/** What the ask card shows (GLOSSARY.md: Ask, Answer button, Expiry). Pure, so it's tested on the shared v2 fixtures. */
import type { AskState, Notification } from "@oyee/schema";

export type AskLike = Pick<Extract<Notification, { intent: "ask" }>, "createdAt" | "ask">;

export interface AskView {
  /** The ask's state; an open ask past its expiry already counts as `expired` (the server's broadcast follows). */
  state: AskState;
  /** Answer buttons and the reply box only work while the ask is open. */
  open: boolean;
  /** Answer buttons; the one that was picked is `chosen`. */
  options: { label: string; chosen: boolean }[];
  /** The reply box, while the ask is open and takes text. */
  reply: { placeholder: string } | null;
  /** "Waiting 12m", "Answered: Approve · Pixel 9", "Expired" or "Withdrawn". */
  status: string;
  /** "Expires in 48m" while the ask is open. */
  expiry: string | null;
  /** Why an expired or withdrawn ask can't be answered. */
  note: string | null;
}

/** "12m", "2h", "3d": how long the ask has been waiting. */
function waited(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** "48m", "1h", "2h 30m", to the nearest minute. */
function span(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return m % 60 === 0 ? `${m / 60}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function statusOf(n: AskLike, state: AskState, now: number): string {
  const { answer } = n.ask;
  if (state === "answered" && answer) {
    const what = [answer.option, answer.text].filter(Boolean).join(": ");
    return `Answered: ${what}${answer.deviceName ? ` · ${answer.deviceName}` : ""}`;
  }
  if (state === "expired") return "Expired";
  if (state === "withdrawn") return "Withdrawn";
  const ms = now - Date.parse(n.createdAt);
  return ms < 60_000 ? "Just asked" : `Waiting ${waited(ms)}`;
}

function noteOf(n: AskLike, state: AskState): string | null {
  if (state === "expired") {
    const lifetime = span(Date.parse(n.ask.expiresAt) - Date.parse(n.createdAt));
    return `Nobody answered within ${lifetime}, so the question was closed on every device.`;
  }
  if (state === "withdrawn") return "The sender withdrew this question before it was answered.";
  return null;
}

export function askView(n: AskLike, now: number = Date.now()): AskView {
  const left = Date.parse(n.ask.expiresAt) - now;
  const state: AskState = n.ask.state === "open" && left <= 0 ? "expired" : n.ask.state;
  const open = state === "open";
  return {
    state,
    open,
    options: n.ask.options.map((label) => ({ label, chosen: n.ask.answer?.option === label })),
    reply: open && n.ask.allowText ? { placeholder: n.ask.replyPlaceholder || "Reply…" } : null,
    status: statusOf(n, state, now),
    expiry: open ? (left < 30_000 ? "Expires in under a minute" : `Expires in ${span(left)}`) : null,
    note: noteOf(n, state),
  };
}
