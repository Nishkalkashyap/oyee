/**
 * Deadline scheduler: the inbox's single Durable Object alarm, always set to the earliest pending deadline.
 *
 * A deadline is `(kind, ref, dueAt)`, e.g. ("prune", "daily", …) or ("ask.expiry", <notification id>, …). Each kind
 * has one handler, registered with `handle()`; `set()` registers or moves a deadline and `clear()` drops it. When the
 * alarm fires, `run()` hands every due ref to its kind's handler (grouped per kind) and re-arms the alarm for the next
 * deadline. Deadlines are removed before their handler runs, so a recurring kind re-registers itself from its handler.
 *
 * Handlers should treat a ref as "check this now", not as proof that the thing is due: the alarm may fire slightly
 * early, and a deadline row can be stale if the thing it points at changed without clearing it.
 */

export type DeadlineHandler = (refs: string[], now: number) => void | Promise<void>;

export class Scheduler {
  private handlers = new Map<string, DeadlineHandler>();
  /** The alarm time last set by this instance (undefined = unknown, e.g. right after a restart). */
  private armed: number | null | undefined;

  constructor(private storage: DurableObjectStorage) {
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS deadlines (kind TEXT NOT NULL, ref TEXT NOT NULL, due_at INTEGER NOT NULL,
        PRIMARY KEY (kind, ref));
      CREATE INDEX IF NOT EXISTS deadlines_due ON deadlines(due_at);
    `);
  }

  /** Registers the handler for a deadline kind (one per kind; call from the Durable Object's constructor). */
  handle(kind: string, handler: DeadlineHandler) {
    this.handlers.set(kind, handler);
  }

  /** Registers a deadline, or moves an existing one, and re-arms the alarm. */
  set(kind: string, ref: string, dueAt: number) {
    this.storage.sql.exec(
      "INSERT INTO deadlines (kind, ref, due_at) VALUES (?, ?, ?) ON CONFLICT(kind, ref) DO UPDATE SET due_at = excluded.due_at",
      kind,
      ref,
      Math.floor(dueAt),
    );
    this.rearm();
  }

  /** Registers a deadline only if none exists for this kind and ref. */
  ensure(kind: string, ref: string, dueAt: number) {
    if (this.dueAt(kind, ref) === null) this.set(kind, ref, dueAt);
  }

  /** Drops a deadline (no-op if absent) and re-arms the alarm. */
  clear(kind: string, ref: string) {
    const r = this.storage.sql.exec("DELETE FROM deadlines WHERE kind = ? AND ref = ?", kind, ref);
    if (r.rowsWritten > 0) this.rearm();
  }

  dueAt(kind: string, ref: string): number | null {
    const row = this.storage.sql
      .exec<{ due_at: number }>("SELECT due_at FROM deadlines WHERE kind = ? AND ref = ?", kind, ref)
      .toArray()[0];
    return row ? row.due_at : null;
  }

  /**
   * Runs everything that is due, then re-arms the alarm. Called from the Durable Object's `alarm()`.
   * The alarm is always set for the earliest deadline, so a firing runs at least that one even if the clock says it
   * is a moment early.
   */
  async run(now = Date.now()) {
    this.armed = undefined; // the alarm that woke us is spent
    const earliest = this.earliest();
    if (earliest !== null) {
      const cutoff = Math.max(now, earliest);
      const due = this.storage.sql
        .exec<{ kind: string; ref: string }>(
          "DELETE FROM deadlines WHERE due_at <= ? RETURNING kind, ref",
          cutoff,
        )
        .toArray();
      const byKind = new Map<string, string[]>();
      for (const { kind, ref } of due) byKind.set(kind, [...(byKind.get(kind) ?? []), ref]);
      for (const [kind, refs] of byKind) {
        const handler = this.handlers.get(kind);
        if (handler) await handler(refs, now);
        else console.warn(`deadline scheduler: no handler for "${kind}", dropped ${refs.length}`);
      }
    }
    this.rearm();
  }

  private earliest(): number | null {
    return this.storage.sql.exec<{ t: number | null }>("SELECT MIN(due_at) AS t FROM deadlines").one().t;
  }

  private rearm() {
    const next = this.earliest();
    if (next === this.armed) return;
    this.armed = next;
    const op = next === null ? this.storage.deleteAlarm() : this.storage.setAlarm(next);
    // Storage writes go through the output gate, so callers needn't await; only log failures.
    op.catch((e: unknown) => console.error("deadline scheduler: setting the alarm failed", e));
  }
}
