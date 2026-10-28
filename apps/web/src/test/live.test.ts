import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { Notification, ServerMessage } from "@oyee/schema";
import type { NotificationPages } from "../lib/cache";
import { backoffDelay, BACKOFF_MAX_MS, LiveConnection, PING_INTERVAL_MS, setSocketFactory, wsUrl, type LiveSocket } from "../lib/live";
import { qk } from "../lib/queries";
import { makeNotification, minute } from "./fixtures";

describe("backoffDelay", () => {
  it("grows exponentially with jitter and caps at 60s", () => {
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(0, () => 1)).toBe(1000);
    expect(backoffDelay(3, () => 1)).toBe(8000);
    expect(backoffDelay(3, () => 0)).toBe(4000);
    expect(backoffDelay(20, () => 1)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(20, () => 0)).toBe(BACKOFF_MAX_MS / 2);
  });
});

describe("wsUrl", () => {
  it("uses ws/wss to match the page", () => {
    expect(wsUrl({ protocol: "https:", host: "h.io" })).toBe("wss://h.io/api/ws");
    expect(wsUrl({ protocol: "http:", host: "localhost:5173" })).toBe("ws://localhost:5173/api/ws");
  });
});

class FakeSocket implements LiveSocket {
  onopen: LiveSocket["onopen"] = null;
  onmessage: LiveSocket["onmessage"] = null;
  onclose: LiveSocket["onclose"] = null;
  onerror: LiveSocket["onerror"] = null;
  sent: unknown[] = [];
  closed = false;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  // test helpers
  open() {
    this.onopen?.({});
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop() {
    this.onclose?.({});
  }
}

describe("LiveConnection", () => {
  let sockets: FakeSocket[];
  let qc: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    setSocketFactory((url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    });
    const target = new EventTarget();
    vi.stubGlobal("window", Object.assign(target, { location: { protocol: "https:", host: "h.io" } }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("navigator", { onLine: true });
    qc = new QueryClient();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const seedList = (items: Notification[]) =>
    qc.setQueryData<NotificationPages>(qk.notificationList({}), { pages: [{ items, nextCursor: null }], pageParams: [null] });
  const listIds = () => qc.getQueryData<NotificationPages>(qk.notificationList({}))!.pages[0]!.items.map((n) => n.id);

  it("syncs on connect, patches caches, pings, and resumes from the cursor after reconnecting", () => {
    const a = makeNotification({ id: "a", createdAt: minute(1) });
    seedList([a]);
    const conn = new LiveConnection(qc);
    conn.start();
    expect(conn.getState().status).toBe("connecting");
    expect(sockets[0]!.url).toBe("wss://h.io/api/ws");

    sockets[0]!.open();
    expect(conn.getState().status).toBe("open");
    expect(sockets[0]!.sent).toEqual([{ type: "sync", since: null }]);

    // sync.result with hasMore → asks for the next batch with the new cursor
    sockets[0]!.receive({ type: "sync.result", notifications: [], deletedIds: [], cursor: "cur1", hasMore: true });
    expect(sockets[0]!.sent.at(-1)).toEqual({ type: "sync", since: "cur1" });
    sockets[0]!.receive({ type: "sync.result", notifications: [], deletedIds: [], cursor: "cur2", hasMore: false });

    // live events patch the list + detail caches
    const b = makeNotification({ id: "b", createdAt: minute(2) });
    sockets[0]!.receive({ type: "notification.created", notification: b });
    expect(listIds()).toEqual(["b", "a"]);
    sockets[0]!.receive({ type: "notification.updated", notification: { ...a, version: 2, readAt: minute(3) }, alert: false, reason: "read" });
    expect(qc.getQueryData<Notification>(qk.notification("a"))!.readAt).toBe(minute(3));
    sockets[0]!.receive({ type: "notification.deleted", id: "b" });
    expect(listIds()).toEqual(["a"]);

    // ping every 30s
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(sockets[0]!.sent.at(-1)).toEqual({ type: "ping" });
    sockets[0]!.receive({ type: "pong" });

    // drop → reconnect with backoff → sync from the last cursor
    sockets[0]!.drop();
    expect(conn.getState().status).toBe("reconnecting");
    expect(conn.getState().retryAt).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(sockets[1]!.sent[0]).toEqual({ type: "sync", since: "cur2" });

    conn.stop();
    expect(sockets[1]!.closed).toBe(true);
    expect(conn.getState().status).toBe("stopped");
  });

  it("backs off exponentially across repeated failures", () => {
    const conn = new LiveConnection(qc);
    conn.start();
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = Date.now();
      sockets.at(-1)!.drop();
      delays.push(conn.getState().retryAt! - before);
      vi.advanceTimersByTime(conn.getState().retryAt! - before);
    }
    expect(delays[0]).toBeLessThanOrEqual(1000);
    expect(delays[3]).toBeGreaterThanOrEqual(4000);
    expect(delays[3]).toBeLessThanOrEqual(8000);
    conn.stop();
  });

  it("reconnects when a dead connection goes silent", () => {
    const conn = new LiveConnection(qc);
    conn.start();
    sockets[0]!.open();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3); // no frames for 90s > 75s stale limit
    expect(sockets[0]!.closed).toBe(true);
    expect(conn.getState().status).toBe("reconnecting");
    conn.stop();
  });
});
