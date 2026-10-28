/**
 * Mock mode (`?mock=1` or `VITE_MOCK=1`): an in-memory fake of the Oyee API + WebSocket so the UI can be explored
 * without the backend. Loaded lazily; never part of the main bundle.
 */
import {
  renderTemplateValue,
  type Device,
  type Notification,
  type PairingCode,
  type SendNotificationInput,
  type ServerMessage,
  type Template,
  type TokenInfo,
  type User,
} from "@oyee/schema";
import type { HttpMethod, Transport, TransportResponse } from "./api";
import { matchesFilters, type InboxFilters } from "./cache";
import type { LiveSocket } from "./live";

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://oyee.example.com";
let seq = 0;
const ulid = () => (Date.now().toString(36) + (seq++).toString(36).padStart(4, "0") + Math.random().toString(36).slice(2, 8)).toUpperCase();
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

const user: User = { id: "usr_mock", email: "demo@oyee.dev", name: "Demo User", avatarUrl: null };

function base(partial: Partial<Notification> & Pick<Notification, "title">, msAgo: number): Notification {
  const at = iso(msAgo);
  return {
    id: `ntf_${ulid()}`,
    source: "web",
    threadId: null,
    body: null,
    severity: "info",
    status: "active",
    icon: null,
    image: null,
    url: null,
    fields: [],
    progress: null,
    actions: [],
    reply: null,
    tags: [],
    silent: false,
    template: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    readAt: null,
    resolvedAt: null,
    responses: [],
    ...partial,
  };
}

function fixtures(): Notification[] {
  const list: Notification[] = [
    base(
      {
        title: "Deploying prod-api v1.4.2",
        body: "Rolling update in progress. Watch the **canary** before continuing.",
        source: "claude-code",
        threadId: "deploy-142",
        icon: "🚀",
        progress: { value: 2, max: 7, label: "2/7 pods", indeterminate: false },
        fields: [
          { label: "Region", value: "us-east-1" },
          { label: "Commit", value: "a1b2c3d" },
        ],
        actions: [
          { id: "pause", label: "Pause", style: "default", resolves: false },
          { id: "rollback", label: "Roll back", style: "destructive", resolves: true },
        ],
        tags: ["prod", "deploy"],
      },
      1 * MIN,
    ),
    base(
      {
        title: "Should I run the database migration?",
        body: "The migration `0042_add_index` will lock `orders` for ~30s.\nReply with any extra instructions.",
        source: "claude-code",
        threadId: "deploy-142",
        severity: "warning",
        actions: [
          { id: "option_1", label: "Yes, run it", style: "primary", resolves: true },
          { id: "option_2", label: "Not now", style: "default", resolves: true },
        ],
        reply: { placeholder: "Tell the agent…", buttonLabel: "Send" },
      },
      4 * MIN,
    ),
    base(
      {
        title: "[FIRING:1] HighCPU prod-api",
        body: "CPU above **90%** for 5m on `prod-api-7f9c`. See [the dashboard](https://grafana.example.com/d/cpu).",
        source: "alertmanager",
        severity: "critical",
        icon: "🔥",
        url: "https://grafana.example.com/d/cpu",
        fields: [
          { label: "Instance", value: "prod-api-7f9c" },
          { label: "Value", value: "93.4%" },
        ],
        actions: [
          { id: "ack", label: "Acknowledge", style: "primary", resolves: true },
          { id: "open", label: "Open Grafana", style: "default", url: "https://grafana.example.com/d/cpu", resolves: false },
        ],
        tags: ["prod"],
      },
      22 * MIN,
    ),
    base(
      {
        title: "Laundry",
        body: "The washer is done 🧺",
        source: "home-assistant",
        severity: "success",
        readAt: iso(50 * MIN),
      },
      55 * MIN,
    ),
    base(
      {
        title: "Nightly backup finished",
        body: "Backed up 1,204 files (3.2 GB) in 4m12s.",
        source: "cron",
        severity: "success",
        status: "resolved",
        resolvedAt: iso(2 * HOUR),
        readAt: iso(2 * HOUR),
        version: 3,
        responses: [{ actionId: "ok", text: null, deviceId: "dev_mock1", deviceName: "Pixel 9", at: iso(2 * HOUR) }],
        actions: [{ id: "ok", label: "OK", style: "default", resolves: true }],
      },
      3 * HOUR,
    ),
    base(
      {
        title: "Front door camera",
        body: "Motion detected at the front door.",
        source: "home-assistant",
        severity: "info",
        image: "https://picsum.photos/seed/oyee/640/360",
      },
      5 * HOUR,
    ),
  ];
  // Filler for pagination.
  const sources = ["cron", "github-actions", "aws-monitor", "home-assistant"];
  const sev = ["debug", "info", "success", "warning"] as const;
  for (let i = 0; i < 60; i++) {
    list.push(
      base(
        {
          title: `${["Job", "Build", "Check", "Sensor"][i % 4]} #${1000 - i} ${["ok", "passed", "flapping", "updated"][i % 4]}`,
          body: i % 3 === 0 ? `Run took ${(i % 7) + 1}m. Details in *logs*.` : null,
          source: sources[i % sources.length]!,
          severity: sev[i % sev.length]!,
          readAt: i % 5 === 0 ? null : iso((6 + i) * HOUR),
          threadId: i % 6 === 0 ? `batch-${Math.floor(i / 12)}` : null,
        },
        (6 + i) * HOUR,
      ),
    );
  }
  return list;
}

const db = {
  notifications: fixtures(),
  tokens: [
    {
      id: "tok_mock1",
      kind: "mcp",
      label: "Claude Code",
      prefix: "oyee_mcp_k3x9",
      defaultSource: "claude-code",
      createdAt: iso(5 * 24 * HOUR),
      lastUsedAt: iso(2 * MIN),
    },
    {
      id: "tok_mock2",
      kind: "webhook",
      label: "Home Assistant",
      prefix: "oyee_wh_9qa2",
      defaultSource: "home-assistant",
      createdAt: iso(9 * 24 * HOUR),
      lastUsedAt: iso(55 * MIN),
    },
  ] as TokenInfo[],
  devices: [
    {
      id: "dev_mock1",
      name: "Pixel 9",
      platform: "android",
      transports: ["fcm", "websocket"],
      createdAt: iso(7 * 24 * HOUR),
      lastSeenAt: iso(3 * MIN),
    },
    {
      id: "dev_mock2",
      name: "MacBook Pro",
      platform: "macos",
      transports: ["websocket"],
      createdAt: iso(6 * 24 * HOUR),
      lastSeenAt: iso(10 * 1000),
    },
  ] as Device[],
  templates: [
    {
      id: "tpl_mock1",
      name: "aws-alarm",
      description: "CloudWatch alarm",
      card: {
        title: "{{service}} {{metric}} high",
        body: "{{metric}} is **{{value}}** (threshold {{threshold|80%}})",
        severity: "warning",
        icon: "☁️",
        fields: [
          { label: "Region", value: "{{region|us-east-1}}" },
          { label: "Service", value: "{{service}}" },
        ],
        actions: [{ id: "ack", label: "Acknowledge", style: "primary", resolves: true }],
      },
      createdAt: iso(3 * 24 * HOUR),
      updatedAt: iso(3 * 24 * HOUR),
    },
  ] as Template[],
};

// ─── Live events ────────────────────────────────────────────────────────────

const sockets = new Set<MockSocket>();

function emit(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  sockets.forEach((s) => s.deliver(data));
}

function touch(n: Notification, patch: Partial<Notification>): Notification {
  const next = { ...n, ...patch, version: n.version + 1, updatedAt: new Date().toISOString() };
  db.notifications = db.notifications.map((x) => (x.id === n.id ? next : x));
  return next;
}

function updated(n: Notification, reason: "update" | "read" | "resolved" | "responded", alert = false) {
  emit({ type: "notification.updated", notification: n, alert, reason });
}

class MockSocket implements LiveSocket {
  onopen: LiveSocket["onopen"] = null;
  onmessage: LiveSocket["onmessage"] = null;
  onclose: LiveSocket["onclose"] = null;
  onerror: LiveSocket["onerror"] = null;
  private closed = false;

  constructor() {
    setTimeout(() => {
      if (this.closed) return;
      sockets.add(this);
      this.onopen?.({});
      this.deliver(JSON.stringify({ type: "hello", userId: user.id, deviceId: null, serverTime: iso() }));
    }, 250);
  }

  deliver(data: string) {
    if (!this.closed) setTimeout(() => this.onmessage?.({ data }), 0);
  }

  send(raw: string) {
    const msg = JSON.parse(raw) as { type: string; since?: string | null };
    if (msg.type === "ping") this.deliver(JSON.stringify({ type: "pong" }));
    if (msg.type === "sync") {
      const since = msg.since ? Date.parse(msg.since) : null;
      const items = since
        ? db.notifications.filter((n) => Date.parse(n.updatedAt) > since)
        : db.notifications.filter((n) => n.status === "active").slice(0, 50);
      this.deliver(
        JSON.stringify({ type: "sync.result", notifications: items, deletedIds: [], cursor: iso(), hasMore: false }),
      );
    }
  }

  close() {
    this.closed = true;
    sockets.delete(this);
    setTimeout(() => this.onclose?.({ code: 1000 }), 0);
  }
}

export function createMockSocket(): LiveSocket {
  return new MockSocket();
}

// Demo: advance the deploy progress every few seconds, then post a new notification.
let demoStarted = false;
function startDemo() {
  if (demoStarted) return;
  demoStarted = true;
  const tick = () => {
    const n = db.notifications.find((x) => x.threadId === "deploy-142" && x.progress);
    if (!n || !n.progress || n.status !== "active") return;
    const value = n.progress.value + 1;
    if (value >= n.progress.max) {
      const done = touch(n, {
        title: "Deployed prod-api v1.4.2",
        severity: "success",
        progress: { ...n.progress, value: n.progress.max, label: `${n.progress.max}/${n.progress.max} pods` },
        status: "resolved",
        resolvedAt: iso(),
        actions: [],
      });
      updated(done, "resolved", true);
      return;
    }
    updated(touch(n, { progress: { ...n.progress, value, label: `${value}/${n.progress.max} pods` } }), "update");
    setTimeout(tick, 4000);
  };
  setTimeout(tick, 4000);
}

// ─── REST ───────────────────────────────────────────────────────────────────

const ok = (data: unknown, status = 200): TransportResponse => ({ status, data });
const err = (status: number, code: string, message: string): TransportResponse => ({
  status,
  data: { error: { code, message } },
});

function createNotification(input: SendNotificationInput, source = "web"): Notification {
  let card: Partial<SendNotificationInput> = {};
  if (input.template) {
    const t = db.templates.find((x) => x.name === input.template);
    if (t) card = renderTemplateValue(t.card, input.vars ?? {});
  }
  const { template, vars: _vars, replaceKey: _rk, ...explicit } = input;
  const merged = { ...card, ...Object.fromEntries(Object.entries(explicit).filter(([, v]) => v !== undefined)) };
  return base(
    {
      title: merged.title ?? "Notification",
      body: merged.body ?? null,
      severity: merged.severity ?? "info",
      source: merged.source ?? source,
      threadId: merged.threadId ?? null,
      icon: merged.icon ?? null,
      image: merged.image ?? null,
      url: merged.url ?? null,
      fields: merged.fields ?? [],
      progress: merged.progress
        ? {
            value: merged.progress.value,
            max: merged.progress.max ?? 100,
            label: merged.progress.label,
            indeterminate: merged.progress.indeterminate ?? false,
          }
        : null,
      actions: (merged.actions ?? []).map((a) => ({ ...a, style: a.style ?? "default", resolves: a.resolves ?? false })),
      reply: merged.reply ?? null,
      tags: merged.tags ?? [],
      silent: merged.silent ?? false,
      template: template ?? null,
    },
    0,
  );
}

function handle(method: HttpMethod, path: string, body: unknown): TransportResponse {
  const url = new URL(path, ORIGIN);
  const p = url.pathname;
  const parts = p.split("/").filter(Boolean); // ["api", ...]
  const loggedOut = localStorage.getItem("oyee:mock-logged-out") === "1";

  if (p === "/api/config") return ok({ version: "0.1.0-mock", vapidPublicKey: null, fcmEnabled: false, devLogin: true });
  if (p === "/auth/logout") {
    localStorage.setItem("oyee:mock-logged-out", "1");
    return ok({ ok: true });
  }
  if (loggedOut) return err(401, "unauthorized", "Not signed in (mock)");
  if (p === "/api/me") {
    startDemo();
    return ok(user);
  }

  // Tokens
  if (p === "/api/tokens" && method === "GET") return ok({ items: db.tokens });
  if (p === "/api/tokens" && method === "POST") {
    const b = body as { kind: "webhook" | "mcp"; label: string; defaultSource?: string };
    const prefix = b.kind === "mcp" ? "oyee_mcp_" : "oyee_wh_";
    const secret = prefix + Array.from({ length: 43 }, () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(Math.random() * 32)]).join("");
    const token: TokenInfo = {
      id: `tok_${ulid()}`,
      kind: b.kind,
      label: b.label,
      prefix: secret.slice(0, prefix.length + 4),
      defaultSource: b.defaultSource ?? null,
      createdAt: iso(),
      lastUsedAt: null,
    };
    db.tokens = [token, ...db.tokens];
    const callbackSecret = Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    return ok({ token, secret, url: `${ORIGIN}/${b.kind === "mcp" ? "mcp" : "hook"}/${secret}`, callbackSecret }, 201);
  }
  if (parts[1] === "tokens" && parts[2] && method === "DELETE") {
    db.tokens = db.tokens.filter((t) => t.id !== parts[2]);
    return ok(null, 204);
  }

  // Devices
  if (p === "/api/devices" && method === "GET") return ok({ items: db.devices });
  if (p === "/api/devices/pairing-codes" && method === "POST") {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const raw = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    const pc: PairingCode = {
      code,
      expiresAt: new Date(Date.now() + 10 * MIN).toISOString(),
      deepLink: `oyee://pair?server=${encodeURIComponent(ORIGIN)}&code=${code}`,
    };
    return ok(pc, 201);
  }
  if (p === "/api/devices/web" && method === "POST") return err(400, "bad_request", "Web Push isn't available in mock mode");
  if (parts[1] === "devices" && parts[2] && method === "DELETE") {
    db.devices = db.devices.filter((d) => d.id !== parts[2]);
    return ok(null, 204);
  }

  // Sources
  if (p === "/api/sources") {
    const map = new Map<string, { source: string; count: number; unread: number; lastAt: string }>();
    for (const n of db.notifications) {
      const s = map.get(n.source) ?? { source: n.source, count: 0, unread: 0, lastAt: n.createdAt };
      s.count++;
      if (!n.readAt) s.unread++;
      if (n.createdAt > s.lastAt) s.lastAt = n.createdAt;
      map.set(n.source, s);
    }
    return ok({ items: [...map.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt)) });
  }

  // Notifications
  if (p === "/api/notifications" && method === "GET") {
    const f: InboxFilters = {
      source: url.searchParams.get("source") ?? undefined,
      severity: (url.searchParams.get("severity") ?? undefined) as InboxFilters["severity"],
      status: (url.searchParams.get("status") ?? undefined) as InboxFilters["status"],
      threadId: url.searchParams.get("threadId") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    };
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    const all = db.notifications
      .filter((n) => matchesFilters(n, f))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const items = all.slice(offset, offset + limit);
    return ok({ items, nextCursor: offset + limit < all.length ? String(offset + limit) : null });
  }
  if (p === "/api/notifications" && method === "POST") {
    const n = createNotification(body as SendNotificationInput);
    db.notifications = [n, ...db.notifications];
    emit({ type: "notification.created", notification: n });
    return ok(n, 201);
  }
  if (p === "/api/notifications/read-all" && method === "POST") {
    const src = (body as { source?: string } | undefined)?.source;
    let count = 0;
    for (const n of db.notifications) {
      if (!n.readAt && (!src || n.source === src)) {
        updated(touch(n, { readAt: iso() }), "read");
        count++;
      }
    }
    return ok({ updated: count });
  }
  if (parts[1] === "notifications" && parts[2]) {
    const n = db.notifications.find((x) => x.id === parts[2]);
    if (!n) return err(404, "not_found", "Notification not found");
    const action = parts[3];
    if (!action && method === "GET") return ok(n);
    if (!action && method === "DELETE") {
      db.notifications = db.notifications.filter((x) => x.id !== n.id);
      emit({ type: "notification.deleted", id: n.id });
      return ok(null, 204);
    }
    if (!action && method === "PATCH") {
      const next = touch(n, body as Partial<Notification>);
      updated(next, "update");
      return ok(next);
    }
    if (action === "read") {
      if (n.readAt) return ok(n);
      const next = touch(n, { readAt: iso() });
      updated(next, "read");
      return ok(next);
    }
    if (action === "resolve") {
      const next = touch(n, { status: "resolved", resolvedAt: iso() });
      updated(next, "resolved");
      return ok(next);
    }
    if (action === "respond") {
      const b = body as { actionId?: string; text?: string };
      const a = n.actions.find((x) => x.id === b.actionId);
      if (b.actionId && !a) return err(400, "bad_request", `Unknown action "${b.actionId}"`);
      const responses = [
        ...n.responses,
        { actionId: b.actionId ?? null, text: b.text ?? null, deviceId: null, deviceName: "Web", at: iso() },
      ].slice(-20);
      const next = touch(n, {
        responses,
        readAt: n.readAt ?? iso(),
        ...(a?.resolves ? { status: "resolved" as const, resolvedAt: iso() } : {}),
      });
      updated(next, "responded");
      return ok(next);
    }
  }

  // Templates
  if (p === "/api/templates" && method === "GET") return ok({ items: db.templates });
  if (parts[1] === "templates" && parts[2]) {
    const name = decodeURIComponent(parts[2]);
    const t = db.templates.find((x) => x.name === name);
    if (parts[3] === "preview") {
      if (!t) return err(404, "not_found", "Template not found");
      return ok(renderTemplateValue(t.card, (body as { vars?: Record<string, string> })?.vars ?? {}));
    }
    if (method === "GET") return t ? ok(t) : err(404, "not_found", "Template not found");
    if (method === "PUT") {
      const b = body as { description?: string; card: Template["card"] };
      const next: Template = {
        id: t?.id ?? `tpl_${ulid()}`,
        name,
        description: b.description ?? null,
        card: b.card,
        createdAt: t?.createdAt ?? iso(),
        updatedAt: iso(),
      };
      db.templates = t ? db.templates.map((x) => (x.name === name ? next : x)) : [...db.templates, next];
      return ok(next);
    }
    if (method === "DELETE") {
      db.templates = db.templates.filter((x) => x.name !== name);
      return ok(null, 204);
    }
  }

  return err(404, "not_found", `Mock: no handler for ${method} ${p}`);
}

export const mockTransport: Transport = async (method, path, body) => {
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  return handle(method, path, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
};
