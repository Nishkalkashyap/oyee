/**
 * Pure helpers that patch the TanStack Query caches from live events (WebSocket messages, mutation results).
 * Everything here is immutable: it returns the same reference when nothing changed so React Query can skip renders.
 */
import type { Notification, NotificationStatus, Page, ServerMessage, Severity } from "@oyee/schema";

export interface InboxFilters {
  source?: string;
  severity?: Severity;
  status?: NotificationStatus;
  q?: string;
}

/** Shape of TanStack's InfiniteData for the notification list. */
export interface NotificationPages {
  pages: Page<Notification>[];
  pageParams: unknown[];
}

export type CacheEvent = { kind: "upsert"; notification: Notification } | { kind: "delete"; id: string };

/** Normalizes a server WebSocket message into cache events. */
export function eventsFromServerMessage(msg: ServerMessage): CacheEvent[] {
  switch (msg.type) {
    case "notification.created":
    case "notification.updated":
      return [{ kind: "upsert", notification: msg.notification }];
    case "notification.deleted":
      return [{ kind: "delete", id: msg.id }];
    case "sync.result":
      return [
        ...msg.notifications.map((n): CacheEvent => ({ kind: "upsert", notification: n })),
        ...msg.deletedIds.map((id): CacheEvent => ({ kind: "delete", id })),
      ];
    default:
      return [];
  }
}

/** Client-side approximation of the server's list filters (used to decide where live items belong). */
export function matchesFilters(n: Notification, f: InboxFilters | undefined): boolean {
  if (!f) return true;
  if (f.source && n.source !== f.source) return false;
  if (f.severity && n.severity !== f.severity) return false;
  if (f.status && n.status !== f.status) return false;
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    if (q) {
      // As the server's search: an inform's rows, an ask's answer buttons, a progress's label.
      const extra =
        n.intent === "inform"
          ? n.inform.fields.map((x) => `${x.label} ${x.value}`)
          : n.intent === "ask"
            ? n.ask.options
            : [n.progress.label ?? ""];
      const hay = [n.title, n.body ?? "", n.source, ...extra]
        .join("\n")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}

/** True when `incoming` is at least as new as `existing` (version, then updatedAt). */
export function isNewer(existing: Notification, incoming: Notification): boolean {
  if (incoming.version !== existing.version) return incoming.version > existing.version;
  return Date.parse(incoming.updatedAt) >= Date.parse(existing.updatedAt);
}

function locate(data: NotificationPages, id: string): [number, number] | null {
  for (let p = 0; p < data.pages.length; p++) {
    const idx = data.pages[p]!.items.findIndex((n) => n.id === id);
    if (idx !== -1) return [p, idx];
  }
  return null;
}

function withPage(data: NotificationPages, pageIdx: number, items: Notification[]): NotificationPages {
  const pages = data.pages.slice();
  pages[pageIdx] = { ...pages[pageIdx]!, items };
  return { ...data, pages };
}

export function removeFromPages(data: NotificationPages, id: string): NotificationPages {
  const at = locate(data, id);
  if (!at) return data;
  const [p, i] = at;
  const items = data.pages[p]!.items.slice();
  items.splice(i, 1);
  return withPage(data, p, items);
}

/**
 * Inserts or replaces a notification in a createdAt-desc paginated list.
 * - Existing + older version → ignored. Existing but no longer matching the filters → removed.
 * - New + matching → inserted at its createdAt position among loaded items; if it's older than everything loaded
 *   and more pages exist, it's skipped (it will arrive with pagination).
 */
export function upsertIntoPages(
  data: NotificationPages,
  n: Notification,
  filters?: InboxFilters,
): NotificationPages {
  const at = locate(data, n.id);
  const matches = matchesFilters(n, filters);
  if (at) {
    const [p, i] = at;
    const existing = data.pages[p]!.items[i]!;
    if (!isNewer(existing, n)) return data;
    if (!matches) return removeFromPages(data, n.id);
    const items = data.pages[p]!.items.slice();
    items[i] = n;
    return withPage(data, p, items);
  }
  if (!matches) return data;
  if (data.pages.length === 0) {
    return { pages: [{ items: [n], nextCursor: null }], pageParams: [null] };
  }
  const t = Date.parse(n.createdAt);
  for (let p = 0; p < data.pages.length; p++) {
    const page = data.pages[p]!;
    const idx = page.items.findIndex((x) => Date.parse(x.createdAt) < t);
    if (idx !== -1) {
      const items = page.items.slice();
      items.splice(idx, 0, n);
      return withPage(data, p, items);
    }
  }
  const lastIdx = data.pages.length - 1;
  const last = data.pages[lastIdx]!;
  if (last.nextCursor === null) return withPage(data, lastIdx, [...last.items, n]);
  return data;
}

export function applyEventToPages(
  data: NotificationPages | undefined,
  ev: CacheEvent,
  filters?: InboxFilters,
): NotificationPages | undefined {
  if (!data) return data;
  return ev.kind === "delete" ? removeFromPages(data, ev.id) : upsertIntoPages(data, ev.notification, filters);
}

export function applyEventsToPages(
  data: NotificationPages | undefined,
  events: CacheEvent[],
  filters?: InboxFilters,
): NotificationPages | undefined {
  return events.reduce((acc, ev) => applyEventToPages(acc, ev, filters), data);
}

/** Detail cache: replace only with a newer version. */
export function applyEventToDetail(existing: Notification | undefined, n: Notification): Notification {
  return existing && !isNewer(existing, n) ? existing : n;
}

/** Optimistic "mark all read" over a list (optionally restricted to one source). */
export function markAllReadInPages(
  data: NotificationPages | undefined,
  at: string,
  source?: string,
): NotificationPages | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const items = page.items.map((n) => {
      if (n.readAt || (source && n.source !== source)) return n;
      pageChanged = true;
      return { ...n, readAt: at };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, items };
  });
  return changed ? { ...data, pages } : data;
}

/** Flattens loaded pages, de-duplicating by id (cursor pagination + live inserts can overlap). */
export function flattenPages(data: NotificationPages | undefined): Notification[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: Notification[] = [];
  for (const page of data.pages) {
    for (const n of page.items) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
  }
  return out;
}
