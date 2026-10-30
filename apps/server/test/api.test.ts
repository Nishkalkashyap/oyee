import type { Notification } from "@oyee/schema";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { BASE, call, createToken, devLogin, pairDevice } from "./helpers";


describe("meta", () => {
  it("healthz and config", async () => {
    expect((await call("GET", "/healthz", null)).body).toEqual({ ok: true });
    const cfg = await call("GET", "/api/config", null);
    expect(cfg.status).toBe(200);
    expect(cfg.body).toEqual({ version: "0.1.0", vapidPublicKey: env.VAPID_PUBLIC_KEY, fcmEnabled: true, devLogin: true });
  });

  it("requires auth and uses the error envelope", async () => {
    const r = await call("GET", "/api/me", null);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("unauthorized");
    const unknown = await call("GET", "/api/nope", { cookie: await devLogin() });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("not_found");
  });

  it("logout invalidates the session", async () => {
    const cookie = await devLogin("logout@example.com");
    expect((await call("GET", "/api/me", { cookie })).body.email).toBe("logout@example.com");
    expect((await call("POST", "/auth/logout", { cookie })).status).toBe(204);
    expect((await call("GET", "/api/me", { cookie })).status).toBe(401);
  });

  it("rejects open redirects on dev login", async () => {
    const res = await SELF.fetch(`${BASE}/auth/dev-login?email=a@b.co&redirect=//evil.com`, { redirect: "manual" });
    expect(res.headers.get("Location")).toBe("/");
  });

  it("google login redirects with state + PKCE when configured, errors otherwise", async () => {
    const r = await call("GET", "/auth/google/login?redirect=/inbox", null);
    expect(r.status).toBe(302); // GOOGLE_CLIENT_ID not configured in tests
    expect(r.res.headers.get("location")).toBe("/login?error=not_configured");
  });
});

describe("end-to-end webhook flow", () => {
  it("dev login → webhook token → text + JSON → list → read → resolve", async () => {
    const cookie = await devLogin();
    const tok = await createToken(cookie, "webhook", "Home Assistant", "home-assistant");
    expect(tok.secret).toMatch(/^oyee_wh_[A-Za-z0-9_-]{43}$/);
    expect(tok.url).toBe(`https://oyee.test/hook/${tok.secret}`);
    expect(tok.token.prefix).toBe(tok.secret.slice(0, "oyee_wh_".length + 4));
    expect(Object.keys(tok).sort()).toEqual(["secret", "token", "url"]); // no callback secret: callbacks are gone

    // text/plain
    const t = await SELF.fetch(`${BASE}/hook/${tok.secret}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Title: "Door opened", Priority: "4" },
      body: "Front door opened at 10:00",
    });
    expect(t.status).toBe(200);
    const tRes = (await t.json()) as { id: string; version: number };
    expect(tRes.id).toMatch(/^ntf_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(tRes.version).toBe(1);

    // JSON
    const j = await call("POST", `/hook/${tok.secret}`, null, {
      title: "Deploy finished",
      body: "prod-api **v42**",
      severity: "success",
      links: [{ label: "Build log", url: "https://ci.example.com/42" }],
      fields: [{ label: "Env", value: "prod" }],
    });
    expect(j.status).toBe(200);

    // List (newest first): the wire notification is the shared fields plus one intent block, nothing else
    const list = await call("GET", "/api/notifications", { cookie });
    expect(list.status).toBe(200);
    expect(list.body.items.map((n: Notification) => n.id)).toEqual([j.body.id, tRes.id]);
    expect(list.body.nextCursor).toBeNull();
    expect(list.body.items[1]).toMatchObject({
      intent: "inform",
      title: "Door opened",
      body: "Front door opened at 10:00",
      severity: "warning",
      source: "home-assistant",
      status: "active",
      readAt: null,
    });
    const json = list.body.items[0] as Notification;
    expect(Object.keys(json).sort()).toEqual(
      [
        "id", "intent", "source", "key", "title", "body", "severity", "status", "url", "version", "createdAt",
        "updatedAt", "readAt", "resolvedAt", "targetDeviceIds", "inform",
      ].sort(),
    );
    expect(json).toMatchObject({
      inform: { links: [{ label: "Build log", url: "https://ci.example.com/42" }], fields: [{ label: "Env", value: "prod" }] },
    });

    // An inform takes no answers
    const answer = await call("POST", `/api/notifications/${json.id}/respond`, { cookie }, { text: "ok" });
    expect(answer.status).toBe(400);
    expect(answer.body.error.message).toMatch(/not an ask/);

    // Read, then resolve
    expect((await call("POST", `/api/notifications/${json.id}/read`, { cookie })).body.version).toBe(2);
    const res = await call("POST", `/api/notifications/${tRes.id}/resolve`, { cookie });
    expect(res.body.status).toBe("resolved");
    expect(res.body.resolvedAt).not.toBeNull();
    expect(res.body.version).toBe(2);

    // Filters
    const resolved = await call("GET", "/api/notifications?status=resolved", { cookie });
    expect(resolved.body.items).toHaveLength(1);
    const q = await call("GET", "/api/notifications?q=DOOR", { cookie });
    expect(q.body.items.map((n: Notification) => n.id)).toEqual([tRes.id]);
    const byField = await call("GET", "/api/notifications?q=prod", { cookie });
    expect(byField.body.items.map((n: Notification) => n.id)).toEqual([j.body.id]);
  });

  it("revoked tokens stop working", async () => {
    const cookie = await devLogin();
    const tok = await createToken(cookie, "webhook");
    expect((await call("GET", "/api/tokens", { cookie })).body.items).toHaveLength(1);
    expect((await call("DELETE", `/api/tokens/${tok.token.id}`, { cookie })).status).toBe(204);
    const r = await call("POST", `/hook/${tok.secret}`, null, { title: "x" });
    expect(r.status).toBe(401);
  });
});

describe("notifications", () => {
  it("requires a title", async () => {
    const cookie = await devLogin();
    const r = await call("POST", "/api/notifications", { cookie }, { body: "no title" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("bad_request");
  });

  it("the flat card's routes are gone: no templates, no PATCH", async () => {
    const cookie = await devLogin();
    const sent = await call("POST", "/api/notifications", { cookie }, { title: "x" });
    const patch = await call("PATCH", `/api/notifications/${sent.body.id}`, { cookie }, { title: "y" });
    expect(patch.status).toBe(404);
    expect((await call("GET", `/api/notifications/${sent.body.id}`, { cookie })).body).toMatchObject({ title: "x", version: 1 });
    for (const [method, path] of [
      ["GET", "/api/templates"],
      ["GET", "/api/templates/aws"],
      ["PUT", "/api/templates/aws"],
      ["DELETE", "/api/templates/aws"],
      ["POST", "/api/templates/aws/preview"],
    ] as const) {
      expect((await call(method, path, { cookie }, method === "GET" || method === "DELETE" ? undefined : { card: { title: "T" } })).status, `${method} ${path}`).toBe(404);
    }
  });

  it("rejects protocol v1 card fields, saying what to send instead", async () => {
    const cookie = await devLogin();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ replaceKey: "a" }, /use key/],
      [{ template: "aws", vars: { a: 1 } }, /template is no longer supported/],
      [{ actions: [{ id: "ok", label: "OK" }] }, /use links/],
      [{ reply: {} }, /asks/],
      [{ progress: { value: 1 } }, /"intent": "progress"/],
      [{ threadId: "t" }, /threadId/],
      [{ tags: ["a"] }, /tags/],
      [{ silent: true }, /every severity alerts/],
      [{ severity: "debug" }, /use "info"/],
    ];
    for (const [extra, message] of cases) {
      const r = await call("POST", "/api/notifications", { cookie }, { title: "x", ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(r.body.error.message, JSON.stringify(extra)).toMatch(message);
    }
    expect((await call("GET", "/api/notifications", { cookie })).body.items).toHaveLength(0);
  });

  it("sends an intent-tagged body: an inform with a key updates in place, after a resolve a new one is created", async () => {
    const cookie = await devLogin();
    const a = await call("POST", "/api/notifications", { cookie }, { intent: "inform", title: "CPU 91%", key: "cpu-prod" });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ id: expect.stringMatching(/^ntf_/), version: 1, outcome: "created", reason: expect.any(String) });
    expect(a.body.notification).toMatchObject({ id: a.body.id, intent: "inform", key: "cpu-prod", source: "web", title: "CPU 91%" });
    const b = await call("POST", "/api/notifications", { cookie }, { title: "CPU 95%", key: "cpu-prod" });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ id: a.body.id, version: 2, outcome: "alerted", notification: { title: "CPU 95%" } });
    expect((await call("GET", "/api/notifications", { cookie })).body.items).toHaveLength(1);

    await call("POST", `/api/notifications/${a.body.id}/resolve`, { cookie });
    const c = await call("POST", "/api/notifications", { cookie }, { title: "CPU 99%", key: "cpu-prod" });
    expect(c.body.id).not.toBe(a.body.id);
    expect(c.body).toMatchObject({ version: 1, outcome: "created" });
  });

  it("reports progress, and rejects asks (they're for agents over MCP)", async () => {
    const cookie = await devLogin();
    const p = await call("POST", "/api/notifications", { cookie }, { intent: "progress", key: "import", title: "Importing", value: 2, max: 5 });
    expect(p.status).toBe(201);
    expect(p.body.notification).toMatchObject({ intent: "progress", progress: { value: 2, max: 5, state: "running" } });
    const done = await call("POST", "/api/notifications", { cookie }, { intent: "progress", key: "import", title: "Imported", status: "done" });
    expect(done.body).toMatchObject({ id: p.body.id, outcome: "alerted", notification: { progress: { value: 5, state: "done" } } });

    const ask = await call("POST", "/api/notifications", { cookie }, { intent: "ask", title: "Ship it?", options: ["Yes"] });
    expect(ask.status).toBe(400);
    expect(ask.body.error.message).toMatch(/agents over MCP/);
  });

  it("read, read-all, sources, delete, pagination, updatedSince", async () => {
    const cookie = await devLogin();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await call("POST", "/api/notifications", { cookie }, { title: `n${i}`, source: i % 2 ? "odd" : "even" });
      ids.push(r.body.id);
    }
    const p1 = await call("GET", "/api/notifications?limit=2", { cookie });
    expect(p1.body.items.map((n: Notification) => n.title)).toEqual(["n4", "n3"]);
    expect(p1.body.nextCursor).toBeTypeOf("string");
    const p2 = await call("GET", `/api/notifications?limit=2&cursor=${p1.body.nextCursor}`, { cookie });
    expect(p2.body.items.map((n: Notification) => n.title)).toEqual(["n2", "n1"]);
    const p3 = await call("GET", `/api/notifications?limit=2&cursor=${p2.body.nextCursor}`, { cookie });
    expect(p3.body.items.map((n: Notification) => n.title)).toEqual(["n0"]);
    expect(p3.body.nextCursor).toBeNull();
    expect((await call("GET", "/api/notifications?cursor=garbage", { cookie })).status).toBe(400);
    expect((await call("GET", "/api/notifications?limit=500", { cookie })).status).toBe(400);

    const read = await call("POST", `/api/notifications/${ids[0]}/read`, { cookie });
    expect(read.body.readAt).not.toBeNull();
    expect(read.body.version).toBe(2);
    // idempotent
    expect((await call("POST", `/api/notifications/${ids[0]}/read`, { cookie })).body.version).toBe(2);

    const sources = await call("GET", "/api/sources", { cookie });
    const even = sources.body.items.find((s: { source: string }) => s.source === "even");
    expect(even).toMatchObject({ count: 3, unread: 2 });
    // Resolved notifications don't count as unread (they're out of the default view)
    await call("POST", `/api/notifications/${ids[1]}/resolve`, { cookie });
    const after = await call("GET", "/api/sources", { cookie });
    expect(after.body.items.find((s: { source: string }) => s.source === "odd")).toMatchObject({ count: 2, unread: 1 });

    const ra = await call("POST", "/api/notifications/read-all", { cookie }, { source: "odd" });
    expect(ra.body).toEqual({ updated: 2 });
    const ra2 = await call("POST", "/api/notifications/read-all", { cookie });
    expect(ra2.body).toEqual({ updated: 2 });

    // updatedSince: ordered by updatedAt asc
    const since = await call("GET", `/api/notifications?updatedSince=${encodeURIComponent("2000-01-01T00:00:00Z")}`, { cookie });
    expect(since.body.items).toHaveLength(5);
    expect(since.body.items[since.body.items.length - 1].readAt).not.toBeNull();

    expect((await call("DELETE", `/api/notifications/${ids[1]}`, { cookie })).status).toBe(204);
    expect((await call("GET", `/api/notifications/${ids[1]}`, { cookie })).status).toBe(404);
    expect((await call("GET", `/api/notifications/${ids[2]}`, { cookie })).body.title).toBe("n2");
  });

  it("isolates users", async () => {
    const a = await devLogin();
    const b = await devLogin();
    const n = await call("POST", "/api/notifications", { cookie: a }, { title: "private" });
    expect((await call("GET", `/api/notifications/${n.body.id}`, { cookie: b })).status).toBe(404);
    expect((await call("GET", "/api/notifications", { cookie: b })).body.items).toHaveLength(0);
  });
});

describe("devices", () => {
  it("pairing flow → device token → Bearer access with device scope", async () => {
    const cookie = await devLogin();
    const pc = await call("POST", "/api/devices/pairing-codes", { cookie });
    expect(pc.status).toBe(201);
    expect(pc.body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(pc.body.deepLink).toBe(`oyee://pair?server=https%3A%2F%2Foyee.test&code=${pc.body.code}`);

    // dash optional, case-insensitive
    const code = (pc.body.code as string).replace("-", "").toLowerCase();
    const paired = await call("POST", "/api/devices/pair", null, { code, name: "Pixel 9", platform: "android" });
    expect(paired.status).toBe(201);
    expect(paired.body.token).toMatch(/^oyee_dev_/);
    expect(paired.body.device).toMatchObject({ name: "Pixel 9", platform: "android", transports: ["websocket"] });
    const bearer = paired.body.token as string;

    // single use
    expect((await call("POST", "/api/devices/pair", null, { code, name: "Again", platform: "ios" })).status).toBe(400);

    await call("POST", "/api/notifications", { cookie }, { title: "hello device" });
    const list = await call("GET", "/api/notifications", { bearer });
    expect(list.status).toBe(200);
    expect(list.body.items[0].title).toBe("hello device");
    expect((await call("GET", "/api/me", { bearer })).body.id).toBe(paired.body.user.id);

    // device scope: can read/resolve (and answer asks), can't send or manage tokens
    const id = list.body.items[0].id;
    expect((await call("POST", `/api/notifications/${id}/read`, { bearer })).body.readAt).not.toBeNull();
    expect((await call("POST", "/api/notifications", { bearer }, { title: "x" })).status).toBe(403);
    expect((await call("GET", "/api/tokens", { bearer })).status).toBe(403);

    const self = await call("PUT", "/api/devices/self", { bearer }, { fcmToken: "fcm-abc", name: "My Pixel" });
    expect(self.body).toMatchObject({ name: "My Pixel", transports: ["websocket", "fcm"] });
    const devs = await call("GET", "/api/devices", { cookie });
    expect(devs.body.items).toHaveLength(1);

    expect((await call("DELETE", "/api/devices/self", { bearer })).status).toBe(204);
    expect((await call("GET", "/api/notifications", { bearer })).status).toBe(401);
  });

  it("registers web push devices keyed by endpoint", async () => {
    const cookie = await devLogin();
    const sub = { endpoint: "https://push.example.com/abc", keys: { p256dh: "BAAA", auth: "AAAA" } };
    const a = await call("POST", "/api/devices/web", { cookie }, { name: "Chrome on Mac", subscription: sub });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ platform: "web", transports: ["webpush"] });
    const b = await call("POST", "/api/devices/web", { cookie }, { name: "Chrome (renamed)", subscription: sub });
    expect(b.body.id).toBe(a.body.id);
    expect((await call("DELETE", `/api/devices/${a.body.id}`, { cookie })).status).toBe(204);
    expect((await call("GET", "/api/devices", { cookie })).body.items).toHaveLength(0);
  });

  it("rejects webhook tokens on the REST API", async () => {
    const cookie = await devLogin();
    const tok = await createToken(cookie, "webhook");
    expect((await call("GET", "/api/notifications", { bearer: tok.secret })).status).toBe(403);
    expect((await pairDevice(cookie)).token).toMatch(/^oyee_dev_/);
  });
});
