/**
 * How the active inbox is laid out, by intent (GLOSSARY.md): open asks first (Needs you), then running or stopped
 * progress (In progress), then everything else (Updates) with repeats stacked into one row. Pure, so it's unit-tested
 * on the shared v2 fixtures and shared by every list render. Android (InboxSections.kt) and macOS
 * (InboxSections.swift) follow the same rules.
 */
import { isLiveProgress, isOpenAsk, isQuietProgress, type AskBlock, type Notification, type ProgressBlock } from "@oyee/schema";

/** What the inbox reads: identity plus the intent and its state (the wire notification and the v2 fixtures both fit). */
export type InboxItem = Pick<Notification, "id" | "source" | "key" | "title"> &
  ({ intent: "inform" } | { intent: "ask"; ask: Pick<AskBlock, "state" | "expiresAt"> } | { intent: "progress"; progress: Pick<ProgressBlock, "state"> });

export type InboxSectionId = "needs-you" | "in-progress" | "updates";

/**
 * Which section a notification belongs in: decided by its intent and state only. An open ask past its expiry already
 * counts as expired (as on the ask card), so it leaves Needs you before the server's broadcast arrives.
 */
function sectionOf(n: InboxItem, now: number): InboxSectionId {
  if (isOpenAsk(n, now)) return "needs-you";
  if (isLiveProgress(n)) return "in-progress";
  return "updates";
}

/** Repeats collapse by `(source, key)` when there is a key, otherwise by source + title ("Front door left open" ×4). */
function stackKey(n: InboxItem): string {
  return n.key ? `key:${n.source}\u0000${n.key}` : `title:${n.source}\u0000${n.title}`;
}

export interface InboxStack<T extends InboxItem = InboxItem> {
  key: string;
  /** Newest first; the first one is the row that's shown. */
  items: T[];
}

export interface InboxSection<T extends InboxItem = InboxItem> {
  id: InboxSectionId;
  title: string;
  stacks: InboxStack<T>[];
}

const TITLES: Record<InboxSectionId, string> = { "needs-you": "Needs you", "in-progress": "In progress", updates: "Updates" };

/**
 * Splits a createdAt-desc list into sections, in the order Needs you, In progress, Updates; empty sections are
 * dropped. Only Updates stacks repeats: an open ask or a live progress is always its own row.
 */
export function inboxSections<T extends InboxItem>(items: T[], now: number = Date.now()): InboxSection<T>[] {
  const stacks: Record<InboxSectionId, InboxStack<T>[]> = { "needs-you": [], "in-progress": [], updates: [] };
  const byKey = new Map<string, InboxStack<T>>();
  for (const n of items) {
    const id = sectionOf(n, now);
    if (id !== "updates") {
      stacks[id].push({ key: n.id, items: [n] });
      continue;
    }
    const k = stackKey(n);
    let s = byKey.get(k);
    if (!s) {
      s = { key: k, items: [] };
      byKey.set(k, s);
      stacks.updates.push(s);
    }
    s.items.push(n);
  }
  return (["needs-you", "in-progress", "updates"] as const)
    .map((id) => ({ id, title: TITLES[id], stacks: stacks[id] }))
    .filter((s) => s.stacks.length > 0);
}

/** Every item as its own stack, for views that shouldn't group (search, resolved). */
export function flatSections<T extends InboxItem>(items: T[]): InboxSection<T>[] {
  return items.length ? [{ id: "updates", title: "", stacks: items.map((n) => ({ key: n.id, items: [n] })) }] : [];
}

/** Whether a notification arriving while the app is open gets an in-app toast: a running progress appears quietly. */
export function toastsOnArrival(n: InboxItem): boolean {
  return !isQuietProgress(n);
}
