/** What the ask card shows (GLOSSARY.md: Ask, Answer button, Expiry). Pure, so it's tested on the shared v2 fixtures. */
import type { AskState, IntentNotification, Notification } from "@oyee/schema";

export type AskLike = Pick<Extract<IntentNotification, { intent: "ask" }>, "createdAt" | "ask">;

export interface AskView {
  state: AskState;
  /** Answer buttons and the reply box only work while the ask is open. */
  open: boolean;
  /** Answer buttons; the one that was picked is `chosen`. */
  options: { label: string; chosen: boolean }[];
  /** The reply box, while the ask is open and takes text. */
  reply: { placeholder: string } | null;
  /** "Waiting 12m", "Answered: Approve · Pixel 9", "Expired" or "Withdrawn". */
  status: string;
}

/** "12m", "2h", "3d": how long the ask has been waiting. */
function waited(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function statusOf(n: AskLike, now: number): string {
  const { answer, state } = n.ask;
  if (state === "answered" && answer) {
    const what = [answer.option, answer.text].filter(Boolean).join(": ");
    return `Answered: ${what}${answer.deviceName ? ` · ${answer.deviceName}` : ""}`;
  }
  if (state === "expired") return "Expired";
  if (state === "withdrawn") return "Withdrawn";
  const ms = now - Date.parse(n.createdAt);
  return ms < 60_000 ? "Just asked" : `Waiting ${waited(ms)}`;
}

/**
 * Whether to draw the ask card. While v1 cards still arrive (until ticket 15), one inferred as an ask may also carry a
 * progress bar, fields, an image or link buttons; those keep the generic card so nothing is hidden.
 */
export function showsAsAsk(n: Notification): n is Extract<Notification, { intent: "ask" }> {
  return n.intent === "ask" && !n.progress && n.fields.length === 0 && !n.image && n.actions.every((a) => !a.url);
}

export function askView(n: AskLike, now: number = Date.now()): AskView {
  const open = n.ask.state === "open";
  return {
    state: n.ask.state,
    open,
    options: n.ask.options.map((label) => ({ label, chosen: n.ask.answer?.option === label })),
    reply: open && n.ask.allowText ? { placeholder: n.ask.replyPlaceholder || "Reply…" } : null,
    status: statusOf(n, now),
  };
}
