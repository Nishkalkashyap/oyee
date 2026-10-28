import { describe, expect, it } from "vitest";
import type { WebPushPayload } from "@herald/schema";
import swSource from "../../public/sw.js?raw";
import { REPLY_ACTION, shouldClose, webPushActions, webPushPresentation } from "../lib/webpush";
import { makeNotification } from "./fixtures";

const rich = makeNotification({
  id: "ntf_1",
  title: "Deploy",
  body: "Rolling **v2** to `prod`",
  severity: "critical",
  icon: "🚀",
  image: "https://img.example.com/a.png",
  url: "https://ci.example.com/run/1",
  fields: [{ label: "Region", value: "eu-west-1" }],
  progress: { value: 2, max: 4, indeterminate: false },
  actions: [
    { id: "open", label: "Open", style: "default", url: "https://x.example.com", resolves: false },
    { id: "ack", label: "Ack", style: "primary", resolves: true },
    { id: "stop", label: "Stop", style: "destructive", resolves: true },
  ],
  reply: { placeholder: "Say something" },
  version: 4,
});

describe("webPushActions", () => {
  it("keeps at most 2 non-url actions", () => {
    expect(webPushActions(rich)).toEqual([
      { action: "ack", title: "Ack" },
      { action: "stop", title: "Stop" },
    ]);
  });
  it("adds a Reply button when there's room", () => {
    const n = { ...rich, actions: rich.actions.slice(0, 2) };
    expect(webPushActions(n)).toEqual([
      { action: "ack", title: "Ack" },
      { action: REPLY_ACTION, title: "Reply…" },
    ]);
  });
});

describe("webPushPresentation", () => {
  it("maps severity, silence and alerting", () => {
    const p = webPushPresentation(rich, true);
    expect(p.title).toBe("🚀 Deploy");
    expect(p.options.tag).toBe("ntf_1");
    expect(p.options.body).toBe("Rolling v2 to prod\nRegion: eu-west-1\n▓▓▓▓▓░░░░░ 2/4");
    expect(p.options.requireInteraction).toBe(true);
    expect(p.options.renotify).toBe(true);
    expect(p.options.image).toBe(rich.image);
    expect(p.options.icon).toBe("/icon-192.png");
    expect(webPushPresentation({ ...rich, silent: true }, true).options.renotify).toBe(false);
    expect(webPushPresentation({ ...rich, severity: "debug" }, true).options.silent).toBe(true);
    expect(webPushPresentation({ ...rich, icon: "https://i.example.com/x.png" }, false).options.icon).toBe("https://i.example.com/x.png");
  });

  it("shouldClose on read or resolved", () => {
    expect(shouldClose(rich)).toBe(false);
    expect(shouldClose({ ...rich, readAt: "2026-10-28T10:00:00.000Z" })).toBe(true);
    expect(shouldClose({ ...rich, status: "resolved" })).toBe(true);
  });
});

// ─── public/sw.js behaves like the TS presentation ──────────────────────────

interface Shown {
  title: string;
  options: Record<string, unknown>;
}

function loadServiceWorker() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: Shown[] = [];
  const closed: string[] = [];
  const fetches: { url: string; init?: RequestInit }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://herald.test" },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: () => undefined,
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }),
      getNotifications: async ({ tag }: { tag: string }) => [{ close: () => closed.push(tag) }],
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => [],
      openWindow: async (url: string) => void opened.push(url),
    },
  };
  const fakeFetch = async (url: string, init?: RequestInit) => {
    fetches.push({ url, init });
    return { ok: true, json: async () => rich } as Response;
  };
  new Function("self", "fetch", swSource)(self, fakeFetch);

  const dispatch = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { shown, closed, fetches, opened, dispatch };
}

const push = (payload: WebPushPayload) => ({ data: { json: () => payload } });

describe("public/sw.js", () => {
  it("shows notifications exactly like webPushPresentation", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("push", push({ type: "notification.created", id: rich.id, notification: rich }));
    const expected = webPushPresentation(rich, true);
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]!.title).toBe(expected.title);
    expect(sw.shown[0]!.options).toEqual(expected.options);
  });

  it("closes on deleted / read / resolved", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("push", push({ type: "notification.deleted", id: "ntf_9", notification: null }));
    await sw.dispatch("push", push({ type: "notification.updated", id: rich.id, notification: { ...rich, status: "resolved" } }));
    expect(sw.closed).toEqual(["ntf_9", rich.id]);
    expect(sw.shown).toHaveLength(0);
  });

  it("fetches the notification when the payload omits it", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("push", push({ type: "notification.created", id: rich.id, notification: null }));
    expect(sw.fetches[0]!.url).toBe("/api/notifications/ntf_1");
    expect(sw.shown).toHaveLength(1);
  });

  it("action click responds; reply/body clicks open the app", async () => {
    const sw = loadServiceWorker();
    const notification = { data: { id: "ntf_1", url: null }, close: () => undefined };
    await sw.dispatch("notificationclick", { action: "ack", notification });
    expect(sw.fetches[0]!.url).toBe("/api/notifications/ntf_1/respond");
    expect(sw.fetches[0]!.init?.method).toBe("POST");
    expect(sw.fetches[0]!.init?.credentials).toBe("include");
    expect(JSON.parse(String(sw.fetches[0]!.init?.body))).toEqual({ actionId: "ack" });

    await sw.dispatch("notificationclick", { action: REPLY_ACTION, notification });
    expect(sw.opened).toEqual(["https://herald.test/inbox/ntf_1?reply=1"]);

    await sw.dispatch("notificationclick", { action: "", notification: { ...notification, data: { id: "ntf_1", url: "https://ci.example.com/x" } } });
    expect(sw.fetches.at(-1)!.url).toBe("/api/notifications/ntf_1/read");
    expect(sw.opened.at(-1)).toBe("https://ci.example.com/x");
  });
});
