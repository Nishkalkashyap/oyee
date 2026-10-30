/** Every notification carries its intent (expand step): flat sends get an inferred intent block. */
import { Notification, type ServerMessage } from "@oyee/schema";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { encodeCursor, type InboxDO } from "../src/inbox/do";
import { BASE, call, createToken, devLogin, eventually, pairDevice } from "./helpers";

describe("intent of flat sends", () => {
  it("a plain card from the web composer is an inform", async () => {
    const cookie = await devLogin();
    const r = await call<Notification>("POST", "/api/notifications", { cookie }, { title: "Backup done" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      intent: "inform",
      key: null,
      title: "Backup done",
      inform: { links: [], fields: [], image: null, icon: null, cooldown: null },
    });
    expect(Notification.safeParse(r.body).error).toBeUndefined();
  });
});

describe("intent of webhook sends", () => {
  it("link actions become links and replaceKey becomes the key", async () => {
    const cookie = await devLogin();
    const hook = new URL((await createToken(cookie, "webhook", "CI", "ci")).url).pathname;
    const sent = await call("POST", hook, null, {
      title: "Deploy finished",
      replaceKey: "deploy-prod",
      icon: "🚀",
      fields: [{ label: "Env", value: "prod" }],
      actions: [{ id: "log", label: "Build log", url: "https://ci.example.com/42" }],
    });
    expect(sent.status).toBe(200);
    const n = (await call<Notification>("GET", `/api/notifications/${sent.body.id}`, { cookie })).body;
    expect(n).toMatchObject({
      intent: "inform",
      key: "deploy-prod",
      source: "ci",
      inform: {
        links: [{ label: "Build log", url: "https://ci.example.com/42" }],
        fields: [{ label: "Env", value: "prod" }],
        icon: "🚀",
        cooldown: null,
      },
      // the flat card is still there for older app builds
      actions: [{ id: "log", label: "Build log", url: "https://ci.example.com/42" }],
    });
  });

  it("a plain-text body with ntfy headers is an inform", async () => {
    const cookie = await devLogin();
    const hook = new URL((await createToken(cookie, "webhook")).url).pathname;
    const sent = await call("POST", hook, null, "Front door opened", { "Content-Type": "text/plain", Title: "Door" });
    const n = (await call<Notification>("GET", `/api/notifications/${sent.body.id}`, { cookie })).body;
    expect(n).toMatchObject({ intent: "inform", key: null, title: "Door", body: "Front door opened" });
  });
});

let rpcId = 0;

/** Calls an MCP tool and returns its first text content parsed as JSON. */
async function tool(path: string, name: string, args: unknown): Promise<any> {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  expect(body.result.isError ?? false).toBe(false);
  return JSON.parse(body.result.content[0]!.text);
}

/** Calls the MCP `ask` tool and reads the ask's id from its text result. */
async function askId(path: string, args: unknown): Promise<string> {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "ask", arguments: args } }),
  });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  expect(body.result.isError ?? false).toBe(false);
  return /ntf_[0-9A-Za-z]+/.exec(body.result.content[0]!.text)![0];
}

async function socket(cookie: string) {
  const res = await SELF.fetch(`${BASE}/api/ws`, { headers: { Upgrade: "websocket", Cookie: cookie } });
  const ws = res.webSocket!;
  const messages: ServerMessage[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(JSON.parse(e.data as string));
  });
  ws.accept();
  return { ws, messages };
}

describe("intent of MCP sends", () => {
  it("ask is an open ask until a device answers it", async () => {
    const cookie = await devLogin();
    const mcp = new URL((await createToken(cookie, "mcp", "Claude Code", "claude-code")).url).pathname;
    const { ws, messages } = await socket(cookie);

    const id = await askId(mcp, { title: "Deploy to prod?", options: ["Approve", "Reject"] });
    const asked = (await call<Notification>("GET", `/api/notifications/${id}`, { cookie })).body;
    expect(asked).toMatchObject({
      intent: "ask",
      ask: { options: ["Approve", "Reject"], allowText: false, replyPlaceholder: null, answer: null, state: "open" },
    });
    if (asked.intent !== "ask") throw new Error("not an ask");
    expect(Date.parse(asked.ask.expiresAt) - Date.parse(asked.createdAt)).toBe(3_600_000);

    const phone = await pairDevice(cookie, "Pixel 9");
    await call("POST", `/api/notifications/${id}/respond`, { bearer: phone.token }, { actionId: "option_1" });
    const update = await eventually(() =>
      messages.find((m) => m.type === "notification.updated" && m.reason === "responded"),
    );
    if (update.type !== "notification.updated") throw new Error("unexpected message");
    expect(update.notification).toMatchObject({
      intent: "ask",
      status: "resolved",
      ask: { state: "answered", answer: { option: "Approve", text: null, deviceName: "Pixel 9" } },
    });
    ws.close();
  });

  it("an ask with only a reply box accepts text", async () => {
    const cookie = await devLogin();
    const mcp = new URL((await createToken(cookie, "mcp")).url).pathname;
    const id = await askId(mcp, { title: "Which branch?" });
    await call("POST", `/api/notifications/${id}/respond`, { cookie }, { text: "main" });
    const n = (await call<Notification>("GET", `/api/notifications/${id}`, { cookie })).body;
    expect(n).toMatchObject({
      intent: "ask",
      ask: { options: [], allowText: true, replyPlaceholder: "Reply…", state: "answered", answer: { option: null, text: "main" } },
    });
  });

  it("an ask resolved without an answer is withdrawn", async () => {
    const cookie = await devLogin();
    const mcp = new URL((await createToken(cookie, "mcp")).url).pathname;
    const id = await askId(mcp, { title: "Still needed?", options: ["Yes"] });
    const n = await tool(mcp, "resolve_notification", { id });
    expect(n).toMatchObject({ intent: "ask", status: "resolved", ask: { state: "withdrawn", answer: null } });
  });

  it("send_notification with progress is a running progress, done at max", async () => {
    const cookie = await devLogin();
    const mcp = new URL((await createToken(cookie, "mcp")).url).pathname;
    const sent = await tool(mcp, "send_notification", {
      title: "Build",
      replaceKey: "build-42",
      progress: { value: 2, max: 7, label: "2/7 checks" },
    });
    expect(sent).toMatchObject({
      intent: "progress",
      key: "build-42",
      progress: { value: 2, max: 7, label: "2/7 checks", state: "running", staleAfter: "30m", lastReportAt: sent.createdAt },
    });
    const done = await tool(mcp, "update_notification", { id: sent.id, progress: { value: 7, max: 7 } });
    expect(done).toMatchObject({ intent: "progress", key: "build-42", progress: { value: 7, state: "done" } });
    expect(done.progress.lastReportAt).toBe(done.updatedAt);
  });

  it("a card with answer buttons and a progress bar is an ask", async () => {
    const cookie = await devLogin();
    const mcp = new URL((await createToken(cookie, "mcp")).url).pathname;
    const sent = await tool(mcp, "send_notification", {
      title: "Canary at 40%",
      progress: { value: 40 },
      actions: [{ id: "abort", label: "Abort", resolves: true }],
    });
    expect(sent).toMatchObject({ intent: "ask", ask: { options: ["Abort"], state: "open" }, progress: { value: 40 } });
  });
});

// ─── Notifications stored before intents existed ────────────────────────────

const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:05:00.000Z";

/** A notification as protocol v1 stored it. */
function legacyCard(id: string, over: Record<string, unknown>) {
  return {
    id,
    source: "claude-code",
    threadId: "t-1",
    title: `Card ${id}`,
    body: null,
    severity: "info",
    status: "active",
    icon: null,
    image: null,
    url: null,
    fields: [],
    progress: null,
    actions: [],
    reply: null,
    tags: ["old"],
    silent: false,
    template: null,
    version: 2,
    createdAt: T0,
    updatedAt: T1,
    readAt: null,
    resolvedAt: null,
    responses: [],
    ...over,
  };
}

const LEGACY_ROWS: [card: ReturnType<typeof legacyCard>, replaceKey: string | null][] = [
  [
    legacyCard("ntf_01LEGACYINFORM00000000000", {
      severity: "debug",
      icon: "🚀",
      fields: [{ label: "Env", value: "prod" }],
      actions: [{ id: "pr", label: "Open PR", style: "default", url: "https://github.com/o/r/pull/1", resolves: false }],
    }),
    "deploy",
  ],
  [
    legacyCard("ntf_01LEGACYANSWERED000000000", {
      status: "resolved",
      resolvedAt: T1,
      actions: [
        { id: "option_1", label: "Yes", style: "primary", resolves: true },
        { id: "option_2", label: "No", style: "default", resolves: true },
      ],
      responses: [{ actionId: "option_2", text: null, deviceId: "dev_1", deviceName: "Pixel 9", at: T1 }],
    }),
    null,
  ],
  [legacyCard("ntf_01LEGACYUNANSWERED0000000", { reply: { placeholder: "Reply…", buttonLabel: "Send" } }), null],
  [legacyCard("ntf_01LEGACYPROGRESSDONE00000", { progress: { value: 5, max: 5, indeterminate: false } }), "build"],
  [
    legacyCard("ntf_01LEGACYPROGRESSHALF00000", { progress: { value: 2, max: 5, label: "2/5", indeterminate: false } }),
    null,
  ],
];

/** Recreates the user's inbox table as it was before intents, with LEGACY_ROWS in it, then restarts the inbox. */
async function seedLegacyInbox(userId: string) {
  const id = env.INBOX.idFromName(userId);
  await runInDurableObject(env.INBOX.get(id), (_inst: InboxDO, state) => {
    const sql = state.storage.sql;
    sql.exec("DELETE FROM meta WHERE key = 'schema'");
    sql.exec("UPDATE meta SET value = ? WHERE key = 'seq'", LEGACY_ROWS.length);
    sql.exec("DROP TABLE notifications");
    sql.exec(`CREATE TABLE notifications (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, source TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL, thread_id TEXT,
      replace_key TEXT, read_at TEXT, token_id TEXT, search TEXT NOT NULL, data TEXT NOT NULL)`);
    LEGACY_ROWS.forEach(([n, replaceKey], i) => {
      sql.exec(
        `INSERT INTO notifications (id, seq, created_at, updated_at, source, severity, status, thread_id, replace_key,
           read_at, token_id, search, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', ?)`,
        n.id,
        i + 1,
        n.createdAt,
        n.updatedAt,
        n.source,
        n.severity,
        n.status,
        n.threadId,
        replaceKey,
        JSON.stringify(n),
      );
    });
  });
  await runInDurableObject(env.INBOX.get(id), (_inst: InboxDO, state) => state.abort("restart")).catch(() => undefined);
}

describe("notifications stored before intents", () => {
  it("are converted once to the intent they most resemble", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedLegacyInbox(me.id);

    const list = await call<{ items: Notification[] }>("GET", "/api/notifications", { cookie });
    expect(list.status).toBe(200);
    const byId = new Map(list.body.items.map((n) => [n.id, n]));
    expect(byId.size).toBe(LEGACY_ROWS.length);
    for (const n of list.body.items) expect(Notification.safeParse(n).error).toBeUndefined();

    expect(byId.get("ntf_01LEGACYINFORM00000000000")).toMatchObject({
      intent: "inform",
      key: "deploy",
      inform: {
        links: [{ label: "Open PR", url: "https://github.com/o/r/pull/1" }],
        fields: [{ label: "Env", value: "prod" }],
        image: null,
        icon: "🚀",
        cooldown: null,
      },
      // flat fields untouched for older app builds
      severity: "debug",
      tags: ["old"],
      threadId: "t-1",
      version: 2,
    });
    expect(byId.get("ntf_01LEGACYANSWERED000000000")).toMatchObject({
      intent: "ask",
      key: null,
      ask: {
        options: ["Yes", "No"],
        allowText: false,
        state: "answered",
        answer: { option: "No", text: null, deviceId: "dev_1", deviceName: "Pixel 9", at: T1 },
      },
    });
    expect(byId.get("ntf_01LEGACYUNANSWERED0000000")).toMatchObject({
      intent: "ask",
      ask: { options: [], allowText: true, replyPlaceholder: "Reply…", answer: null, state: "expired" },
    });
    expect(byId.get("ntf_01LEGACYPROGRESSDONE00000")).toMatchObject({
      intent: "progress",
      key: "build",
      progress: { value: 5, max: 5, state: "done", lastReportAt: T1 },
    });
    expect(byId.get("ntf_01LEGACYPROGRESSHALF00000")).toMatchObject({
      intent: "progress",
      progress: { value: 2, max: 5, label: "2/5", state: "stopped", staleAfter: "30m", lastReportAt: T1 },
    });
  });

  it("are converted only once", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedLegacyInbox(me.id);
    const first = (await call<{ items: Notification[] }>("GET", "/api/notifications", { cookie })).body.items;

    // Answering the converted (expired) ask from an old app build, then restarting, must not convert it again.
    await call("POST", `/api/notifications/ntf_01LEGACYUNANSWERED0000000/respond`, { cookie }, { text: "late" });
    const id = env.INBOX.idFromName(me.id);
    await runInDurableObject(env.INBOX.get(id), (_inst: InboxDO, state) => state.abort("restart")).catch(() => undefined);

    const again = (await call<{ items: Notification[] }>("GET", "/api/notifications", { cookie })).body.items;
    expect(again.map((n) => n.id)).toEqual(first.map((n) => n.id));
    expect(again.find((n) => n.id === "ntf_01LEGACYUNANSWERED0000000")).toMatchObject({
      intent: "ask",
      ask: { state: "answered", answer: { text: "late" } },
    });
    expect(again.find((n) => n.id === "ntf_01LEGACYPROGRESSHALF00000")).toEqual(
      first.find((n) => n.id === "ntf_01LEGACYPROGRESSHALF00000"),
    );
  });

  it("reach clients that synced before the upgrade", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedLegacyInbox(me.id);
    // The client's cursor from before the upgrade: it had seen every legacy row.
    const cursor = encodeCursor({ s: LEGACY_ROWS.length });
    const sync = await call<{ items: Notification[] }>("GET", `/api/notifications?updatedSince=${cursor}`, { cookie });
    expect(sync.body.items).toHaveLength(LEGACY_ROWS.length);
    expect(sync.body.items.every((n) => n.intent !== undefined)).toBe(true);
  });

  it("new notifications sit next to converted ones with their key", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedLegacyInbox(me.id);
    const hook = new URL((await createToken(cookie, "webhook")).url).pathname;
    const sent = await call("POST", hook, null, { title: "fresh", replaceKey: "fresh-key" });
    const n = (await call<Notification>("GET", `/api/notifications/${sent.body.id}`, { cookie })).body;
    expect(n).toMatchObject({ intent: "inform", key: "fresh-key" });
  });
});
