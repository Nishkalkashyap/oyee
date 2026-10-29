import type { User } from "@oyee/schema";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../app";
import { findDeviceByToken, getSessionUser, getUser, SESSION_TTL_DAYS, type DeviceRow } from "../db";
import { authFailure } from "../lib/abuse";
import { forbidden, unauthorized } from "../lib/errors";
import type { Actor } from "../inbox/model";

export const SESSION_COOKIE = "oyee_session";

export type Principal =
  | { kind: "session"; user: User; sessionId: string }
  | { kind: "device"; user: User; device: DeviceRow };

export function isSecureRequest(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86400,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecureRequest(c), httpOnly: true, sameSite: "Lax" });
}

function bearer(c: Context): string | null {
  const h = c.req.header("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

/** Resolves the caller from a device Bearer token (or `?token=` for WebSockets) or the session cookie. */
export async function resolvePrincipal(c: Context<AppEnv>, allowQueryToken = false): Promise<Principal | null> {
  const db = c.env.DB;
  const token = bearer(c) ?? (allowQueryToken ? c.req.query("token") ?? null : null);
  if (token) {
    if ((token.startsWith("oyee_dev_") || token.startsWith("hrd_dev_"))) {
      const device = await findDeviceByToken(db, token);
      if (!device) throw await authFailure(c, unauthorized("Invalid or revoked device token"));
      const user = await getUser(db, device.userId);
      if (!user) throw unauthorized("Invalid or revoked device token");
      return { kind: "device", user, device };
    }
    if (/^(oyee|hrd)_(wh|mcp)_/.test(token)) {
      throw forbidden("Webhook and MCP tokens can't be used with the REST API (use /hook/<token> or /mcp)");
    }
    throw unauthorized("Invalid token");
  }
  const sessionId = getCookie(c, SESSION_COOKIE);
  if (sessionId) {
    const user = await getSessionUser(db, sessionId);
    if (user) return { kind: "session", user, sessionId };
  }
  return null;
}

export const requireAuth = (opts: { allowQueryToken?: boolean } = {}): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const p = await resolvePrincipal(c, opts.allowQueryToken);
    if (!p) throw unauthorized();
    c.set("principal", p);
    await next();
  };

/** Only browser sessions (not device tokens). */
export const sessionOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  const p = c.get("principal");
  if (p.kind !== "session") throw forbidden("This endpoint requires a signed-in browser session");
  await next();
};

export function actorFor(p: Principal): Actor {
  if (p.kind === "device") {
    return { userId: p.user.id, deviceId: p.device.id, deviceName: p.device.name, tokenId: null, defaultSource: p.device.name.slice(0, 64) };
  }
  return { userId: p.user.id, deviceId: null, deviceName: "Web", tokenId: null, defaultSource: "web" };
}

/** ALLOWED_EMAILS (comma-separated, case-insensitive; `@domain.com` entries allow a whole domain). */
export function emailAllowed(allowed: string | undefined, email: string): boolean {
  const list = (allowed ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return true;
  const e = email.toLowerCase();
  return list.some((entry) => (entry.startsWith("@") ? e.endsWith(entry) : e === entry));
}

/** Only allow same-origin relative redirects ("/inbox"), never "//evil.com" or absolute URLs. */
export function safeRedirect(r: string | undefined | null): string {
  if (!r || !r.startsWith("/") || r.startsWith("//") || r.startsWith("/\\")) return "/";
  return r;
}
