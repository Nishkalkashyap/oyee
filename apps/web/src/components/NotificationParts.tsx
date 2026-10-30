import type { Severity } from "@oyee/schema";
import { progressAmount } from "@oyee/schema";
import { progressPercent, type ProgressLike } from "../lib/format";
import { SEVERITY_STYLES } from "../lib/severity";
import { AlertOctagonIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon } from "./Icons";
import { cx } from "./ui";

export function SeverityIcon({ severity, size = 16, className }: { severity: Severity; size?: number; className?: string }) {
  const C =
    severity === "critical"
      ? AlertOctagonIcon
      : severity === "warning"
        ? AlertTriangleIcon
        : severity === "success"
          ? CheckCircleIcon
          : InfoIcon;
  return <C size={size} className={className} />;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold", s.soft)}>
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
  muted,
}: {
  progress: ProgressLike;
  severity?: Severity;
  className?: string;
  compact?: boolean;
  /** Greyed out: a progress that stopped reporting. */
  muted?: boolean;
}) {
  const pct = progressPercent(progress);
  const label = progressAmount(progress);
  // Progress is ink, like Gluon's quiet controls; severity already shows in the pill and avatar dot.
  const bar = muted ? "bg-zinc-400 dark:bg-zinc-500" : severity === "critical" ? "bg-red-500" : "bg-foreground";
  return (
    <div className={className}>
      {!compact && (
        <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>{label}</span>
          {progress.label && <span className="tabular-nums">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        className={cx("relative w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700", compact ? "h-1" : "h-1.5")}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={label || "Progress"}
      >
        <div className={cx("h-full rounded-full transition-[width] duration-500", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
