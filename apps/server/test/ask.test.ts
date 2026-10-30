/** Ask end-to-end (ticket 05): an agent asks over MCP, the user answers from any device, the agent waits for it. */
import { Notification, type ServerMessage } from "@oyee/schema";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { InboxDO } from "../src/inbox/do";
import { BASE, call, createToken, devLogin, eventually, pairDevice, sleep } from "./helpers";

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
  return { cookie, mcp };
}

/** The ask's id, read from the tool result the way an agent would. */
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

describe("ask", () => {
  it("creates an open ask that alerts at warning and tells the agent to wait for the answer", async () => {
    const { cookie, mcp } = await setup();
    const { id, text } = await ask(mcp, {
      title: "Deploy prod-api v1.4.2?",
      body: "Canary is green.",
      options: ["Approve", "Reject"],
      url: "https://github.com/example/api/pull/42",
    });
    expect(text).toContain(`wait_for_response`);
    expect(text).toContain(id);

    const n = await get(cookie, id);
    expect(Notification.safeParse(n).error).toBeUndefined();
    expect(n).toMatchObject({
      intent: "ask",
      source: "claude-code",
      title: "Deploy prod-api v1.4.2?",
      body: "Canary is green.",
      severity: "warning",
      status: "active",
      url: "https://github.com/example/api/pull/42",
      ask: { options: ["Approve", "Reject"], allowText: false, replyPlaceholder: null, answer: null, state: "open" },
    });
    if (n.intent !== "ask") throw new Error("not an ask");
    expect(Date.parse(n.ask.expiresAt) - Date.parse(n.createdAt)).toBe(3_600_000);
    // Older app builds still get answer buttons from the flat card.
    expect(n.actions.map((a) => a.label)).toEqual(["Approve", "Reject"]);
    expect(n.reply).toBeNull();
  });

  it("adds a reply box when there are neither options nor allowText, and keeps both when asked", async () => {
    const { cookie, mcp } = await setup();
    const open = await get(cookie, (await ask(mcp, { title: "Which branch?" })).id);
    expect(open).toMatchObject({ ask: { options: [], allowText: true, replyPlaceholder: "Reply…" }, reply: { placeholder: "Reply…" } });

    const both = await get(cookie, (await ask(mcp, { title: "Ship it?", options: ["Yes"], allowText: true })).id);
    expect(both).toMatchObject({ ask: { options: ["Yes"], allowText: true } });
  });

  it("rejects more than three options", async () => {
    const { mcp } = await setup();
    const r = await tool(mcp, "ask", { title: "Pick", options: ["a", "b", "c", "d"] });
    expect(r.isError).toBe(true);
  });

  it("lists a small, described ask schema", async () => {
    const { mcp } = await setup();
    const res = await SELF.fetch(`${BASE}${mcp}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/list", params: {} }),
    });
    const tools = ((await res.json()) as any).result.tools as { name: string; inputSchema: any }[];
    const schema = tools.find((t) => t.name === "ask")!.inputSchema;
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["allowText", "body", "devices", "key", "options", "platforms", "source", "title", "url"].sort(),
    );
    for (const [name, prop] of Object.entries<any>(schema.properties)) expect(prop.description, name).toBeTruthy();
  });
});

describe("answering an ask", () => {
  it("the first answer from any device closes it everywhere; later answers conflict", async () => {
    const { cookie, mcp } = await setup();
    const { ws, messages } = await socket(cookie);
    const { id } = await ask(mcp, { title: "Deploy?", options: ["Approve", "Reject"] });
    const phone = await pairDevice(cookie, "Pixel 9");

    const first = await call<Notification>("POST", `/api/notifications/${id}/respond`, { bearer: phone.token }, { option: "Approve" });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      status: "resolved",
      ask: { state: "answered", answer: { option: "Approve", text: null, deviceName: "Pixel 9" } },
    });
    const update = await eventually(() => messages.find((m) => m.type === "notification.updated" && m.reason === "responded"));
    expect(update).toMatchObject({
      alert: false,
      notification: { id, status: "resolved", ask: { state: "answered", answer: { option: "Approve", deviceName: "Pixel 9" } } },
    });

    // Another device, an older app build using the v1 action id, and a text answer: all too late.
    const late = await call("POST", `/api/notifications/${id}/respond`, { cookie }, { option: "Reject" });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toContain("Approve · Pixel 9");
    expect((await call("POST", `/api/notifications/${id}/respond`, { cookie }, { actionId: "option_2" })).status).toBe(409);
    expect((await get(cookie, id))).toMatchObject({ version: 2, ask: { answer: { option: "Approve" } } });
    ws.close();
  });

  it("older app builds answer with the v1 action id", async () => {
    const { cookie, mcp } = await setup();
    const { id } = await ask(mcp, { title: "Deploy?", options: ["Approve", "Reject"] });
    const r = await call<Notification>("POST", `/api/notifications/${id}/respond`, { cookie }, { actionId: "option_2" });
    expect(r.body).toMatchObject({ ask: { state: "answered", answer: { option: "Reject", deviceName: "Web" } } });
    expect(r.body.responses).toMatchObject([{ actionId: "option_2" }]);
  });

  it("rejects answers the ask doesn't take", async () => {
    const { cookie, mcp } = await setup();
    const { id } = await ask(mcp, { title: "Deploy?", options: ["Approve"] });
    expect((await call("POST", `/api/notifications/${id}/respond`, { cookie }, { option: "Maybe" })).status).toBe(400);
    expect((await call("POST", `/api/notifications/${id}/respond`, { cookie }, { text: "why not" })).status).toBe(400);
    expect((await get(cookie, id))).toMatchObject({ status: "active", ask: { state: "open", answer: null } });
  });
});

describe("wait_for_response", () => {
  it("says how long ago it was asked while pending, then returns the answer and its device", async () => {
    const { cookie, mcp } = await setup();
    const { id } = await ask(mcp, { title: "Which branch?" });

    const pending = await tool(mcp, "wait_for_response", { id, timeoutSeconds: 1 });
    expect(pending.isError).toBe(false);
    expect(pending.text).toMatch(new RegExp(`^outcome: pending\\nid: ${id}\\nNo answer yet: asked \\d+s ago`));
    expect(pending.text).toContain(`wait_for_response again with id "${id}"`);

    const mac = await pairDevice(cookie, "MacBook Pro", "macos");
    const waiting = tool(mcp, "wait_for_response", { id, timeoutSeconds: 10 });
    await sleep(200);
    await call("POST", `/api/notifications/${id}/respond`, { bearer: mac.token }, { text: "release/1.4" });
    expect((await waiting).text).toBe(`outcome: answered\nid: ${id}\nThe user replied from MacBook Pro: "release/1.4"`);

    // Later calls return the stored answer at once.
    expect((await tool(mcp, "wait_for_response", { id })).text).toBe(`outcome: answered\nid: ${id}\nThe user replied from MacBook Pro: "release/1.4"`);
  });

  it("reports an answer button with its device", async () => {
    const { cookie, mcp } = await setup();
    const { id } = await ask(mcp, { title: "Deploy?", options: ["Approve", "Reject"] });
    const phone = await pairDevice(cookie, "Pixel 9");
    await call("POST", `/api/notifications/${id}/respond`, { bearer: phone.token }, { option: "Reject" });
    expect((await tool(mcp, "wait_for_response", { id })).text).toBe(`outcome: answered\nid: ${id}\nThe user answered "Reject" from Pixel 9.`);
  });

  it("holds at most 50 seconds", async () => {
    const { mcp } = await setup();
    const { id } = await ask(mcp, { title: "Deploy?" });
    expect((await tool(mcp, "wait_for_response", { id, timeoutSeconds: 55 })).isError).toBe(true);
  });
});

describe("asking again with a key", () => {
  it("returns the open ask instead of alerting again", async () => {
    const { cookie, mcp } = await setup();
    const { ws, messages } = await socket(cookie);
    const first = await ask(mcp, { title: "Rotate the staging keys?", options: ["Rotate", "Skip"], key: "rotate-keys" });
    await eventually(() => messages.find((m) => m.type === "notification.created"));

    // Ten minutes later, the cron-driven agent asks again.
    const me = (await call("GET", "/api/me", { cookie })).body;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    await runInDurableObject(env.INBOX.get(env.INBOX.idFromName(me.id)), async (_i: InboxDO, state) => {
      state.storage.sql.exec("UPDATE notifications SET data = json_set(data, '$.createdAt', ?) WHERE id = ?", tenMinutesAgo, first.id);
    });
    const again = await ask(mcp, { title: "Rotate the staging keys?", options: ["Rotate", "Skip"], key: "rotate-keys" });
    expect(again.id).toBe(first.id);
    expect(again.text).toMatch(/^outcome: reused\nid: ntf_\w+\nAlready asked 10m ago, still waiting/);
    expect(again.text).toContain(`wait_for_response with id "${first.id}"`);
    await sleep(100);
    expect(messages.filter((m) => m.type === "notification.created")).toHaveLength(1);

    // Once answered, the same key asks anew.
    await call("POST", `/api/notifications/${first.id}/respond`, { cookie }, { option: "Skip" });
    const next = await ask(mcp, { title: "Rotate the staging keys?", options: ["Rotate", "Skip"], key: "rotate-keys" });
    expect(next.id).not.toBe(first.id);
    expect(next.text).toMatch(/^outcome: created\nid: ntf_\w+\nAsked the user/);
    ws.close();
  });

  it("is per source", async () => {
    const { cookie, mcp } = await setup();
    const a = await ask(mcp, { title: "Q?", key: "q" });
    const b = await ask(mcp, { title: "Q?", key: "q", source: "other-agent" });
    expect(b.id).not.toBe(a.id);
    expect((await get(cookie, b.id))).toMatchObject({ source: "other-agent", key: "q" });
  });
});
