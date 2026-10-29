/** Per-account quotas, caps and per-IP protections (docs/protocol.md §3.1). */
import { LIMITS, QUOTAS } from "@oyee/schema";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createPairedDevice } from "../src/db";
import type { InboxDO } from "../src/inbox/do";
import { call, createToken, devLogin, uniqueEmail } from "./helpers";

const DAY = 86_400_000;

async function signedIn() {
  const cookie = await devLogin();
  const me = await call("GET", "/api/me", { cookie });
  return { cookie, userId: me.body.id as string };
}

/** Sets today's (or this minute's) counter for a quota directly in the user's InboxDO. */
async function setUsage(userId: string, kind: string, period: "d" | "m", count: number) {
  const stub = env.INBOX.get(env.INBOX.idFromName(userId));
  await runInDurableObject(stub, (_do: InboxDO, state) => {
    const win = period === "d" ? Math.floor(Date.now() / DAY) : Math.floor(Date.now() / 60_000);
    state.storage.sql.exec(
      "INSERT INTO usage (kind, period, win, count) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET count = excluded.count",
      kind,
      period,
      win,
      count,
    );
  });
}

describe("per-account quotas", () => {
  it("rejects sends past the daily limit with 429 + Retry-After, and posts a notice at the limit", async () => {
    const { cookie, userId } = await signedIn();
    const hook = await createToken(cookie, "webhook");
    const path = new URL(hook.url).pathname;
    await setUsage(userId, "send", "d", QUOTAS.send.perDay - 1);

    expect((await call("POST", path, null, { title: "last one" })).status).toBe(200);
    const over = await call("POST", path, null, { title: "too many" });
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe("rate_limited");
    expect(over.body.error.message).toMatch(/Daily limit reached: 1,000 notifications sent per day/);
    const retry = Number(over.res.headers.get("Retry-After"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(86_400);

    const list = await call("GET", "/api/notifications?source=oyee", { cookie });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ title: "Daily limit reached: notifications sent", severity: "critical" });

    const usage = await call("GET", "/api/usage", { cookie });
    expect(usage.status).toBe(200);
    expect(usage.body.items.find((i: { kind: string }) => i.kind === "send")).toEqual({
      kind: "send",
      label: "Notifications sent",
      used: QUOTAS.send.perDay,
      limit: QUOTAS.send.perDay,
    });
    expect(Date.parse(usage.body.resetsAt) - Date.now()).toBeLessThanOrEqual(DAY);
  });

  it("warns once at 80% of the daily limit", async () => {
    const { cookie, userId } = await signedIn();
    await setUsage(userId, "send", "d", QUOTAS.send.perDay * 0.8 - 1);
    await call("POST", "/api/notifications", { cookie }, { title: "a" });
    await call("POST", "/api/notifications", { cookie }, { title: "b" });
    const notices = (await call("GET", "/api/notifications?source=oyee", { cookie })).body.items;
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe("80% of today's notifications sent used");
  });

  it("applies the per-minute burst limit", async () => {
    const { cookie, userId } = await signedIn();
    await setUsage(userId, "send", "m", QUOTAS.send.perMinute!);
    const r = await call("POST", "/api/notifications", { cookie }, { title: "burst" });
    expect(r.status).toBe(429);
    expect(r.body.error.message).toMatch(/120 per minute/);
    expect(Number(r.res.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
  });

  it("counts updates, replies and reads separately", async () => {
    const { cookie, userId } = await signedIn();
    const n = (await call("POST", "/api/notifications", { cookie }, { title: "x", actions: [{ id: "ok", label: "OK" }] })).body;
    await setUsage(userId, "update", "d", QUOTAS.update.perDay);
    expect((await call("PATCH", `/api/notifications/${n.id}`, { cookie }, { body: "y" })).status).toBe(429);
    expect((await call("POST", `/api/notifications/${n.id}/respond`, { cookie }, { actionId: "ok" })).status).toBe(200);
    await setUsage(userId, "read", "d", QUOTAS.read.perDay);
    expect((await call("GET", "/api/notifications", { cookie })).status).toBe(429);
    expect((await call("GET", "/api/usage", { cookie })).status).toBe(200); // usage itself is never metered
  });

  it("limits pairing codes per minute", async () => {
    const { cookie } = await signedIn();
    for (let i = 0; i < QUOTAS.pairing.perMinute!; i++) {
      expect((await call("POST", "/api/devices/pairing-codes", { cookie })).status).toBe(201);
    }
    expect((await call("POST", "/api/devices/pairing-codes", { cookie })).status).toBe(429);
  });
});

describe("caps", () => {
  it("caps tokens per account", async () => {
    const { cookie } = await signedIn();
    for (let i = 0; i < LIMITS.maxTokensPerUser; i++) await createToken(cookie, i % 2 ? "mcp" : "webhook", `t${i}`);
    const r = await call("POST", "/api/tokens", { cookie }, { kind: "webhook", label: "one too many" });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/at most 20 tokens/);
  });

  it("caps devices per account (pairing and browser push)", async () => {
    const { cookie, userId } = await signedIn();
    for (let i = 0; i < LIMITS.maxDevicesPerUser; i++) {
      await createPairedDevice(env.DB, userId, { name: `Phone ${i}`, platform: "android" });
    }
    const pc = await call("POST", "/api/devices/pairing-codes", { cookie });
    const pair = await call("POST", "/api/devices/pair", null, { code: pc.body.code, name: "Eleventh", platform: "android" });
    expect(pair.status).toBe(409);
    expect(pair.body.error.message).toMatch(/at most 10 devices/);
    const web = await call("POST", "/api/devices/web", { cookie }, {
      name: "Chrome",
      subscription: { endpoint: "https://push.example.net/sub/cap", keys: { p256dh: "x", auth: "y" } },
    });
    expect(web.status).toBe(409);
  });

  it("caps templates per account", async () => {
    const { cookie } = await signedIn();
    for (let i = 0; i < LIMITS.maxTemplatesPerUser; i++) {
      expect((await call("PUT", `/api/templates/t${i}`, { cookie }, { card: { title: "T" } })).status).toBe(200);
    }
    expect((await call("PUT", "/api/templates/t0", { cookie }, { card: { title: "edit is fine" } })).status).toBe(200);
    expect((await call("PUT", "/api/templates/extra", { cookie }, { card: { title: "T" } })).status).toBe(409);
  });
});

describe("per-IP protections", () => {
  it("limits new accounts per IP per day, but existing users can still sign in", async () => {
    const ip = { "CF-Connecting-IP": `203.0.113.${Math.floor(Math.random() * 250)}` };
    const first = uniqueEmail();
    for (const email of [first, ...Array.from({ length: LIMITS.signupsPerIpPerDay - 1 }, uniqueEmail)]) {
      const r = await call("GET", `/auth/dev-login?email=${encodeURIComponent(email)}`, null, undefined, ip);
      expect(r.status).toBe(302);
    }
    const blocked = await call("GET", `/auth/dev-login?email=${encodeURIComponent(uniqueEmail())}`, null, undefined, ip);
    expect(blocked.status).toBe(403);
    const again = await call("GET", `/auth/dev-login?email=${encodeURIComponent(first)}`, null, undefined, ip);
    expect(again.status).toBe(302);
  });

  it("turns repeated bad tokens from one IP into 429s", async () => {
    const ip = { "CF-Connecting-IP": "198.51.100.7" };
    const statuses: number[] = [];
    for (let i = 0; i <= LIMITS.authFailuresPerIpPerMinute; i++) {
      statuses.push((await call("POST", "/hook/oyee_wh_nope", null, { title: "x" }, ip)).status);
    }
    expect(statuses.slice(0, LIMITS.authFailuresPerIpPerMinute).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
