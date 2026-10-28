/** D1 data access via Drizzle: users, sessions, tokens, devices, pairing codes, OAuth states. */
import { and, desc, eq, isNotNull, lt, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Device, Platform, TokenInfo, TokenKind, Transport, User, WebPushSubscription } from "@oyee/schema";
import { b64urlEncode, randomBytes, sha256Hex } from "../lib/encoding";
import { newId, newSecret, secretPrefix } from "../lib/ids";
import * as schema from "./schema";
import { devices, oauthStates, pairingCodes, sessions, tokens, users, type DeviceRow, type TokenRow, type UserRow } from "./schema";

export type { DeviceRow } from "./schema";

const orm = (db: D1Database) => drizzle(db, { schema });
const nowIso = () => new Date().toISOString();

// ─── Users ──────────────────────────────────────────────────────────────────

export const toUser = (r: Pick<UserRow, "id" | "email" | "name" | "avatarUrl">): User => ({
  id: r.id,
  email: r.email,
  name: r.name,
  avatarUrl: r.avatarUrl,
});

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  const r = await orm(db).select().from(users).where(eq(users.id, id)).get();
  return r ? toUser(r) : null;
}

/** Creates or updates a user by email (and Google `sub` when known). */
export async function upsertUser(
  db: D1Database,
  p: { email: string; name?: string | null; avatarUrl?: string | null; googleSub?: string | null },
): Promise<User> {
  const d = orm(db);
  const email = p.email.trim().toLowerCase();
  const match = p.googleSub
    ? or(eq(users.email, email), and(isNotNull(users.googleSub), eq(users.googleSub, p.googleSub)))
    : eq(users.email, email);
  const existing = await d.select().from(users).where(match).get();
  const now = nowIso();
  if (existing) {
    const updated = await d
      .update(users)
      .set({
        name: p.name ?? existing.name,
        avatarUrl: p.avatarUrl ?? existing.avatarUrl,
        googleSub: p.googleSub ?? existing.googleSub,
        updatedAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning()
      .get();
    return toUser(updated);
  }
  const row = await d
    .insert(users)
    .values({
      id: newId("usr"),
      email,
      name: p.name ?? null,
      avatarUrl: p.avatarUrl ?? null,
      googleSub: p.googleSub ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toUser(row);
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export const SESSION_TTL_DAYS = 30;

export async function createSession(db: D1Database, userId: string, userAgent: string | null): Promise<string> {
  const id = b64urlEncode(randomBytes(32));
  const now = new Date();
  await orm(db)
    .insert(sessions)
    .values({
      idHash: await sha256Hex(id),
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_DAYS * 86400_000).toISOString(),
      lastSeenAt: now.toISOString(),
      userAgent: userAgent?.slice(0, 256) ?? null,
    })
    .run();
  return id;
}

export async function getSessionUser(db: D1Database, sessionId: string): Promise<User | null> {
  const d = orm(db);
  const hash = await sha256Hex(sessionId);
  const r = await d
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.idHash, hash))
    .get();
  if (!r) return null;
  const now = Date.now();
  if (Date.parse(r.expiresAt) < now) {
    await d.delete(sessions).where(eq(sessions.idHash, hash)).run();
    return null;
  }
  // Sliding expiry, throttled to one write per hour.
  if (now - Date.parse(r.lastSeenAt) > 3600_000) {
    await d
      .update(sessions)
      .set({
        lastSeenAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SESSION_TTL_DAYS * 86400_000).toISOString(),
      })
      .where(eq(sessions.idHash, hash))
      .run();
  }
  return toUser(r);
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await orm(db)
    .delete(sessions)
    .where(eq(sessions.idHash, await sha256Hex(sessionId)))
    .run();
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

export interface TokenRecord extends TokenInfo {
  userId: string;
  callbackSecret: string;
}

const toTokenInfo = (r: TokenRow): TokenInfo => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  prefix: r.prefix,
  defaultSource: r.defaultSource,
  createdAt: r.createdAt,
  lastUsedAt: r.lastUsedAt,
});

export async function listTokens(db: D1Database, userId: string): Promise<TokenInfo[]> {
  const rows = await orm(db).select().from(tokens).where(eq(tokens.userId, userId)).orderBy(desc(tokens.createdAt)).all();
  return rows.map(toTokenInfo);
}

export async function createToken(
  db: D1Database,
  userId: string,
  p: { kind: TokenKind; label: string; defaultSource?: string },
): Promise<{ token: TokenInfo; secret: string; callbackSecret: string }> {
  const secret = newSecret(p.kind);
  const callbackSecret = b64urlEncode(randomBytes(32));
  const row = await orm(db)
    .insert(tokens)
    .values({
      id: newId("tok"),
      userId,
      kind: p.kind,
      label: p.label,
      prefix: secretPrefix(secret),
      hash: await sha256Hex(secret),
      defaultSource: p.defaultSource ?? null,
      callbackSecret,
      createdAt: nowIso(),
    })
    .returning()
    .get();
  return { token: toTokenInfo(row), secret, callbackSecret };
}

export async function deleteToken(db: D1Database, userId: string, id: string): Promise<boolean> {
  const deleted = await orm(db)
    .delete(tokens)
    .where(and(eq(tokens.id, id), eq(tokens.userId, userId)))
    .returning({ id: tokens.id })
    .all();
  return deleted.length > 0;
}

export async function findTokenBySecret(db: D1Database, secret: string, kind: TokenKind): Promise<TokenRecord | null> {
  const d = orm(db);
  const r = await d
    .select()
    .from(tokens)
    .where(and(eq(tokens.hash, await sha256Hex(secret)), eq(tokens.kind, kind)))
    .get();
  if (!r) return null;
  // lastUsedAt, throttled to one write per minute.
  if (!r.lastUsedAt || Date.now() - Date.parse(r.lastUsedAt) > 60_000) {
    r.lastUsedAt = nowIso();
    await d.update(tokens).set({ lastUsedAt: r.lastUsedAt }).where(eq(tokens.id, r.id)).run();
  }
  return { ...toTokenInfo(r), userId: r.userId, callbackSecret: r.callbackSecret };
}

export async function getTokenCallbackSecret(db: D1Database, tokenId: string): Promise<string | null> {
  const r = await orm(db).select({ callbackSecret: tokens.callbackSecret }).from(tokens).where(eq(tokens.id, tokenId)).get();
  return r?.callbackSecret ?? null;
}

// ─── Devices ────────────────────────────────────────────────────────────────

export function toDevice(r: DeviceRow): Device {
  const transports: Transport[] = [];
  if (r.platform !== "web") transports.push("websocket");
  if (r.fcmToken) transports.push("fcm");
  if (r.webPush) transports.push("webpush");
  return { id: r.id, name: r.name, platform: r.platform, transports, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt };
}

export async function listDevices(db: D1Database, userId: string): Promise<DeviceRow[]> {
  return orm(db).select().from(devices).where(eq(devices.userId, userId)).orderBy(desc(devices.createdAt)).all();
}

export async function getDevice(db: D1Database, id: string): Promise<DeviceRow | null> {
  return (await orm(db).select().from(devices).where(eq(devices.id, id)).get()) ?? null;
}

export async function findDeviceByToken(db: D1Database, secret: string): Promise<DeviceRow | null> {
  const d = orm(db);
  const r = await d
    .select()
    .from(devices)
    .where(eq(devices.tokenHash, await sha256Hex(secret)))
    .get();
  if (!r) return null;
  if (!r.lastSeenAt || Date.now() - Date.parse(r.lastSeenAt) > 60_000) {
    r.lastSeenAt = nowIso();
    await d.update(devices).set({ lastSeenAt: r.lastSeenAt }).where(eq(devices.id, r.id)).run();
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
  const device = await orm(db)
    .insert(devices)
    .values({
      id: newId("dev"),
      userId,
      name: p.name,
      platform: p.platform,
      tokenHash: await sha256Hex(token),
      createdAt: now,
      lastSeenAt: now,
    })
    .returning()
    .get();
  return { device, token };
}

export async function updateDevice(
  db: D1Database,
  id: string,
  p: { name?: string; fcmToken?: string | null },
): Promise<DeviceRow | null> {
  const d = orm(db);
  if (p.fcmToken) {
    // An FCM registration token belongs to exactly one app install.
    await d
      .update(devices)
      .set({ fcmToken: null })
      .where(and(eq(devices.fcmToken, p.fcmToken), ne(devices.id, id)))
      .run();
  }
  const set: Partial<DeviceRow> = {};
  if (p.name !== undefined) set.name = p.name;
  if (p.fcmToken !== undefined) set.fcmToken = p.fcmToken;
  if (Object.keys(set).length > 0) await d.update(devices).set(set).where(eq(devices.id, id)).run();
  return getDevice(db, id);
}

export async function clearFcmToken(db: D1Database, deviceId: string, fcmToken: string): Promise<void> {
  await orm(db)
    .update(devices)
    .set({ fcmToken: null })
    .where(and(eq(devices.id, deviceId), eq(devices.fcmToken, fcmToken)))
    .run();
}

export async function deleteDevice(db: D1Database, userId: string, id: string): Promise<boolean> {
  const deleted = await orm(db)
    .delete(devices)
    .where(and(eq(devices.id, id), eq(devices.userId, userId)))
    .returning({ id: devices.id })
    .all();
  return deleted.length > 0;
}

/** Creates or updates a `web` device keyed by the push subscription endpoint. */
export async function upsertWebDevice(
  db: D1Database,
  userId: string,
  p: { name: string; subscription: WebPushSubscription },
): Promise<DeviceRow> {
  const now = nowIso();
  return orm(db)
    .insert(devices)
    .values({
      id: newId("dev"),
      userId,
      name: p.name,
      platform: "web",
      webPush: JSON.stringify(p.subscription),
      webPushEndpoint: p.subscription.endpoint,
      createdAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: devices.webPushEndpoint,
      set: { userId, name: p.name, webPush: JSON.stringify(p.subscription), lastSeenAt: now },
    })
    .returning()
    .get();
}

/** Called when a push service reports the subscription as gone (404/410). */
export async function removeWebPush(db: D1Database, deviceId: string): Promise<void> {
  const d = orm(db);
  // A web device only exists for its subscription, so delete it entirely.
  await d
    .delete(devices)
    .where(and(eq(devices.id, deviceId), eq(devices.platform, "web")))
    .run();
  await d.update(devices).set({ webPush: null, webPushEndpoint: null }).where(eq(devices.id, deviceId)).run();
}

// ─── Pairing codes ──────────────────────────────────────────────────────────

export const PAIRING_TTL_MS = 10 * 60_000;

export async function createPairingCode(db: D1Database, userId: string, code: string): Promise<string> {
  const d = orm(db);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();
  await d.delete(pairingCodes).where(lt(pairingCodes.expiresAt, now.toISOString())).run();
  await d.insert(pairingCodes).values({ code, userId, createdAt: now.toISOString(), expiresAt }).run();
  return expiresAt;
}

/** Atomically consumes a pairing code. Returns the user id, or null if unknown/expired. */
export async function consumePairingCode(db: D1Database, code: string): Promise<string | null> {
  const r = await orm(db)
    .delete(pairingCodes)
    .where(eq(pairingCodes.code, code))
    .returning({ userId: pairingCodes.userId, expiresAt: pairingCodes.expiresAt })
    .get();
  if (!r || Date.parse(r.expiresAt) < Date.now()) return null;
  return r.userId;
}

// ─── OAuth states ───────────────────────────────────────────────────────────

export async function saveOAuthState(db: D1Database, state: string, codeVerifier: string, redirect: string): Promise<void> {
  const d = orm(db);
  const now = new Date();
  await d.delete(oauthStates).where(lt(oauthStates.expiresAt, now.toISOString())).run();
  await d
    .insert(oauthStates)
    .values({
      state,
      codeVerifier,
      redirect,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    })
    .run();
}

export async function consumeOAuthState(
  db: D1Database,
  state: string,
): Promise<{ codeVerifier: string; redirect: string } | null> {
  const r = await orm(db).delete(oauthStates).where(eq(oauthStates.state, state)).returning().get();
  if (!r || Date.parse(r.expiresAt) < Date.now()) return null;
  return { codeVerifier: r.codeVerifier, redirect: r.redirect };
}
