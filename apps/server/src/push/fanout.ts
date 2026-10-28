/** Push fan-out (FCM + Web Push) for notification events. WebSocket broadcast happens in the InboxDO. */
import {
  WebPushSubscription,
  type Notification,
  type PushEventType,
  type Response as HeraldResponse,
  type UpdateReason,
  type WebPushPayload,
} from "@herald/schema";
import type { Env } from "../env";
import { clearFcmToken, getTokenCallbackSecret, listDevices, removeWebPush, type DeviceRow } from "../db";
import { byteLength, hmacSha256, toHex } from "../lib/encoding";
import { buildFcmData, parseServiceAccount, sendFcm } from "./fcm";
import { sendWebPush, type VapidKeys } from "./webpush";

export type InboxEvent =
  | { type: "notification.created"; notification: Notification }
  | { type: "notification.updated"; notification: Notification; alert: boolean; reason: UpdateReason }
  | { type: "notification.deleted"; id: string };

const WEB_PUSH_MAX_PLAINTEXT = 3000;

export function vapidKeys(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY.trim(),
    privateKey: env.VAPID_PRIVATE_KEY.trim(),
    subject: env.VAPID_SUBJECT?.trim() || env.PUBLIC_URL?.trim() || "mailto:admin@example.com",
  };
}

function eventInfo(ev: InboxEvent): { id: string; notification: Notification | null; alert: boolean } {
  switch (ev.type) {
    case "notification.created":
      return { id: ev.notification.id, notification: ev.notification, alert: true };
    case "notification.updated":
      return { id: ev.notification.id, notification: ev.notification, alert: ev.alert };
    case "notification.deleted":
      return { id: ev.id, notification: null, alert: false };
  }
}

/** §8: Web Push only for `created`, `updated` with alert, and close-worthy changes (read/resolved/deleted). */
export function shouldWebPush(ev: InboxEvent): boolean {
  if (ev.type !== "notification.updated") return true;
  return ev.alert || ev.reason === "read" || ev.reason === "resolved" || ev.notification.status === "resolved";
}

export async function fanoutPush(env: Env, userId: string, events: InboxEvent[], devices?: DeviceRow[]): Promise<void> {
  const sa = parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON);
  const vapid = vapidKeys(env);
  if (!sa && !vapid) return;
  const all = devices ?? (await listDevices(env.DB, userId));
  const fcmDevices = sa ? all.filter((d) => d.fcmToken) : [];
  const webDevices = vapid ? all.filter((d) => d.webPush) : [];
  if (!fcmDevices.length && !webDevices.length) return;

  const tasks: Promise<unknown>[] = [];
  for (const ev of events) {
    const { id, notification, alert } = eventInfo(ev);
    const type: PushEventType = ev.type;

    if (sa) {
      const data = buildFcmData(type, id, notification, alert);
      const highPriority =
        ev.type === "notification.created" ||
        (notification !== null && (notification.severity === "critical" || notification.severity === "warning"));
      for (const d of fcmDevices) {
        const token = d.fcmToken!;
        tasks.push(
          sendFcm(sa, token, data, { highPriority, collapseKey: id })
            .then(async (r) => {
              if (r.unregistered) await clearFcmToken(env.DB, d.id, token);
              else if (!r.ok) console.warn(`FCM send to ${d.id} failed: ${r.status} ${r.error ?? ""}`);
            })
            .catch((e) => console.warn(`FCM send to ${d.id} errored`, e)),
        );
      }
    }

    if (vapid && shouldWebPush(ev)) {
      let payload: WebPushPayload = { type, id, notification };
      let text = JSON.stringify(payload);
      if (byteLength(text) > WEB_PUSH_MAX_PLAINTEXT) {
        payload = { type, id, notification: null };
        text = JSON.stringify(payload);
      }
      const urgency = notification?.severity === "critical" ? "high" : ev.type === "notification.created" ? "normal" : "low";
      for (const d of webDevices) {
        const parsed = WebPushSubscription.safeParse(JSON.parse(d.webPush!));
        if (!parsed.success) continue;
        tasks.push(
          sendWebPush(parsed.data, text, vapid, { urgency, topic: id })
            .then(async (r) => {
              if (r.gone) await removeWebPush(env.DB, d.id);
              else if (!r.ok) console.warn(`Web Push to ${d.id} failed: ${r.status}`);
            })
            .catch((e) => console.warn(`Web Push to ${d.id} errored`, e)),
        );
      }
    }
  }
  await Promise.all(tasks);
}

// ─── Action callbacks ───────────────────────────────────────────────────────

export async function signCallback(secret: string, body: string): Promise<string> {
  return `sha256=${toHex(await hmacSha256(secret, body))}`;
}

/**
 * Key used to sign callbacks: the sending token's callback secret, or (for notifications created from the web app)
 * a per-user key derived from SESSION_SECRET.
 */
export async function callbackSecretFor(env: Env, userId: string, tokenId: string | null): Promise<string> {
  if (tokenId) {
    const s = await getTokenCallbackSecret(env.DB, tokenId);
    if (s) return s;
  }
  return toHex(await hmacSha256(env.SESSION_SECRET || "herald-dev-secret", `callback:${userId}`));
}

export async function sendActionCallback(
  env: Env,
  userId: string,
  tokenId: string | null,
  callback: { url: string; headers?: Record<string, string> },
  notification: Notification,
  response: HeraldResponse,
): Promise<void> {
  const body = JSON.stringify({ notification, response });
  const signature = await signCallback(await callbackSecretFor(env, userId, tokenId), body);
  const headers: Record<string, string> = {
    ...(callback.headers ?? {}),
    "Content-Type": "application/json",
    "User-Agent": "Herald/0.1 (+https://github.com/herald)",
    "X-Herald-Signature": signature,
    "X-Herald-Notification-Id": notification.id,
  };
  try {
    const res = await fetch(callback.url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) console.warn(`callback ${callback.url} → ${res.status}`);
  } catch (e) {
    console.warn(`callback ${callback.url} failed`, e);
  }
}
