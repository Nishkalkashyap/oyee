import { describe, expect, it } from "vitest";
import {
  applyEventToDetail,
  applyEventsToPages,
  eventsFromServerMessage,
  flattenPages,
  groupByThread,
  markAllReadInPages,
  matchesFilters,
  upsertIntoPages,
  type NotificationPages,
} from "../lib/cache";
import { makeNotification, minute } from "./fixtures";

const n1 = makeNotification({ id: "n1", createdAt: minute(30) });
const n2 = makeNotification({ id: "n2", createdAt: minute(20) });
const n3 = makeNotification({ id: "n3", createdAt: minute(10) });

function pages(items: ReturnType<typeof makeNotification>[][], lastCursor: string | null = null): NotificationPages {
  return {
    pages: items.map((p, i) => ({ items: p, nextCursor: i === items.length - 1 ? lastCursor : `c${i + 1}` })),
    pageParams: items.map((_, i) => (i === 0 ? null : `c${i}`)),
  };
}

const ids = (d: NotificationPages | undefined) => flattenPages(d).map((n) => n.id);

describe("eventsFromServerMessage", () => {
  it("maps created/updated/deleted/sync", () => {
    expect(eventsFromServerMessage({ type: "notification.created", notification: n1 })).toEqual([{ kind: "upsert", notification: n1 }]);
    expect(eventsFromServerMessage({ type: "notification.updated", notification: n1, alert: false, reason: "read" })).toEqual([
      { kind: "upsert", notification: n1 },
    ]);
    expect(eventsFromServerMessage({ type: "notification.deleted", id: "x" })).toEqual([{ kind: "delete", id: "x" }]);
    expect(
      eventsFromServerMessage({ type: "sync.result", notifications: [n1], deletedIds: ["d"], cursor: "c", hasMore: false }),
    ).toEqual([
      { kind: "upsert", notification: n1 },
      { kind: "delete", id: "d" },
    ]);
    expect(eventsFromServerMessage({ type: "pong" })).toEqual([]);
  });
});

describe("upsertIntoPages", () => {
  it("prepends a newer created notification", () => {
    const fresh = makeNotification({ id: "new", createdAt: minute(40) });
    expect(ids(upsertIntoPages(pages([[n1, n2, n3]]), fresh))).toEqual(["new", "n1", "n2", "n3"]);
  });

  it("inserts by createdAt among loaded pages", () => {
    const mid = makeNotification({ id: "mid", createdAt: minute(15) });
    const d = upsertIntoPages(pages([[n1, n2], [n3]]), mid);
    expect(d.pages[0]!.items.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(d.pages[1]!.items.map((n) => n.id)).toEqual(["mid", "n3"]);
  });

  it("skips items older than everything loaded when more pages exist, appends when fully loaded", () => {
    const old = makeNotification({ id: "old", createdAt: minute(1) });
    const partial = pages([[n1, n2, n3]], "more");
    expect(upsertIntoPages(partial, old)).toBe(partial);
    expect(ids(upsertIntoPages(pages([[n1, n2, n3]], null), old))).toEqual(["n1", "n2", "n3", "old"]);
  });

  it("replaces in place when the version is newer, ignores stale versions", () => {
    const d = pages([[n1, n2, n3]]);
    const v2 = { ...n2, version: 2, title: "updated" };
    const after = upsertIntoPages(d, v2);
    expect(flattenPages(after)[1]!.title).toBe("updated");
    expect(upsertIntoPages(after, n2)).toBe(after); // v1 after v2 → ignored
  });

  it("removes an item that no longer matches the filters", () => {
    const d = pages([[n1, n2]]);
    const resolved = { ...n1, version: 2, status: "resolved" as const };
    expect(ids(upsertIntoPages(d, resolved, { status: "active" }))).toEqual(["n2"]);
  });

  it("does not insert non-matching new items", () => {
    const d = pages([[n1]]);
    const other = makeNotification({ id: "x", source: "other", createdAt: minute(50) });
    expect(upsertIntoPages(d, other, { source: "test" })).toBe(d);
  });

  it("creates a first page when the list is empty", () => {
    expect(ids(upsertIntoPages({ pages: [], pageParams: [] }, n1))).toEqual(["n1"]);
  });
});

describe("applyEventsToPages", () => {
  it("handles deletes and leaves undefined data alone", () => {
    expect(ids(applyEventsToPages(pages([[n1, n2, n3]]), [{ kind: "delete", id: "n2" }]))).toEqual(["n1", "n3"]);
    expect(applyEventsToPages(undefined, [{ kind: "delete", id: "n2" }])).toBeUndefined();
  });

  it("returns the same reference when nothing changes", () => {
    const d = pages([[n1]]);
    expect(applyEventsToPages(d, [{ kind: "delete", id: "nope" }])).toBe(d);
  });

  it("applies a sync batch", () => {
    const d = pages([[n1, n2, n3]]);
    const events = eventsFromServerMessage({
      type: "sync.result",
      notifications: [{ ...n3, version: 3, readAt: minute(60) }, makeNotification({ id: "n4", createdAt: minute(45) })],
      deletedIds: ["n1"],
      cursor: "c",
      hasMore: false,
    });
    const after = applyEventsToPages(d, events);
    expect(ids(after)).toEqual(["n4", "n2", "n3"]);
    expect(flattenPages(after).find((n) => n.id === "n3")!.readAt).toBe(minute(60));
  });
});

describe("matchesFilters", () => {
  const n = makeNotification({
    id: "m",
    source: "aws",
    severity: "critical",
    threadId: "t1",
    title: "CPU high",
    body: "on prod-api",
    tags: ["prod"],
  });
  it("matches every filter dimension", () => {
    expect(matchesFilters(n, {})).toBe(true);
    expect(matchesFilters(n, { source: "aws", severity: "critical", status: "active", threadId: "t1" })).toBe(true);
    expect(matchesFilters(n, { source: "gcp" })).toBe(false);
    expect(matchesFilters(n, { severity: "info" })).toBe(false);
    expect(matchesFilters(n, { status: "resolved" })).toBe(false);
    expect(matchesFilters(n, { threadId: "t2" })).toBe(false);
  });
  it("searches title, body, source and tags case-insensitively", () => {
    expect(matchesFilters(n, { q: "cpu" })).toBe(true);
    expect(matchesFilters(n, { q: "PROD-API" })).toBe(true);
    expect(matchesFilters(n, { q: "nope" })).toBe(false);
  });
});

describe("detail + helpers", () => {
  it("applyEventToDetail keeps the newer version", () => {
    const v2 = { ...n1, version: 2 };
    expect(applyEventToDetail(undefined, n1)).toBe(n1);
    expect(applyEventToDetail(v2, n1)).toBe(v2);
    expect(applyEventToDetail(n1, v2)).toBe(v2);
  });

  it("markAllReadInPages respects the source filter", () => {
    const a = makeNotification({ id: "a", source: "x" });
    const b = makeNotification({ id: "b", source: "y" });
    const after = markAllReadInPages(pages([[a, b]]), minute(99), "x");
    expect(flattenPages(after).map((n) => n.readAt)).toEqual([minute(99), null]);
  });

  it("flattenPages de-duplicates", () => {
    expect(ids(pages([[n1, n2], [n2, n3]]))).toEqual(["n1", "n2", "n3"]);
  });

  it("groupByThread groups by threadId in order of newest item", () => {
    const a = makeNotification({ id: "a", threadId: "t" });
    const b = makeNotification({ id: "b" });
    const c = makeNotification({ id: "c", threadId: "t" });
    const g = groupByThread([a, b, c]);
    expect(g.map((x) => [x.threadId, x.items.map((n) => n.id)])).toEqual([
      ["t", ["a", "c"]],
      [null, ["b"]],
    ]);
  });
});
