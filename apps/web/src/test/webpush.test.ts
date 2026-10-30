import { describe, expect, it } from "vitest";
import { Notification, type WebPushPayload } from "@oyee/schema";
import swSource from "../../public/sw.js?raw";
import fixtures from "../../../../packages/schema/fixtures/notifications.v2.json";
import { REPLY_ACTION, shouldClose, webPushActions, webPushPresentation } from "../lib/webpush";

type Name = keyof typeof fixtures;

/** A shared protocol v2 fixture (packages/schema/fixtures), decoded the way the web reads the wire. */
const fx = (name: Name): Notification => Notification.parse(fixtures[name]);
const ask = (patch: Partial<Extract<Notification, { intent: "ask" }>["ask"]>) => {
  const n = fx("ask-open") as Extract<Notification, { intent: "ask" }>;
  return { ...n, ask: { ...n.ask, ...patch } };
};

describe("webPushActions: the popup shows at most two buttons", () => {
  it("an open ask shows its first two answer buttons", () => {
    expect(webPushActions(fx("ask-open"))).toEqual([
      { action: "answer:Approve", title: "Approve" },
      { action: "answer:Reject", title: "Reject" },
    ]);
  });

  it("an ask that takes text gets a Reply button when there's room", () => {
    expect(webPushActions(ask({ options: ["Ship it"] }))).toEqual([
      { action: "answer:Ship it", title: "Ship it" },
      { action: REPLY_ACTION, title: "Reply…" },
    ]);
    expect(webPushActions(ask({ options: [] }))).toEqual([{ action: REPLY_ACTION, title: "Reply…" }]);
    expect(webPushActions(ask({ options: ["Ship it"], allowText: false }))).toEqual([{ action: "answer:Ship it", title: "Ship it" }]);
  });

  it("an ask that is no longer open has nothing to press", () => {
    expect(webPushActions(fx("ask-expired"))).toEqual([]);
    expect(webPushActions(fx("ask-answered-option"))).toEqual([]);
  });

  it("an inform shows its first two link buttons", () => {
    expect(webPushActions(fx("inform-full"))).toEqual([
      { action: "link:https://grafana.example.com/d/disk", title: "Dashboard" },
      { action: "link:https://wiki.example.com/runbooks/disk", title: "Runbook" },
    ]);
    expect(webPushActions(fx("inform-minimal"))).toEqual([]);
  });

  it("progress has no buttons", () => {
    expect(webPushActions(fx("progress-running"))).toEqual([]);
    expect(webPushActions(fx("progress-done"))).toEqual([]);
  });
});

describe("webPushPresentation", () => {
  it("an inform: icon, body with its rows, image, critical stays on screen", () => {
    const p = webPushPresentation(fx("inform-full"), true);
    expect(p.title).toBe("💾 Disk 95% full on db-1");
    expect(p.options).toMatchObject({
      tag: "ntf_01JBXA0000000000000000INF2",
      body: "Free space is below 5%. See the /var breakdown.\nNext check in 5 minutes.\nHost: db-1\nUsed: 95%",
      icon: "/icon-192.png",
      image: "https://grafana.example.com/render/disk.png",
      requireInteraction: true,
      silent: false,
      renotify: true,
      data: { id: "ntf_01JBXA0000000000000000INF2", url: "https://grafana.example.com/d/disk", hasReply: false, version: 3 },
    });
    expect(webPushPresentation(fx("inform-minimal"), true).options).toMatchObject({ body: "", requireInteraction: false });
  });

  it("an ask alerts and remembers it takes text", () => {
    const p = webPushPresentation(fx("ask-open"), true);
    expect(p.title).toBe("Deploy prod-api v1.4.2?");
    expect(p.options).toMatchObject({ body: "Canary is green. 3 migrations pending.", silent: false, renotify: true });
    expect(p.options.data.hasReply).toBe(true);
    expect(p.options.image).toBeUndefined();
  });

  it("a running progress shows the text bar without sound", () => {
    const p = webPushPresentation(fx("progress-running"), true);
    expect(p.options).toMatchObject({ body: "▓▓▓▓░░░░░░ 3/7 checks", silent: true, renotify: false });
  });

  it("a finished or stopped progress says how it ended and alerts", () => {
    expect(webPushPresentation(fx("progress-done"), true).options).toMatchObject({ body: "Done · 7/7 checks", silent: false, renotify: true });
    expect(webPushPresentation(fx("progress-failed"), true).options.body).toBe("test:e2e failed.\nFailed · 4/7 checks");
    expect(webPushPresentation(fx("progress-stopped"), true).options.body).toBe("Stopped reporting after 40%");
  });

  it("only re-alerts when asked to", () => {
    expect(webPushPresentation(fx("inform-full"), false).options.renotify).toBe(false);
  });

  it("shouldClose on read or resolved", () => {
    expect(shouldClose(fx("inform-minimal"))).toBe(false);
    expect(shouldClose(fx("progress-failed"))).toBe(true);
    expect(shouldClose(fx("ask-expired"))).toBe(true);
  });
});

// ─── public/sw.js behaves like the TS presentation ──────────────────────────

interface Shown {
  title: string;
  options: Record<string, unknown>;
}

function loadServiceWorker(fetched: Notification = fx("inform-full")) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const shown: Shown[] = [];
  const closed: string[] = [];
  const fetches: { url: string; init?: RequestInit }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://oyee.test" },
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
    return { ok: true, json: async () => fetched } as Response;
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
  const shownOpen = ["inform-minimal", "inform-full", "inform-warning", "ask-open", "progress-running", "progress-running-percent", "progress-done", "progress-stopped"] as const;

  it.each(shownOpen)("shows %s exactly like webPushPresentation", async (name) => {
    const sw = loadServiceWorker();
    const n = fx(name);
    await sw.dispatch("push", push({ type: "notification.created", id: n.id, notification: n as never }));
    const expected = webPushPresentation(n, true);
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]!.title).toBe(expected.title);
    expect(sw.shown[0]!.options).toEqual(expected.options);
  });

  it("says a progress stopped reporting the way every client does, also when max isn't 100", async () => {
    const sw = loadServiceWorker();
    const stopped = fx("progress-stopped") as Extract<Notification, { intent: "progress" }>;
    const n = { ...stopped, progress: { ...stopped.progress, value: 3, max: 7 } };
    await sw.dispatch("push", push({ type: "notification.updated", id: n.id, notification: n as never }));
    expect(webPushPresentation(n, true).options.body).toBe("Stopped reporting after 43%");
    expect(sw.shown[0]!.options).toEqual(webPushPresentation(n, true).options);
  });

  it("closes on deleted / read / resolved", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("push", push({ type: "notification.deleted", id: "ntf_9", notification: null }));
    const expired = fx("ask-expired");
    await sw.dispatch("push", push({ type: "notification.updated", id: expired.id, notification: expired as never }));
    expect(sw.closed).toEqual(["ntf_9", expired.id]);
    expect(sw.shown).toHaveLength(0);
  });

  it("fetches the notification when the payload omits it", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("push", push({ type: "notification.created", id: "ntf_01JBXA0000000000000000INF2", notification: null }));
    expect(sw.fetches[0]!.url).toBe("/api/notifications/ntf_01JBXA0000000000000000INF2");
    expect(sw.shown).toHaveLength(1);
  });

  it("an answer button sends the option; reply opens the inbox with the reply box", async () => {
    const sw = loadServiceWorker();
    const notification = { data: { id: "ntf_1", url: null }, close: () => undefined };
    await sw.dispatch("notificationclick", { action: "answer:Ship it", notification });
    expect(sw.fetches[0]!.url).toBe("/api/notifications/ntf_1/respond");
    expect(sw.fetches[0]!.init?.method).toBe("POST");
    expect(sw.fetches[0]!.init?.credentials).toBe("include");
    expect(JSON.parse(String(sw.fetches[0]!.init?.body))).toEqual({ option: "Ship it" });
    expect(sw.opened).toEqual([]);

    await sw.dispatch("notificationclick", { action: REPLY_ACTION, notification });
    expect(sw.opened).toEqual(["https://oyee.test/inbox/ntf_1?reply=1"]);
  });

  it("a link button opens its URL and marks the notification read; nothing is sent back", async () => {
    const sw = loadServiceWorker();
    const notification = { data: { id: "ntf_1", url: "https://grafana.example.com/d/disk" }, close: () => undefined };
    await sw.dispatch("notificationclick", { action: "link:https://wiki.example.com/runbooks/disk", notification });
    expect(sw.fetches.map((f) => f.url)).toEqual(["/api/notifications/ntf_1/read"]);
    expect(sw.opened).toEqual(["https://wiki.example.com/runbooks/disk"]);
  });

  it("a body click marks read and opens the URL, else the notification", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("notificationclick", { action: "", notification: { data: { id: "ntf_1", url: "https://ci.example.com/x" }, close: () => undefined } });
    expect(sw.fetches.at(-1)!.url).toBe("/api/notifications/ntf_1/read");
    expect(sw.opened.at(-1)).toBe("https://ci.example.com/x");
    await sw.dispatch("notificationclick", { action: "", notification: { data: { id: "ntf_2", url: null }, close: () => undefined } });
    expect(sw.opened.at(-1)).toBe("https://oyee.test/inbox/ntf_2");
  });

  it("a button from an older popup opens the notification instead of guessing", async () => {
    const sw = loadServiceWorker();
    await sw.dispatch("notificationclick", { action: "ack", notification: { data: { id: "ntf_1", url: null }, close: () => undefined } });
    expect(sw.fetches).toEqual([]);
    expect(sw.opened).toEqual(["https://oyee.test/inbox/ntf_1"]);
  });
});
