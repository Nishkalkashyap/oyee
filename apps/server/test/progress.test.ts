/** Progress end-to-end: one MCP `progress` tool called repeatedly with a key; silent while running, alerts once at the end. */
import type { Notification, ServerMessage } from "@oyee/schema";
import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
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

async function setup(label = "Claude Code", source = "claude-code") {
  const cookie = await devLogin();
  const mcp = new URL((await createToken(cookie, "mcp", label, source)).url).pathname;
  const res = await SELF.fetch(`${BASE}/api/ws`, { headers: { Upgrade: "websocket", Cookie: cookie } });
  const ws = res.webSocket!;
  const messages: ServerMessage[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(e.data as string));
  });
  ws.accept();
  await eventually(() => messages.find((m) => m.type === "hello"));
  /** The next notification event after `from`. */
  const next = (from: number) =>
    eventually(() => messages.slice(from).find((m) => m.type === "notification.created" || m.type === "notification.updated")) as Promise<
      Extract<ServerMessage, { type: "notification.created" | "notification.updated" }>
    >;
  const get = async (id: string) => (await call<Notification>("GET", `/api/notifications/${id}`, { cookie })).body;
  return { cookie, mcp, ws, messages, next, get };
}

describe("MCP progress", () => {
  it("the first report creates a running progress that appears without sound", async () => {
    const { mcp, ws, messages, next, get } = await setup();
    const r = await tool(mcp, "progress", { key: "deploy", title: "Deploying api", value: 3, max: 7, label: "3/7 steps" });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/^outcome: created\nid: ntf_[0-9A-Za-z]+\n/);
    expect(r.text).toContain('"deploy"');

    const ev = await next(0);
    expect(ev.type).toBe("notification.created");
    expect(ev.notification).toMatchObject({
      id: r.id,
      intent: "progress",
      key: "deploy",
      source: "claude-code",
      title: "Deploying api",
      severity: "info",
      status: "active",
      // older app builds read these flat fields: no sound, native bar from `progress`
      silent: true,
      progress: { value: 3, max: 7, label: "3/7 steps", state: "running", staleAfter: "30m", indeterminate: false },
    });
    expect(await get(r.id!)).toMatchObject({ intent: "progress", progress: { state: "running" } });
    expect(messages.length).toBeGreaterThan(0);
    ws.close();
  });

  it("later reports with the same key update it in place without alerting", async () => {
    const { mcp, ws, messages, next, get } = await setup();
    const first = await tool(mcp, "progress", { key: "deploy", title: "Deploying api", value: 1, max: 4, body: "Step 1" });
    await next(0);
    const from = messages.length;
    const r = await tool(mcp, "progress", { key: "deploy", title: "Deploying api", value: 2 });
    expect(r.text).toMatch(/^outcome: updated_silently\nid: ntf_[0-9A-Za-z]+\n/);
    expect(r.id).toBe(first.id);

    const ev = await next(from);
    expect(ev).toMatchObject({ type: "notification.updated", alert: false, reason: "update" });
    // omitted fields keep the previous report's value
    expect(ev.notification).toMatchObject({ version: 2, silent: true, body: "Step 1", progress: { value: 2, max: 4, state: "running" } });
    expect(await get(first.id!)).toMatchObject({ version: 2, progress: { value: 2 } });
    ws.close();
  });

  it("done alerts once at success and stays active and unread", async () => {
    const { cookie, mcp, ws, messages, next, get } = await setup();
    const first = await tool(mcp, "progress", { key: "ci", title: "CI", value: 3, max: 7, label: "3/7 checks" });
    await next(0);
    await call("POST", `/api/notifications/${first.id}/read`, { cookie });
    const from = messages.length;
    const r = await tool(mcp, "progress", { key: "ci", title: "CI passed", status: "done" });
    expect(r.text).toMatch(/^outcome: alerted\nid: ntf_[0-9A-Za-z]+\n/);
    expect(r.text).toContain("done");

    const ev = await eventually(() =>
      messages.slice(from).find((m) => m.type === "notification.updated" && m.reason === "update"),
    );
    expect(ev).toMatchObject({
      alert: true,
      notification: {
        id: first.id,
        title: "CI passed",
        severity: "success",
        status: "active",
        readAt: null,
        silent: false,
        // value defaults to max; the old label described 3/7 so it's dropped
        progress: { value: 7, max: 7, state: "done" },
      },
    });
    const n = await get(first.id!);
    expect(n).toMatchObject({ status: "active", resolvedAt: null, progress: { state: "done" } });
    expect(n.progress).not.toHaveProperty("label");
    ws.close();
  });

  it("failed alerts once at warning", async () => {
    const { mcp, ws, messages, next } = await setup();
    const first = await tool(mcp, "progress", { key: "e2e", title: "e2e tests", value: 40 });
    await next(0);
    const from = messages.length;
    const r = await tool(mcp, "progress", { key: "e2e", title: "e2e tests", status: "failed", body: "`login` failed" });
    expect(r.text).toMatch(/^outcome: alerted\nid: ntf_[0-9A-Za-z]+\n/);
    const ev = await next(from);
    expect(ev).toMatchObject({
      type: "notification.updated",
      alert: true,
      notification: { id: first.id, severity: "warning", silent: false, status: "active", progress: { value: 40, state: "failed" } },
    });
    ws.close();
  });

  it("a running report after a finished progress starts a fresh one", async () => {
    const { mcp, ws, messages, next, get } = await setup();
    const first = await tool(mcp, "progress", { key: "nightly", title: "Nightly", value: 10 });
    await tool(mcp, "progress", { key: "nightly", title: "Nightly", status: "done" });
    await next(0);
    const from = messages.length;
    const again = await tool(mcp, "progress", { key: "nightly", title: "Nightly", value: 5 });
    expect(again.text).toMatch(/^outcome: created\nid: ntf_[0-9A-Za-z]+\n/);
    expect(again.id).not.toBe(first.id);
    const ev = await eventually(() => messages.slice(from).find((m) => m.type === "notification.created"));
    expect(ev).toMatchObject({ notification: { id: again.id, silent: true, version: 1, progress: { value: 5, state: "running" } } });
    // the finished one is left as it was
    expect(await get(first.id!)).toMatchObject({ status: "active", progress: { state: "done" } });
    ws.close();
  });

  it("keys are per source", async () => {
    const { cookie, mcp, ws } = await setup();
    const a = await tool(mcp, "progress", { key: "build", title: "Build" });
    const b = await tool(mcp, "progress", { key: "build", title: "Build", source: "other-agent" });
    expect(b.text).toMatch(/^outcome: created\nid: ntf_[0-9A-Za-z]+\n/);
    expect(b.id).not.toBe(a.id);
    const again = await tool(mcp, "progress", { key: "build", title: "Build", source: "other-agent", value: 50 });
    expect(again.id).toBe(b.id);
    const n = (await call<Notification>("GET", `/api/notifications/${a.id}`, { cookie })).body;
    expect(n).toMatchObject({ source: "claude-code", progress: { value: 0 } });
    ws.close();
  });

  it("a finished progress keeps its outcome when the user resolves it", async () => {
    const { cookie, mcp, ws, get } = await setup();
    const first = await tool(mcp, "progress", { key: "e2e", title: "e2e", value: 2, max: 5 });
    await tool(mcp, "progress", { key: "e2e", title: "e2e", status: "failed" });
    await call("POST", `/api/notifications/${first.id}/resolve`, { cookie });
    expect(await get(first.id!)).toMatchObject({ status: "resolved", severity: "warning", progress: { value: 2, state: "failed" } });
    ws.close();
  });

  it("rejects a report without a key", async () => {
    const { mcp, ws } = await setup();
    const r = await tool(mcp, "progress", { title: "No key" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/key/);
    ws.close();
  });
});

describe("progress push", () => {
  it("running reports reach FCM without alert at normal priority; finishing alerts at high priority", async () => {
    const { cookie, mcp, ws } = await setup();
    const phone = await pairDevice(cookie, "Pixel 9", "android");
    await call("PUT", "/api/devices/self", { bearer: phone.token }, { fcmToken: "fcm-progress" });
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

    const first = await tool(mcp, "progress", { key: "build", title: "Build", value: 10 });
    await eventually(() => sent.length === 1);
    expect(sent[0]!.data).toMatchObject({ type: "notification.created", id: first.id, alert: "false" });
    expect(sent[0]!.android.priority).toBe("NORMAL");
    expect(JSON.parse(sent[0]!.data.notification!)).toMatchObject({ intent: "progress", silent: true });

    await tool(mcp, "progress", { key: "build", title: "Build", status: "done" });
    await eventually(() => sent.some((m) => m.data.alert === "true"), 4000);
    const done = sent.find((m) => m.data.alert === "true")!;
    expect(done.data).toMatchObject({ type: "notification.updated", id: first.id });
    expect(done.android.priority).toBe("HIGH");
    expect(JSON.parse(done.data.notification!)).toMatchObject({ silent: false, progress: { state: "done" } });
    ws.close();
  });
});

describe("progress tool schema", () => {
  it("is a flat object where key and title are required and every field is described", async () => {
    const { mcp, ws } = await setup();
    const res = await SELF.fetch(`${BASE}${mcp}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/list", params: {} }),
    });
    const tools = ((await res.json()) as { result: { tools: { name: string; inputSchema: any }[] } }).result.tools;
    const schema = tools.find((t) => t.name === "progress")!.inputSchema;
    expect(schema.type).toBe("object");
    expect([...schema.required].sort()).toEqual(["key", "title"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["body", "devices", "key", "label", "max", "platforms", "source", "status", "title", "url", "value"].sort(),
    );
    expect(schema.properties.status.enum).toEqual(["running", "done", "failed"]);
    for (const [name, prop] of Object.entries<any>(schema.properties)) expect(prop.description, name).toBeTruthy();
    ws.close();
  });
});
