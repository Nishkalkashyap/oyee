/** /api/* REST endpoints (docs/protocol.md §2.2, §3) and the WebSocket upgrade (§6). */
import {
  CreateTokenInput,
  ListNotificationsQuery,
  PairInput,
  RegisterWebDeviceInput,
  RenameDeviceInput,
  RespondInput,
  UpdateSelfDeviceInput,
  LIMITS,
  type PairingCode,
  type ServerConfig,
} from "@oyee/schema";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { actorFor, requireAuth, sessionOnly, type Principal } from "../auth/principal";
import {
  consumePairingCode,
  createPairedDevice,
  createPairingCode,
  countDevices,
  countTokens,
  createToken,
  deleteDevice,
  deleteToken,
  getDevice,
  getUser,
  listDevices,
  listTokens,
  toDevice,
  updateDevice,
  upsertWebDevice,
  webDeviceExists,
} from "../db";
import { isDevLogin, publicUrl, SERVER_VERSION, type Env } from "../env";
import { authFailure } from "../lib/abuse";
import { badRequest, conflict, notFound, parseOrThrow, rpc, unauthorized } from "../lib/errors";
import { readJson } from "../lib/http";
import { formatPairingCode, newPairingCode, normalizePairingCode } from "../lib/ids";
import { parseServiceAccount } from "../push/fcm";
import { parseIntentSend, sendIntent } from "./send";

export const inbox = (env: Env, userId: string) => env.INBOX.get(env.INBOX.idFromName(userId));

export const api = new Hono<AppEnv>();

// ─── Public ─────────────────────────────────────────────────────────────────

api.get("/config", (c) => {
  const body: ServerConfig = {
    version: SERVER_VERSION,
    vapidPublicKey: c.env.VAPID_PUBLIC_KEY?.trim() || null,
    fcmEnabled: parseServiceAccount(c.env.FCM_SERVICE_ACCOUNT_JSON) !== null,
    devLogin: isDevLogin(c.env),
  };
  return c.json(body);
});

api.post("/devices/pair", async (c) => {
  const input = await readJson(c, PairInput);
  const userId = await consumePairingCode(c.env.DB, normalizePairingCode(input.code));
  const user = userId ? await getUser(c.env.DB, userId) : null;
  if (!userId || !user) throw await authFailure(c, badRequest("Invalid or expired pairing code"));
  await assertDeviceRoom(c.env, userId);
  const { device, token } = await createPairedDevice(c.env.DB, userId, { name: input.name, platform: input.platform });
  return c.json({ device: toDevice(device), token, user }, 201);
});

async function assertDeviceRoom(env: Env, userId: string) {
  if ((await countDevices(env.DB, userId)) >= LIMITS.maxDevicesPerUser) {
    throw conflict(`You can have at most ${LIMITS.maxDevicesPerUser} devices: remove one in Devices first`);
  }
}

// ─── Authenticated ──────────────────────────────────────────────────────────

api.get("/ws", requireAuth({ allowQueryToken: true }), async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") throw badRequest("Expected a WebSocket upgrade");
  const p = c.get("principal");
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Oyee-User-Id", p.user.id);
  if (p.kind === "device") headers.set("X-Oyee-Device-Id", p.device.id);
  else headers.delete("X-Oyee-Device-Id");
  return inbox(c.env, p.user.id).fetch(new Request(c.req.raw.url, { headers }));
});

api.use("*", requireAuth());

const principal = (c: { get(k: "principal"): Principal }) => c.get("principal");

api.get("/me", (c) => c.json(principal(c).user));

api.get("/usage", async (c) => c.json(await rpc(inbox(c.env, principal(c).user.id).usage())));

// Tokens (session only)
api.get("/tokens", sessionOnly, async (c) => c.json({ items: await listTokens(c.env.DB, principal(c).user.id) }));

api.post("/tokens", sessionOnly, async (c) => {
  const input = await readJson(c, CreateTokenInput);
  if ((await countTokens(c.env.DB, principal(c).user.id)) >= LIMITS.maxTokensPerUser) {
    throw conflict(`You can have at most ${LIMITS.maxTokensPerUser} tokens: delete one first`);
  }
  const { token, secret } = await createToken(c.env.DB, principal(c).user.id, input);
  const base = publicUrl(c.env, c.req.raw);
  const url = input.kind === "webhook" ? `${base}/hook/${secret}` : `${base}/mcp/${secret}`;
  return c.json({ token, secret, url }, 201);
});

api.delete("/tokens/:id", sessionOnly, async (c) => {
  if (!(await deleteToken(c.env.DB, principal(c).user.id, c.req.param("id")))) throw notFound("Token not found");
  return c.body(null, 204);
});

// Devices
api.post("/devices/pairing-codes", sessionOnly, async (c) => {
  const userId = principal(c).user.id;
  await rpc(inbox(c.env, userId).useQuota("pairing"));
  let code = "";
  let expiresAt = "";
  for (let attempt = 0; ; attempt++) {
    code = newPairingCode();
    try {
      expiresAt = await createPairingCode(c.env.DB, userId, code);
      break;
    } catch (e) {
      if (attempt >= 3) throw e; // PK collision is astronomically unlikely; retry a few times anyway
    }
  }
  const pretty = formatPairingCode(code);
  const body: PairingCode = {
    code: pretty,
    expiresAt,
    deepLink: `oyee://pair?server=${encodeURIComponent(publicUrl(c.env, c.req.raw))}&code=${pretty}`,
  };
  return c.json(body, 201);
});

api.get("/devices", sessionOnly, async (c) => {
  const rows = await listDevices(c.env.DB, principal(c).user.id);
  return c.json({ items: rows.map(toDevice) });
});

api.post("/devices/web", sessionOnly, async (c) => {
  const input = await readJson(c, RegisterWebDeviceInput);
  const userId = principal(c).user.id;
  if (!(await webDeviceExists(c.env.DB, userId, input.subscription.endpoint))) await assertDeviceRoom(c.env, userId);
  const row = await upsertWebDevice(c.env.DB, userId, input);
  return c.json(toDevice(row), 201);
});

api.put("/devices/self", async (c) => {
  const p = principal(c);
  if (p.kind !== "device") throw unauthorized("A device token is required");
  const input = await readJson(c, UpdateSelfDeviceInput);
  const row = await updateDevice(c.env.DB, p.device.id, input);
  if (!row) throw notFound("Device not found");
  return c.json(toDevice(row));
});

api.delete("/devices/self", async (c) => {
  const p = principal(c);
  if (p.kind !== "device") throw unauthorized("A device token is required");
  await deleteDevice(c.env.DB, p.user.id, p.device.id);
  c.executionCtx.waitUntil(inbox(c.env, p.user.id).disconnectDevice(p.device.id));
  return c.body(null, 204);
});

api.patch("/devices/:id", sessionOnly, async (c) => {
  const p = principal(c);
  const id = c.req.param("id");
  const { name } = await readJson(c, RenameDeviceInput);
  const dev = await getDevice(c.env.DB, id);
  if (!dev || dev.userId !== p.user.id) throw notFound("Device not found");
  return c.json(toDevice((await updateDevice(c.env.DB, id, { name }))!));
});

api.delete("/devices/:id", sessionOnly, async (c) => {
  const p = principal(c);
  const id = c.req.param("id");
  const dev = await getDevice(c.env.DB, id);
  if (!dev || dev.userId !== p.user.id || !(await deleteDevice(c.env.DB, p.user.id, id))) throw notFound("Device not found");
  c.executionCtx.waitUntil(inbox(c.env, p.user.id).disconnectDevice(id));
  return c.body(null, 204);
});

// Notifications
api.get("/notifications", async (c) => {
  const q = parseOrThrow(ListNotificationsQuery, c.req.query());
  return c.json(await rpc(inbox(c.env, principal(c).user.id).list(q)));
});

/** The web composer's send: an intent-tagged body, answered like a webhook send plus the notification itself. */
api.post("/notifications", sessionOnly, async (c) => {
  const body = await readJson(c, z.unknown());
  const p = principal(c);
  const sent = await sendIntent(inbox(c.env, p.user.id), actorFor(p), parseIntentSend(body));
  return c.json(sent, sent.outcome === "created" ? 201 : 200);
});

api.post("/notifications/read-all", async (c) => {
  const input = await readJson(c, z.object({ source: z.string().optional() }));
  const p = principal(c);
  return c.json(await rpc(inbox(c.env, p.user.id).readAll(actorFor(p), input.source)));
});

api.get("/notifications/:id", async (c) => {
  return c.json(await rpc(inbox(c.env, principal(c).user.id).get(c.req.param("id"))));
});

api.post("/notifications/:id/respond", async (c) => {
  const input = await readJson(c, RespondInput);
  const p = principal(c);
  return c.json(await rpc(inbox(c.env, p.user.id).respond(actorFor(p), c.req.param("id"), input)));
});

api.post("/notifications/:id/read", async (c) => {
  const p = principal(c);
  return c.json(await rpc(inbox(c.env, p.user.id).markRead(actorFor(p), c.req.param("id"))));
});

api.post("/notifications/:id/resolve", async (c) => {
  const p = principal(c);
  return c.json(await rpc(inbox(c.env, p.user.id).resolve(actorFor(p), c.req.param("id"))));
});

api.delete("/notifications/:id", async (c) => {
  const p = principal(c);
  await rpc(inbox(c.env, p.user.id).remove(actorFor(p), c.req.param("id")));
  return c.body(null, 204);
});

api.get("/sources", async (c) => c.json({ items: await rpc(inbox(c.env, principal(c).user.id).sources()) }));
