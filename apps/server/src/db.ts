/** D1 data access: users, sessions, tokens, devices, pairing codes, OAuth states. */
import type { Device, Platform, TokenInfo, TokenKind, Transport, User, WebPushSubscription } from "@herald/schema";
import { b64urlEncode, randomBytes, sha256Hex } from "./lib/encoding";
import { newId, newSecret, secretPrefix } from "./lib/ids";

const nowIso = () => new Date().toISOString();

// ─── Users ──────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
}

export const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url });

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  const r = await db.prepare("SELECT id, email, name, avatar_url FROM users WHERE id = ?").bind(id).first<UserRow>();
  return r ? toUser(r) : null;
}

/** Creates or updates a user by email (and Google `sub` when known). */
export async function upsertUser(
  db: D1Database,
  p: { email: string; name?: string | null; avatarUrl?: string | null; googleSub?: string | null },
): Promise<User> {
  const email = p.email.trim().toLowerCase();
  const existing = await db
    .prepare("SELECT id, email, name, avatar_url FROM users WHERE email = ? OR (google_sub IS NOT NULL AND google_sub = ?)")
    .bind(email, p.googleSub ?? null)
    .first<UserRow>();
  const now = nowIso();
  if (existing) {
    await db
      .prepare(
        `UPDATE users SET name = COALESCE(?, name), avatar_url = COALESCE(?, avatar_url),
           google_sub = COALESCE(?, google_sub), updated_at = ? WHERE id = ?`,
      )
      .bind(p.name ?? null, p.avatarUrl ?? null, p.googleSub ?? null, now, existing.id)
      .run();
    return (await getUser(db, existing.id))!;
  }
  const id = newId("usr");
  await db
    .prepare(
      "INSERT INTO users (id, email, name, avatar_url, google_sub, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, email, p.name ?? null, p.avatarUrl ?? null, p.googleSub ?? null, now, now)
    .run();
  return { id, email, name: p.name ?? null, avatarUrl: p.avatarUrl ?? null };
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export const SESSION_TTL_DAYS = 30;

export async function createSession(db: D1Database, userId: string, userAgent: string | null): Promise<string> {
  const id = b64urlEncode(randomBytes(32));
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 86400_000);
  await db
    .prepare(
      "INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(await sha256Hex(id), userId, now.toISOString(), expires.toISOString(), now.toISOString(), userAgent?.slice(0, 256) ?? null)
    .run();
  return id;
}

export async function getSessionUser(db: D1Database, sessionId: string): Promise<User | null> {
  const hash = await sha256Hex(sessionId);
  const r = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.avatar_url, s.expires_at, s.last_seen_at FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    )
    .bind(hash)
    .first<UserRow & { expires_at: string; last_seen_at: string }>();
  if (!r) return null;
  const now = Date.now();
  if (Date.parse(r.expires_at) < now) {
    await db.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(hash).run();
    return null;
  }
  // Sliding expiry, throttled to one write per hour.
  if (now - Date.parse(r.last_seen_at) > 3600_000) {
    await db
      .prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?")
      .bind(new Date(now).toISOString(), new Date(now + SESSION_TTL_DAYS * 86400_000).toISOString(), hash)
      .run();
  }
  return toUser(r);
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256Hex(sessionId)).run();
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

interface TokenRow {
  id: string;
  user_id: string;
  kind: TokenKind;
  label: string;
  prefix: string;
  default_source: string | null;
  callback_secret: string;
  created_at: string;
  last_used_at: string | null;
}

export interface TokenRecord extends TokenInfo {
  userId: string;
  callbackSecret: string;
}

const toTokenInfo = (r: TokenRow): TokenInfo => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  prefix: r.prefix,
  defaultSource: r.default_source,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
});

export async function listTokens(db: D1Database, userId: string): Promise<TokenInfo[]> {
  const { results } = await db
    .prepare("SELECT * FROM tokens WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<TokenRow>();
  return results.map(toTokenInfo);
}

export async function createToken(
  db: D1Database,
  userId: string,
  p: { kind: TokenKind; label: string; defaultSource?: string },
): Promise<{ token: TokenInfo; secret: string; callbackSecret: string }> {
  const secret = newSecret(p.kind);
  const id = newId("tok");
  const callbackSecret = b64urlEncode(randomBytes(32));
  const now = nowIso();
  const prefix = secretPrefix(secret);
  await db
    .prepare(
      `INSERT INTO tokens (id, user_id, kind, label, prefix, hash, default_source, callback_secret, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, p.kind, p.label, prefix, await sha256Hex(secret), p.defaultSource ?? null, callbackSecret, now)
    .run();
  return {
    token: { id, kind: p.kind, label: p.label, prefix, defaultSource: p.defaultSource ?? null, createdAt: now, lastUsedAt: null },
    secret,
    callbackSecret,
  };
}

export async function deleteToken(db: D1Database, userId: string, id: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM tokens WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function findTokenBySecret(db: D1Database, secret: string, kind: TokenKind): Promise<TokenRecord | null> {
  const r = await db
    .prepare("SELECT * FROM tokens WHERE hash = ? AND kind = ?")
    .bind(await sha256Hex(secret), kind)
    .first<TokenRow>();
  if (!r) return null;
  // lastUsedAt, throttled to one write per minute.
  if (!r.last_used_at || Date.now() - Date.parse(r.last_used_at) > 60_000) {
    r.last_used_at = nowIso();
    await db.prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?").bind(r.last_used_at, r.id).run();
  }
  return { ...toTokenInfo(r), userId: r.user_id, callbackSecret: r.callback_secret };
}

export async function getTokenCallbackSecret(db: D1Database, tokenId: string): Promise<string | null> {
  const r = await db.prepare("SELECT callback_secret FROM tokens WHERE id = ?").bind(tokenId).first<{ callback_secret: string }>();
  return r?.callback_secret ?? null;
}

// ─── Devices ────────────────────────────────────────────────────────────────

export interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  platform: Platform;
  fcm_token: string | null;
  web_push: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export function toDevice(r: DeviceRow): Device {
  const transports: Transport[] = [];
  if (r.platform !== "web") transports.push("websocket");
  if (r.fcm_token) transports.push("fcm");
  if (r.web_push) transports.push("webpush");
  return { id: r.id, name: r.name, platform: r.platform, transports, createdAt: r.created_at, lastSeenAt: r.last_seen_at };
}

const DEVICE_COLS = "id, user_id, name, platform, fcm_token, web_push, created_at, last_seen_at";

export async function listDevices(db: D1Database, userId: string): Promise<DeviceRow[]> {
  const { results } = await db
    .prepare(`SELECT ${DEVICE_COLS} FROM devices WHERE user_id = ? ORDER BY created_at DESC`)
    .bind(userId)
    .all<DeviceRow>();
  return results;
}

export async function getDevice(db: D1Database, id: string): Promise<DeviceRow | null> {
  return db.prepare(`SELECT ${DEVICE_COLS} FROM devices WHERE id = ?`).bind(id).first<DeviceRow>();
}

export async function findDeviceByToken(db: D1Database, secret: string): Promise<DeviceRow | null> {
  const r = await db
    .prepare(`SELECT ${DEVICE_COLS} FROM devices WHERE token_hash = ?`)
    .bind(await sha256Hex(secret))
    .first<DeviceRow>();
  if (!r) return null;
  if (!r.last_seen_at || Date.now() - Date.parse(r.last_seen_at) > 60_000) {
    r.last_seen_at = nowIso();
    await db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(r.last_seen_at, r.id).run();
  }
  return r;
}

export async function createPairedDevice(
  db: D1Database,
  userId: string,
  p: { name: string; platform: Platform },
): Promise<{ device: DeviceRow; token: string }> {
  const token = newSecret("device");
  const now = nowIso();
  const row: DeviceRow = {
    id: newId("dev"),
    user_id: userId,
    name: p.name,
    platform: p.platform,
    fcm_token: null,
    web_push: null,
    created_at: now,
    last_seen_at: now,
  };
  await db
    .prepare(
      "INSERT INTO devices (id, user_id, name, platform, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(row.id, userId, row.name, row.platform, await sha256Hex(token), now, now)
    .run();
  return { device: row, token };
}

export async function updateDevice(
  db: D1Database,
  id: string,
  p: { name?: string; fcmToken?: string | null },
): Promise<DeviceRow | null> {
  if (p.name !== undefined) await db.prepare("UPDATE devices SET name = ? WHERE id = ?").bind(p.name, id).run();
  if (p.fcmToken !== undefined) {
    if (p.fcmToken) {
      // An FCM registration token belongs to exactly one app install.
      await db.prepare("UPDATE devices SET fcm_token = NULL WHERE fcm_token = ? AND id != ?").bind(p.fcmToken, id).run();
    }
    await db.prepare("UPDATE devices SET fcm_token = ? WHERE id = ?").bind(p.fcmToken, id).run();
  }
  return getDevice(db, id);
}

export async function clearFcmToken(db: D1Database, deviceId: string, fcmToken: string): Promise<void> {
  await db.prepare("UPDATE devices SET fcm_token = NULL WHERE id = ? AND fcm_token = ?").bind(deviceId, fcmToken).run();
}

export async function deleteDevice(db: D1Database, userId: string, id: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM devices WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return (r.meta.changes ?? 0) > 0;
}

/** Creates or updates a `web` device keyed by the push subscription endpoint. */
export async function upsertWebDevice(
  db: D1Database,
  userId: string,
  p: { name: string; subscription: WebPushSubscription },
): Promise<DeviceRow> {
  const json = JSON.stringify(p.subscription);
  const existing = await db
    .prepare("SELECT id FROM devices WHERE web_push_endpoint = ?")
    .bind(p.subscription.endpoint)
    .first<{ id: string }>();
  const now = nowIso();
  if (existing) {
    await db
      .prepare("UPDATE devices SET user_id = ?, name = ?, web_push = ?, last_seen_at = ? WHERE id = ?")
      .bind(userId, p.name, json, now, existing.id)
      .run();
    return (await getDevice(db, existing.id))!;
  }
  const id = newId("dev");
  await db
    .prepare(
      `INSERT INTO devices (id, user_id, name, platform, web_push, web_push_endpoint, created_at, last_seen_at)
       VALUES (?, ?, ?, 'web', ?, ?, ?, ?)`,
    )
    .bind(id, userId, p.name, json, p.subscription.endpoint, now, now)
    .run();
  return (await getDevice(db, id))!;
}

/** Called when a push service reports the subscription as gone (404/410). */
export async function removeWebPush(db: D1Database, deviceId: string): Promise<void> {
  // A web device only exists for its subscription, so delete it entirely.
  await db.prepare("DELETE FROM devices WHERE id = ? AND platform = 'web'").bind(deviceId).run();
  await db.prepare("UPDATE devices SET web_push = NULL, web_push_endpoint = NULL WHERE id = ?").bind(deviceId).run();
}

// ─── Pairing codes ──────────────────────────────────────────────────────────

export const PAIRING_TTL_MS = 10 * 60_000;

export async function createPairingCode(db: D1Database, userId: string, code: string): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
  await db.prepare("DELETE FROM pairing_codes WHERE expires_at < ?").bind(now.toISOString()).run();
  await db
    .prepare("INSERT INTO pairing_codes (code, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(code, userId, now.toISOString(), expiresAt)
    .run();
  return expiresAt;
}

/** Atomically consumes a pairing code. Returns the user id, or null if unknown/expired. */
export async function consumePairingCode(db: D1Database, code: string): Promise<string | null> {
  const r = await db
    .prepare("DELETE FROM pairing_codes WHERE code = ? RETURNING user_id, expires_at")
    .bind(code)
    .first<{ user_id: string; expires_at: string }>();
  if (!r || Date.parse(r.expires_at) < Date.now()) return null;
  return r.user_id;
}

// ─── OAuth states ───────────────────────────────────────────────────────────

export async function saveOAuthState(db: D1Database, state: string, codeVerifier: string, redirect: string): Promise<void> {
  const now = new Date();
  await db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(now.toISOString()).run();
  await db
    .prepare("INSERT INTO oauth_states (state, code_verifier, redirect, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(state, codeVerifier, redirect, now.toISOString(), new Date(now.getTime() + 10 * 60_000).toISOString())
    .run();
}

export async function consumeOAuthState(
  db: D1Database,
  state: string,
): Promise<{ codeVerifier: string; redirect: string } | null> {
  const r = await db
    .prepare("DELETE FROM oauth_states WHERE state = ? RETURNING code_verifier, redirect, expires_at")
    .bind(state)
    .first<{ code_verifier: string; redirect: string; expires_at: string }>();
  if (!r || Date.parse(r.expires_at) < Date.now()) return null;
  return { codeVerifier: r.code_verifier, redirect: r.redirect };
}
