/**
 * Keys across intents (ticket 09): a key whose latest notification is still live (a running or stopped progress, an
 * open ask) belongs to that intent until it finishes; once it isn't live, any intent can take the key over.
 */
import type { Notification } from "@oyee/schema";
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { InboxDO } from "../src/inbox/do";
import { BASE, call, createToken, devLogin } from "./helpers";

let rpcId = 0;

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

async function setup() {
  const cookie = await devLogin();
  const mcp = new URL((await createToken(cookie, "mcp", "Claude Code", "claude-code")).url).pathname;
  const get = async (id: string) => (await call<Notification>("GET", `/api/notifications/${id}`, { cookie })).body;
  return { cookie, mcp, get };
}

/** Moves a stored notification to a state only time reaches (stopped reporting, past its expiry). */
async function edit(cookie: string, id: string, path: string, value: string) {
  const me = (await call("GET", "/api/me", { cookie })).body;
  await runInDurableObject(env.INBOX.get(env.INBOX.idFromName(me.id)), async (_i: InboxDO, state) => {
    state.storage.sql.exec("UPDATE notifications SET data = json_set(data, ?, ?) WHERE id = ?", path, value, id);
  });
}

describe("a key held by a running progress", () => {
  it("rejects an inform, naming the key, its intent and how to fix it", async () => {
    const { mcp } = await setup();
    const p = await tool(mcp, "progress", { key: "deploy", title: "Deploying api", value: 3, max: 7 });
    expect(p.isError, p.text).toBe(false);

    const r = await tool(mcp, "inform", { key: "deploy", title: "Deploy started" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^conflict: /);
    expect(r.text).toContain('"deploy"');
    expect(r.text).toContain("running progress");
    expect(r.text).toContain(p.id!);
    expect(r.text).toMatch(/different key/);
    expect(r.text).toMatch(/"done" or "failed"/);
  });

  it("still holds it after the progress stopped reporting", async () => {
    const { cookie, mcp } = await setup();
    const p = await tool(mcp, "progress", { key: "backup", title: "Backing up", value: 40 });
    await edit(cookie, p.id!, "$.progress.state", "stopped");

    const r = await tool(mcp, "ask", { key: "backup", title: "Retry the backup?", options: ["Retry", "Skip"] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('"backup" belongs to a stopped progress');
    expect(r.text).toContain("different key for this ask");
  });
});

describe("a key held by an open ask", () => {
  it("rejects a progress and an inform, and leaves the ask open", async () => {
    const { mcp, get } = await setup();
    const a = await tool(mcp, "ask", { key: "release", title: "Ship v2?", options: ["Ship", "Hold"] });
    expect(a.isError, a.text).toBe(false);

    for (const [name, args] of [
      ["progress", { key: "release", title: "Releasing", value: 10 }],
      ["inform", { key: "release", title: "Release notes ready" }],
    ] as const) {
      const r = await tool(mcp, name, args);
      expect(r.isError, name).toBe(true);
      expect(r.text).toMatch(/^conflict: /);
      expect(r.text).toContain('"release"');
      expect(r.text).toContain("open ask");
      expect(r.text).toContain(`different key for this ${name}`);
      expect(r.text).toContain(`resolve (id ${a.id})`);
    }
    expect(await get(a.id!)).toMatchObject({ intent: "ask", status: "active", version: 1, ask: { state: "open" } });
  });
});

describe("a key whose latest notification is no longer live", () => {
  /** Sends `name` with the key and expects a fresh notification of that intent, leaving `previous` untouched. */
  async function takesOver(s: Awaited<ReturnType<typeof setup>>, previous: string, name: string, args: Record<string, unknown>) {
    const before = await s.get(previous);
    const r = await tool(s.mcp, name, args);
    expect(r.isError, r.text).toBe(false);
    expect(r.id).not.toBe(previous);
    expect(await s.get(r.id!)).toMatchObject({ intent: name, key: args.key, status: "active" });
    expect(await s.get(previous)).toEqual(before);
  }

  it("a finished progress lets an ask take the key", async () => {
    const s = await setup();
    const p = await tool(s.mcp, "progress", { key: "migrate", title: "Migrating", value: 3 });
    await tool(s.mcp, "progress", { key: "migrate", title: "Migrating", status: "failed" });
    await takesOver(s, p.id!, "ask", { key: "migrate", title: "Retry the migration?", options: ["Retry", "Skip"] });
  });

  it("an answered ask lets a progress take the key", async () => {
    const s = await setup();
    const a = await tool(s.mcp, "ask", { key: "deploy", title: "Deploy?", options: ["Deploy", "Wait"] });
    expect((await call("POST", `/api/notifications/${a.id}/respond`, { cookie: s.cookie }, { option: "Deploy" })).status).toBe(200);
    await takesOver(s, a.id!, "progress", { key: "deploy", title: "Deploying", value: 1, max: 5 });
  });

  it("a withdrawn ask lets an inform take the key", async () => {
    const s = await setup();
    const a = await tool(s.mcp, "ask", { key: "pr-42", title: "Merge PR 42?" });
    expect((await call("POST", `/api/notifications/${a.id}/resolve`, { cookie: s.cookie })).status).toBe(200);
    await takesOver(s, a.id!, "inform", { key: "pr-42", title: "PR 42 was merged by someone else" });
  });

  it("an expired ask lets a progress take the key", async () => {
    const s = await setup();
    const a = await tool(s.mcp, "ask", { key: "rotate", title: "Rotate the keys?" });
    await edit(s.cookie, a.id!, "$.ask.expiresAt", new Date(Date.now() - 1000).toISOString());
    await takesOver(s, a.id!, "progress", { key: "rotate", title: "Rotating keys", value: 1 });
  });

  it("an inform, resolved or not, lets an ask or a progress take the key", async () => {
    const s = await setup();
    const i = await tool(s.mcp, "inform", { key: "disk", title: "Disk 90% full", severity: "warning" });
    await takesOver(s, i.id!, "progress", { key: "disk", title: "Cleaning up", value: 0 });

    const j = await tool(s.mcp, "inform", { key: "cert", title: "Certificate expires in 3 days" });
    expect((await call("POST", `/api/notifications/${j.id}/resolve`, { cookie: s.cookie })).status).toBe(200);
    await takesOver(s, j.id!, "ask", { key: "cert", title: "Renew the certificate now?", options: ["Renew", "Later"] });
  });

  it("is per source: another source's live progress doesn't hold the key", async () => {
    const s = await setup();
    await tool(s.mcp, "progress", { key: "build", title: "Building", value: 1, source: "ci" });
    const r = await tool(s.mcp, "inform", { key: "build", title: "Build requested" });
    expect(r.isError, r.text).toBe(false);
  });
});
