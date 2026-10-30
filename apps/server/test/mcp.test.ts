import type { Notification } from "@oyee/schema";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { InboxDO } from "../src/inbox/do";
import { BASE, call, createToken, devLogin } from "./helpers";

let rpcId = 0;

/** One JSON-RPC request over Streamable HTTP (the server answers with plain JSON). */
async function mcp(path: string, method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function tool<T = any>(path: string, name: string, args: unknown, headers: Record<string, string> = {}) {
  const r = await mcp(path, "tools/call", { name, arguments: args }, headers);
  expect(r.status).toBe(200);
  const result = r.body.result as { content: { type: string; text: string }[]; isError?: boolean };
  return { isError: result.isError ?? false, text: result.content[0]!.text, json: () => JSON.parse(result.content[0]!.text) as T };
}

/** The notification id an acting tool reports on its "id:" line. */
const idOf = (text: string) => /^id: (ntf_[0-9A-Za-z]+)$/m.exec(text)![1]!;

async function setup() {
  const cookie = await devLogin();
  const tok = await createToken(cookie, "mcp", "Claude Code", "claude-code");
  expect(tok.url).toBe(`https://oyee.test/mcp/${tok.secret}`);
  return { cookie, secret: tok.secret, path: `/mcp/${tok.secret}` };
}

describe("MCP", () => {
  it("initializes with instructions and lists exactly the seven tools", async () => {
    const { path } = await setup();
    const init = await mcp(path, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("oyee");
    expect(init.body.result.capabilities.tools).toBeDefined();
    const instructions = init.body.result.instructions as string;
    for (const word of ["inform", "ask", "progress", "wait_for_response"]) expect(instructions).toContain(word);
    expect(instructions).not.toMatch(/send_notification|update_notification|template/);

    const list = await mcp(path, "tools/list");
    const tools = list.body.result.tools as { name: string; description: string }[];
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["ask", "inform", "list_devices", "list_notifications", "progress", "resolve", "wait_for_response"].sort(),
    );
    // No description points agents at a tool that no longer exists.
    for (const t of tools) expect(t.description, t.name).not.toMatch(/send_notification|update_notification|_template/);
  });

  it("resolve removes an inform and withdraws an ask, answering in the shared result shape", async () => {
    const { cookie, secret, path } = await setup();
    const informed = await tool(path, "inform", { title: "Disk 91% on db1" });
    const informId = idOf(informed.text);

    // Bearer auth works the same as the path token.
    const resolved = await tool("/mcp", "resolve", { id: informId }, { Authorization: `Bearer ${secret}` });
    expect(resolved.isError).toBe(false);
    expect(resolved.text).toBe(`outcome: resolved\nid: ${informId}\nResolved "Disk 91% on db1": it is gone from the user's devices.`);
    expect((await call<Notification>("GET", `/api/notifications/${informId}`, { cookie })).body.status).toBe("resolved");

    const askId = idOf((await tool(path, "ask", { title: "Still needed?", options: ["Yes"] })).text);
    const withdrawn = await tool(path, "resolve", { id: askId });
    expect(withdrawn.text).toMatch(new RegExp(`^outcome: withdrawn\\nid: ${askId}\\nWithdrew the ask "Still needed\\?"`));

    const missing = await tool(path, "resolve", { id: "ntf_nope" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not_found/);
  });

  it("every acting tool answers with outcome and id lines, then words", async () => {
    const { path } = await setup();
    const shape = /^outcome: [a-z_]+\nid: ntf_[0-9A-Za-z]+\n\S/;
    expect((await tool(path, "inform", { title: "Hi" })).text).toMatch(shape);
    expect((await tool(path, "progress", { key: "p", title: "Work", value: 1 })).text).toMatch(shape);
    const asked = await tool(path, "ask", { title: "Ok?", options: ["Yes"] });
    expect(asked.text).toMatch(/^outcome: created\nid: ntf_[0-9A-Za-z]+\nAsked the user \(expires in 1h\)\. Call wait_for_response/);
    const pending = await tool(path, "wait_for_response", { id: idOf(asked.text), timeoutSeconds: 1 });
    expect(pending.text).toMatch(new RegExp(`^outcome: pending\\nid: ${idOf(asked.text)}\\nNo answer yet`));
    expect((await tool(path, "resolve", { id: idOf(asked.text) })).text).toMatch(shape);
  });

  it("list_notifications returns compact items filtered by key, intent, status and source", async () => {
    const { cookie, path } = await setup();
    const disk = idOf((await tool(path, "inform", { title: "Disk 91% on db1", key: "disk-db1", body: "long detail" })).text);
    const deploy = idOf((await tool(path, "ask", { title: "Deploy?", key: "deploy", options: ["Approve", "Reject"] })).text);
    const build = idOf((await tool(path, "progress", { key: "build", title: "Build", value: 3, max: 7 })).text);
    const cron = idOf((await tool(path, "inform", { title: "Nightly report", source: "cron" })).text);
    await tool(path, "resolve", { id: disk });
    await call("POST", `/api/notifications/${deploy}/respond`, { cookie }, { option: "Approve" });

    const all = (await tool<{ items: any[]; nextCursor: string | null }>(path, "list_notifications", {})).json();
    expect(all.items.map((i) => i.id)).toEqual([cron, build, deploy, disk]);
    expect(all.nextCursor).toBeNull();
    for (const item of all.items) {
      expect(Object.keys(item).sort()).toEqual(["ago", "answer", "createdAt", "id", "intent", "key", "state", "status", "title"]);
      expect(item.ago).toMatch(/^\d+s$/);
    }
    expect(all.items[0]).toMatchObject({ intent: "inform", key: null, title: "Nightly report", status: "active", state: null, answer: null });
    expect(all.items[1]).toMatchObject({ intent: "progress", key: "build", state: "running", answer: null });
    expect(all.items[2]).toMatchObject({
      intent: "ask",
      key: "deploy",
      status: "resolved",
      state: "answered",
      answer: { option: "Approve", text: null, device: "Web" },
    });

    const list = async (args: Record<string, unknown>) =>
      (await tool<{ items: { id: string }[] }>(path, "list_notifications", args)).json().items.map((i) => i.id);
    expect(await list({ key: "disk-db1" })).toEqual([disk]);
    expect(await list({ intent: "progress" })).toEqual([build]);
    expect(await list({ status: "active" })).toEqual([cron, build]);
    expect(await list({ source: "cron" })).toEqual([cron]);
    expect(await list({ source: "claude-code", intent: "inform" })).toEqual([disk]);
  });

  it("list_notifications pages 10 at a time by default, at most 50, with a cursor", async () => {
    const { path } = await setup();
    const ids: string[] = [];
    for (let i = 1; i <= 12; i++) ids.push(idOf((await tool(path, "inform", { title: `Event ${i}` })).text));
    const newestFirst = [...ids].reverse();

    const first = (await tool<{ items: { id: string }[]; nextCursor: string }>(path, "list_notifications", {})).json();
    expect(first.items.map((i) => i.id)).toEqual(newestFirst.slice(0, 10));
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await tool<{ items: { id: string }[]; nextCursor: null }>(path, "list_notifications", { cursor: first.nextCursor })).json();
    expect(second.items.map((i) => i.id)).toEqual(newestFirst.slice(10));
    expect(second.nextCursor).toBeNull();

    expect((await tool(path, "list_notifications", { limit: 3 })).json().items).toHaveLength(3);
    expect((await tool(path, "list_notifications", { limit: 50 })).json().items).toHaveLength(12);
    expect((await tool(path, "list_notifications", { limit: 51 })).isError).toBe(true);
  });

  it("list_notifications says how long ago each was sent", async () => {
    const { cookie, path } = await setup();
    const id = idOf((await tool(path, "inform", { title: "Old news" })).text);
    const me = (await call<{ id: string }>("GET", "/api/me", { cookie })).body;
    const twelveMinutesAgo = new Date(Date.now() - 12 * 60_000 - 5_000).toISOString();
    await runInDurableObject(env.INBOX.get(env.INBOX.idFromName(me.id)), async (_inst: InboxDO, state) => {
      state.storage.sql.exec("UPDATE notifications SET data = json_set(data, '$.createdAt', ?) WHERE id = ?", twelveMinutesAgo, id);
    });
    const [item] = (await tool(path, "list_notifications", {})).json().items;
    expect(item).toMatchObject({ id, createdAt: twelveMinutesAgo, ago: "12m" });
  });

  it("rejects bad tokens and GET", async () => {
    const { path } = await setup();
    expect((await mcp("/mcp/oyee_mcp_nope", "tools/list")).status).toBe(401);
    expect((await mcp("/mcp", "tools/list")).status).toBe(401);
    expect((await SELF.fetch(`${BASE}${path}`)).status).toBe(405);
  });
});
