/**
 * How a notification is presented through Web Push (protocol §8), per intent. `public/sw.js` implements the same logic
 * in plain JS (service workers can't import the app bundle); this TS copy powers the in-app preview and the unit
 * tests, which run sw.js and check it shows exactly this. Keep the two in sync.
 */
import { progressText, type IntentNotification, type Severity } from "@oyee/schema";
import { fieldLines } from "./format";
import { markdownToPlainText } from "./markdown";
import { progressView } from "./progress";

export const REPLY_ACTION = "__reply";
/** Action prefixes: `answer:<option label>` sends that answer, `link:<url>` opens the URL. */
export const ANSWER_ACTION = "answer:";
export const LINK_ACTION = "link:";
export const DEFAULT_ICON = "/icon-192.png";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A protocol v2 notification as pushed; while v1 cards overlap its severity may still be the old `debug`. */
export type PushNotification = DistributiveOmit<IntentNotification, "severity"> & { severity: Severity };
export const BADGE_ICON = "/badge-72.png";

export interface WebPushAction {
  action: string;
  title: string;
}

/**
 * Browsers show at most 2 buttons. An open ask: its first answer buttons, then "Reply…" (opens the inbox) if it takes
 * text and there's room. An inform: its first link buttons. Progress and closed asks: none.
 */
export function webPushActions(n: PushNotification): WebPushAction[] {
  if (n.intent === "inform") return n.inform.links.slice(0, 2).map((l) => ({ action: LINK_ACTION + l.url, title: l.label }));
  if (n.intent !== "ask" || n.ask.state !== "open") return [];
  const out = n.ask.options.slice(0, 2).map((o) => ({ action: ANSWER_ACTION + o, title: o }));
  if (n.ask.allowText && out.length < 2) out.push({ action: REPLY_ACTION, title: "Reply…" });
  return out;
}

/** Body text, then an inform's rows or a progress's text bar ("Done · 7/7 checks" once it ended). */
export function webPushBody(n: PushNotification): string {
  const parts: string[] = [];
  const body = markdownToPlainText(n.body).trim();
  if (body) parts.push(body);
  if (n.intent === "inform") parts.push(...fieldLines(n.inform.fields));
  if (n.intent === "progress") {
    const v = progressView(n);
    if (v.state === "running") parts.push(progressText(n.progress));
    else if (v.state === "stopped") parts.push(v.stateLabel);
    else parts.push(`${v.stateLabel} · ${v.amount}`);
  }
  return parts.join("\n");
}

/** True when the system notification should be closed instead of shown. */
export function shouldClose(n: Pick<IntentNotification, "readAt" | "status">): boolean {
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

export function webPushPresentation(n: PushNotification, alert: boolean): WebPushPresentation {
  const icon = n.intent === "inform" ? n.inform.icon : null;
  const image = n.intent === "inform" ? n.inform.image : null;
  const emoji = icon && !/^https?:\/\//i.test(icon) ? `${icon} ` : "";
  // Every severity alerts; only a running progress updates quietly.
  const silent = n.intent === "progress" && n.progress.state === "running";
  return {
    title: `${emoji}${n.title}`,
    options: {
      tag: n.id,
      body: webPushBody(n),
      icon: icon && /^https:\/\//i.test(icon) ? icon : DEFAULT_ICON,
      badge: BADGE_ICON,
      ...(image ? { image } : {}),
      actions: webPushActions(n),
      requireInteraction: n.severity === "critical",
      silent,
      renotify: alert && !silent,
      timestamp: Date.parse(n.updatedAt) || Date.now(),
      data: { id: n.id, url: n.url, hasReply: n.intent === "ask" && n.ask.state === "open" && n.ask.allowText, version: n.version },
    },
  };
}
