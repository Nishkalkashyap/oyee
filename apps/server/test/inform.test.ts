/** The MCP `inform` tool end to end: schema, outcomes, keys per source, the stored and broadcast notification. */
import { Notification, type ServerMessage } from "@oyee/schema";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { InboxDO } from "../src/inbox/do";
import { BASE, call, createToken, devLogin, eventually, pairDevice, sleep } from "./helpers";

let rpcId = 0;

async function mcp(path: string, method: string, params: unknown = {}) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

/** Calls `inform` and reads the outcome and id out of its text result. */
async function inform(path: string, args: unknown) {
  const body = await mcp(path, "tools/call", { name: "inform", arguments: args });
  const result = body.result as { content: { text: string }[]; isError?: boolean };
  const text = result.content[0]!.text;
  return {
    isError: result.isError ?? false,
    text,
    outcome: /^outcome: (\w+)$/m.exec(text)?.[1],
    id: /^id: (ntf_\w+)$/m.exec(text)?.[1],
  };
}

async function setup(defaultSource = "claude-code") {
  const cookie = await devLogin();
  const tok = await createToken(cookie, "mcp", "Claude Code", defaultSource);
  return { cookie, path: `/mcp/${tok.secret}` };
}

async function get(cookie: string, id: string) {
  const r = await call<Notification>("GET", `/api/notifications/${id}`, { cookie });
  expect(r.status).toBe(200);
  return r.body;
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

describe("MCP inform", () => {
  it("is listed with a described field for everything an inform can carry", async () => {
    const { path } = await setup();
    const list = await mcp(path, "tools/list");
    const tool = (list.result.tools as { name: string; description: string; inputSchema: any }[]).find((t) => t.name === "inform");
    expect(tool).toBeDefined();
    const props = tool!.inputSchema.properties as Record<string, { description?: string; enum?: string[] }>;
    expect(Object.keys(props).sort()).toEqual(
      ["title", "body", "severity", "url", "key", "source", "devices", "platforms", "links", "fields", "image", "icon", "cooldown"].sort(),
    );
    expect(tool!.inputSchema.required).toEqual(["title"]);
    for (const [name, p] of Object.entries(props)) expect(p.description, name).toBeTruthy();
    expect(props.severity!.enum).toEqual(["info", "success", "warning", "critical"]);
    for (const s of ["info", "success", "warning", "critical"]) expect(props.severity!.description).toContain(s);
  });

  it("with just a title creates an inform on every device and says so", async () => {
    const { cookie, path } = await setup();
    const { ws, messages } = await socket(cookie);

    const r = await inform(path, { title: "Backup done" });
    expect(r.isError).toBe(false);
    expect(r.outcome).toBe("created");
    expect(r.id).toMatch(/^ntf_/);

    const n = await get(cookie, r.id!);
    expect(n).toMatchObject({
      intent: "inform",
      title: "Backup done",
      body: null,
      severity: "info",
      source: "claude-code",
      key: null,
      status: "active",
      targetDeviceIds: null,
      inform: { links: [], fields: [], image: null, icon: null, cooldown: null },
    });
    expect(Notification.safeParse(n).error).toBeUndefined();
    const created = await eventually(() => messages.find((m) => m.type === "notification.created"));
    expect(created).toMatchObject({ notification: { id: r.id, intent: "inform" } });
    ws.close();
  });

  it("carries body, severity, url, rows, image, icon and link buttons", async () => {
    const { cookie, path } = await setup();
    const r = await inform(path, {
      title: "Deploy finished",
      body: "Rolled out **v1.4.2**",
      severity: "success",
      url: "https://ci.example.com/runs/42",
      links: [
        { label: "PR", url: "https://github.com/acme/api/pull/7" },
        { label: "Build log", url: "https://ci.example.com/runs/42/log" },
      ],
      fields: [{ label: "Region", value: "eu-west-1" }],
      image: "https://ci.example.com/chart.png",
      icon: "🚀",
    });
    expect(r.outcome).toBe("created");
    const n = await get(cookie, r.id!);
    expect(n).toMatchObject({
      intent: "inform",
      body: "Rolled out **v1.4.2**",
      severity: "success",
      url: "https://ci.example.com/runs/42",
      inform: {
        links: [
          { label: "PR", url: "https://github.com/acme/api/pull/7" },
          { label: "Build log", url: "https://ci.example.com/runs/42/log" },
        ],
        fields: [{ label: "Region", value: "eu-west-1" }],
        image: "https://ci.example.com/chart.png",
        icon: "🚀",
      },
    });
  });

  it("rejects what an inform can't carry", async () => {
    const { path } = await setup();
    const link = { label: "Open", url: "https://example.com" };
    expect((await inform(path, { title: "x", links: [link, link, link, link] })).isError).toBe(true);
    expect((await inform(path, { title: "x", severity: "debug" })).isError).toBe(true);
    expect((await inform(path, { title: "x", image: "http://example.com/a.png" })).isError).toBe(true);
    expect((await inform(path, { body: "no title" })).isError).toBe(true);
  });

  it("with a key updates the active inform from the same source and alerts again", async () => {
    const { cookie, path } = await setup();
    const { ws, messages } = await socket(cookie);
    const first = await inform(path, { title: "Disk 90% full", key: "disk-db1", severity: "warning" });
    expect(first.outcome).toBe("created");
    await call("POST", `/api/notifications/${first.id}/read`, { cookie });

    const second = await inform(path, { title: "Disk 95% full", key: "disk-db1", severity: "critical" });
    expect(second.isError).toBe(false);
    expect(second.outcome).toBe("alerted");
    expect(second.id).toBe(first.id);
    expect(second.text).toContain('"disk-db1"');

    const n = await get(cookie, first.id!);
    expect(n).toMatchObject({ title: "Disk 95% full", severity: "critical", key: "disk-db1", version: 3, readAt: null }); // 1 sent, 2 read, 3 re-sent
    const updated = await eventually(() =>
      messages.find((m) => m.type === "notification.updated" && m.reason === "update" && m.notification.id === first.id),
    );
    expect(updated).toMatchObject({ alert: true, notification: { title: "Disk 95% full" } });
    const list = await call("GET", "/api/notifications", { cookie });
    expect(list.body.items).toHaveLength(1);
    ws.close();
  });

  it("keys are per source: another source with the same key gets its own inform", async () => {
    const { cookie, path } = await setup();
    const other = `/mcp/${(await createToken(cookie, "mcp", "Cron", "cron")).secret}`;
    const a = await inform(path, { title: "Nightly report", key: "report" });
    const b = await inform(other, { title: "Nightly report", key: "report" });
    expect(b.outcome).toBe("created");
    expect(b.id).not.toBe(a.id);
    // an explicit source is a source of its own too
    const c = await inform(path, { title: "Nightly report", key: "report", source: "cron" });
    expect(c).toMatchObject({ outcome: "alerted", id: b.id });
  });

  it("with the key of a resolved inform creates a new one", async () => {
    const { cookie, path } = await setup();
    const first = await inform(path, { title: "Backup failed", key: "backup" });
    await call("POST", `/api/notifications/${first.id}/resolve`, { cookie });
    const again = await inform(path, { title: "Backup failed again", key: "backup" });
    expect(again.outcome).toBe("created");
    expect(again.id).not.toBe(first.id);
    expect(await get(cookie, again.id!)).toMatchObject({ status: "active", key: "backup", version: 1 });
  });

  it("targets devices by name", async () => {
    const { cookie, path } = await setup();
    const phone = await pairDevice(cookie, "Pixel 9", "android");
    await pairDevice(cookie, "MacBook", "macos");
    const r = await inform(path, { title: "Only the phone", devices: ["pixel"] });
    expect((await get(cookie, r.id!)).targetDeviceIds).toEqual([phone.device.id]);
    const bad = await inform(path, { title: "Nowhere", devices: ["toaster"] });
    expect(bad.isError).toBe(true);
  });
});

describe("MCP inform cooldown", () => {
  it("accepts durations like 30m, 1h and 24h within the limits", async () => {
    const { path } = await setup();
    for (const cooldown of ["30m", "1h", "24h"]) {
      expect((await inform(path, { title: "ok", key: `k-${cooldown}`, cooldown })).isError, cooldown).toBe(false);
    }
    for (const cooldown of ["0m", "1d", "1 hour", "10s", "169h"]) {
      expect((await inform(path, { title: "bad", key: "k", cooldown })).isError, cooldown).toBe(true);
    }
  });

  it("inside the cooldown updates the active inform silently, keeping it read", async () => {
    const { cookie, path } = await setup();
    const { ws, messages } = await socket(cookie);
    const first = await inform(path, { title: "Disk 90% full", key: "disk-full", cooldown: "1h" });
    expect(first.outcome).toBe("created");
    expect(await get(cookie, first.id!)).toMatchObject({ inform: { cooldown: "1h" } });
    await call("POST", `/api/notifications/${first.id}/read`, { cookie });

    const second = await inform(path, { title: "Disk 92% full", key: "disk-full", cooldown: "1h" });
    expect(second).toMatchObject({ isError: false, outcome: "updated_silently", id: first.id });
    expect(second.text).toContain("1h");

    const n = await get(cookie, first.id!);
    expect(n).toMatchObject({ title: "Disk 92% full", status: "active", version: 3 });
    expect(n.readAt).not.toBeNull();
    const updated = await eventually(() =>
      messages.find((m) => m.type === "notification.updated" && m.reason === "update" && m.notification.id === first.id),
    );
    expect(updated).toMatchObject({ alert: false, notification: { title: "Disk 92% full" } });
    ws.close();
  });

  it("after a resolve inside the cooldown changes nothing and says when it was resolved and when the cooldown ends", async () => {
    const { cookie, path } = await setup();
    const first = await inform(path, { title: "Disk 90% full", key: "disk-full", cooldown: "1h" });
    await call("POST", `/api/notifications/${first.id}/resolve`, { cookie });
    const resolved = await get(cookie, first.id!);
    const { ws, messages } = await socket(cookie);

    const again = await inform(path, { title: "Disk 95% full", key: "disk-full", cooldown: "1h" });
    expect(again).toMatchObject({ isError: false, outcome: "suppressed", id: first.id });
    expect(again.text).toContain(`resolved`);
    expect(again.text).toContain(resolved.resolvedAt!); // when it was resolved
    expect(again.text).toMatch(/until|from \d{4}-/); // when the cooldown ends
    expect(again.text).toContain("in 1h");

    expect(await get(cookie, first.id!)).toEqual(resolved);
    const list = await call("GET", "/api/notifications", { cookie });
    expect(list.body.items).toHaveLength(1);
    await sleep(100);
    expect(messages.filter((m) => m.type.startsWith("notification."))).toEqual([]);
    ws.close();
  });

  it("once the cooldown has passed, alerts again and makes the inform unread", async () => {
    const { cookie, path } = await setup();
    const first = await inform(path, { title: "Disk 90% full", key: "disk-full", cooldown: "1h" });
    await call("POST", `/api/notifications/${first.id}/read`, { cookie });
    // a silent update inside the cooldown doesn't move it: it runs from the last alert
    expect((await inform(path, { title: "Disk 91% full", key: "disk-full", cooldown: "1h" })).outcome).toBe("updated_silently");
    await backdateAlert(cookie, first.id!, 61 * 60_000);
    const { ws, messages } = await socket(cookie);

    const r = await inform(path, { title: "Disk 97% full", key: "disk-full", cooldown: "1h" });
    expect(r).toMatchObject({ outcome: "alerted", id: first.id });
    expect(await get(cookie, first.id!)).toMatchObject({ title: "Disk 97% full", readAt: null, status: "active" });
    const updated = await eventually(() => messages.find((m) => m.type === "notification.updated" && m.reason === "update"));
    expect(updated).toMatchObject({ alert: true, notification: { id: first.id } });

    // the alert restarts the cooldown
    expect((await inform(path, { title: "Disk 98% full", key: "disk-full", cooldown: "1h" })).outcome).toBe("updated_silently");
    ws.close();
  });

  it("counts a re-alert as a send and a silent update as an update (docs/protocol.md §3.1)", async () => {
    const { cookie, path } = await setup();
    const used = async () => {
      const items = (await call<{ items: { kind: string; used: number }[] }>("GET", "/api/usage", { cookie })).body.items;
      return Object.fromEntries(items.map((i) => [i.kind, i.used]));
    };
    const first = await inform(path, { title: "Disk 90% full", key: "disk-full", cooldown: "1h" });
    const start = await used();
    expect((await inform(path, { title: "Disk 91% full", key: "disk-full", cooldown: "1h" })).outcome).toBe("updated_silently");
    expect(await used()).toMatchObject({ send: start.send, update: start.update! + 1 });
    await backdateAlert(cookie, first.id!, 61 * 60_000);
    expect((await inform(path, { title: "Disk 97% full", key: "disk-full", cooldown: "1h" })).outcome).toBe("alerted");
    expect(await used()).toMatchObject({ send: start.send! + 1, update: start.update! + 1 });
  });

  it("once the cooldown has passed after a resolve, creates a new inform", async () => {
    const { cookie, path } = await setup();
    const first = await inform(path, { title: "Disk 90% full", key: "disk-full", cooldown: "30m" });
    await call("POST", `/api/notifications/${first.id}/resolve`, { cookie });
    await backdateAlert(cookie, first.id!, 31 * 60_000);
    const { ws, messages } = await socket(cookie);

    const r = await inform(path, { title: "Disk full again", key: "disk-full", cooldown: "30m" });
    expect(r.outcome).toBe("created");
    expect(r.id).not.toBe(first.id);
    expect(await get(cookie, r.id!)).toMatchObject({ status: "active", key: "disk-full", inform: { cooldown: "30m" } });
    expect(await get(cookie, first.id!)).toMatchObject({ status: "resolved" });
    const created = await eventually(() => messages.find((m) => m.type === "notification.created"));
    expect(created).toMatchObject({ notification: { id: r.id } });
    ws.close();
  });
});

/** Moves the last alert of a notification into the past, through its inbox Durable Object (time-based rules). */
async function backdateAlert(cookie: string, id: string, msAgo: number) {
  const me = (await call<{ id: string }>("GET", "/api/me", { cookie })).body;
  const stub = env.INBOX.get(env.INBOX.idFromName(me.id));
  await runInDurableObject(stub, async (_inst: InboxDO, state) => {
    state.storage.sql.exec("UPDATE notifications SET alerted_at = ? WHERE id = ?", new Date(Date.now() - msAgo).toISOString(), id);
  });
}
