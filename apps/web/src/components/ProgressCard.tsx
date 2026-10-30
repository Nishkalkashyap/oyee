import type { Notification } from "@oyee/schema";
import { formatDateTime, relativeTime } from "../lib/format";
import { progressView, type ProgressView } from "../lib/progress";
import { AlertTriangleIcon, CheckIcon, ExternalLinkIcon } from "./Icons";
import { Markdown } from "./Markdown";
import type { NotificationCardProps } from "./NotificationCard";
import { TargetBadge } from "./NotificationCard";
import { Badge, cx } from "./ui";

type ProgressNotification = Extract<Notification, { intent: "progress" }>;

// Static class strings so Tailwind can see them. Running is ink like every progress bar (design.md); an ended
// progress takes its outcome's severity colour, and one that stopped reporting goes faint.
const BAR: Record<ProgressView["tone"], string> = {
  ink: "bg-foreground",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  muted: "bg-zinc-400 dark:bg-zinc-500",
};
const PILL: Record<ProgressView["tone"], string> = {
  ink: "bg-zinc-100 text-secondary-label dark:bg-zinc-800",
  success: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  muted: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

/** The progress pill: a live dot while running, ✓ when done, ⚠ when it failed or stopped reporting. */
export function ProgressStatePill({ view }: { view: ProgressView }) {
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold", PILL[view.tone])}>
      {view.state === "running" ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-foreground/50" />
          <span className="relative inline-flex size-1.5 rounded-full bg-foreground" />
        </span>
      ) : view.state === "done" ? (
        <CheckIcon size={12} />
      ) : (
        <AlertTriangleIcon size={12} />
      )}
      {view.stateLabel}
    </span>
  );
}

/** A purpose-built card for long-running work: state pill, title, a real bar with its amount, and the last report. */
export function ProgressCard({
  notification: n,
  preview,
  inThread,
  onSourceClick,
  footer,
  className,
}: NotificationCardProps & { notification: ProgressNotification }) {
  const view = progressView(n);
  const ended = view.state !== "running";
  return (
    <article
      className={cx(
        "rounded-[22px] bg-bubble p-4 text-foreground sm:p-5",
        inThread ? "rounded-bl-md" : "ring-1 ring-zinc-200/70 dark:ring-zinc-800",
        className,
      )}
    >
      {!inThread && (
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-zinc-500 dark:text-zinc-400">
          {onSourceClick && !preview ? (
            <button type="button" className="font-semibold text-secondary-label hover:text-foreground" onClick={() => onSourceClick(n.source)}>
              {n.source}
            </button>
          ) : (
            <span className="font-semibold text-secondary-label">{n.source}</span>
          )}
          <span aria-hidden>·</span>
          <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
            {relativeTime(n.createdAt)}
          </time>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <ProgressStatePill view={view} />
        {n.status === "resolved" && (
          <Badge className="bg-foreground text-background">
            <CheckIcon size={11} /> Resolved
          </Badge>
        )}
        {n.targetDeviceIds && <TargetBadge ids={n.targetDeviceIds} preview={preview} />}
      </div>

      <h2 className="mt-2.5 text-[18px] leading-snug font-bold tracking-[-0.02em] break-words">{n.title}</h2>

      {n.body && <Markdown text={n.body} className="mt-1.5 text-[14.5px] leading-relaxed break-words text-secondary-label" />}

      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
          <span className="min-w-0 truncate font-semibold tabular-nums">{view.amount}</span>
          <span className="shrink-0 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
            {ended ? (
              <>
                {view.state === "stopped" ? "Last report" : "Ended"}{" "}
                <time title={formatDateTime(n.progress.lastReportAt)}>{relativeTime(n.progress.lastReportAt)}</time>
              </>
            ) : (
              `${Math.round(view.percent)}%`
            )}
          </span>
        </div>
        <div
          className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.percent)}
          aria-valuetext={`${view.amount}, ${view.stateLabel}`}
          aria-label={n.title}
        >
          <div className={cx("h-full rounded-full transition-[width] duration-500", BAR[view.tone])} style={{ width: `${view.percent}%` }} />
        </div>
        {!ended && (
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Updated <time title={formatDateTime(n.progress.lastReportAt)}>{relativeTime(n.progress.lastReportAt)}</time>
          </div>
        )}
        {view.state === "stopped" && (
          <p className="mt-2 text-[13px] leading-snug text-secondary-label">
            No report for over {n.progress.staleAfter}. It picks up again if {n.source} reports.
          </p>
        )}
      </div>

      {n.url && (
        <a
          href={preview ? undefined : n.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3.5 inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-foreground underline decoration-zinc-300 underline-offset-[3px] hover:decoration-foreground dark:decoration-zinc-600"
        >
          <ExternalLinkIcon size={13} />
          <span className="truncate">{n.url}</span>
        </a>
      )}

      {footer && <div className="mt-4 border-t border-zinc-200/80 pt-3.5 dark:border-zinc-700/70">{footer}</div>}
    </article>
  );
}
