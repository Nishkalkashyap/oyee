import { SELF } from "cloudflare:test";
import { expect } from "vitest";

export const BASE = "https://oyee.test";

let counter = 0;
export const uniqueEmail = () => `user${Date.now()}${++counter}@example.com`;

/** Dev-login and return the `Cookie` header value. */
export async function devLogin(email = uniqueEmail()): Promise<string> {
  const res = await SELF.fetch(`${BASE}/auth/dev-login?email=${encodeURIComponent(email)}&redirect=/inbox`, {
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/inbox");
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  const m = /oyee_session=([^;]+)/.exec(setCookie);
  expect(m).not.toBeNull();
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);
  return `oyee_session=${m![1]}`;
}

export type Auth = { cookie: string } | { bearer: string } | null;

export async function call<T = any>(
  method: string,
  path: string,
  auth: Auth,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: T; res: Response }> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (auth && "cookie" in auth) headers.Cookie = auth.cookie;
  if (auth && "bearer" in auth) headers.Authorization = `Bearer ${auth.bearer}`;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (typeof body === "string") payload = body;
    else {
      payload = JSON.stringify(body);
      headers["Content-Type"] ??= "application/json";
    }
  }
  const res = await SELF.fetch(`${BASE}${path}`, { method, headers, body: payload, redirect: "manual" });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T, res };
}

export async function createToken(cookie: string, kind: "webhook" | "mcp", label = "Test", defaultSource?: string) {
  const r = await call("POST", "/api/tokens", { cookie }, { kind, label, defaultSource });
  expect(r.status).toBe(201);
  return r.body as { token: { id: string; prefix: string }; secret: string; url: string };
}

/** Pair a device for the session user; returns the device token. */
export async function pairDevice(cookie: string, name = "Pixel 9", platform = "android") {
  const pc = await call("POST", "/api/devices/pairing-codes", { cookie });
  expect(pc.status).toBe(201);
  const r = await call("POST", "/api/devices/pair", null, { code: pc.body.code, name, platform });
  expect(r.status).toBe(201);
  return r.body as { device: { id: string; name: string }; token: string; user: { id: string } };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` until it returns a truthy value. */
export async function eventually<T>(fn: () => T | Promise<T>, timeoutMs = 3000): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await sleep(20);
  }
}
