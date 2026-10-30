/**
 * Mock mode (`?mock=1` or `VITE_MOCK=1`): an in-memory fake of the Oyee API + WebSocket so the UI can be explored
 * without the backend. Loaded lazily; never part of the main bundle.
 */
import {
  LIMITS,
  QUOTAS,
  QuotaKind,
  type AskBlock,
  type Device,
  type InformBlock,
  type Notification,
  type PairingCode,
  type IntentSendBody,
  type ProgressBlock,
  type ServerMessage,
  type TokenInfo,
  type User,
} from "@oyee/schema";
import type { HttpMethod, Transport, TransportResponse } from "./api";
import { matchesFilters, type InboxFilters } from "./cache";
import { previewNotification } from "./composer";
import type { LiveSocket } from "./live";

const ORIGIN = typeof window !== "undefined" ? window.location.origin : "https://oyee.example.com";
let seq = 0;
const ulid = () => (Date.now().toString(36) + (seq++).toString(36).padStart(4, "0") + Math.random().toString(36).slice(2, 8)).toUpperCase();
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

const user: User = { id: "usr_mock", email: "demo@oyee.dev", name: "Demo User", avatarUrl: null };

type Shared = Omit<Extract<Notification, { intent: "inform" }>, "intent" | "inform">;
type SharedInput = Partial<Shared> & Pick<Notification, "title">;

function shared(partial: SharedInput, msAgo: number): Shared {
  const at = iso(msAgo);
  return {
    id: `ntf_${ulid()}`,
    source: "web",
    key: null,
    body: null,
    severity: "info",
    status: "active",
    url: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    readAt: null,
    resolvedAt: null,
    targetDeviceIds: null,
    ...partial,
  };
}

function inform(partial: SharedInput, block: Partial<InformBlock>, msAgo: number): Notification {
  return {
    ...shared(partial, msAgo),
    intent: "inform",
    inform: { links: [], fields: [], image: null, icon: null, cooldown: null, ...block },
  };
}

/** An ask that expires an hour after it was asked (the default Expiry). */
function ask(partial: SharedInput, block: Partial<AskBlock> & Pick<AskBlock, "options">, msAgo: number): Notification {
  const base = shared(partial, msAgo);
  return {
    ...base,
    intent: "ask",
    ask: {
      allowText: false,
      replyPlaceholder: null,
      expiresAt: new Date(Date.parse(base.createdAt) + HOUR).toISOString(),
      answer: null,
      state: "open",
      ...block,
    },
  };
}

function progress(
  partial: SharedInput & { key: string },
  block: Partial<ProgressBlock> & Pick<ProgressBlock, "value" | "max">,
  msAgo: number,
): Notification {
  const base = shared(partial, msAgo);
  return {
    ...base,
    intent: "progress",
    progress: { state: "running", staleAfter: LIMITS.defaultStaleAfter, lastReportAt: base.updatedAt, ...block },
  };
}

function fixtures(): Notification[] {
  const list: Notification[] = [
    // Progress reported with the MCP `progress` tool, advanced by the demo below.
    progress(
      {
        title: "Deploying prod-api v1.4.2",
        body: "Rolling update in progress. Watch the **canary** before continuing.",
        source: "claude-code",
        key: "deploy-142",
      },
      { value: 2, max: 7, label: "2/7 pods" },
      1 * MIN,
    ),
    ask(
      {
        title: "Should I run the database migration?",
        body: "The migration `0042_add_index` will lock `orders` for ~30s.\nReply with any extra instructions.",
        source: "claude-code",
        severity: "warning",
      },
      { options: ["Yes, run it", "Not now"], allowText: true, replyPlaceholder: "Tell the agent…" },
      4 * MIN,
    ),
    // An ask answered from the phone: every device shows "Answered: Approve · Pixel 9".
    ask(
      {
        title: "Merge the dependency bump?",
        body: "`zod` 4.6 → 4.7. All checks are green.",
        source: "claude-code",
        severity: "warning",
        url: "https://github.com/example/api/pull/42",
        status: "resolved",
        resolvedAt: iso(12 * MIN),
        readAt: iso(12 * MIN),
        version: 2,
      },
      {
        options: ["Approve", "Reject"],
        state: "answered",
        answer: { option: "Approve", text: null, deviceId: "dev_mock1", deviceName: "Pixel 9", at: iso(12 * MIN) },
      },
      15 * MIN,
    ),
    // An ask nobody answered within its hour: it left every tray and shows "Expired".
    ask(
      {
        title: "Rotate the staging API keys?",
        body: "The current keys are 90 days old.",
        source: "key-rotator",
        severity: "warning",
        status: "resolved",
        resolvedAt: iso(80 * MIN),
        version: 2,
      },
      { options: ["Rotate", "Skip"], state: "expired" },
      140 * MIN,
    ),
    // An ask its agent withdrew (resolved unanswered): "Withdrawn".
    ask(
      {
        title: "Retry the flaky e2e job?",
        source: "claude-code",
        severity: "warning",
        status: "resolved",
        resolvedAt: iso(50 * MIN),
        version: 2,
      },
      { options: ["Retry"], state: "withdrawn" },
      55 * MIN,
    ),
    inform(
      {
        title: "[FIRING:1] HighCPU prod-api",
        body: "CPU above **90%** for 5m on `prod-api-7f9c`. See [the dashboard](https://grafana.example.com/d/cpu).",
        source: "alertmanager",
        key: "HighCPU/prod-api",
        severity: "critical",
        url: "https://grafana.example.com/d/cpu",
      },
      {
        icon: "🔥",
        fields: [
          { label: "Instance", value: "prod-api-7f9c" },
          { label: "Value", value: "93.4%" },
        ],
        links: [{ label: "Open Grafana", url: "https://grafana.example.com/d/cpu" }],
      },
      22 * MIN,
    ),
    inform(
      { title: "Laundry", body: "The washer is done 🧺", source: "home-assistant", severity: "success", readAt: iso(50 * MIN) },
      {},
      55 * MIN,
    ),
    inform(
      {
        title: "Nightly backup finished",
        body: "Backed up 1,204 files (3.2 GB) in 4m12s.",
        source: "cron",
        severity: "success",
        status: "resolved",
        resolvedAt: iso(2 * HOUR),
        readAt: iso(2 * HOUR),
        version: 2,
      },
      {},
      3 * HOUR,
    ),
    // An inform with everything: icon, markdown body, rows and link buttons.
    inform(
      {
        title: "Disk 95% full on db-1",
        body: "Free space is **below 5%**. The `/var/lib/postgresql` volume grew 12 GB overnight.",
        source: "disk-watch",
        key: "disk/db-1",
        severity: "warning",
        url: "https://grafana.example.com/d/disk",
      },
      {
        icon: "💾",
        cooldown: "15m",
        fields: [
          { label: "Host", value: "db-1" },
          { label: "Used", value: "95% of 500 GB" },
          { label: "Growth", value: "+12 GB / 24h" },
        ],
        links: [
          { label: "Dashboard", url: "https://grafana.example.com/d/disk" },
          { label: "Runbook", url: "https://wiki.example.com/runbooks/disk" },
        ],
      },
      35 * MIN,
    ),
    inform(
      { title: "Front door camera", body: "Motion detected at the front door.", source: "home-assistant" },
      { image: "https://picsum.photos/seed/oyee/640/360" },
      5 * HOUR,
    ),
    // Progress: running (updates quietly), then done, failed or stopped reporting.
    progress({ title: "Running the test suite", source: "claude-code", key: "tests" }, { value: 3, max: 7, label: "3/7 checks" }, 2 * MIN),
    // A progress whose agent went quiet for longer than its staleAfter: Stopped reporting.
    progress(
      { title: "Migrating user avatars", body: "Copying avatars to the new bucket.", source: "claude-code", key: "avatars", severity: "warning" },
      { value: 40, max: 100, state: "stopped", staleAfter: "30m", lastReportAt: iso(52 * MIN) },
      70 * MIN,
    ),
    progress(
      {
        title: "CI on main",
        body: "All checks passed on `a1b2c3d`.",
        source: "github-actions",
        key: "ci/main",
        severity: "success",
        url: "https://github.com/example/api/actions/runs/811",
      },
      { value: 7, max: 7, label: "7/7 checks", state: "done" },
      12 * MIN,
    ),
    progress(
      {
        title: "CI on feature/login",
        body: "`test:e2e` failed.",
        source: "github-actions",
        key: "ci/feature-login",
        severity: "warning",
        readAt: iso(30 * MIN),
      },
      { value: 4, max: 7, label: "4/7 checks", state: "failed" },
      35 * MIN,
    ),
    // The same periodic alert under one key, several times: the inbox stacks these into one row.
    ...[40, 100, 160, 220].map((min, i) =>
      inform(
        {
          key: "archiver-lag",
          title: i === 0 ? "Archiver lag warning" : `Archiver lag warning (${i + 1})`,
          body: `Shared backlog ${740 + i * 12} pending; watermark still stalled. No data-loss risk yet.`,
          source: "ai-gateway-archiver",
          severity: "warning",
          readAt: i === 0 ? null : iso(min * MIN - MIN),
        },
        {},
        min * MIN,
      ),
    ),
  ];
  // Filler for pagination.
  const sources = ["cron", "github-actions", "aws-monitor", "home-assistant"];
  const sev = ["info", "success", "warning", "info"] as const;
  for (let i = 0; i < 60; i++) {
    list.push(
      inform(
        {
          title: `${["Job", "Build", "Check", "Sensor"][i % 4]} #${1000 - i} ${["ok", "passed", "flapping", "updated"][i % 4]}`,
          body: i % 3 === 0 ? `Run took ${(i % 7) + 1}m. Details in *logs*.` : null,
          source: sources[i % sources.length]!,
          severity: sev[i % sev.length]!,
          readAt: i % 5 === 0 ? null : iso((6 + i) * HOUR),
        },
        {},
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
};

// ─── Live events ────────────────────────────────────────────────────────────

const sockets = new Set<MockSocket>();

function emit(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  sockets.forEach((s) => s.deliver(data));
}

function touch(n: Notification, patch: Partial<Notification>): Notification {
  const next = { ...n, ...patch, version: n.version + 1, updatedAt: new Date().toISOString() } as Notification;
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
    const n = db.notifications.find((x) => x.key === "deploy-142" && x.intent === "progress");
    if (!n || n.intent !== "progress" || n.status !== "active" || n.progress.state !== "running") return;
    const { max } = n.progress;
    const value = n.progress.value + 1;
    const at = iso();
    if (value >= max) {
      const done = touch(n, {
        title: "Deployed prod-api v1.4.2",
        severity: "success",
        progress: { ...n.progress, value: max, label: `${max}/${max} pods`, state: "done", lastReportAt: at },
      });
      updated(done, "update", true);
      return;
    }
    updated(touch(n, { progress: { ...n.progress, value, label: `${value}/${max} pods`, lastReportAt: at } }), "update");
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
  if (p === "/api/usage") {
    const day = new Date().toISOString().slice(0, 10);
    const used: Record<QuotaKind, number> = { send: 312, update: 1840, respond: 9, read: 2210, pairing: 1 };
    return ok({
      day,
      resetsAt: new Date(Date.parse(day) + 86_400_000).toISOString(),
      items: QuotaKind.options.map((kind) => ({ kind, label: QUOTAS[kind].label, used: used[kind], limit: QUOTAS[kind].perDay })),
    });
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
    return ok({ token, secret, url: `${ORIGIN}/${b.kind === "mcp" ? "mcp" : "hook"}/${secret}` }, 201);
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
      if (!n.readAt && n.status === "active") s.unread++;
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
    // Every send creates a new notification here: key and cooldown rules live on the server.
    const n: Notification = { ...previewNotification(body as IntentSendBody), id: `ntf_${ulid()}` };
    db.notifications = [n, ...db.notifications];
    emit({ type: "notification.created", notification: n });
    return ok({ id: n.id, version: n.version, outcome: "created", reason: "Created (mock mode).", notification: n }, 201);
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
      if (n.intent !== "ask") return err(400, "bad_request", `This notification is an ${n.intent}, not an ask: only asks take answers`);
      const b = body as { option?: string; text?: string };
      if (b.option !== undefined && !n.ask.options.includes(b.option)) return err(400, "bad_request", `Unknown answer "${b.option}"`);
      // The first answer wins and closes the ask (as on the server).
      const state = n.ask.state === "open" && Date.parse(n.ask.expiresAt) <= Date.now() ? "expired" : n.ask.state;
      if (state !== "open") return err(409, "conflict", `This ask is ${state}`);
      const at = iso();
      const answer = { option: b.option ?? null, text: b.text ?? null, deviceId: null, deviceName: "Web", at };
      const next = touch(n, {
        ask: { ...n.ask, answer, state: "answered" },
        readAt: n.readAt ?? at,
        status: "resolved",
        resolvedAt: at,
      });
      updated(next, "responded");
      return ok(next);
    }
  }

  return err(404, "not_found", `Mock: no handler for ${method} ${p}`);
}

export const mockTransport: Transport = async (method, path, body) => {
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  return handle(method, path, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
};
