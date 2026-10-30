import { stoppedReportingLabel, type Notification, type ProgressState } from "@oyee/schema";
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

export function progressView(n: Pick<Extract<Notification, { intent: "progress" }>, "progress">): ProgressView {
  const p = n.progress;
  const amount = progressLabel(p);
  const stateLabel = { running: "Running", done: "Done", failed: "Failed", stopped: stoppedReportingLabel(p) }[p.state];
  return { state: p.state, stateLabel, amount, percent: progressPercent(p), tone: TONE[p.state] };
}
