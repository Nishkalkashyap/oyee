import type { Severity } from "@oyee/schema";

export const SEVERITIES: Severity[] = ["critical", "warning", "success", "info", "debug"];

export interface SeverityStyle {
  label: string;
  /** Small solid dot / bar. */
  dot: string;
  /** Text color. */
  text: string;
  /** Soft background tint + text, for icon chips and badges. */
  soft: string;
  /** Left accent border for cards. */
  border: string;
  /** Progress bar fill. */
  bar: string;
  /** Ring for focus/selection. */
  ring: string;
}

// Static class strings so Tailwind can see them.
export const SEVERITY_STYLES: Record<Severity, SeverityStyle> = {
  critical: {
    label: "Critical",
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
    soft: "bg-red-500/12 text-red-700 dark:text-red-300",
    border: "border-l-red-500",
    bar: "bg-red-500",
    ring: "ring-red-500/40",
  },
  warning: {
    label: "Warning",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    soft: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    border: "border-l-amber-500",
    bar: "bg-amber-500",
    ring: "ring-amber-500/40",
  },
  success: {
    label: "Success",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    soft: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    border: "border-l-emerald-500",
    bar: "bg-emerald-500",
    ring: "ring-emerald-500/40",
  },
  info: {
    label: "Info",
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    soft: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    border: "border-l-blue-500",
    bar: "bg-blue-500",
    ring: "ring-blue-500/40",
  },
  debug: {
    label: "Debug",
    dot: "bg-zinc-400",
    text: "text-zinc-500 dark:text-zinc-400",
    soft: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    border: "border-l-zinc-400",
    bar: "bg-zinc-400",
    ring: "ring-zinc-400/40",
  },
};
