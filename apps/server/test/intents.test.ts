/** Every notification is one intent (protocol v2): what each sender produces, and how stored rows are converted. */
import { Notification, type ServerMessage } from "@oyee/schema";
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { encodeCursor, type InboxDO } from "../src/inbox/do";
import { BASE, call, createToken, devLogin, eventually, pairDevice } from "./helpers";

/** The keys of a v2 notification of this intent: shared fields plus its one block, nothing from the flat card. */
const v2Keys = (intent: string) =>
  [
    "id", "intent", "source", "key", "title", "body", "severity", "status", "url", "version", "createdAt", "updatedAt",
    "readAt", "resolvedAt", "targetDeviceIds", intent,
  ].sort();

describe("intent of REST and webhook sends", () => {
  it("a plain body from the web composer is an inform", async () => {
    const cookie = await devLogin();
    const r = await call<{ notification: Notification }>("POST", "/api/notifications", { cookie }, { title: "Backup done" });
    expect(r.status).toBe(201);
    expect(r.body.notification).toMatchObject({
      intent: "inform",
      key: null,
      title: "Backup done",
      inform: { links: [], fields: [], image: null, icon: null, cooldown: null },
    });
    expect(Object.keys(r.body.notification).sort()).toEqual(v2Keys("inform"));
    expect(Notification.safeParse(r.body.notification).error).toBeUndefined();
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
    expect(Object.keys(asked).sort()).toEqual(v2Keys("ask"));
    if (asked.intent !== "ask") throw new Error("not an ask");
    expect(Date.parse(asked.ask.expiresAt) - Date.parse(asked.createdAt)).toBe(3_600_000);

    const phone = await pairDevice(cookie, "Pixel 9");
    await call("POST", `/api/notifications/${id}/respond`, { bearer: phone.token }, { option: "Approve" });
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
    const res = await SELF.fetch(`${BASE}${mcp}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name: "resolve", arguments: { id } } }),
    });
    expect(((await res.json()) as { result: { isError?: boolean } }).result.isError ?? false).toBe(false);
    const n = (await call<Notification>("GET", `/api/notifications/${id}`, { cookie })).body;
    expect(n).toMatchObject({ intent: "ask", status: "resolved", ask: { state: "withdrawn", answer: null } });
  });
});

// ─── Notifications stored before protocol v2 ───────────────────────────────

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

type StoredRow = [data: Record<string, unknown>, replaceKey: string | null];

const LEGACY_ROWS: StoredRow[] = [
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
    "sync",
  ],
];

/** Rows stored while both protocols overlapped (storage schema 1): the intent block next to the flat card. */
const OVERLAP_ROWS: StoredRow[] = [
  [
    legacyCard("ntf_01OVERLAPDEBUG000000000", {
      intent: "inform",
      key: "noisy",
      severity: "debug",
      inform: { links: [], fields: [], image: null, icon: null, cooldown: null },
    }),
    "noisy",
  ],
  [
    legacyCard("ntf_01OVERLAPPROGRESS000000", {
      intent: "progress",
      key: "import",
      silent: true,
      progress: { value: 3, max: 7, state: "running", staleAfter: "30m", lastReportAt: T1, indeterminate: false },
    }),
    null,
  ],
];

/**
 * Recreates the user's inbox table as storage schema `schema` left it (0: before intents, 1: intents next to the flat
 * card) with `rows` in it, then restarts the inbox so it migrates.
 */
async function seedOldInbox(userId: string, schema: 0 | 1, rows: StoredRow[]) {
  const id = env.INBOX.idFromName(userId);
  await runInDurableObject(env.INBOX.get(id), (_inst: InboxDO, state) => {
    const sql = state.storage.sql;
    if (schema === 0) sql.exec("DELETE FROM meta WHERE key = 'schema'");
    else sql.exec("INSERT INTO meta (key, value) VALUES ('schema', 1) ON CONFLICT(key) DO UPDATE SET value = 1");
    sql.exec("UPDATE meta SET value = ? WHERE key = 'seq'", rows.length);
    sql.exec("DROP TABLE notifications");
    sql.exec(`CREATE TABLE notifications (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, source TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL, thread_id TEXT,
      replace_key TEXT, read_at TEXT, token_id TEXT, search TEXT NOT NULL, data TEXT NOT NULL
      ${schema === 1 ? ", intent TEXT, key TEXT, alerted_at TEXT" : ""})`);
    sql.exec("CREATE INDEX ntf_thread ON notifications(thread_id, id)");
    sql.exec("CREATE INDEX ntf_replace ON notifications(replace_key, status)");
    sql.exec("CREATE TABLE IF NOT EXISTS templates (name TEXT PRIMARY KEY, data TEXT NOT NULL)");
    rows.forEach(([n, replaceKey], i) => {
      sql.exec(
        `INSERT INTO notifications (id, seq, created_at, updated_at, source, severity, status, thread_id, replace_key,
           read_at, token_id, search, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', ?)`,
        n.id as string,
        i + 1,
        n.createdAt as string,
        n.updatedAt as string,
        n.source as string,
        n.severity as string,
        n.status as string,
        n.threadId as string,
        replaceKey,
        JSON.stringify(n),
      );
      if (schema === 1) sql.exec("UPDATE notifications SET intent = ?, key = ? WHERE id = ?", n.intent as string, n.key as string, n.id as string);
    });
  });
  await runInDurableObject(env.INBOX.get(id), (_inst: InboxDO, state) => state.abort("restart")).catch(() => undefined);
}

async function inboxTables(userId: string) {
  return runInDurableObject(env.INBOX.get(env.INBOX.idFromName(userId)), (_inst: InboxDO, state) => ({
    tables: state.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((r) => r.name),
    columns: state.storage.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('notifications')").toArray().map((r) => r.name),
  }));
}

describe("notifications stored before protocol v2", () => {
  it("flat cards become the intent they most resemble, with nothing of the flat card left", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedOldInbox(me.id, 0, LEGACY_ROWS);

    const list = await call<{ items: Notification[] }>("GET", "/api/notifications", { cookie });
    expect(list.status).toBe(200);
    const byId = new Map(list.body.items.map((n) => [n.id, n]));
    expect(byId.size).toBe(LEGACY_ROWS.length);
    for (const n of list.body.items) {
      expect(Notification.safeParse(n).error).toBeUndefined();
      expect(Object.keys(n).sort(), n.id).toEqual(v2Keys(n.intent));
    }

    expect(byId.get("ntf_01LEGACYINFORM00000000000")).toMatchObject({
      intent: "inform",
      key: "deploy",
      severity: "info", // debug is gone
      version: 2,
      inform: {
        links: [{ label: "Open PR", url: "https://github.com/o/r/pull/1" }],
        fields: [{ label: "Env", value: "prod" }],
        image: null,
        icon: "🚀",
        cooldown: null,
      },
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
    expect(byId.get("ntf_01LEGACYPROGRESSHALF00000")).toEqual(
      expect.objectContaining({
        intent: "progress",
        progress: { value: 2, max: 5, label: "2/5", state: "stopped", staleAfter: "30m", lastReportAt: T1 },
      }),
    );

    // Severity filters and search read the converted rows; thread, replace-key and template storage is gone.
    const info = await call<{ items: Notification[] }>("GET", "/api/notifications?severity=info", { cookie });
    expect(info.body.items.map((n) => n.id)).toContain("ntf_01LEGACYINFORM00000000000");
    const q = await call<{ items: Notification[] }>("GET", "/api/notifications?q=env", { cookie });
    expect(q.body.items.map((n) => n.id)).toEqual(["ntf_01LEGACYINFORM00000000000"]);
    const { tables, columns } = await inboxTables(me.id);
    expect(tables).not.toContain("templates");
    expect(columns).not.toContain("thread_id");
    expect(columns).not.toContain("replace_key");
  });

  it("rows from the overlap lose their flat fields and debug; only changed ones are synced again", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedOldInbox(me.id, 1, OVERLAP_ROWS);

    const list = (await call<{ items: Notification[] }>("GET", "/api/notifications", { cookie })).body.items;
    for (const n of list) expect(Object.keys(n).sort(), n.id).toEqual(v2Keys(n.intent));
    expect(list.find((n) => n.id === "ntf_01OVERLAPDEBUG000000000")).toMatchObject({ intent: "inform", key: "noisy", severity: "info" });
    expect(list.find((n) => n.id === "ntf_01OVERLAPPROGRESS000000")).toEqual(
      expect.objectContaining({
        intent: "progress",
        progress: { value: 3, max: 7, state: "running", staleAfter: "30m", lastReportAt: T1 },
      }),
    );

    // A client that had synced everything before the upgrade gets the row whose severity changed, not the other.
    const cursor = encodeCursor({ s: OVERLAP_ROWS.length });
    const sync = await call<{ items: Notification[] }>("GET", `/api/notifications?updatedSince=${cursor}`, { cookie });
    expect(sync.body.items.map((n) => n.id)).toEqual(["ntf_01OVERLAPDEBUG000000000"]);

    // Keys keep working on converted rows.
    const hook = new URL((await createToken(cookie, "webhook", "Test", "claude-code")).url).pathname;
    const again = await call("POST", hook, null, { title: "still noisy", key: "noisy" });
    expect(again.body).toMatchObject({ id: "ntf_01OVERLAPDEBUG000000000", outcome: "alerted" });
  });

  it("an ask nobody answered and a progress that never finished leave the inbox and free their key", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedOldInbox(me.id, 0, LEGACY_ROWS);

    const active = (await call<{ items: Notification[] }>("GET", "/api/notifications?status=active", { cookie })).body.items;
    expect(active.map((n) => n.id)).not.toContain("ntf_01LEGACYUNANSWERED0000000");
    expect(active.map((n) => n.id)).not.toContain("ntf_01LEGACYPROGRESSHALF00000");
    // A finished progress stays until read, as a new one would.
    expect(active.map((n) => n.id)).toContain("ntf_01LEGACYPROGRESSDONE00000");
    const ask = (await call<Notification>("GET", "/api/notifications/ntf_01LEGACYUNANSWERED0000000", { cookie })).body;
    expect(ask).toMatchObject({ status: "resolved", resolvedAt: T1, ask: { state: "expired" } });
    const progress = (await call<Notification>("GET", "/api/notifications/ntf_01LEGACYPROGRESSHALF00000", { cookie })).body;
    expect(progress).toMatchObject({ status: "resolved", resolvedAt: T1, progress: { state: "stopped" } });

    // The expiry sweep leaves the converted ask alone.
    const stub = env.INBOX.get(env.INBOX.idFromName(me.id));
    await runInDurableObject(stub, (_inst: InboxDO, state) => state.storage.setAlarm(Date.now()));
    await runDurableObjectAlarm(stub);
    const swept = (await call<Notification>("GET", "/api/notifications/ntf_01LEGACYUNANSWERED0000000", { cookie })).body;
    expect(swept.version).toBe(ask.version);

    // The stopped progress's key is free for a new progress.
    const hook = new URL((await createToken(cookie, "webhook", "Test", "claude-code")).url).pathname;
    const next = await call<{ id: string; outcome: string }>("POST", hook, null, {
      intent: "progress",
      key: "sync",
      title: "Sync again",
      value: 1,
    });
    expect(next.body).toMatchObject({ outcome: "created" });
    expect(next.body.id).not.toBe("ntf_01LEGACYPROGRESSHALF00000");
  });

  it("are converted only once", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedOldInbox(me.id, 0, LEGACY_ROWS);
    const first = (await call<{ items: Notification[] }>("GET", "/api/notifications", { cookie })).body.items;

    // The converted ask is expired, so an old app build can no longer answer it. Reading it, then restarting, must
    // not convert it again.
    const late = await call("POST", `/api/notifications/ntf_01LEGACYUNANSWERED0000000/respond`, { cookie }, { text: "late" });
    expect(late.status).toBe(409);
    await call("POST", `/api/notifications/ntf_01LEGACYUNANSWERED0000000/read`, { cookie });
    const id = env.INBOX.idFromName(me.id);
    await runInDurableObject(env.INBOX.get(id), (_inst: InboxDO, state) => state.abort("restart")).catch(() => undefined);

    const again = (await call<{ items: Notification[] }>("GET", "/api/notifications", { cookie })).body.items;
    expect(again.map((n) => n.id)).toEqual(first.map((n) => n.id));
    expect(again.find((n) => n.id === "ntf_01LEGACYUNANSWERED0000000")).toMatchObject({
      intent: "ask",
      readAt: expect.any(String),
      ask: { state: "expired", answer: null },
    });
    expect(again.find((n) => n.id === "ntf_01LEGACYPROGRESSHALF00000")).toEqual(
      first.find((n) => n.id === "ntf_01LEGACYPROGRESSHALF00000"),
    );
  });

  it("reach clients that synced before the upgrade", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedOldInbox(me.id, 0, LEGACY_ROWS);
    // The client's cursor from before the upgrade: it had seen every legacy row.
    const cursor = encodeCursor({ s: LEGACY_ROWS.length });
    const sync = await call<{ items: Notification[] }>("GET", `/api/notifications?updatedSince=${cursor}`, { cookie });
    expect(sync.body.items).toHaveLength(LEGACY_ROWS.length);
    expect(sync.body.items.every((n) => n.intent !== undefined)).toBe(true);
  });

  it("new notifications sit next to converted ones with their key", async () => {
    const cookie = await devLogin();
    const me = (await call("GET", "/api/me", { cookie })).body;
    await seedOldInbox(me.id, 0, LEGACY_ROWS);
    const hook = new URL((await createToken(cookie, "webhook")).url).pathname;
    const sent = await call("POST", hook, null, { title: "fresh", key: "fresh-key" });
    const n = (await call<Notification>("GET", `/api/notifications/${sent.body.id}`, { cookie })).body;
    expect(n).toMatchObject({ intent: "inform", key: "fresh-key" });
  });
});
