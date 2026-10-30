/**
 * Progress intent rules (spec "Keys", GLOSSARY "Progress"): one report per call, identified by `(source, key)`.
 * The first report creates a running progress without sound, later reports update it silently, `done` / `failed`
 * finish it and alert once. A finished progress stays `active` (unread) so its alert isn't cancelled; the next report
 * with the same key starts a fresh one. Pure: the InboxDO looks up the latest notification for the key, stores the
 * result and emits the event.
 */
import { LIMITS, type IntentSeverity, type Notification, type ProgressInput, type ProgressStatus } from "@oyee/schema";

export type ProgressNotification = Extract<Notification, { intent: "progress" }>;

/** `created` = a new progress; `updated_silently` = a running report; `alerted` = finished an existing progress. */
export type ProgressOutcome = "created" | "updated_silently" | "alerted";

export interface ProgressReport {
  notification: ProgressNotification;
  outcome: ProgressOutcome;
  /** Whether devices alert (sound) for this report: only when it finishes. */
  alert: boolean;
}

/** Running progress has no severity of its own; finishing picks the alert's urgency. */
const SEVERITY: Record<ProgressStatus, IntentSeverity> = { running: "info", done: "success", failed: "warning" };

/** A progress the next report continues: running or stopped, and not resolved by the user. */
export function isLiveProgress(n: Notification | null | undefined): n is ProgressNotification {
  return n?.intent === "progress" && n.status === "active" && (n.progress.state === "running" || n.progress.state === "stopped");
}

/**
 * Applies one report to the latest notification with its key. Omitted fields keep the previous report's value; the
 * label is kept only while value and max are unchanged (it describes them). `targets` undefined = keep the previous.
 */
export function reportProgress(
  latest: Notification | null,
  input: ProgressInput,
  ctx: { id: string; source: string; now: string; targets: string[] | null | undefined },
): ProgressReport {
  const live = isLiveProgress(latest) ? latest : null;
  const prev = live?.progress;
  const status = input.status ?? "running";
  const finished = status !== "running";
  const max = input.max ?? prev?.max ?? 100;
  const value = input.value ?? (status === "done" ? max : (prev?.value ?? 0));
  const label = input.label ?? (prev && value === prev.value && max === prev.max ? prev.label : undefined);
  const now = ctx.now;

  const notification: ProgressNotification = {
    id: live?.id ?? ctx.id,
    intent: "progress",
    source: ctx.source,
    key: input.key,
    title: input.title,
    body: input.body ?? live?.body ?? null,
    severity: SEVERITY[status],
    status: "active",
    url: input.url ?? live?.url ?? null,
    version: (live?.version ?? 0) + 1,
    createdAt: live?.createdAt ?? now,
    updatedAt: now,
    // A finished progress is unread until the user sees the outcome.
    readAt: finished ? null : (live?.readAt ?? null),
    resolvedAt: null,
    targetDeviceIds: ctx.targets === undefined ? (live?.targetDeviceIds ?? null) : ctx.targets,
    progress: {
      value,
      max,
      ...(label !== undefined ? { label } : {}),
      state: status,
      staleAfter: prev?.staleAfter ?? LIMITS.defaultStaleAfter,
      lastReportAt: now,
      indeterminate: false,
    },
    // Flat card for app builds that predate intents (removed with the flat card): `silent` keeps running reports quiet.
    threadId: null,
    icon: null,
    image: null,
    fields: [],
    actions: [],
    reply: null,
    tags: [],
    silent: !finished,
    template: null,
    responses: [],
  };
  return { notification, outcome: !live ? "created" : finished ? "alerted" : "updated_silently", alert: finished };
}

const amount = (p: ProgressNotification["progress"]) =>
  p.label ?? (p.max === 100 ? `${Math.round((Math.min(p.value, p.max) / p.max) * 100)}%` : `${p.value}/${p.max}`);

/** The MCP `progress` result: what happened, then what to do next. */
export function progressResultText({ notification: n, outcome }: ProgressReport): string {
  const key = JSON.stringify(n.key);
  const p = n.progress;
  if (p.state === "done" || p.state === "failed") {
    return (
      `${outcome}: progress ${n.id} (key ${key}) finished as ${p.state} at ${amount(p)}; the user was alerted once. ` +
      `It stays in the inbox until read. A later report with key ${key} starts a new progress.`
    );
  }
  const what =
    outcome === "created" ? `appeared without sound at ${amount(p)}` : `is now at ${amount(p)} (updated silently)`;
  return (
    `${outcome}: progress ${n.id} (key ${key}) ${what}. Call progress again with key ${key} to update it; ` +
    `finish with status "done" or "failed" to alert the user once.`
  );
}
