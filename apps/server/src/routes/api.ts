/** /api/* REST endpoints (docs/protocol.md §2.2, §3) and the WebSocket upgrade (§6). */
import {
  CreateTokenInput,
  ListNotificationsQuery,
  PairInput,
  RegisterWebDeviceInput,
  RespondInput,
  SendNotificationInput,
  TemplateName,
  UpdateNotificationInput,
  UpdateSelfDeviceInput,
  UpsertTemplateInput,
  type PairingCode,
  type ServerConfig,
} from "@herald/schema";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { actorFor, requireAuth, sessionOnly, type Principal } from "../auth/principal";
import {
  consumePairingCode,
  createPairedDevice,
  createPairingCode,
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
} from "../db";
import { isDevLogin, publicUrl, SERVER_VERSION, type Env } from "../env";
import { badRequest, notFound, parseOrThrow, rpc, unauthorized } from "../lib/errors";
import { readJson } from "../lib/http";
import { formatPairingCode, newPairingCode, normalizePairingCode } from "../lib/ids";
import { parseServiceAccount } from "../push/fcm";

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
  if (!userId) throw badRequest("Invalid or expired pairing code");
  const user = await getUser(c.env.DB, userId);
  if (!user) throw badRequest("Invalid or expired pairing code");
  const { device, token } = await createPairedDevice(c.env.DB, userId, { name: input.name, platform: input.platform });
  return c.json({ device: toDevice(device), token, user }, 201);
});

// ─── Authenticated ──────────────────────────────────────────────────────────

api.get("/ws", requireAuth({ allowQueryToken: true }), async (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") throw badRequest("Expected a WebSocket upgrade");
  const p = c.get("principal");
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Herald-User-Id", p.user.id);
  if (p.kind === "device") headers.set("X-Herald-Device-Id", p.device.id);
  else headers.delete("X-Herald-Device-Id");
  return inbox(c.env, p.user.id).fetch(new Request(c.req.raw.url, { headers }));
});

api.use("*", requireAuth());

const principal = (c: { get(k: "principal"): Principal }) => c.get("principal");

api.get("/me", (c) => c.json(principal(c).user));

// Tokens (session only)
api.get("/tokens", sessionOnly, async (c) => c.json({ items: await listTokens(c.env.DB, principal(c).user.id) }));

api.post("/tokens", sessionOnly, async (c) => {
  const input = await readJson(c, CreateTokenInput);
  const { token, secret, callbackSecret } = await createToken(c.env.DB, principal(c).user.id, input);
  const base = publicUrl(c.env, c.req.raw);
  const url = input.kind === "webhook" ? `${base}/hook/${secret}` : `${base}/mcp/${secret}`;
  // `callbackSecret` is an extension: the HMAC key for X-Herald-Signature on action callbacks sent via this token.
  return c.json({ token, secret, url, callbackSecret }, 201);
});

api.delete("/tokens/:id", sessionOnly, async (c) => {
  if (!(await deleteToken(c.env.DB, principal(c).user.id, c.req.param("id")))) throw notFound("Token not found");
  return c.body(null, 204);
});

// Devices
api.post("/devices/pairing-codes", sessionOnly, async (c) => {
  const userId = principal(c).user.id;
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
    deepLink: `herald://pair?server=${encodeURIComponent(publicUrl(c.env, c.req.raw))}&code=${pretty}`,
  };
  return c.json(body, 201);
});

api.get("/devices", sessionOnly, async (c) => {
  const rows = await listDevices(c.env.DB, principal(c).user.id);
  return c.json({ items: rows.map(toDevice) });
});

api.post("/devices/web", sessionOnly, async (c) => {
  const input = await readJson(c, RegisterWebDeviceInput);
  const row = await upsertWebDevice(c.env.DB, principal(c).user.id, input);
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

api.delete("/devices/:id", sessionOnly, async (c) => {
  const p = principal(c);
  const id = c.req.param("id");
  const dev = await getDevice(c.env.DB, id);
  if (!dev || dev.user_id !== p.user.id || !(await deleteDevice(c.env.DB, p.user.id, id))) throw notFound("Device not found");
  c.executionCtx.waitUntil(inbox(c.env, p.user.id).disconnectDevice(id));
  return c.body(null, 204);
});

// Notifications
api.get("/notifications", async (c) => {
  const q = parseOrThrow(ListNotificationsQuery, c.req.query());
  return c.json(await rpc(inbox(c.env, principal(c).user.id).list(q)));
});

api.post("/notifications", sessionOnly, async (c) => {
  const input = await readJson(c, SendNotificationInput);
  const p = principal(c);
  return c.json(await rpc(inbox(c.env, p.user.id).send(actorFor(p), input)), 201);
});

api.post("/notifications/read-all", async (c) => {
  const input = await readJson(c, z.object({ source: z.string().optional() }));
  const p = principal(c);
  return c.json(await rpc(inbox(c.env, p.user.id).readAll(actorFor(p), input.source)));
});

api.get("/notifications/:id", async (c) => {
  return c.json(await rpc(inbox(c.env, principal(c).user.id).get(c.req.param("id"))));
});

api.patch("/notifications/:id", sessionOnly, async (c) => {
  const input = await readJson(c, UpdateNotificationInput);
  const p = principal(c);
  return c.json(await rpc(inbox(c.env, p.user.id).update(actorFor(p), c.req.param("id"), input)));
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

// Templates
const templateName = (raw: string) => parseOrThrow(TemplateName, raw);

api.get("/templates", async (c) => c.json({ items: await rpc(inbox(c.env, principal(c).user.id).listTemplates()) }));

api.get("/templates/:name", async (c) => {
  return c.json(await rpc(inbox(c.env, principal(c).user.id).getTemplate(templateName(c.req.param("name")))));
});

api.put("/templates/:name", sessionOnly, async (c) => {
  const name = templateName(c.req.param("name"));
  const input = await readJson(c, UpsertTemplateInput);
  return c.json(await rpc(inbox(c.env, principal(c).user.id).upsertTemplate(name, input)));
});

api.delete("/templates/:name", sessionOnly, async (c) => {
  await rpc(inbox(c.env, principal(c).user.id).deleteTemplate(templateName(c.req.param("name"))));
  return c.body(null, 204);
});

api.post("/templates/:name/preview", sessionOnly, async (c) => {
  const name = templateName(c.req.param("name"));
  const input = await readJson(
    c,
    z.object({ vars: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) }),
  );
  return c.json(await rpc(inbox(c.env, principal(c).user.id).previewTemplate(name, input.vars)));
});
