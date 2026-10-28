import { progressText, type Field, type Notification, type Progress } from "@herald/schema";
import { markdownToPlainText } from "./markdown";

type ProgressLike = Pick<Progress, "value"> & Partial<Pick<Progress, "max" | "label" | "indeterminate">>;

/** Percentage 0..100 for a progress object (max defaults to 100; NaN/negative safe). */
export function progressPercent(p: ProgressLike): number {
  const max = p.max && p.max > 0 ? p.max : 100;
  const v = Number.isFinite(p.value) ? p.value : 0;
  return Math.max(0, Math.min(100, (v / max) * 100));
}

/** The label shown next to a progress bar: explicit label, else "42%" (max 100) or "3/7". */
export function progressLabel(p: ProgressLike): string {
  if (p.label) return p.label;
  if (p.indeterminate) return "";
  const max = p.max && p.max > 0 ? p.max : 100;
  return max === 100 ? `${Math.round(progressPercent(p))}%` : `${p.value}/${max}`;
}

/** `Label: value` lines, as appended to system-notification text (protocol §9). */
export function fieldLines(fields: readonly Field[] | null | undefined): string[] {
  return (fields ?? []).map((f) => `${f.label}: ${f.value}`);
}

/**
 * The plain-text body a system notification shows: markdown-stripped body, then field lines, then the
 * text progress bar. Mirrors `public/sw.js` (keep them in sync).
 */
export function systemNotificationBody(
  n: Pick<Notification, "body" | "fields" | "progress"> | { body?: string | null; fields?: Field[]; progress?: ProgressLike | null },
): string {
  const parts: string[] = [];
  const body = markdownToPlainText(n.body ?? null).trim();
  if (body) parts.push(body);
  parts.push(...fieldLines(n.fields));
  if (n.progress) parts.push(progressText(n.progress));
  return parts.join("\n");
}

/** Compact relative time: "now", "5m", "3h", "2d", else a short date. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.round((now - t) / 1000);
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** `XXXXYYYY` → `XXXX-YYYY` (pairing codes are shown with a dash). */
export function formatPairingCode(code: string): string {
  const c = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : code.toUpperCase();
}

/** "9:05" style countdown from milliseconds. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function isHttpUrl(s: string | null | undefined): boolean {
  return !!s && /^https?:\/\//i.test(s);
}
