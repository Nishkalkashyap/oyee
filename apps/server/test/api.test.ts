import type { Notification } from "@herald/schema";
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hmacSha256, toHex } from "../src/lib/encoding";
import { BASE, call, createToken, devLogin, eventually, pairDevice } from "./helpers";

afterEach(() => vi.restoreAllMocks());

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
  it("dev login → webhook token → text + JSON → list → patch → respond → resolve", async () => {
    const cookie = await devLogin();
    const tok = await createToken(cookie, "webhook", "Home Assistant", "home-assistant");
    expect(tok.secret).toMatch(/^hrd_wh_[A-Za-z0-9_-]{43}$/);
    expect(tok.url).toBe(`https://herald.test/hook/${tok.secret}`);
    expect(tok.token.prefix).toBe(tok.secret.slice(0, 11));

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
      actions: [
        { id: "ack", label: "Acknowledge", style: "primary", resolves: true },
        { id: "later", label: "Later" },
      ],
      fields: [{ label: "Env", value: "prod" }],
    });
    expect(j.status).toBe(200);

    // List (newest first)
    const list = await call("GET", "/api/notifications", { cookie });
    expect(list.status).toBe(200);
    expect(list.body.items.map((n: Notification) => n.id)).toEqual([j.body.id, tRes.id]);
    expect(list.body.nextCursor).toBeNull();
    const text = list.body.items[1] as Notification;
    expect(text).toMatchObject({
      title: "Door opened",
      body: "Front door opened at 10:00",
      severity: "warning",
      source: "home-assistant",
      status: "active",
      readAt: null,
    });
    const json = list.body.items[0] as Notification;
    expect(json.actions[1]).toEqual({ id: "later", label: "Later", style: "default", resolves: false });

    // PATCH → version increments
    const patched = await call("PATCH", `/api/notifications/${json.id}`, { cookie }, {
      progress: { value: 3, max: 7, label: "3/7" },
      body: null,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.version).toBe(2);
    expect(patched.body.body).toBeNull();
    expect(patched.body.progress).toEqual({ value: 3, max: 7, label: "3/7", indeterminate: false });

    // Respond with a non-resolving action
    const r1 = await call("POST", `/api/notifications/${json.id}/respond`, { cookie }, { actionId: "later", text: "tomorrow" });
    expect(r1.status).toBe(200);
    expect(r1.body.version).toBe(3);
    expect(r1.body.status).toBe("active");
    expect(r1.body.readAt).not.toBeNull();
    expect(r1.body.responses).toHaveLength(1);
    expect(r1.body.responses[0]).toMatchObject({ actionId: "later", text: "tomorrow", deviceId: null });

    // Unknown action
    expect((await call("POST", `/api/notifications/${json.id}/respond`, { cookie }, { actionId: "nope" })).status).toBe(400);
    // Neither actionId nor text
    expect((await call("POST", `/api/notifications/${json.id}/respond`, { cookie }, {})).status).toBe(400);

    // Resolve
    const res = await call("POST", `/api/notifications/${tRes.id}/resolve`, { cookie });
    expect(res.body.status).toBe("resolved");
    expect(res.body.resolvedAt).not.toBeNull();
    expect(res.body.version).toBe(2);

    // Responding with a `resolves` action resolves it
    const r2 = await call("POST", `/api/notifications/${json.id}/respond`, { cookie }, { actionId: "ack" });
    expect(r2.body.status).toBe("resolved");

    // Filters
    const resolved = await call("GET", "/api/notifications?status=resolved", { cookie });
    expect(resolved.body.items).toHaveLength(2);
    const q = await call("GET", "/api/notifications?q=DOOR", { cookie });
    expect(q.body.items.map((n: Notification) => n.id)).toEqual([tRes.id]);
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
  it("renders templates on send, with overrides and fallbacks", async () => {
    const cookie = await devLogin();
    const put = await call("PUT", "/api/templates/aws-alarm", { cookie }, {
      description: "CloudWatch alarm",
      card: {
        title: "{{service}} {{metric}} high",
        severity: "warning",
        body: "Value: {{value|n/a}}",
        fields: [{ label: "Region", value: "{{region|us-east-1}}" }],
      },
    });
    expect(put.status).toBe(200);
    expect(put.body.id).toMatch(/^tpl_/);

    const sent = await call("POST", "/api/notifications", { cookie }, {
      template: "aws-alarm",
      vars: { service: "prod-api", metric: "CPU", value: 93 },
      severity: "critical",
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({
      title: "prod-api CPU high",
      body: "Value: 93",
      severity: "critical",
      template: "aws-alarm",
      source: "web",
      fields: [{ label: "Region", value: "us-east-1" }],
    });

    const preview = await call("POST", "/api/templates/aws-alarm/preview", { cookie }, { vars: { service: "db" } });
    expect(preview.body.title).toBe("db  high");

    expect((await call("GET", "/api/templates", { cookie })).body.items).toHaveLength(1);
    expect((await call("GET", "/api/templates/aws-alarm", { cookie })).body.description).toBe("CloudWatch alarm");
    expect((await call("POST", "/api/notifications", { cookie }, { template: "missing" })).status).toBe(400);
    expect((await call("DELETE", "/api/templates/aws-alarm", { cookie })).status).toBe(204);
    expect((await call("GET", "/api/templates/aws-alarm", { cookie })).status).toBe(404);
  });

  it("requires a title when there's no template", async () => {
    const cookie = await devLogin();
    const r = await call("POST", "/api/notifications", { cookie }, { body: "no title" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("bad_request");
  });

  it("dedupes by replaceKey while active", async () => {
    const cookie = await devLogin();
    const a = await call("POST", "/api/notifications", { cookie }, { title: "CPU 91%", replaceKey: "cpu-prod" });
    const b = await call("POST", "/api/notifications", { cookie }, { title: "CPU 95%", replaceKey: "cpu-prod" });
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.version).toBe(2);
    expect(b.body.title).toBe("CPU 95%");
    expect((await call("GET", "/api/notifications", { cookie })).body.items).toHaveLength(1);

    await call("POST", `/api/notifications/${a.body.id}/resolve`, { cookie });
    const c = await call("POST", "/api/notifications", { cookie }, { title: "CPU 99%", replaceKey: "cpu-prod" });
    expect(c.body.id).not.toBe(a.body.id);
    expect(c.body.version).toBe(1);
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

  it("signs action callbacks with the token's callback secret", async () => {
    const cookie = await devLogin();
    const tok = await createToken(cookie, "webhook");
    const sent = await call("POST", `/hook/${tok.secret}`, null, {
      title: "Scale?",
      actions: [{ id: "scale", label: "Scale +2", callback: { url: "https://example.com/cb", headers: { "X-Custom": "1" } } }],
    });
    const realFetch = globalThis.fetch;
    const seen: { url: string; headers: Headers; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input as RequestInfo, init as RequestInit);
      if (req.url === "https://example.com/cb") {
        seen.push({ url: req.url, headers: req.headers, body: await req.text() });
        return new Response("ok");
      }
      return realFetch(input as RequestInfo, init as RequestInit);
    });
    const r = await call("POST", `/api/notifications/${sent.body.id}/respond`, { cookie }, { actionId: "scale" });
    expect(r.status).toBe(200);
    const cb = await eventually(() => seen[0]);
    const expected = `sha256=${toHex(await hmacSha256(tok.callbackSecret, cb.body))}`;
    expect(cb.headers.get("X-Herald-Signature")).toBe(expected);
    expect(cb.headers.get("X-Custom")).toBe("1");
    const payload = JSON.parse(cb.body);
    expect(payload.notification.id).toBe(sent.body.id);
    expect(payload.response.actionId).toBe("scale");
  });
});

describe("devices", () => {
  it("pairing flow → device token → Bearer access with device scope", async () => {
    const cookie = await devLogin();
    const pc = await call("POST", "/api/devices/pairing-codes", { cookie });
    expect(pc.status).toBe(201);
    expect(pc.body.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(pc.body.deepLink).toBe(`herald://pair?server=https%3A%2F%2Fherald.test&code=${pc.body.code}`);

    // dash optional, case-insensitive
    const code = (pc.body.code as string).replace("-", "").toLowerCase();
    const paired = await call("POST", "/api/devices/pair", null, { code, name: "Pixel 9", platform: "android" });
    expect(paired.status).toBe(201);
    expect(paired.body.token).toMatch(/^hrd_dev_/);
    expect(paired.body.device).toMatchObject({ name: "Pixel 9", platform: "android", transports: ["websocket"] });
    const bearer = paired.body.token as string;

    // single use
    expect((await call("POST", "/api/devices/pair", null, { code, name: "Again", platform: "ios" })).status).toBe(400);

    await call("POST", "/api/notifications", { cookie }, { title: "hello device" });
    const list = await call("GET", "/api/notifications", { bearer });
    expect(list.status).toBe(200);
    expect(list.body.items[0].title).toBe("hello device");
    expect((await call("GET", "/api/me", { bearer })).body.id).toBe(paired.body.user.id);

    // device scope: can respond/read, can't send or manage tokens
    const id = list.body.items[0].id;
    const reply = await call("POST", `/api/notifications/${id}/respond`, { bearer }, { text: "on it" });
    expect(reply.body.responses[0]).toMatchObject({ deviceId: paired.body.device.id, deviceName: "Pixel 9", text: "on it" });
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
    expect((await pairDevice(cookie)).token).toMatch(/^hrd_dev_/);
  });
});
