import type { ServerMessage } from "@herald/schema";
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { InboxDO } from "../src/inbox/do";
import { BASE, call, devLogin, eventually, pairDevice } from "./helpers";

async function connect(headers: Record<string, string>, query = "") {
  const res = await SELF.fetch(`${BASE}/api/ws${query}`, { headers: { Upgrade: "websocket", ...headers } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const messages: ServerMessage[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(e.data as string));
  });
  ws.accept();
  const next = (type: ServerMessage["type"], from = 0) =>
    eventually(() => messages.slice(from).find((m) => m.type === type)) as Promise<any>;
  return { ws, messages, next };
}

describe("WebSocket", () => {
  it("sends hello and broadcasts created / updated / deleted", async () => {
    const cookie = await devLogin();
    const { ws, messages, next } = await connect({ Cookie: cookie });
    const hello = await next("hello");
    expect(hello.deviceId).toBeNull();
    expect(hello.userId).toMatch(/^usr_/);

    const sent = await call("POST", "/api/notifications", { cookie }, { title: "live!" });
    const created = await next("notification.created");
    expect(created.notification.id).toBe(sent.body.id);
    expect(created.notification.title).toBe("live!");

    await call("POST", `/api/notifications/${sent.body.id}/read`, { cookie });
    const updated = await next("notification.updated");
    expect(updated).toMatchObject({ alert: false, reason: "read" });
    expect(updated.notification.readAt).not.toBeNull();

    const n = messages.length;
    await call("DELETE", `/api/notifications/${sent.body.id}`, { cookie });
    expect(await next("notification.deleted", n)).toEqual({ type: "notification.deleted", id: sent.body.id });
    ws.close();
  });

  it("authenticates devices via ?token=, answers ping and sync", async () => {
    const cookie = await devLogin();
    const dev = await pairDevice(cookie, "MacBook", "macos");
    const a = await call("POST", "/api/notifications", { cookie }, { title: "one" });
    const b = await call("POST", "/api/notifications", { cookie }, { title: "two" });
    await call("POST", `/api/notifications/${a.body.id}/resolve`, { cookie });

    const { ws, messages, next } = await connect({}, `?token=${dev.token}`);
    expect((await next("hello")).deviceId).toBe(dev.device.id);

    ws.send(JSON.stringify({ type: "ping" }));
    expect(await next("pong")).toEqual({ type: "pong" });

    // null → last 50 active
    ws.send(JSON.stringify({ type: "sync", since: null }));
    const first = await next("sync.result");
    expect(first.notifications.map((x: { id: string }) => x.id)).toEqual([b.body.id]);
    expect(first.hasMore).toBe(false);

    // cursor → changes since then, including deletions
    const from = messages.length;
    await call("PATCH", `/api/notifications/${b.body.id}`, { cookie }, { title: "two (edited)", alert: true });
    await call("DELETE", `/api/notifications/${a.body.id}`, { cookie });
    expect((await next("notification.updated", from)).alert).toBe(true);
    ws.send(JSON.stringify({ type: "sync", since: first.cursor }));
    const second = await next("sync.result", from);
    expect(second.notifications.map((x: { title: string }) => x.title)).toEqual(["two (edited)"]);
    expect(second.deletedIds).toEqual([a.body.id]);
    expect(second.cursor).not.toBe(first.cursor);

    // ISO time works too
    const s3 = messages.length;
    ws.send(JSON.stringify({ type: "sync", since: "2000-01-01T00:00:00.000Z" }));
    const third = await next("sync.result", s3);
    expect(third.notifications).toHaveLength(1);
    expect(third.deletedIds).toEqual([a.body.id]);
    ws.close();
  });

  it("rejects unauthenticated upgrades", async () => {
    const res = await SELF.fetch(`${BASE}/api/ws`, { headers: { Upgrade: "websocket" } });
    expect(res.status).toBe(401);
  });

  it("retention alarm prunes old notifications and records tombstones", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    const n = await call("POST", "/api/notifications", { cookie }, { title: "old" });
    const stub = env.INBOX.get(env.INBOX.idFromName(me.id));
    // Age the row past the retention window.
    await runInDurableObject(stub, async (_inst: InboxDO, state) => {
      state.storage.sql.exec("UPDATE notifications SET created_at = '2000-01-01T00:00:00.000Z'");
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true); // scheduled on first send
    expect((await call("GET", `/api/notifications/${n.body.id}`, { cookie })).status).toBe(404);
    const deleted = await runInDurableObject(stub, (inst: InboxDO) => inst.syncResult("2000-01-01T00:00:00.000Z").deletedIds);
    expect(deleted).toEqual([n.body.id]);
  });
});
