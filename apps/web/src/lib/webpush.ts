/**
 * How a notification is presented through Web Push (protocol §8). `public/sw.js` implements the same logic in plain
 * JS (service workers can't import the app bundle); this TS copy powers the in-app preview and the unit tests.
 * Keep the two in sync.
 */
import type { Notification } from "@oyee/schema";
import { systemNotificationBody } from "./format";

export const REPLY_ACTION = "__reply";
export const DEFAULT_ICON = "/icon-192.png";
export const BADGE_ICON = "/badge-72.png";

export interface WebPushAction {
  action: string;
  title: string;
}

/** Up to 2 buttons: non-url actions first, then a "Reply…" button (opens the inbox) if there's room. */
export function webPushActions(n: Pick<Notification, "actions" | "reply">): WebPushAction[] {
  const out: WebPushAction[] = n.actions
    .filter((a) => !a.url)
    .slice(0, 2)
    .map((a) => ({ action: a.id, title: a.label }));
  if (n.reply && out.length < 2) out.push({ action: REPLY_ACTION, title: n.reply.buttonLabel || "Reply…" });
  return out;
}

/** True when the system notification should be closed instead of shown. */
export function shouldClose(n: Pick<Notification, "readAt" | "status">): boolean {
  return !!n.readAt || n.status === "resolved";
}

export interface WebPushPresentation {
  title: string;
  options: {
    tag: string;
    body: string;
    icon: string;
    badge: string;
    image?: string;
    actions: WebPushAction[];
    requireInteraction: boolean;
    silent: boolean;
    renotify: boolean;
    timestamp: number;
    data: { id: string; url: string | null; hasReply: boolean; version: number };
  };
}

export function webPushPresentation(n: Notification, alert: boolean): WebPushPresentation {
  const emoji = n.icon && !/^https?:\/\//i.test(n.icon) ? `${n.icon} ` : "";
  const silent = n.silent || n.severity === "debug";
  return {
    title: `${emoji}${n.title}`,
    options: {
      tag: n.id,
      body: systemNotificationBody(n),
      icon: n.icon && /^https:\/\//i.test(n.icon) ? n.icon : DEFAULT_ICON,
      badge: BADGE_ICON,
      ...(n.image ? { image: n.image } : {}),
      actions: webPushActions(n),
      requireInteraction: n.severity === "critical",
      silent,
      renotify: alert && !silent,
      timestamp: Date.parse(n.updatedAt) || Date.now(),
      data: { id: n.id, url: n.url, hasReply: !!n.reply, version: n.version },
    },
  };
}
