/**
 * InboxDO — one per user (`idFromName(userId)`), SQLite-backed.
 * Holds notifications (+ tombstones for sync), per-token and per-account quota counters, hibernatable WebSockets and
 * in-memory `wait_for_response` waiters. Every mutation is broadcast over WebSocket and fanned out to push transports.
 */
import { DurableObject } from "cloudflare:workers";
import {
  ClientMessage,
  LIMITS,
  type AskInput,
  QUOTAS,
  type InformInput,
  type Intent,
  type ListNotificationsQuery,
  type McpWaitResult,
  type Notification,
  type Page,
  type ProgressInput,
  type QuotaKind,
  type RespondInput,
  type ServerMessage,
  type SourceSummary,
  type Usage,
} from "@oyee/schema";
import type { Env } from "../env";
import { ApiError, badRequest, notFound, rateLimited, type RpcResult } from "../lib/errors";
import { b64urlDecodeString, b64urlEncode } from "../lib/encoding";
import { newId } from "../lib/ids";
import { listDevices } from "../db";
import { fanoutPush, type InboxEvent } from "../push/fanout";
import { resolveTargets, searchText, type Actor } from "./model";
import { isLiveProgress, reportProgress, staleDueAt, stopIfQuiet, type ProgressReport } from "./progress";
import { Scheduler } from "./scheduler";
import { answerAsk, buildAsk, expireAsk, expiryDue, isOpenAsk, waitResult, withdrawIfOpen, type AskResult } from "./ask";
import { applyInform, buildInform, type InformResult } from "./inform";
import { assertKeyFree } from "./keys";
import { fromStored } from "./legacy";

type UpdatedEvent = Extract<InboxEvent, { type: "notification.updated" }>;

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Quotas that post an inbox notice at 80% and 100% of the daily limit. */
const WARN_KINDS: QuotaKind[] = ["send", "update", "respond"];

interface StoredRow {
  data: string;
  token_id: string | null;
  seq: number;
  [k: string]: SqlStorageValue;
}

interface Loaded {
  n: Notification;
  tokenId: string | null;
}

const article = (intent: Intent) => (intent === "inform" ? "an inform" : `a ${intent}`);

/** Storage schema version in `meta.schema`: 1 = intents next to the flat card, 2 = intents only (protocol v2). */
const STORAGE_SCHEMA = 2;

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
/** Deadline kind for a running progress's stale deadline (ref = notification id). */
const PROGRESS_STALE = "progress.stale";
/** A stale check that failed is tried again this much later. */
const STALE_RETRY_MS = 5 * 60_000;
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
  /** The inbox's single alarm: fires at the earliest deadline (the daily prune, plus kinds added by later features). */
  readonly scheduler: Scheduler;
  private pruneEnsured = false;
  /** Cache of `meta.user_id` (see rememberUser). */
  private knownUserId: string | null = null;
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
    this.scheduler.handle(PROGRESS_STALE, (refs, now) => this.stopQuietProgress(refs, now));
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
        intent TEXT,
        key TEXT,
        read_at TEXT,
        token_id TEXT,
        alerted_at TEXT,
        search TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ntf_seq ON notifications(seq);
      CREATE INDEX IF NOT EXISTS ntf_created ON notifications(created_at);
      CREATE INDEX IF NOT EXISTS ntf_updated ON notifications(updated_at);
      CREATE INDEX IF NOT EXISTS ntf_source ON notifications(source, id);
      CREATE INDEX IF NOT EXISTS ntf_status ON notifications(status, id);
      CREATE INDEX IF NOT EXISTS ntf_severity ON notifications(severity, id);
      CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, deleted_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tomb_seq ON tombstones(seq);
      CREATE TABLE IF NOT EXISTS rate_limits (token_id TEXT NOT NULL, win INTEGER NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY (token_id, win));
      CREATE TABLE IF NOT EXISTS usage (kind TEXT NOT NULL, period TEXT NOT NULL, win INTEGER NOT NULL,
        count INTEGER NOT NULL, PRIMARY KEY (kind, period, win));
    `);
    this.migrateToV2();
  }

  /**
   * Protocol v2 storage, once per inbox (recorded as `meta.schema`). Inboxes created before intents get the `intent`,
   * `key` and `alerted_at` columns; every stored row becomes a v2 notification (inbox/legacy.ts: a flat card turns into
   * the intent it most resembles, flat fields and the `debug` severity go); then the thread and replace-key columns and
   * the templates table are dropped. Rows whose meaning changed (no intent before, or `debug`) get a new `seq` so
   * clients that sync by cursor receive them again.
   */
  private migrateToV2() {
    const schema = this.sql.exec<{ value: number }>("SELECT value FROM meta WHERE key = 'schema'").toArray()[0]?.value ?? 0;
    if (schema >= STORAGE_SCHEMA) return;
    const columns = new Set(
      this.sql.exec<{ name: string }>("SELECT name FROM pragma_table_info('notifications')").toArray().map((c) => c.name),
    );
    for (const c of ["intent", "key", "alerted_at"]) {
      if (!columns.has(c)) this.sql.exec(`ALTER TABLE notifications ADD COLUMN ${c} TEXT`);
    }
    const rows = this.sql
      .exec<{ id: string; data: string; replace_key: string | null }>(
        `SELECT id, data, ${columns.has("replace_key") ? "replace_key" : "NULL AS replace_key"} FROM notifications`,
      )
      .toArray();
    for (const r of rows) {
      const old = JSON.parse(r.data) as { intent?: string; severity?: string; status?: string };
      const n = fromStored(old, r.replace_key);
      const changed = old.intent === undefined || old.severity !== n.severity || old.status !== n.status;
      this.sql.exec(
        "UPDATE notifications SET intent = ?, key = ?, severity = ?, status = ?, search = ?, data = ?, seq = COALESCE(?, seq) WHERE id = ?",
        n.intent,
        n.key,
        n.severity,
        n.status,
        searchText(n),
        JSON.stringify(n),
        changed ? this.nextSeq() : null,
        r.id,
      );
    }
    this.sql.exec("DROP INDEX IF EXISTS ntf_thread");
    this.sql.exec("DROP INDEX IF EXISTS ntf_replace");
    if (columns.has("thread_id")) this.sql.exec("ALTER TABLE notifications DROP COLUMN thread_id");
    if (columns.has("replace_key")) this.sql.exec("ALTER TABLE notifications DROP COLUMN replace_key");
    this.sql.exec("DROP TABLE IF EXISTS templates");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ntf_key ON notifications(source, key)");
    this.sql.exec(
      "INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      STORAGE_SCHEMA,
    );
  }

  // ─── Storage helpers ──────────────────────────────────────────────────────

  private nextSeq(): number {
    return this.sql.exec<{ value: number }>("UPDATE meta SET value = value + 1 WHERE key = 'seq' RETURNING value").one().value;
  }

  private currentSeq(): number {
    return this.sql.exec<{ value: number }>("SELECT value FROM meta WHERE key = 'seq'").one().value;
  }

  private load(id: string): Loaded | null {
    const r = this.sql.exec<StoredRow>("SELECT data, token_id, seq FROM notifications WHERE id = ?", id).toArray()[0];
    return r ? { n: JSON.parse(r.data) as Notification, tokenId: r.token_id } : null;
  }

  private mustLoad(id: string): Loaded {
    const r = this.load(id);
    if (!r) throw notFound(`Notification ${id} not found`);
    return r;
  }

  private save(n: Notification, tokenId: string | null) {
    this.sql.exec(
      `INSERT INTO notifications (id, seq, created_at, updated_at, source, severity, status, read_at, token_id, search,
         data, intent, key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at, source = excluded.source,
         severity = excluded.severity, status = excluded.status, read_at = excluded.read_at, token_id = excluded.token_id,
         search = excluded.search, data = excluded.data, intent = excluded.intent, key = excluded.key`,
      n.id,
      this.nextSeq(),
      n.createdAt,
      n.updatedAt,
      n.source,
      n.severity,
      n.status,
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
    if (userId) this.rememberUser(userId); // so the alarm can push asks it expires
    if (userId && WARN_KINDS.includes(kind) && (used === Math.ceil(q.perDay * 0.8) || used === q.perDay)) {
      // After the current operation, so the notice never interleaves with the send that crossed the threshold.
      this.ctx.waitUntil(Promise.resolve().then(() => this.postQuotaNotice(userId, kind, used)));
    }
  }

  /** An inform from Oyee itself (source "oyee", keyed per quota), not charged to the quota it warns about. */
  private postQuotaNotice(userId: string, kind: QuotaKind, used: number) {
    const q = QUOTAS[kind];
    const limit = q.perDay.toLocaleString("en-US");
    const full = used >= q.perDay;
    const actor: Actor = { userId, deviceId: null, deviceName: null, tokenId: null, defaultSource: "oyee" };
    this.storeInform(
      actor,
      {
        title: full ? `Daily limit reached: ${q.label.toLowerCase()}` : `80% of today's ${q.label.toLowerCase()} used`,
        body: full
          ? `You've used all ${limit} for today. More are rejected until 00:00 UTC.`
          : `${used.toLocaleString("en-US")} of ${limit} used today. The limit resets at 00:00 UTC.`,
        severity: full ? "critical" : "warning",
        key: `oyee-quota-${kind}`,
      },
      null,
      false,
    );
  }

  // ─── Notifications (RPC) ──────────────────────────────────────────────────

  /** Inform (inbox/inform.ts): creates the notification, or updates the one with its key (alerting or silently). */
  async inform(actor: Actor, input: InformInput): Promise<RpcResult<InformResult>> {
    return guard(async () => {
      if (actor.tokenId) this.checkRate(actor.tokenId);
      const targets =
        input.devices?.length || input.platforms?.length
          ? resolveTargets(await listDevices(this.env.DB, actor.userId), input)
          : null;
      return this.storeInform(actor, input, targets, true);
    });
  }

  /**
   * Applies an inform to its key and stores, broadcasts and pushes the result. `charge`: a new notification counts as a
   * send and a silent update as an update (spec "Quotas"); Oyee's own notices aren't charged.
   */
  private storeInform(actor: Actor, input: InformInput, targets: string[] | null, charge: boolean): InformResult {
    const now = new Date().toISOString();
    const fresh = buildInform(newId("ntf"), input, actor, now, targets);
    const latest = fresh.key ? this.claimKey(fresh.source, fresh.key, "inform") : null;
    const result = applyInform(latest && { n: latest.n, alertedAt: this.informAlertedAt(latest.n) }, fresh, now);
    if (result.outcome === "suppressed") return result;
    if (charge) this.consume(result.outcome === "updated_silently" ? "update" : "send", actor.userId);
    const n = result.notification;
    if (n.id === fresh.id) {
      this.save(n, actor.tokenId);
      this.emit(actor.userId, [{ type: "notification.created", notification: n }]);
      this.ensurePrune();
    } else {
      const alert = result.outcome === "alerted";
      this.save(n, actor.tokenId ?? latest!.tokenId);
      this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert, reason: "update" }]);
    }
    if (result.outcome !== "updated_silently") {
      this.sql.exec("UPDATE notifications SET alerted_at = ? WHERE id = ?", now, n.id);
    }
    return result;
  }

  /**
   * The latest notification under `(source, key)`, for an intent about to use the key (inbox/keys.ts): fails when that
   * notification is still live and of another intent.
   */
  private claimKey(source: string, key: string, intent: Intent): Loaded | null {
    const latest = this.latestByKey(source, key);
    assertKeyFree(latest?.n, intent, Date.now());
    return latest;
  }

  /** When an inform last alerted (`alerted_at`, written by inform); rows without one fall back to `updatedAt`. */
  private informAlertedAt(n: Notification): string {
    const r = this.sql.exec<{ alerted_at: string | null }>("SELECT alerted_at FROM notifications WHERE id = ?", n.id).toArray()[0];
    return r?.alerted_at ?? n.updatedAt;
  }

  /** The latest notification a sender named with this key (keys are unique per `(source, key)`). */
  private latestByKey(source: string, key: string): Loaded | null {
    const r = this.sql
      .exec<StoredRow>(
        "SELECT data, token_id, seq FROM notifications WHERE source = ? AND key = ? ORDER BY id DESC LIMIT 1",
        source,
        key,
      )
      .toArray()[0];
    return r ? { n: JSON.parse(r.data) as Notification, tokenId: r.token_id } : null;
  }

  /** The first answer to an open ask, from any device (inbox/ask.ts). Only asks can be answered. */
  async respond(actor: Actor, id: string, input: RespondInput): Promise<RpcResult<Notification>> {
    return guard(() => {
      this.consume("respond", actor.userId);
      const rec = this.mustLoad(id);
      if (rec.n.intent !== "ask") throw badRequest(`This notification is ${article(rec.n.intent)}, not an ask: only asks take answers`);
      const n = answerAsk(rec.n, input, actor, new Date().toISOString());
      this.save(n, rec.tokenId);
      this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: false, reason: "responded" }]);
      this.wake(id);
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
      this.save(n, rec.tokenId);
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
              "SELECT data, token_id, seq FROM notifications WHERE read_at IS NULL AND source = ? ORDER BY id DESC",
              source,
            )
          : this.sql.exec<StoredRow>(
              "SELECT data, token_id, seq FROM notifications WHERE read_at IS NULL ORDER BY id DESC",
            )
      ).toArray();
      const now = new Date().toISOString();
      const events: InboxEvent[] = [];
      for (const r of rows) {
        const old = JSON.parse(r.data) as Notification;
        const n: Notification = { ...old, readAt: now, version: old.version + 1, updatedAt: now };
        this.save(n, r.token_id);
        events.push({ type: "notification.updated", notification: n, alert: false, reason: "read" });
      }
      this.emit(actor.userId, events, events.slice(0, MAX_BULK_PUSH));
      return { updated: rows.length };
    });
  }

  async resolve(actor: Actor, id: string): Promise<RpcResult<Notification>> {
    return guard(() => {
      const rec = this.mustLoad(id);
      if (rec.n.status === "resolved") return rec.n;
      this.consume("update", actor.userId);
      const now = new Date().toISOString();
      const resolved: Notification = { ...rec.n, version: rec.n.version + 1, updatedAt: now, status: "resolved", resolvedAt: now };
      const n = resolved.intent === "ask" ? withdrawIfOpen(resolved) : resolved;
      this.save(n, rec.tokenId);
      this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: false, reason: "resolved" }]);
      this.wake(n.id); // a withdrawn ask ends its waits
      return n;
    });
  }

  /**
   * Alertmanager/Grafana "resolved": the active inform with this key shows `input` as its final content and is resolved
   * without alerting. With none active, the resolution is recorded as an inform that is resolved from the start.
   */
  async resolveInformByKey(actor: Actor, input: InformInput & { key: string }): Promise<RpcResult<Notification>> {
    return guard(() => {
      if (actor.tokenId) this.checkRate(actor.tokenId);
      const now = new Date().toISOString();
      const fresh = buildInform(newId("ntf"), input, actor, now, null);
      const latest = this.claimKey(fresh.source, input.key, "inform");
      const active = latest && latest.n.intent === "inform" && latest.n.status === "active" ? latest : null;
      this.consume(active ? "update" : "send", actor.userId);
      const n: Notification = {
        ...fresh,
        ...(active && {
          id: active.n.id,
          createdAt: active.n.createdAt,
          version: active.n.version + 1,
          readAt: active.n.readAt,
          targetDeviceIds: active.n.targetDeviceIds,
        }),
        status: "resolved",
        resolvedAt: now,
      };
      this.save(n, actor.tokenId ?? active?.tokenId ?? null);
      this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: false, reason: "resolved" }]);
      if (!active) this.ensurePrune();
      return n;
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

  /** `key` and `intent` filter what MCP list_notifications asks for; REST lists by the other fields. */
  async list(q: ListNotificationsQuery & { key?: string; intent?: Intent }): Promise<RpcResult<Page<Notification>>> {
    return guard(() => {
      this.consume("read");
      const where: string[] = [];
      const params: SqlStorageValue[] = [];
      if (q.source) (where.push("source = ?"), params.push(q.source));
      if (q.key) (where.push("key = ?"), params.push(q.key));
      if (q.intent) (where.push("intent = ?"), params.push(q.intent));
      if (q.severity) (where.push("severity = ?"), params.push(q.severity));
      if (q.status) (where.push("status = ?"), params.push(q.status));
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
            `SELECT data, seq, token_id FROM notifications ${where.length ? "WHERE " + where.join(" AND ") : ""}
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
          `SELECT id, data, seq, token_id FROM notifications ${where.length ? "WHERE " + where.join(" AND ") : ""}
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
      const asked = this.mustLoad(id).n;
      if (asked.intent !== "ask") throw badRequest(`${id} is ${article(asked.intent)}, not an ask: only asks have answers`);
      const current = waitResult(asked, Date.now());
      if (current.status !== "pending") return current;
      const ms = Math.max(1, Math.min(LIMITS.askWaitSeconds, timeoutSeconds)) * 1000;
      const now = () => {
        const latest = this.load(id)?.n;
        return latest?.intent === "ask" ? waitResult(latest, Date.now()) : current;
      };
      return new Promise<McpWaitResult>((resolve) => {
        const set = this.waiters.get(id) ?? new Set();
        this.waiters.set(id, set);
        const timer = setTimeout(() => {
          set.delete(fn);
          if (set.size === 0 && this.waiters.get(id) === set) this.waiters.delete(id);
          resolve(now());
        }, ms);
        const fn = () => {
          clearTimeout(timer);
          resolve(now());
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
      const row = this.claimKey(source, input.key, "progress");
      const latest = row?.n ?? null;
      const continues = isLiveProgress(latest);
      if (!continues && actor.tokenId) this.checkRate(actor.tokenId);
      this.consume(continues ? "update" : "send", actor.userId);
      const report = reportProgress(latest, input, { id: newId("ntf"), source, now: new Date().toISOString(), targets });
      const n = report.notification;
      this.save(n, continues ? (row!.tokenId ?? actor.tokenId) : actor.tokenId);
      if (continues) {
        this.emit(actor.userId, [{ type: "notification.updated", notification: n, alert: report.alert, reason: "update" }]);
      } else {
        this.emit(actor.userId, [{ type: "notification.created", notification: n }]);
        this.ensurePrune();
      }
      this.rememberUser(actor.userId);
      this.trackStale(n);
      return report;
    });
  }

  /** Keeps a progress's stale deadline in step with it: registered while running, dropped once it can't stop. */
  private trackStale(n: Notification) {
    const due = staleDueAt(n);
    if (due === null) this.scheduler.clear(PROGRESS_STALE, n.id);
    else this.scheduler.set(PROGRESS_STALE, n.id, due);
  }

  /**
   * Stale deadlines that came due: each running progress that got no report for `staleAfter` is marked stopped and
   * alerts once (not charged to quotas). A ref is only "check this now": one that changed meanwhile is skipped or
   * re-registered for its real deadline, and one whose check failed is retried a few minutes later (the scheduler
   * removes due refs before calling this, so nothing else would bring it back).
   */
  private stopQuietProgress(refs: string[], now: number) {
    const userId = this.userId();
    for (const id of refs) {
      try {
        const rec = this.load(id);
        if (!rec) continue;
        const stopped = stopIfQuiet(rec.n, now);
        if (!stopped) {
          this.trackStale(rec.n);
          continue;
        }
        this.save(stopped, rec.tokenId);
        const ev: InboxEvent = { type: "notification.updated", notification: stopped, alert: true, reason: "update" };
        if (userId) this.emit(userId, [ev]);
        else this.broadcast(ev);
      } catch (e) {
        console.error(`stopped reporting: checking ${id} failed; retrying`, e);
        this.scheduler.set(PROGRESS_STALE, id, now + STALE_RETRY_MS);
      }
    }
  }

  /** The inbox owner's id, kept so work the alarm does on its own (stopped reporting) can push to their devices. */
  private rememberUser(userId: string) {
    if (this.knownUserId === userId) return;
    this.sql.exec("INSERT INTO meta (key, value) VALUES ('user_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", userId);
    this.knownUserId = userId;
  }

  private userId(): string | null {
    this.knownUserId ??=
      this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'user_id'").toArray()[0]?.value ?? null;
    return this.knownUserId;
  }

  // ─── Ask (RPC) ────────────────────────────────────────────────────────────

  /** Asks the user a question, or returns the open, unexpired ask that already has this `(source, key)`. */
  async ask(actor: Actor, input: AskInput): Promise<RpcResult<AskResult>> {
    return guard(async () => {
      if (actor.tokenId) this.checkRate(actor.tokenId);
      const latest = input.key ? this.claimKey(input.source ?? actor.defaultSource, input.key, "ask")?.n : null;
      if (latest && isOpenAsk(latest, Date.now())) return { outcome: "reused", notification: latest };
      this.consume("send", actor.userId);
      const targets =
        input.devices?.length || input.platforms?.length
          ? resolveTargets(await listDevices(this.env.DB, actor.userId), input)
          : null;
      const n = buildAsk(newId("ntf"), input, actor, new Date().toISOString(), targets);
      this.save(n, actor.tokenId);
      this.emit(actor.userId, [{ type: "notification.created", notification: n }]);
      this.ensurePrune();
      return { outcome: "created", notification: n };
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
        `SELECT id FROM notifications WHERE intent = 'ask' AND status = 'active' AND json_extract(data, '$.ask.state') = 'open'
           AND json_extract(data, '$.ask.expiresAt') <= ?`,
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
      this.save(n, rec.tokenId);
      events.push({ type: "notification.updated", notification: n, alert: false, reason: "resolved" });
      this.wake(id);
    }
    if (!events.length) return;
    const owner = this.userId();
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
