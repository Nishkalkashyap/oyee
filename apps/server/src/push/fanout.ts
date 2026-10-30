/** Push fan-out (FCM + Web Push) for notification events. WebSocket broadcast happens in the InboxDO. */
import { WebPushSubscription, type Notification, type PushEventType, type UpdateReason, type WebPushPayload } from "@oyee/schema";
import type { Env } from "../env";
import { clearFcmToken, listDevices, removeWebPush, type DeviceRow } from "../db";
import { byteLength } from "../lib/encoding";
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

/** Whether a new notification sounds: everything but a running progress (spec "Alert rules"). */
export function alertsOnCreate(n: Notification): boolean {
  return !(n.intent === "progress" && n.progress.state === "running");
}

function eventInfo(ev: InboxEvent): { id: string; notification: Notification | null; alert: boolean } {
  switch (ev.type) {
    case "notification.created":
      // The first report of a running progress appears without sound; every other new notification alerts.
      return { id: ev.notification.id, notification: ev.notification, alert: alertsOnCreate(ev.notification) };
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
    // Targeted notifications only push to their devices (deletes carry no notification and go everywhere).
    const targets = notification?.targetDeviceIds ? new Set(notification.targetDeviceIds) : null;
    const targeted = (d: DeviceRow) => !targets || targets.has(d.id);

    if (sa) {
      const data = buildFcmData(type, id, notification, alert);
      const highPriority =
        alert || (notification !== null && (notification.severity === "critical" || notification.severity === "warning"));
      for (const d of fcmDevices.filter(targeted)) {
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
      for (const d of webDevices.filter(targeted)) {
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
