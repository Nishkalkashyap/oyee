import type { Notification } from "@oyee/schema";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BASE, call, createToken, devLogin, sleep } from "./helpers";

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

async function setup() {
  const cookie = await devLogin();
  const tok = await createToken(cookie, "mcp", "Claude Code", "claude-code");
  expect(tok.url).toBe(`https://oyee.test/mcp/${tok.secret}`);
  return { cookie, secret: tok.secret, path: `/mcp/${tok.secret}` };
}

describe("MCP", () => {
  it("initializes and lists all tools", async () => {
    const { path } = await setup();
    const init = await mcp(path, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("oyee");
    expect(init.body.result.capabilities.tools).toBeDefined();

    const list = await mcp(path, "tools/list");
    const names = (list.body.result.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "ask",
        "delete_template",
        "get_notification",
        "inform",
        "list_devices",
        "list_notifications",
        "list_templates",
        "progress",
        "resolve_notification",
        "send_notification",
        "update_notification",
        "upsert_template",
        "wait_for_response",
      ].sort(),
    );
    const send = (list.body.result.tools as { name: string; inputSchema: any }[]).find((t) => t.name === "send_notification")!;
    expect(send.inputSchema.type).toBe("object");
    expect(Object.keys(send.inputSchema.properties)).toEqual(expect.arrayContaining(["title", "body", "severity", "actions", "replaceKey"]));
  });

  it("send_notification / update / resolve / get / list via path token and Bearer", async () => {
    const { cookie, secret, path } = await setup();
    const sent = await tool<Notification>(path, "send_notification", { title: "Build started", progress: { value: 0, max: 5 } });
    expect(sent.isError).toBe(false);
    const n = sent.json();
    expect(n).toMatchObject({ title: "Build started", source: "claude-code", version: 1 });

    const upd = (await tool<Notification>("/mcp", "update_notification", { id: n.id, progress: { value: 3, max: 5 } }, {
      Authorization: `Bearer ${secret}`,
    })).json();
    expect(upd.version).toBe(2);
    expect(upd.progress?.value).toBe(3);

    expect((await tool<Notification>(path, "resolve_notification", { id: n.id })).json().status).toBe("resolved");
    expect((await tool<Notification>(path, "get_notification", { id: n.id })).json().version).toBe(3);
    const list = (await tool<{ items: Notification[] }>(path, "list_notifications", { status: "resolved" })).json();
    expect(list.items.map((i) => i.id)).toEqual([n.id]);

    // visible to the web app too
    expect((await call("GET", `/api/notifications/${n.id}`, { cookie })).body.status).toBe("resolved");

    // tool errors are reported as isError results
    const missing = await tool(path, "get_notification", { id: "ntf_nope" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/not_found/);
  });

  it("ask + wait_for_response (pending, then answered while waiting)", async () => {
    const { cookie, path } = await setup();
    const ask = (await tool<{ id: string }>(path, "ask", { title: "Deploy to prod?", options: ["Yes", "No"], allowText: true })).json();
    const n = (await call("GET", `/api/notifications/${ask.id}`, { cookie })).body as Notification;
    expect(n.actions.map((a) => [a.id, a.label, a.resolves])).toEqual([
      ["option_1", "Yes", true],
      ["option_2", "No", true],
    ]);
    expect(n.reply).not.toBeNull();

    expect((await tool(path, "wait_for_response", { id: ask.id, timeoutSeconds: 1 })).json()).toEqual({ status: "pending" });

    const waiting = tool(path, "wait_for_response", { id: ask.id, timeoutSeconds: 10 });
    await sleep(200);
    const responded = await call("POST", `/api/notifications/${ask.id}/respond`, { cookie }, { actionId: "option_1" });
    expect(responded.body.status).toBe("resolved");
    const answered = (await waiting).json();
    expect(answered.status).toBe("answered");
    expect(answered.response).toMatchObject({ actionId: "option_1", text: null });

    // later calls return the stored response immediately
    expect((await tool(path, "wait_for_response", { id: ask.id })).json().status).toBe("answered");
  });

  it("templates and devices tools", async () => {
    const { path } = await setup();
    const t = (await tool(path, "upsert_template", { name: "ci", card: { title: "CI {{status}}", severity: "info" } })).json();
    expect(t.name).toBe("ci");
    expect((await tool(path, "list_templates", {})).json().items).toHaveLength(1);
    const sent = (await tool<Notification>(path, "send_notification", { template: "ci", vars: { status: "green" } })).json();
    expect(sent.title).toBe("CI green");
    expect((await tool(path, "delete_template", { name: "ci" })).json()).toEqual({ ok: true });
    expect((await tool(path, "list_devices", {})).json()).toEqual({ items: [] });
  });

  it("rejects bad tokens and GET", async () => {
    const { path } = await setup();
    expect((await mcp("/mcp/oyee_mcp_nope", "tools/list")).status).toBe(401);
    expect((await mcp("/mcp", "tools/list")).status).toBe(401);
    expect((await SELF.fetch(`${BASE}${path}`)).status).toBe(405);
  });
});
