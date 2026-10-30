/**
 * Ask expiry (ticket 06): an ask closes `expiresIn` after it was sent (default 1h, at most 24h), or earlier when its
 * sender withdraws it. Time is moved by backdating the stored ask and firing the inbox's alarm.
 */
import { Notification, type ServerMessage } from "@oyee/schema";
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxDO } from "../src/inbox/do";
import { BASE, call, createToken, devLogin, eventually, pairDevice, sleep } from "./helpers";

afterEach(() => vi.restoreAllMocks());

let rpcId = 0;

async function tool(path: string, name: string, args: unknown) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  return { isError: body.result.isError ?? false, text: body.result.content[0]!.text };
}

async function setup() {
  const cookie = await devLogin();
  const mcp = new URL((await createToken(cookie, "mcp", "Claude Code", "claude-code")).url).pathname;
  const me = (await call("GET", "/api/me", { cookie })).body;
  return { cookie, mcp, stub: env.INBOX.get(env.INBOX.idFromName(me.id)) };
}

const idIn = (text: string) => /ntf_[0-9A-Za-z]+/.exec(text)![0];

async function ask(mcp: string, args: Record<string, unknown>) {
  const r = await tool(mcp, "ask", args);
  expect(r.isError, r.text).toBe(false);
  return { id: idIn(r.text), text: r.text };
}

async function get(cookie: string, id: string) {
  return (await call<Notification>("GET", `/api/notifications/${id}`, { cookie })).body;
}

async function socket(cookie: string) {
  const res = await SELF.fetch(`${BASE}/api/ws`, { headers: { Upgrade: "websocket", Cookie: cookie } });
  const ws = res.webSocket!;
  const messages: ServerMessage[] = [];
  ws.addEventListener("message", (e) => messages.push(JSON.parse(e.data as string)));
  ws.accept();
  return { ws, messages };
}

/** Moves an ask's expiry into the past, as if its time had run out. */
async function backdateExpiry(stub: DurableObjectStub<InboxDO>, id: string, msAgo = 1_000) {
  await runInDurableObject(stub, async (_i: InboxDO, state) => {
    state.storage.sql.exec(
      "UPDATE notifications SET data = json_set(data, '$.ask.expiresAt', ?) WHERE id = ?",
      new Date(Date.now() - msAgo).toISOString(),
      id,
    );
  });
}

const alarmAt = (stub: DurableObjectStub<InboxDO>) =>
  runInDurableObject(stub, async (_i: InboxDO, state) => state.storage.getAlarm());

describe("expiresIn", () => {
  it("sets when the ask expires (default 1h, at most 24h) and the alarm is armed for it", async () => {
    const { cookie, mcp, stub } = await setup();
    const { id, text } = await ask(mcp, { title: "Deploy?", options: ["Yes"], expiresIn: "30m" });
    expect(text).toContain("expires in 30m");
    const n = await get(cookie, id);
    if (n.intent !== "ask") throw new Error("not an ask");
    expect(Date.parse(n.ask.expiresAt) - Date.parse(n.createdAt)).toBe(30 * 60_000);
    expect(await alarmAt(stub)).toBe(Date.parse(n.ask.expiresAt));

    const day = await get(cookie, (await ask(mcp, { title: "Tomorrow?", expiresIn: "24h" })).id);
    if (day.intent !== "ask") throw new Error("not an ask");
    expect(Date.parse(day.ask.expiresAt) - Date.parse(day.createdAt)).toBe(24 * 3_600_000);

    const tooLong = await tool(mcp, "ask", { title: "Next week?", expiresIn: "25h" });
    expect(tooLong.isError).toBe(true);
    expect(tooLong.text).toContain("24h");
    expect((await tool(mcp, "ask", { title: "Soon?", expiresIn: "10 minutes" })).isError).toBe(true);
  });

  it("is listed in the ask schema", async () => {
    const { mcp } = await setup();
    const res = await SELF.fetch(`${BASE}${mcp}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/list", params: {} }),
    });
    const tools = ((await res.json()) as any).result.tools as { name: string; inputSchema: any }[];
    const prop = tools.find((t) => t.name === "ask")!.inputSchema.properties.expiresIn;
    expect(prop.description).toMatch(/24h/);
  });
});

describe("when an ask expires", () => {
  it("is resolved as expired everywhere, wait_for_response says so, and late answers conflict", async () => {
    const { cookie, mcp, stub } = await setup();
    const { ws, messages } = await socket(cookie);
    const { id } = await ask(mcp, { title: "Rotate the staging keys?", options: ["Rotate", "Skip"] });

    const pending = await tool(mcp, "wait_for_response", { id, timeoutSeconds: 1 });
    expect(pending.text).toMatch(/No answer yet: asked \d+s ago, expires in (1h|59m)\./);

    await backdateExpiry(stub, id);
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const n = await get(cookie, id);
    expect(n).toMatchObject({ status: "resolved", ask: { state: "expired", answer: null } });
    expect(n.resolvedAt).not.toBeNull();
    const update = await eventually(() => messages.find((m) => m.type === "notification.updated" && m.reason === "resolved"));
    expect(update).toMatchObject({ alert: false, notification: { id, status: "resolved", ask: { state: "expired" } } });

    const expired = await tool(mcp, "wait_for_response", { id });
    expect(expired.isError).toBe(false);
    expect(expired.text).toMatch(/^outcome: expired\nid: ntf_\w+\nThe ask expired/);

    const late = await call("POST", `/api/notifications/${id}/respond`, { cookie }, { option: "Rotate" });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/expired/);
    // The next alarm is the daily prune again.
    expect(await alarmAt(stub)).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    ws.close();
  });

  it("tells the user's phone to take it out of the tray", async () => {
    const { cookie, mcp, stub } = await setup();
    const phone = await pairDevice(cookie, "Pixel 9", "android");
    await call("PUT", "/api/devices/self", { bearer: phone.token }, { fcmToken: "fcm-expiry" });
    const realFetch = globalThis.fetch;
    const sent: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input as RequestInfo, init as RequestInit);
      if (req.url.startsWith("https://oauth2.googleapis.com/")) return Response.json({ access_token: "t", expires_in: 3600 });
      if (req.url.startsWith("https://fcm.googleapis.com/")) {
        sent.push(JSON.parse(await req.text()).message.data);
        return Response.json({ name: "m" });
      }
      return realFetch(input as RequestInfo, init as RequestInit);
    });
    const { id } = await ask(mcp, { title: "Deploy?", options: ["Yes"] });
    await eventually(() => sent.length === 1);

    await backdateExpiry(stub, id);
    await runDurableObjectAlarm(stub);
    const push = await eventually(() => sent[1]);
    expect(push).toMatchObject({ type: "notification.updated", id, alert: "false" });
    expect(JSON.parse(push.notification)).toMatchObject({ status: "resolved", ask: { state: "expired" } });
  });

  it("wakes a waiting wait_for_response", async () => {
    const { mcp, stub } = await setup();
    const { id } = await ask(mcp, { title: "Which branch?" });
    const waiting = tool(mcp, "wait_for_response", { id, timeoutSeconds: 10 });
    await sleep(200);
    await backdateExpiry(stub, id);
    await runDurableObjectAlarm(stub);
    expect((await waiting).text).toMatch(/^outcome: expired\nid: ntf_\w+\nThe ask expired/);
  });

  it("can't be answered once its time is up, even before the alarm has run", async () => {
    const { cookie, mcp, stub } = await setup();
    const { id } = await ask(mcp, { title: "Deploy?", options: ["Yes"] });
    await backdateExpiry(stub, id);
    expect((await call("POST", `/api/notifications/${id}/respond`, { cookie }, { option: "Yes" })).status).toBe(409);
    expect((await tool(mcp, "wait_for_response", { id })).text).toMatch(/^outcome: expired\nid: ntf_\w+\nThe ask expired/);
  });

  it("asking again with its key creates a new ask", async () => {
    const { mcp, stub } = await setup();
    const first = await ask(mcp, { title: "Rotate?", key: "rotate" });
    await backdateExpiry(stub, first.id);
    await runDurableObjectAlarm(stub);
    const next = await ask(mcp, { title: "Rotate?", key: "rotate" });
    expect(next.id).not.toBe(first.id);
  });

  it("expires every due ask in one firing, including asks sent as a flat card", async () => {
    const { cookie, mcp, stub } = await setup();
    const a = await ask(mcp, { title: "First?", expiresIn: "2h" });
    const b = await ask(mcp, { title: "Second?", expiresIn: "3h" });
    const flat = await call<Notification>(
      "POST",
      "/api/notifications",
      { cookie },
      { title: "Old style?", actions: [{ id: "ok", label: "OK", resolves: true }] },
    );
    expect(flat.body.intent).toBe("ask");
    const later = await ask(mcp, { title: "Not yet?", expiresIn: "4h" });
    for (const id of [a.id, b.id, flat.body.id]) await backdateExpiry(stub, id);

    await runDurableObjectAlarm(stub);
    for (const id of [a.id, b.id, flat.body.id]) {
      expect(await get(cookie, id), id).toMatchObject({ status: "resolved", ask: { state: "expired" } });
    }
    const open = await get(cookie, later.id);
    expect(open).toMatchObject({ status: "active", ask: { state: "open" } });
    if (open.intent !== "ask") throw new Error("not an ask");
    expect(await alarmAt(stub)).toBe(Date.parse(open.ask.expiresAt));
  });

  it("leaves answered asks alone", async () => {
    const { cookie, mcp, stub } = await setup();
    const { id } = await ask(mcp, { title: "Deploy?", options: ["Yes"] });
    await call("POST", `/api/notifications/${id}/respond`, { cookie }, { option: "Yes" });
    await backdateExpiry(stub, id);
    await runDurableObjectAlarm(stub);
    expect(await get(cookie, id)).toMatchObject({ ask: { state: "answered", answer: { option: "Yes" } } });
  });
});

describe("withdrawing an ask", () => {
  it("resolving an open ask withdraws it: no more answers, wait_for_response says so, no expiry left", async () => {
    const { cookie, mcp, stub } = await setup();
    const { ws, messages } = await socket(cookie);
    const { id } = await ask(mcp, { title: "Deploy?", options: ["Yes"], expiresIn: "2h" });
    const waiting = tool(mcp, "wait_for_response", { id, timeoutSeconds: 10 });
    await sleep(200);

    const r = await tool(mcp, "resolve", { id });
    expect(r.isError, r.text).toBe(false);
    expect((await waiting).text).toMatch(/^outcome: withdrawn\nid: ntf_\w+\nThe ask was withdrawn/);

    const n = await get(cookie, id);
    expect(n).toMatchObject({ status: "resolved", ask: { state: "withdrawn", answer: null } });
    if (n.intent !== "ask") throw new Error("not an ask");
    expect(Date.parse(n.ask.expiresAt) - Date.parse(n.createdAt)).toBe(2 * 3_600_000);
    const update = await eventually(() => messages.find((m) => m.type === "notification.updated" && m.reason === "resolved"));
    expect(update).toMatchObject({ notification: { id, ask: { state: "withdrawn" } } });

    const late = await call("POST", `/api/notifications/${id}/respond`, { cookie }, { option: "Yes" });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/withdrawn/);
    expect(await alarmAt(stub)).toBeGreaterThan(Date.now() + 23 * 3_600_000);

    // The alarm doesn't turn a withdrawn ask into an expired one.
    await backdateExpiry(stub, id);
    await runDurableObjectAlarm(stub);
    expect(await get(cookie, id)).toMatchObject({ ask: { state: "withdrawn" } });
    ws.close();
  });
});
