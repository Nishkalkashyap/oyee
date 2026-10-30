/**
 * How the active inbox is laid out: what's waiting on you first, then live progress, then everything else with
 * repeats stacked into one row. Pure, so it's unit-tested and shared by every list render.
 */
import type { Notification } from "@oyee/schema";

/** An unanswered question: buttons that call back (not links) or a reply box, with no response yet. */
export function needsAnswer(n: Notification): boolean {
  if (n.status !== "active" || n.responses.length > 0) return false;
  return !!n.reply || n.actions.some((a) => !a.url);
}

/** A job that's still running (progress that hasn't reached its max, or an indeterminate bar). */
export function inProgress(n: Notification): boolean {
  if (n.status !== "active" || !n.progress) return false;
  if (n.intent === "progress" && (n.progress.state === "done" || n.progress.state === "failed")) return false;
  return n.progress.indeterminate || n.progress.value < n.progress.max;
}

/** Repeats collapse by thread, otherwise by source + title ("AI archiver warning" ×4 becomes one row). */
export function stackKey(n: Notification): string {
  return n.threadId ? `thread:${n.threadId}` : `title:${n.source}\u0000${n.title}`;
}

export interface InboxStack {
  key: string;
  /** Newest first; the first one is the row that's shown. */
  items: Notification[];
}

export type InboxSectionId = "needs-you" | "in-progress" | "updates";

export interface InboxSection {
  id: InboxSectionId;
  title: string;
  stacks: InboxStack[];
}

/** Splits a createdAt-desc list into sections. Empty sections are dropped. Only "Updates" stacks repeats. */
export function inboxSections(items: Notification[]): InboxSection[] {
  const needs: InboxStack[] = [];
  const live: InboxStack[] = [];
  const updates: InboxStack[] = [];
  const byKey = new Map<string, InboxStack>();
  for (const n of items) {
    // A running job's buttons (Pause, Roll back) are controls, not questions: it stays under "In progress".
    if (inProgress(n)) live.push({ key: n.id, items: [n] });
    else if (needsAnswer(n)) needs.push({ key: n.id, items: [n] });
    else {
      const k = stackKey(n);
      let s = byKey.get(k);
      if (!s) {
        s = { key: k, items: [] };
        byKey.set(k, s);
        updates.push(s);
      }
      s.items.push(n);
    }
  }
  const sections: InboxSection[] = [
    { id: "needs-you", title: "Needs you", stacks: needs },
    { id: "in-progress", title: "In progress", stacks: live },
    { id: "updates", title: "Updates", stacks: updates },
  ];
  return sections.filter((s) => s.stacks.length > 0);
}

/** Every item as its own stack, for views that shouldn't group (search, resolved). */
export function flatSections(items: Notification[]): InboxSection[] {
  return items.length ? [{ id: "updates", title: "", stacks: items.map((n) => ({ key: n.id, items: [n] })) }] : [];
}
