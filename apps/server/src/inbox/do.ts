/**
 * InboxDO — one per user (`idFromName(userId)`), SQLite-backed.
 * Holds notifications (+ tombstones for sync), templates, per-token and per-account quota counters, hibernatable WebSockets and
 * in-memory `wait_for_response` waiters. Every mutation is broadcast over WebSocket and fanned out to push transports.
 */
import { DurableObject } from "cloudflare:workers";
import {
  ClientMessage,
  LIMITS,
  type AskInput,
  QUOTAS,
  type FlatNotification,
  type InformInput,
  type ListNotificationsQuery,
  type McpWaitResult,
  type Notification,
  type Page,
  type ProgressInput,
  type QuotaKind,
  type RespondInput,
  type SendNotificationInput,
  type ServerMessage,
  type SourceSummary,
  type Template,
  type TemplateCard,
  type UpdateNotificationInput,
  type UpsertTemplateInput,
  type Usage,
  inferIntent,
  renderTemplateValue,
} from "@oyee/schema";
import type { Env } from "../env";
import { ApiError, badRequest, conflict, notFound, rateLimited, type RpcResult } from "../lib/errors";
import { b64urlDecodeString, b64urlEncode } from "../lib/encoding";
import { newId } from "../lib/ids";
import { listDevices } from "../db";
import { fanoutPush, sendActionCallback, type InboxEvent } from "../push/fanout";
import {
  applyPatch,
  assertUniqueActionIds,
  buildNotification,
  replaceContent,
  resolveSendInput,
  respondToCard,
  resolveTargets,
  searchText,
  type Actor,
  type SendOptions,
} from "./model";
import { isLiveProgress, reportProgress, type ProgressReport } from "./progress";
import { Scheduler } from "./scheduler";
import { answerAsk, buildAsk, expireAsk, expiryDue, isOpenAsk, waitResult, type AskResult } from "./ask";
import { applyInform, buildInform, type InformResult } from "./inform";

type UpdatedEvent = Extract<InboxEvent, { type: "notification.updated" }>;

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Quotas that post an inbox notice at 80% and 100% of the daily limit. */
const WARN_KINDS: QuotaKind[] = ["send", "update", "respond"];

interface StoredRow {
  data: string;
  replace_key: string | null;
  token_id: string | null;
  seq: number;
  [k: string]: SqlStorageValue;
}

interface Loaded {
  n: Notification;
  replaceKey: string | null;
  tokenId: string | null;
}

type Cursor = { b: string } | { s: number };

export function encodeCursor(c: Cursor): string {
  return b64urlEncode(JSON.stringify(c));
}

export function decodeCursor(s: string | null | undefined): Cursor | null {
  if (!s) return null;
  try {
    const c = JSON.parse(b64urlDecodeString(s)) as Cursor;
    if ("b" in c && typeof c.b === "string") return c;
    if ("s" in c && typeof c.s === "number") return c;
  } catch {
    // not a cursor
  }
  return null;
}

/** Push fan-out for bulk operations (read-all, retention) is capped to keep it cheap. */
const MAX_BULK_PUSH = 100;
/** Deadline kind for the daily retention prune (one per inbox). */
const PRUNE = "prune";
const PRUNE_REF = "daily";
/** Deadline kind for an open ask's expiry (ref = notification id). */
const ASK_EXPIRY = "ask.expiry";
const SYNC_PAGE = 200;

/**
 * Runs a method body and returns an RpcResult instead of throwing: errors thrown across Durable Object RPC lose their
 * class and are logged as uncaught exceptions, so expected ApiErrors travel as values (unwrapped by `rpc()`).
 */
async function guard<T>(fn: () => T | Promise<T>): Promise<RpcResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: { code: e.code, message: e.message, retryAfter: e.retryAfter } };
    throw e;
  }
}

export class InboxDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private waiters = new Map<string, Set<() => void>>();
  private ownerKnown = false;
  /** The inbox's single alarm: fires at the earliest deadline (the daily prune, plus kinds added by later features). */
  readonly scheduler: Scheduler;
  private pruneEnsured = false;
  /** Per-notification push coalescing for updates (see LIMITS.updatePushIntervalMs). In memory: resets on eviction. */
  private pushSlots = new Map<string, { last: number; pending: UpdatedEvent | null }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.migrate();
    this.scheduler = new Scheduler(ctx.storage);
    this.scheduler.handle(PRUNE, (_refs, now) => {
      this.prune(now);
      this.expireAsks([], now); // also catches asks whose expiry deadline was lost
      this.scheduler.set(PRUNE, PRUNE_REF, now + DAY);
    });
    this.scheduler.handle(ASK_EXPIRY, (refs, now) => this.expireAsks(refs, now));
    // Pings are answered without waking the object from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value);
      INSERT OR IGNORE INTO meta (key, value) VALUES ('seq', 0);
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL,
        thread_id TEXT,
        replace_key TEXT,
        read_at TEXT,
        token_id TEXT,
        search TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ntf_seq ON notifications(seq);
      CREATE INDEX IF NOT EXISTS ntf_created ON notifications(created_at);
      CREATE INDEX IF NOT EXISTS ntf_updated ON notifications(updated_at);
      CREATE INDEX IF NOT EXISTS ntf_source ON notifications(source, id);
      CREATE INDEX IF NOT EXISTS ntf_status ON notifications(status, id);
      CREATE INDEX IF NOT EXISTS ntf_thread ON notifications(thread_id, id);
      CREATE INDEX IF NOT EXISTS ntf_severity ON notifications(severity, id);
      CREATE INDEX IF NOT EXISTS ntf_replace ON notifications(replace_key, status);
      CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, deleted_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tomb_seq ON tombstones(seq);
      CREATE TABLE IF NOT EXISTS templates (name TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rate_limits (token_id TEXT NOT NULL, win INTEGER NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY (token_id, win));
      CREATE TABLE IF NOT EXISTS usage (kind TEXT NOT NULL, period TEXT NOT NULL, win INTEGER NOT NULL,
        count INTEGER NOT NULL, PRIMARY KEY (kind, period, win));
    `);
    this.migrateToIntents();
  }

  /**
   * Notifications carry their intent (protocol v2): adds the `intent` and `key` columns and converts rows stored
   * before intents existed, once (recorded as `meta.schema = 1`; rows that already have an intent are left alone).
   * Old rows' senders can no longer act on them, so an unanswered ask becomes expired and an unfinished progress
   * stopped (see inferIntent). Converted rows get a new `seq` so clients that sync by cursor receive the new shape.
   */
  private migrateToIntents() {
    const schema = this.sql.exec<{ value: number }>("SELECT value FROM meta WHERE key = 'schema'").toArray()[0]?.value ?? 0;
    if (schema >= 1) return;
    const columns = new Set(
      this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('notifications')").toArray().map((c) => c.name),
    );
    if (!columns.has("intent")) this.sql.exec("ALTER TABLE notifications ADD COLUMN intent TEXT");
    if (!columns.has("key")) this.sql.exec("ALTER TABLE notifications ADD COLUMN key TEXT");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ntf_key ON notifications(source, key)");
    const legacy = this.sql
      .exec<{ id: string; data: string; replace_key: string | null }>(
        "SELECT id, data, replace_key FROM notifications WHERE intent IS NULL",
      )
      .toArray();
    for (const r of legacy) {
      const n = inferIntent({ ...(JSON.parse(r.data) as FlatNotification), key: r.replace_key }, { legacy: true });
      this.sql.exec(
        "UPDATE notifications SET intent = ?, key = ?, data = ?, seq = ? WHERE id = ?",
        n.intent,
        n.key,
        JSON.stringify(n),
        this.nextSeq(),
        r.id,
      );
    }
    this.sql.exec("INSERT INTO meta (key, value) VALUES ('schema', 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  }

  // ─── Storage helpers ──────────────────────────────────────────────────────

  private nextSeq(): number {
    return this.sql.exec<{ value: number }>("UPDATE meta SET value = value + 1 WHERE key = 'seq' RETURNING value").one().value;
  }

  private currentSeq(): number {
    return this.sql.exec<{ value: number }>("SELECT value FROM meta WHERE key = 'seq'").one().value;
  }

  private load(id: string): Loaded | null {
    const rows = this.sql
      .exec<StoredRow>("SELECT data, replace_key, token_id, seq FROM notifications WHERE id = ?", id)
      .toArray();
    const r = rows[0];
    return r ? { n: JSON.parse(r.data) as Notification, replaceKey: r.replace_key, tokenId: r.token_id } : null;
  }

  private mustLoad(id: string): Loaded {
    const r = this.load(id);
    if (!r) throw notFound(`Notification ${id} not found`);
    return r;
  }

  private save(n: Notification, replaceKey: string | null, tokenId: string | null) {
    this.sql.exec(
      `INSERT INTO notifications (id, seq, created_at, updated_at, source, severity, status, thread_id, replace_key,
         read_at, token_id, search, data, intent, key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at, source = excluded.source,
         severity = excluded.severity, status = excluded.status, thread_id = excluded.thread_id,
         replace_key = excluded.replace_key, read_at = excluded.read_at, token_id = excluded.token_id,
         search = excluded.search, data = excluded.data, intent = excluded.intent, key = excluded.key`,
      n.id,
      this.nextSeq(),
      n.createdAt,
      n.updatedAt,
      n.source,
      n.severity,
      n.status,
      n.threadId,
      replaceKey,
      n.readAt,
      tokenId,
      searchText(n),
      JSON.stringify(n),
      n.intent,
      n.key,
    );
    if (n.intent === "ask") this.trackExpiry(n);
  }

  /** Keeps an ask's expiry deadline in step with the ask: armed while it is open, dropped once it is closed. */
  private trackExpiry(n: Notification) {
    const due = expiryDue(n);
    if (due === null) this.scheduler.clear(ASK_EXPIRY, n.id);
    else if (this.scheduler.dueAt(ASK_EXPIRY, n.id) !== due) this.scheduler.set(ASK_EXPIRY, n.id, due);
  }

  /** The user this inbox belongs to, for pushes the alarm sends (it has no caller to ask). */
  private owner(): string | null {
    if (this.ctx.id.name) return this.ctx.id.name;
    return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'owner'").toArray()[0]?.value ?? null;
  }

  private rememberOwner(userId: string) {
    if (this.ownerKnown) return;
    this.ownerKnown = true;
    this.sql.exec("INSERT INTO meta (key, value) VALUES ('owner', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", userId);
  }

  /** Wakes every wait_for_response held on this notification so it reports the notification's current state. */
  private wake(id: string) {
    const waiters = this.waiters.get(id);
    if (!waiters) return;
    this.waiters.delete(id);
    for (const w of waiters) w();
  }

  private deleteRow(id: string, now: string) {
    this.sql.exec("DELETE FROM notifications WHERE id = ?", id);
    this.sql.exec(
      "INSERT INTO tombstones (id, seq, deleted_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, deleted_at = excluded.deleted_at",
      id,
      this.nextSeq(),
      now,
    );
  }

  /** Schedules the daily prune once this inbox holds data. */
  private ensurePrune() {
    if (this.pruneEnsured) return;
    this.pruneEnsured = true;
    this.scheduler.ensure(PRUNE, PRUNE_REF, Date.now() + DAY);
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  private broadcast(msg: ServerMessage) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // socket already closing
      }
    }
  }

  private emit(userId: string, events: InboxEvent[], pushEvents: InboxEvent[] = events) {
    for (const ev of events) this.broadcast(ev);
    const only = pushEvents.length === 1 ? pushEvents[0]! : null;
    if (only?.type === "notification.updated") return this.pushCoalesced(userId, only);
    for (const ev of pushEvents) {
      if (ev.type === "notification.created") this.pushSlots.set(ev.notification.id, { last: Date.now(), pending: null });
      if (ev.type === "notification.deleted") this.pushSlots.delete(ev.id);
    }
    if (pushEvents.length) this.push(userId, pushEvents);
  }

  private push(userId: string, events: InboxEvent[]) {
    this.ctx.waitUntil(fanoutPush(this.env, userId, events).catch((e) => console.error("push fan-out failed", e)));
  }

  /**
   * At most one push per notification per interval: a burst of progress updates sends the first right away and the
   * latest one when the interval ends (keeping `alert` if any update in between asked for it).
   */
  private pushCoalesced(userId: string, ev: UpdatedEvent) {
    const id = ev.notification.id;
    const now = Date.now();
    const slot = this.pushSlots.get(id);
    if (!slot || now - slot.last >= LIMITS.updatePushIntervalMs) {
      this.pushSlots.set(id, { last: now, pending: null });
      this.push(userId, [ev]);
      this.sweepPushSlots(now);
      return;
    }
    const scheduled = slot.pending !== null;
    slot.pending = { ...ev, alert: ev.alert || (slot.pending?.alert ?? false) };
    if (scheduled) return;
    const flush = new Promise((r) => setTimeout(r, slot.last + LIMITS.updatePushIntervalMs - now)).then(() => {
      if (this.pushSlots.get(id) !== slot || !slot.pending) return; // deleted meanwhile
      const pending = slot.pending;
      slot.pending = null;
      slot.last = Date.now();
      return fanoutPush(this.env, userId, [pending]);
    });
    this.ctx.waitUntil(flush.catch((e) => console.error("push fan-out failed", e)));
  }

  private sweepPushSlots(now: number) {
    if (this.pushSlots.size < 256) return;
    for (const [id, slot] of this.pushSlots) {
      if (!slot.pending && now - slot.last >= LIMITS.updatePushIntervalMs) this.pushSlots.delete(id);
    }
  }

  private checkRate(tokenId: string) {
    const win = Math.floor(Date.now() / 60_000);
    const { count } = this.sql
      .exec<{ count: number }>(
        `INSERT INTO rate_limits (token_id, win, count) VALUES (?, ?, 1)
         ON CONFLICT(token_id, win) DO UPDATE SET count = count + 1 RETURNING count`,
        tokenId,
        win,
      )
      .one();
    if (count > LIMITS.sendsPerMinutePerToken) {
      throw new ApiError("rate_limited", `Rate limit exceeded (${LIMITS.sendsPerMinutePerToken} sends/min per token)`);
    }
  }

  private bumpUsage(kind: QuotaKind, period: "m" | "d", win: number): number {
    return this.sql
      .exec<{ count: number }>(
        `INSERT INTO usage (kind, period, win, count) VALUES (?, ?, ?, 1)
         ON CONFLICT(kind, period, win) DO UPDATE SET count = count + 1 RETURNING count`,
        kind,
        period,
        win,
      )
      .one().count;
  }

  /**
   * Counts one use of a per-account quota, throwing `rate_limited` (with Retry-After) past the per-minute or daily
   * limit. With `userId`, crossing 80% and 100% of the daily limit posts a notice to the inbox.
   */
  private consume(kind: QuotaKind, userId?: string) {
    const q = QUOTAS[kind];
    const now = Date.now();
    const label = q.label.toLowerCase();
    if (q.perMinute !== null && this.bumpUsage(kind, "m", Math.floor(now / MINUTE)) > q.perMinute) {
      throw rateLimited(`Too many ${label}: the limit is ${q.perMinute} per minute`, (MINUTE - (now % MINUTE)) / 1000);
    }
    const used = this.bumpUsage(kind, "d", Math.floor(now / DAY));
    if (used > q.perDay) {
      throw rateLimited(
        `Daily limit reached: ${q.perDay.toLocaleString("en-US")} ${label} per day. It resets at 00:00 UTC.`,
        (DAY - (now % DAY)) / 1000,
      );
    }
    this.ensurePrune();
    if (userId) this.rememberOwner(userId);
    if (userId && WARN_KINDS.includes(kind) && (used === Math.ceil(q.perDay * 0.8) || used === q.perDay)) {
      this.ctx.waitUntil(this.postQuotaNotice(userId, kind, used));
    }
  }

  private async postQuotaNotice(userId: string, kind: QuotaKind, used: number) {
    const q = QUOTAS[kind];
    const limit = q.perDay.toLocaleString("en-US");
    const full = used >= q.perDay;
    const actor: Actor = { userId, deviceId: null, deviceName: null, tokenId: null, defaultSource: "oyee" };
    const input = resolveSendInput({
      title: full ? `Daily limit reached: ${q.label.toLowerCase()}` : `80% of today's ${q.label.toLowerCase()} used`,
      body: full
        ? `You've used all ${limit} for today. More are rejected until 00:00 UTC.`
        : `${used.toLocaleString("en-US")} of ${limit} used today. The limit resets at 00:00 UTC.`,
      severity: full ? "critical" : "warning",
      source: "oyee",
      replaceKey: `oyee-quota-${kind}`,
    }, null);
    await this.store(actor, input, null);
  }

  private getTemplateRow(name: string): Template | null {
    const r = this.sql.exec<{ data: string }>("SELECT data FROM templates WHERE name = ?", name).toArray()[0];
    return r ? (JSON.parse(r.data) as Template) : null;
  }

  // ─── Notifications (RPC) ──────────────────────────────────────────────────

  async send(actor: Actor, input: SendNotificationInput, opts: SendOptions = {}): Promise<RpcResult<Notification>> {
    return guard(async () => {
      if (actor.tokenId) this.checkRate(actor.tokenId);
      this.consume("send", actor.userId);
      let template: Template | null = null;
      if (input.template) {
        template = this.getTemplateRow(input.template);
        if (!template) throw badRequest(`template: unknown template "${input.template}"`);
      }
      const resolved = resolveSendInput(input, template, opts);
      const targets =
        resolved.devices?.length || resolved.platforms?.length
          ? resolveTargets(await listDevices(this.env.DB, actor.userId), resolved)
          : null;
      return this.store(actor, resolved, targets);
    });
  }

  /** Creates the notification, or replaces the active one with the same replaceKey. No quota checks. */
  private async store(
    actor: Actor,
    resolved: ReturnType<typeof resolveSendInput>,
    targets: string[] | null,
  ): Promise<Notification> {
    const now = new Date().toISOString();
    const fresh = buildNotification(newId("ntf"), resolved, actor, now, targets);
    assertUniqueActionIds(fresh.actions);
    const replaceKey = resolved.replaceKey ?? null;

    if (replaceKey) {
      const row = this.sql
        .exec<StoredRow>(
          "SELECT data, replace_key, token_id, seq FROM notifications WHERE replace_key = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
          replaceKey,
        )
        .toArray()[0];
      if (row) {
        const existing = JSON.parse(row.data) as Notification;
        const n = replaceContent(existing, fresh, now);
        this.save(n, replaceKey, actor.tokenId ?? row.token_id);
        this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: true, reason: "update" }]);
        return n;
      }
    }

    this.save(fresh, replaceKey, actor.tokenId);
    this.emit(actor.userId, [{ type: "notification.created", notification: fresh }]);
    this.ensurePrune();
    return fresh;
  }

  /** Inform (inbox/inform.ts): creates the notification, or updates and re-alerts the active one with its key. */
  async inform(actor: Actor, input: InformInput): Promise<RpcResult<InformResult>> {
    return guard(async () => {
      if (actor.tokenId) this.checkRate(actor.tokenId);
      this.consume("send", actor.userId);
      const targets =
        input.devices?.length || input.platforms?.length
          ? resolveTargets(await listDevices(this.env.DB, actor.userId), input)
          : null;
      const now = new Date().toISOString();
      const fresh = buildInform(newId("ntf"), input, actor, now, targets);
      const latest = fresh.key ? this.latestByKey(fresh.source, fresh.key) : null;
      const result = applyInform(latest?.n ?? null, fresh, now);
      const n = result.notification;
      if (n.id === fresh.id) {
        this.save(n, null, actor.tokenId);
        this.emit(actor.userId, [{ type: "notification.created", notification: n }]);
        this.ensurePrune();
      } else {
        this.save(n, latest!.replaceKey, actor.tokenId ?? latest!.tokenId);
        this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: true, reason: "update" }]);
      }
      return result;
    });
  }

  /** The latest notification a sender named with this key (keys are unique per `(source, key)`). */
  private latestByKey(source: string, key: string): Loaded | null {
    const r = this.sql
      .exec<StoredRow>(
        "SELECT data, replace_key, token_id, seq FROM notifications WHERE source = ? AND key = ? ORDER BY id DESC LIMIT 1",
        source,
        key,
      )
      .toArray()[0];
    return r ? { n: JSON.parse(r.data) as Notification, replaceKey: r.replace_key, tokenId: r.token_id } : null;
  }

  async update(actor: Actor, id: string, patch: UpdateNotificationInput): Promise<RpcResult<Notification>> {
    return guard(() => {
      this.consume("update", actor.userId);
      const rec = this.mustLoad(id);
      const n = applyPatch(rec.n, patch, new Date().toISOString());
      this.save(n, rec.replaceKey, rec.tokenId);
      this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: patch.alert ?? false, reason: "update" }]);
      return n;
    });
  }

  async respond(actor: Actor, id: string, input: RespondInput): Promise<RpcResult<Notification>> {
    return guard(() => {
      this.consume("respond", actor.userId);
      const rec = this.mustLoad(id);
      const now = new Date().toISOString();
      const { n, response, action } =
        rec.n.intent === "ask" ? answerAsk(rec.n, input, actor, now) : respondToCard(rec.n, input, actor, now);
      this.save(n, rec.replaceKey, rec.tokenId);
      this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: false, reason: "responded" }]);
      this.wake(id);
      if (action?.callback) {
        this.ctx.waitUntil(sendActionCallback(this.env, actor.userId, rec.tokenId, action.callback, n, response));
      }
      return n;
    });
  }

  async markRead(actor: Actor, id: string): Promise<RpcResult<Notification>> {
    return guard(() => {
      const rec = this.mustLoad(id);
      if (rec.n.readAt) return rec.n;
      this.consume("update", actor.userId);
      const now = new Date().toISOString();
      const n: Notification = { ...rec.n, readAt: now, version: rec.n.version + 1, updatedAt: now };
      this.save(n, rec.replaceKey, rec.tokenId);
      this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: false, reason: "read" }]);
      return n;
    });
  }

  async readAll(actor: Actor, source?: string): Promise<RpcResult<{ updated: number }>> {
    return guard(() => {
      this.consume("update", actor.userId);
      const rows = (
        source
          ? this.sql.exec<StoredRow>(
              "SELECT data, replace_key, token_id, seq FROM notifications WHERE read_at IS NULL AND source = ? ORDER BY id DESC",
              source,
            )
          : this.sql.exec<StoredRow>(
              "SELECT data, replace_key, token_id, seq FROM notifications WHERE read_at IS NULL ORDER BY id DESC",
            )
      ).toArray();
      const now = new Date().toISOString();
      const events: InboxEvent[] = [];
      for (const r of rows) {
        const old = JSON.parse(r.data) as Notification;
        const n: Notification = { ...old, readAt: now, version: old.version + 1, updatedAt: now };
        this.save(n, r.replace_key, r.token_id);
        events.push({ type: "notification.updated", notification: n, alert: false, reason: "read" });
      }
      this.emit(actor.userId, events, events.slice(0, MAX_BULK_PUSH));
      return { updated: rows.length };
    });
  }

  async resolve(actor: Actor, id: string): Promise<RpcResult<Notification>> {
    return guard(() => {
      const rec = this.mustLoad(id);
      if (rec.n.status !== "resolved") this.consume("update", actor.userId);
      return this.resolveLoaded(actor, rec);
    });
  }

  private resolveLoaded(actor: Actor, rec: Loaded, patch?: UpdateNotificationInput): Notification {
    if (rec.n.status === "resolved" && !patch) return rec.n;
    const now = new Date().toISOString();
    const base = patch ? applyPatch(rec.n, patch, now) : { ...rec.n, version: rec.n.version + 1, updatedAt: now };
    const n = inferIntent({ ...base, status: "resolved", resolvedAt: rec.n.resolvedAt ?? now });
    this.save(n, rec.replaceKey, rec.tokenId);
    this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: false, reason: "resolved" }]);
    this.wake(n.id); // a withdrawn ask ends its waits
    return n;
  }

  /** Alertmanager/Grafana "resolved": resolve the active notification with this replaceKey (optionally patching it). */
  async resolveByReplaceKey(actor: Actor, replaceKey: string, patch?: UpdateNotificationInput): Promise<RpcResult<Notification | null>> {
    return guard(() => {
      if (actor.tokenId) this.checkRate(actor.tokenId);
      this.consume("update", actor.userId);
      const row = this.sql
        .exec<StoredRow>(
          "SELECT data, replace_key, token_id, seq FROM notifications WHERE replace_key = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
          replaceKey,
        )
        .toArray()[0];
      if (!row) return null;
      return this.resolveLoaded(actor, { n: JSON.parse(row.data) as Notification, replaceKey: row.replace_key, tokenId: row.token_id }, patch);
    });
  }

  async remove(actor: Actor, id: string): Promise<RpcResult<void>> {
    return guard(() => {
      this.mustLoad(id);
      this.consume("update", actor.userId);
      this.deleteRow(id, new Date().toISOString());
      this.emit(actor.userId, [{ type: "notification.deleted", id }]);
    });
  }

  async get(id: string): Promise<RpcResult<Notification>> {
    return guard(() => {
      this.consume("read");
      return this.mustLoad(id).n;
    });
  }

  async list(q: ListNotificationsQuery): Promise<RpcResult<Page<Notification>>> {
    return guard(() => {
      this.consume("read");
      const where: string[] = [];
      const params: SqlStorageValue[] = [];
      if (q.source) (where.push("source = ?"), params.push(q.source));
      if (q.severity) (where.push("severity = ?"), params.push(q.severity));
      if (q.status) (where.push("status = ?"), params.push(q.status));
      if (q.threadId) (where.push("thread_id = ?"), params.push(q.threadId));
      if (q.q) (where.push("instr(search, ?) > 0"), params.push(q.q.toLowerCase()));

      const cursor = decodeCursor(q.cursor);
      if (q.cursor && !cursor) throw badRequest("cursor: invalid");
      const limit = q.limit;

      if (q.updatedSince !== undefined || (cursor && "s" in cursor)) {
        // Sync mode: ordered by change sequence (≈ updatedAt asc).
        const sinceCursor = decodeCursor(q.updatedSince);
        if (cursor && "s" in cursor) (where.push("seq > ?"), params.push(cursor.s));
        else if (sinceCursor && "s" in sinceCursor) (where.push("seq > ?"), params.push(sinceCursor.s));
        else if (q.updatedSince) {
          const t = Date.parse(q.updatedSince);
          if (Number.isNaN(t)) throw badRequest("updatedSince: expected an ISO-8601 timestamp");
          where.push("updated_at >= ?");
          params.push(new Date(t).toISOString());
        }
        const rows = this.sql
          .exec<StoredRow>(
            `SELECT data, seq, replace_key, token_id FROM notifications ${where.length ? "WHERE " + where.join(" AND ") : ""}
             ORDER BY seq ASC LIMIT ?`,
            ...params,
            limit + 1,
          )
          .toArray();
        const page = rows.slice(0, limit);
        return {
          items: page.map((r) => JSON.parse(r.data) as Notification),
          nextCursor: rows.length > limit ? encodeCursor({ s: page[page.length - 1]!.seq }) : null,
        };
      }

      if (cursor && "b" in cursor) (where.push("id < ?"), params.push(cursor.b));
      const rows = this.sql
        .exec<StoredRow & { id: string }>(
          `SELECT id, data, seq, replace_key, token_id FROM notifications ${where.length ? "WHERE " + where.join(" AND ") : ""}
           ORDER BY id DESC LIMIT ?`,
          ...params,
          limit + 1,
        )
        .toArray();
      const page = rows.slice(0, limit);
      return {
        items: page.map((r) => JSON.parse(r.data) as Notification),
        nextCursor: rows.length > limit ? encodeCursor({ b: page[page.length - 1]!.id }) : null,
      };
    });
  }

  async sources(): Promise<RpcResult<SourceSummary[]>> {
    return guard(() => {
      this.consume("read");
      return this.sql
        .exec<{ source: string; count: number; unread: number; lastAt: string }>(
          `SELECT source, COUNT(*) AS count, SUM(CASE WHEN read_at IS NULL AND status = 'active' THEN 1 ELSE 0 END) AS unread,
             MAX(created_at) AS lastAt FROM notifications GROUP BY source ORDER BY lastAt DESC`,
        )
        .toArray()
        .map((r) => ({ source: r.source, count: r.count, unread: r.unread, lastAt: r.lastAt }));
    });
  }

  /**
   * Long-poll for the answer (at most LIMITS.askWaitSeconds). Returns at once if the ask was already answered, expired
   * or withdrawn; a held wait is woken by the answer, the expiry or the withdrawal.
   */
  async waitForResponse(id: string, timeoutSeconds: number): Promise<RpcResult<McpWaitResult>> {
    return guard(() => {
      this.consume("read");
      const current = waitResult(this.mustLoad(id).n, Date.now());
      if (current.status !== "pending") return current;
      const ms = Math.max(1, Math.min(LIMITS.askWaitSeconds, timeoutSeconds)) * 1000;
      return new Promise<McpWaitResult>((resolve) => {
        const set = this.waiters.get(id) ?? new Set();
        this.waiters.set(id, set);
        const timer = setTimeout(() => {
          set.delete(fn);
          if (set.size === 0 && this.waiters.get(id) === set) this.waiters.delete(id);
          const latest = this.load(id)?.n;
          resolve(latest ? waitResult(latest, Date.now()) : current);
        }, ms);
        const fn = () => {
          clearTimeout(timer);
          const latest = this.load(id)?.n;
          resolve(latest ? waitResult(latest, Date.now()) : current);
        };
        set.add(fn);
      });
    });
  }

  // ─── Progress (RPC) ───────────────────────────────────────────────────────

  /** One progress report (see inbox/progress.ts): creates by `(source, key)`, updates silently, alerts when finished. */
  async progress(actor: Actor, input: ProgressInput): Promise<RpcResult<ProgressReport>> {
    return guard(async () => {
      const targets =
        input.devices?.length || input.platforms?.length
          ? resolveTargets(await listDevices(this.env.DB, actor.userId), input)
          : undefined;
      // No awaits from here on, so concurrent reports for the same key can't interleave.
      const source = input.source ?? actor.defaultSource;
      const row = this.sql
        .exec<StoredRow>(
          "SELECT data, replace_key, token_id, seq FROM notifications WHERE source = ? AND key = ? ORDER BY id DESC LIMIT 1",
          source,
          input.key,
        )
        .toArray()[0];
      const latest = row ? (JSON.parse(row.data) as Notification) : null;
      const continues = isLiveProgress(latest);
      if (!continues && actor.tokenId) this.checkRate(actor.tokenId);
      this.consume(continues ? "update" : "send", actor.userId);
      const report = reportProgress(latest, input, { id: newId("ntf"), source, now: new Date().toISOString(), targets });
      const n = report.notification;
      this.save(n, null, continues ? (row!.token_id ?? actor.tokenId) : actor.tokenId);
      if (continues) {
        this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: report.alert, reason: "update" }]);
      } else {
        this.emit(actor.userId, [{ type: "notification.created", notification: n }]);
        this.ensurePrune();
      }
      return report;
    });
  }

  // ─── Ask (RPC) ────────────────────────────────────────────────────────────

  /** Asks the user a question, or returns the open, unexpired ask that already has this `(source, key)`. */
  async ask(actor: Actor, input: AskInput): Promise<RpcResult<AskResult>> {
    return guard(async () => {
      if (actor.tokenId) this.checkRate(actor.tokenId);
      const latest = input.key ? this.latestByKey(input.source ?? actor.defaultSource, input.key)?.n : null;
      if (latest && isOpenAsk(latest, Date.now())) return { outcome: "reused", notification: latest };
      this.consume("send", actor.userId);
      const targets =
        input.devices?.length || input.platforms?.length
          ? resolveTargets(await listDevices(this.env.DB, actor.userId), input)
          : null;
      const n = buildAsk(newId("ntf"), input, actor, new Date().toISOString(), targets);
      this.save(n, null, actor.tokenId);
      this.emit(actor.userId, [{ type: "notification.created", notification: n }]);
      this.ensurePrune();
      return { outcome: "created", notification: n };
    });
  }

  // ─── Templates (RPC) ──────────────────────────────────────────────────────

  async listTemplates(): Promise<RpcResult<Template[]>> {
    return guard(() => {
      this.consume("read");
      return this.sql
        .exec<{ data: string }>("SELECT data FROM templates ORDER BY name")
        .toArray()
        .map((r) => JSON.parse(r.data) as Template);
    });
  }

  async getTemplate(name: string): Promise<RpcResult<Template>> {
    return guard(() => {
      this.consume("read");
      const t = this.getTemplateRow(name);
      if (!t) throw notFound(`Template "${name}" not found`);
      return t;
    });
  }

  async upsertTemplate(name: string, input: UpsertTemplateInput): Promise<RpcResult<Template>> {
    return guard(() => {
      if (input.card.actions) assertUniqueActionIds(input.card.actions);
      const existing = this.getTemplateRow(name);
      if (!existing) {
        const { count } = this.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM templates").one();
        if (count >= LIMITS.maxTemplatesPerUser) {
          throw conflict(`You can have at most ${LIMITS.maxTemplatesPerUser} templates: delete one first`);
        }
      }
      const now = new Date().toISOString();
      const t: Template = {
        id: existing?.id ?? newId("tpl"),
        name,
        description: input.description ?? (existing && input.description === undefined ? existing.description : null),
        card: input.card,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.sql.exec(
        "INSERT INTO templates (name, data) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data",
        name,
        JSON.stringify(t),
      );
      return t;
    });
  }

  async deleteTemplate(name: string): Promise<RpcResult<void>> {
    return guard(() => {
      const r = this.sql.exec("DELETE FROM templates WHERE name = ?", name);
      if (r.rowsWritten === 0) throw notFound(`Template "${name}" not found`);
    });
  }

  async previewTemplate(name: string, vars: Record<string, string | number | boolean>): Promise<RpcResult<TemplateCard & { template: string }>> {
    return guard(() => {
      const t = this.getTemplateRow(name);
      if (!t) throw notFound(`Template "${name}" not found`);
      return { ...renderTemplateValue(t.card, vars), template: name };
    });
  }

  // ─── Quotas (RPC) ─────────────────────────────────────────────────────────

  /** Counts one use of a quota enforced outside the inbox (e.g. pairing codes, stored in D1). */
  async useQuota(kind: QuotaKind): Promise<RpcResult<void>> {
    return guard(() => this.consume(kind));
  }

  /** Today's usage of every daily quota (UTC). */
  async usage(now = Date.now()): Promise<RpcResult<Usage>> {
    return guard(() => {
      const day = Math.floor(now / DAY);
      const rows = this.sql
        .exec<{ kind: string; count: number }>("SELECT kind, count FROM usage WHERE period = 'd' AND win = ?", day)
        .toArray();
      const used = new Map(rows.map((r) => [r.kind, r.count]));
      return {
        day: new Date(day * DAY).toISOString().slice(0, 10),
        resetsAt: new Date((day + 1) * DAY).toISOString(),
        items: (Object.keys(QUOTAS) as QuotaKind[]).map((kind) => ({
          kind,
          label: QUOTAS[kind].label,
          used: Math.min(used.get(kind) ?? 0, QUOTAS[kind].perDay),
          limit: QUOTAS[kind].perDay,
        })),
      };
    });
  }

  // ─── WebSocket (Hibernation API) ──────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: { code: "bad_request", message: "Expected a WebSocket upgrade" } }, { status: 426 });
    }
    const userId = request.headers.get("X-Oyee-User-Id") ?? "";
    const deviceId = request.headers.get("X-Oyee-Device-Id") || null;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [deviceId ?? "browser"]);
    server.serializeAttachment({ userId, deviceId });
    const hello: ServerMessage = { type: "hello", userId, deviceId, serverTime: new Date().toISOString() };
    server.send(JSON.stringify(hello));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Closes the sockets of an unpaired/deleted device. */
  async disconnectDevice(deviceId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(deviceId)) {
      try {
        ws.close(4001, "device removed");
      } catch {
        // already closed
      }
    }
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let parsed: ClientMessage;
    try {
      const res = ClientMessage.safeParse(JSON.parse(message));
      if (!res.success) return;
      parsed = res.data;
    } catch {
      return;
    }
    if (parsed.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" } satisfies ServerMessage));
      return;
    }
    if (parsed.type === "sync") {
      try {
        this.consume("read");
      } catch {
        return; // over quota: the client retries on its next reconnect
      }
      ws.send(JSON.stringify(this.syncResult(parsed.since)));
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // already closed
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      // already closed
    }
  }

  /** §6 sync: `since` = cursor (from a previous sync.result), ISO time, or null (= last 50 active). */
  syncResult(since: string | null): Extract<ServerMessage, { type: "sync.result" }> {
    const head = this.currentSeq();
    const cursor = decodeCursor(since);
    const time = since && !cursor && !Number.isNaN(Date.parse(since)) ? new Date(Date.parse(since)).toISOString() : null;

    if (!(cursor && "s" in cursor) && !time) {
      const notifications = this.sql
        .exec<{ data: string }>("SELECT data FROM notifications WHERE status = 'active' ORDER BY id DESC LIMIT 50")
        .toArray()
        .map((r) => JSON.parse(r.data) as Notification);
      return { type: "sync.result", notifications, deletedIds: [], cursor: encodeCursor({ s: head }), hasMore: false };
    }

    const nRows =
      cursor && "s" in cursor
        ? this.sql.exec<{ data: string; seq: number }>(
            "SELECT data, seq FROM notifications WHERE seq > ? ORDER BY seq ASC LIMIT ?",
            cursor.s,
            SYNC_PAGE + 1,
          )
        : this.sql.exec<{ data: string; seq: number }>(
            "SELECT data, seq FROM notifications WHERE updated_at >= ? ORDER BY seq ASC LIMIT ?",
            time,
            SYNC_PAGE + 1,
          );
    const tRows =
      cursor && "s" in cursor
        ? this.sql.exec<{ id: string; seq: number }>(
            "SELECT id, seq FROM tombstones WHERE seq > ? ORDER BY seq ASC LIMIT ?",
            cursor.s,
            SYNC_PAGE + 1,
          )
        : this.sql.exec<{ id: string; seq: number }>(
            "SELECT id, seq FROM tombstones WHERE deleted_at >= ? ORDER BY seq ASC LIMIT ?",
            time,
            SYNC_PAGE + 1,
          );

    type Change = { seq: number; n?: Notification; deletedId?: string };
    const changes: Change[] = [
      ...nRows.toArray().map((r) => ({ seq: r.seq, n: JSON.parse(r.data) as Notification })),
      ...tRows.toArray().map((r) => ({ seq: r.seq, deletedId: r.id })),
    ].sort((a, b) => a.seq - b.seq);
    const page = changes.slice(0, SYNC_PAGE);
    const hasMore = changes.length > SYNC_PAGE;
    const last = page[page.length - 1];
    const nextSeq = hasMore && last ? last.seq : head;
    return {
      type: "sync.result",
      notifications: page.filter((c) => c.n).map((c) => c.n!),
      deletedIds: page.filter((c) => c.deletedId).map((c) => c.deletedId!),
      cursor: encodeCursor({ s: nextSeq }),
      hasMore,
    };
  }

  // ─── Deadlines and retention ──────────────────────────────────────────────

  override async alarm(): Promise<void> {
    // Inboxes whose alarm predates the scheduler have no prune deadline yet; their alarm meant "prune now".
    this.scheduler.ensure(PRUNE, PRUNE_REF, Date.now());
    await this.scheduler.run();
  }

  /**
   * Expires open asks whose time is up (Expiry): the given deadline refs plus any open ask past its `expiresAt`, so an
   * ask whose deadline was lost still expires at the next alarm. A ref that isn't due yet (the alarm fired a moment
   * early) is re-armed. Not charged to the user's quota.
   */
  private expireAsks(refs: string[], now: number) {
    const overdue = this.sql
      .exec<{ id: string }>(
        "SELECT id FROM notifications WHERE intent = 'ask' AND status = 'active' AND json_extract(data, '$.ask.expiresAt') <= ?",
        new Date(now).toISOString(),
      )
      .toArray()
      .map((r) => r.id);
    const events: InboxEvent[] = [];
    for (const id of new Set([...refs, ...overdue])) {
      const rec = this.load(id);
      if (!rec) continue;
      const n = expireAsk(rec.n, now);
      if (!n) {
        this.trackExpiry(rec.n);
        continue;
      }
      this.save(n, rec.replaceKey, rec.tokenId);
      events.push({ type: "notification.updated", notification: n, alert: false, reason: "resolved" });
      this.wake(id);
    }
    if (!events.length) return;
    const owner = this.owner();
    if (owner) this.emit(owner, events, events.slice(0, MAX_BULK_PUSH));
    else for (const ev of events) this.broadcast(ev);
  }

  /** Deletes notifications older than the retention window and beyond the per-user cap. Returns deleted ids. */
  prune(now = Date.now()): string[] {
    const cutoff = new Date(now - LIMITS.retentionDays * 86400_000).toISOString();
    const nowIso = new Date(now).toISOString();
    const old = this.sql.exec<{ id: string }>("SELECT id FROM notifications WHERE created_at < ?", cutoff).toArray();
    const overflow = this.sql
      .exec<{ id: string }>("SELECT id FROM notifications ORDER BY id DESC LIMIT -1 OFFSET ?", LIMITS.maxNotificationsPerUser)
      .toArray();
    const ids = [...new Set([...old, ...overflow].map((r) => r.id))];
    for (const id of ids) this.deleteRow(id, nowIso);
    this.sql.exec("DELETE FROM tombstones WHERE deleted_at < ?", cutoff);
    this.sql.exec("DELETE FROM rate_limits WHERE win < ?", Math.floor(now / 60_000) - 5);
    this.sql.exec(
      "DELETE FROM usage WHERE (period = 'm' AND win < ?) OR (period = 'd' AND win < ?)",
      Math.floor(now / MINUTE) - 5,
      Math.floor(now / DAY) - 2,
    );
    for (const id of ids.slice(0, MAX_BULK_PUSH)) this.broadcast({ type: "notification.deleted", id });
    return ids;
  }
}
