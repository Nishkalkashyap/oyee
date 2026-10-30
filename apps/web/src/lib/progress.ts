import type { IntentNotification, Notification, ProgressState } from "@oyee/schema";
import { progressLabel, progressPercent } from "./format";

/** What the progress card and rows show for a progress notification. */
export interface ProgressView {
  state: ProgressState;
  /** "Running", "Done", "Failed" or "Stopped reporting after 40%". */
  stateLabel: string;
  /** The sender's label, else "40%" (max 100) or "3/7". */
  amount: string;
  /** 0..100. */
  percent: number;
  /** Bar and state pill colour: ink while running (design.md), severity colours once it ended. */
  tone: "ink" | "success" | "warning" | "muted";
}

const TONE: Record<ProgressState, ProgressView["tone"]> = { running: "ink", done: "success", failed: "warning", stopped: "muted" };

export function progressView(n: Pick<Extract<IntentNotification, { intent: "progress" }>, "progress">): ProgressView {
  const p = n.progress;
  const amount = progressLabel(p);
  const stateLabel = { running: "Running", done: "Done", failed: "Failed", stopped: `Stopped reporting after ${amount}` }[p.state];
  return { state: p.state, stateLabel, amount, percent: progressPercent(p), tone: TONE[p.state] };
}

/**
 * Whether the inbox draws this notification with the progress card. During the expand phase older flat senders can
 * still put fields, buttons, an image or an indeterminate bar on a card inferred as progress; those keep the generic
 * card until the flat card is removed, so nothing they sent disappears.
 */
export function usesProgressCard(n: Notification): n is Extract<Notification, { intent: "progress" }> {
  return n.intent === "progress" && !n.progress.indeterminate && !n.fields.length && !n.actions.length && !n.image && !n.reply;
}
