/**
 * Stopped reporting: a running progress that gets no report for `staleAfter` is marked stopped by the inbox alarm,
 * alerts once at warning, and a later report revives it. Time passes by backdating the stored `lastReportAt` through
 * the Durable Object and firing its alarm (spec "Time-based rules"); everything is observed via MCP, REST and WebSocket.
 */
import type { Notification, ServerMessage } from "@oyee/schema";
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxDO } from "../src/inbox/do";
import { BASE, call, createToken, devLogin, eventually, pairDevice } from "./helpers";

afterEach(() => vi.restoreAllMocks());

let rpcId = 0;

/** Calls an MCP tool; returns its text result and the notification id it mentions. */
async function tool(path: string, name: string, args: unknown) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = body.result.content[0]!.text;
  return { isError: body.result.isError ?? false, text, id: /ntf_[0-9A-Za-z]+/.exec(text)?.[0] ?? null };
}

type NotificationEvent = Extract<ServerMessage, { type: "notification.created" | "notification.updated" }>;

async function setup() {
  const cookie = await devLogin();
  const me = (await call<{ id: string }>("GET", "/api/me", { cookie })).body;
  const stub = env.INBOX.get(env.INBOX.idFromName(me.id));
  const mcp = new URL((await createToken(cookie, "mcp", "Claude Code", "claude-code")).url).pathname;
  const res = await SELF.fetch(`${BASE}/api/ws`, { headers: { Upgrade: "websocket", Cookie: cookie } });
  const ws = res.webSocket!;
  const messages: ServerMessage[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(e.data as string));
  });
  ws.accept();
  await eventually(() => messages.find((m) => m.type === "hello"));
  const events = (from = 0) =>
    messages.slice(from).filter((m): m is NotificationEvent => m.type === "notification.created" || m.type === "notification.updated");
  const get = async (id: string) => (await call<Notification>("GET", `/api/notifications/${id}`, { cookie })).body;

  /** Makes the progress look like its last report was `ms` ago. */
  const quietFor = (id: string, ms: number) =>
    runInDurableObject(stub, async (_inst: InboxDO, state) => {
      state.storage.sql.exec(
        "UPDATE notifications SET data = json_set(data, '$.progress.lastReportAt', ?) WHERE id = ?",
        new Date(Date.now() - ms).toISOString(),
        id,
      );
    });
  const alarmAt = () => runInDurableObject(stub, (_inst: InboxDO, state) => state.storage.getAlarm());
  return { cookie, stub, mcp, ws, messages, events, get, quietFor, alarmAt };
}

const MIN = 60_000;

describe("stopped reporting", () => {
  it("a running progress that went quiet for staleAfter is marked stopped and alerts once at warning", async () => {
    const { stub, mcp, ws, messages, events, get, quietFor } = await setup();
    const r = await tool(mcp, "progress", { key: "deploy", title: "Deploying api", value: 40 });
    await eventually(() => events().length === 1);
    await quietFor(r.id!, 31 * MIN);

    const from = messages.length;
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const ev = await eventually(() => events(from)[0]);
    expect(ev).toMatchObject({
      type: "notification.updated",
      alert: true,
      notification: {
        id: r.id,
        severity: "warning",
        status: "active",
        readAt: null,
        // older app builds read the flat `silent`: this one should sound
        silent: false,
        progress: { value: 40, max: 100, state: "stopped" },
      },
    });
    expect(await get(r.id!)).toMatchObject({ version: 2, progress: { state: "stopped" } });

    // Only once: a later firing leaves it alone.
    const after = messages.length;
    await runDurableObjectAlarm(stub);
    await new Promise((res) => setTimeout(res, 100));
    expect(events(after)).toEqual([]);
    expect(await get(r.id!)).toMatchObject({ version: 2 });
    ws.close();
  });

  it("a later report revives a stopped progress as running, silently, and it can stop again", async () => {
    const { stub, mcp, ws, messages, events, quietFor, alarmAt } = await setup();
    const r = await tool(mcp, "progress", { key: "ci", title: "CI", value: 3, max: 7, label: "3/7 checks" });
    await quietFor(r.id!, 31 * MIN);
    await runDurableObjectAlarm(stub);
    await eventually(() => events().some((e) => e.notification.version === 2));

    const from = messages.length;
    const again = await tool(mcp, "progress", { key: "ci", title: "CI" });
    expect(again.id).toBe(r.id);
    expect(again.text).toMatch(/^outcome: updated_silently\nid: ntf_[0-9A-Za-z]+\n/);
    expect(again.text).toContain("stopped reporting and is running again");
    const ev = await eventually(() => events(from)[0]);
    expect(ev).toMatchObject({
      type: "notification.updated",
      alert: false,
      notification: {
        id: r.id,
        severity: "info",
        silent: true,
        // the sender's label survived the stop
        progress: { value: 3, max: 7, label: "3/7 checks", state: "running" },
      },
    });
    // its stale deadline is back
    const due = Date.parse(ev.notification.intent === "progress" ? ev.notification.progress.lastReportAt : "") + 30 * MIN;
    expect(await alarmAt()).toBe(due);

    await quietFor(r.id!, 31 * MIN);
    const later = messages.length;
    await runDurableObjectAlarm(stub);
    expect(await eventually(() => events(later)[0])).toMatchObject({ alert: true, notification: { progress: { state: "stopped" } } });
    ws.close();
  });

  it("staleAfter sets how long it may go quiet, and the alarm waits for that deadline", async () => {
    const { stub, mcp, ws, messages, events, get, quietFor, alarmAt } = await setup();
    const r = await tool(mcp, "progress", { key: "train", title: "Training", value: 10, staleAfter: "2h" });
    const n = await get(r.id!);
    expect(n).toMatchObject({ progress: { staleAfter: "2h" } });
    expect(r.text).toContain("2h");
    expect(await alarmAt()).toBe(Date.parse(n.intent === "progress" ? n.progress.lastReportAt : "") + 120 * MIN);

    // Quiet for an hour: not stopped yet, the alarm moves to the real deadline.
    await quietFor(r.id!, 60 * MIN);
    const from = messages.length;
    await runDurableObjectAlarm(stub);
    await new Promise((res) => setTimeout(res, 100));
    expect(events(from)).toEqual([]);
    expect(await get(r.id!)).toMatchObject({ version: 1, progress: { state: "running" } });
    const due = await alarmAt();
    expect(due).toBeGreaterThan(Date.now() + 59 * MIN);
    expect(due).toBeLessThan(Date.now() + 61 * MIN);

    // A later report keeps the progress's staleAfter.
    await tool(mcp, "progress", { key: "train", title: "Training", value: 20 });
    expect(await get(r.id!)).toMatchObject({ progress: { staleAfter: "2h" } });
    ws.close();
  });

  it("staleAfter outside the bounds is rejected", async () => {
    const { mcp, ws } = await setup();
    for (const staleAfter of ["30s", "25h", "soon"]) {
      const r = await tool(mcp, "progress", { key: "x", title: "X", staleAfter });
      expect(r.isError, staleAfter).toBe(true);
      expect(r.text, staleAfter).toMatch(/staleAfter/);
    }
    ws.close();
  });

  it("a finished or resolved progress never stops reporting", async () => {
    const { cookie, stub, mcp, ws, messages, events, get, quietFor, alarmAt } = await setup();
    const done = await tool(mcp, "progress", { key: "a", title: "A", value: 10 });
    expect(await alarmAt()).toBeLessThanOrEqual(Date.now() + 30 * MIN);
    await tool(mcp, "progress", { key: "a", title: "A", status: "done" });
    // finishing drops its stale deadline: the alarm falls back to the daily prune
    expect(await alarmAt()).toBeGreaterThan(Date.now() + 23 * 60 * MIN);

    const resolved = await tool(mcp, "progress", { key: "b", title: "B", value: 10 });
    await call("POST", `/api/notifications/${resolved.id}/resolve`, { cookie });
    await quietFor(done.id!, 31 * MIN);
    await quietFor(resolved.id!, 31 * MIN);
    const from = messages.length;
    await runDurableObjectAlarm(stub);
    await new Promise((res) => setTimeout(res, 100));
    expect(events(from)).toEqual([]);
    expect(await get(done.id!)).toMatchObject({ progress: { state: "done" } });
    expect(await get(resolved.id!)).toMatchObject({ status: "resolved", progress: { state: "running" } });
    ws.close();
  });

  it("the stop reaches phones as an alerting push", async () => {
    const { cookie, stub, mcp, ws, quietFor } = await setup();
    const phone = await pairDevice(cookie, "Pixel 9", "android");
    await call("PUT", "/api/devices/self", { bearer: phone.token }, { fcmToken: "fcm-stopped" });
    const realFetch = globalThis.fetch;
    const sent: { data: Record<string, string>; android: { priority: string } }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input as RequestInfo, init as RequestInit);
      if (req.url.startsWith("https://oauth2.googleapis.com/")) return Response.json({ access_token: "t", expires_in: 3600 });
      if (req.url.startsWith("https://fcm.googleapis.com/")) {
        sent.push(((await req.json()) as { message: (typeof sent)[number] }).message);
        return Response.json({ name: "m" });
      }
      return realFetch(input as RequestInfo, init as RequestInit);
    });

    const r = await tool(mcp, "progress", { key: "deploy", title: "Deploy", value: 40 });
    await eventually(() => sent.length === 1);
    await quietFor(r.id!, 31 * MIN);
    await runDurableObjectAlarm(stub);
    const stop = await eventually(() => sent.find((m) => m.data.alert === "true"));
    expect(stop.data).toMatchObject({ type: "notification.updated", id: r.id });
    expect(stop.android.priority).toBe("HIGH");
    expect(JSON.parse(stop.data.notification!)).toMatchObject({ silent: false, progress: { state: "stopped" } });
    ws.close();
  });

  it("resolving a stopped progress keeps it stopped", async () => {
    const { cookie, stub, mcp, ws, events, get, quietFor } = await setup();
    const r = await tool(mcp, "progress", { key: "c", title: "C", value: 40 });
    await quietFor(r.id!, 31 * MIN);
    await runDurableObjectAlarm(stub);
    await eventually(() => events().some((e) => e.notification.version === 2));
    await call("POST", `/api/notifications/${r.id}/resolve`, { cookie });
    expect(await get(r.id!)).toMatchObject({ status: "resolved", severity: "warning", progress: { value: 40, state: "stopped" } });
    ws.close();
  });
});
