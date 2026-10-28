import type { Notification, Progress, Severity } from "@herald/schema";
import { progressLabel, progressPercent, isHttpUrl } from "../lib/format";
import { SEVERITY_STYLES } from "../lib/severity";
import { AlertOctagonIcon, AlertTriangleIcon, BugIcon, CheckCircleIcon, InfoIcon } from "./Icons";
import { cx } from "./ui";

export function SeverityIcon({ severity, size = 16, className }: { severity: Severity; size?: number; className?: string }) {
  const C =
    severity === "critical"
      ? AlertOctagonIcon
      : severity === "warning"
        ? AlertTriangleIcon
        : severity === "success"
          ? CheckCircleIcon
          : severity === "debug"
            ? BugIcon
            : InfoIcon;
  return <C size={size} className={className} />;
}

/** The notification's icon (emoji or https URL), falling back to the severity glyph, in a tinted chip. */
export function NotificationIcon({
  notification,
  size = "md",
}: {
  notification: Pick<Notification, "icon" | "severity">;
  size?: "sm" | "md" | "lg";
}) {
  const s = SEVERITY_STYLES[notification.severity];
  const box = size === "sm" ? "size-7 text-sm" : size === "lg" ? "size-11 text-xl" : "size-9 text-base";
  const glyph = size === "sm" ? 14 : size === "lg" ? 20 : 17;
  const icon = notification.icon?.trim();
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg", box, s.soft)}>
      {icon && isHttpUrl(icon) ? (
        <img src={icon} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : icon ? (
        <span className="leading-none">{[...icon].slice(0, 2).join("")}</span>
      ) : (
        <SeverityIcon severity={notification.severity} size={glyph} />
      )}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", s.soft)}>
      <span className={cx("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function ProgressBar({
  progress,
  severity = "info",
  className,
  compact,
}: {
  progress: Pick<Progress, "value"> & Partial<Progress>;
  severity?: Severity;
  className?: string;
  compact?: boolean;
}) {
  const pct = progressPercent(progress);
  const label = progressLabel(progress);
  const bar = SEVERITY_STYLES[severity].bar;
  return (
    <div className={className}>
      {!compact && (label || progress.indeterminate) && (
        <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>{label || "In progress…"}</span>
          {!progress.indeterminate && progress.label && <span className="tabular-nums">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        className={cx(
          "relative w-full overflow-hidden rounded-full bg-zinc-200/80 dark:bg-zinc-800",
          compact ? "h-1" : "h-1.5",
        )}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.indeterminate ? undefined : Math.round(pct)}
        aria-label={label || "Progress"}
      >
        {progress.indeterminate ? (
          <div className={cx("absolute inset-y-0 w-1/3 rounded-full animate-[indeterminate_1.4s_ease-in-out_infinite]", bar)} />
        ) : (
          <div className={cx("h-full rounded-full transition-[width] duration-500", bar)} style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}
