/**
 * Inform (GLOSSARY.md): pure rules for turning an InformInput into a stored notification, given the latest notification
 * with the same `(source, key)`. The InboxDO does the I/O (lookup, quota, save, broadcast, push).
 */
import { durationMs, type InformInput, type Notification, type SendOutcome } from "@oyee/schema";
import type { Actor } from "./model";

export interface InformResult {
  outcome: SendOutcome;
  /** One sentence for the sender: what happened and what to do next. */
  reason: string;
  notification: Notification;
}

/** A new inform. */
export function buildInform(
  id: string,
  input: InformInput,
  actor: Actor,
  now: string,
  targetDeviceIds: string[] | null,
): Extract<Notification, { intent: "inform" }> {
  return {
    id,
    intent: "inform",
    source: input.source ?? actor.defaultSource,
    key: input.key ?? null,
    title: input.title,
    body: input.body ?? null,
    severity: input.severity ?? "info",
    status: "active",
    url: input.url ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    readAt: null,
    resolvedAt: null,
    targetDeviceIds,
    inform: {
      links: input.links ?? [],
      fields: input.fields ?? [],
      image: input.image ?? null,
      icon: input.icon ?? null,
      cooldown: input.cooldown ?? null,
    },
  };
}

/** The latest notification with the fresh inform's `(source, key)`, and when that key last alerted. */
export interface KeyedLatest {
  n: Notification;
  /** ISO time of the key's last alert, whatever the notification's status. */
  alertedAt: string;
}

type InformNotification = Extract<Notification, { intent: "inform" }>;

/**
 * Applies a fresh inform to its key (spec "Keys", GLOSSARY "Cooldown"). Without a key, or with nothing (or another
 * intent) under it, the fresh one is created. Otherwise the fresh send's cooldown is measured from the key's last alert:
 * inside it, an active inform is updated silently (`updated_silently`) and a resolved one is left alone (`suppressed`,
 * the user already said "I know"); past it, or without a cooldown, an active inform
 * is updated and alerts again (`alerted`) and a resolved one is followed by a new one (`created`).
 */
export function applyInform(latest: KeyedLatest | null, fresh: InformNotification, now: string): InformResult {
  const key = fresh.key;
  const cooldown = fresh.inform.cooldown;
  const prev = latest?.n.intent === "inform" ? latest.n : null;
  if (key && latest && prev) {
    const nowMs = Date.parse(now);
    const cooldownEnds = cooldown ? Date.parse(latest.alertedAt) + durationMs(cooldown) : 0;
    const inside = nowMs < cooldownEnds;
    const until = `${new Date(cooldownEnds).toISOString()} (in ${span(cooldownEnds - nowMs)})`;
    if (inside && prev.status === "resolved") {
      const resolvedAt = prev.resolvedAt ?? prev.updatedAt;
      return {
        outcome: "suppressed",
        reason:
          `Changed nothing: the user resolved the notification with key "${key}" ${span(nowMs - Date.parse(resolvedAt))} ago ` +
          `(${resolvedAt}), inside its ${cooldown} cooldown. Sends with this key can alert again from ${until}.`,
        notification: prev,
      };
    }
    if (prev.status === "active") {
      const updated: InformNotification = {
        ...fresh,
        id: prev.id,
        createdAt: prev.createdAt,
        version: prev.version + 1,
        updatedAt: now,
        readAt: inside ? prev.readAt : null, // an alert makes it unread again; a silent update doesn't
      };
      if (inside) {
        return {
          outcome: "updated_silently",
          reason:
            `Updated the notification with key "${key}" without alerting: it alerted ${span(nowMs - Date.parse(latest.alertedAt))} ` +
            `ago, inside its ${cooldown} cooldown. The card shows the new text; sends with this key can alert again from ${until}.`,
          notification: updated,
        };
      }
      return {
        outcome: "alerted",
        reason:
          `Updated the notification with key "${key}" in place and alerted the user's devices again.` +
          (cooldown ? ` Sends with this key in the next ${cooldown} update it without alerting.` : ""),
        notification: updated,
      };
    }
  }
  const reason = !key
    ? "Created and alerted the user's devices. Give it a `key` next time to update it instead of sending a new one." +
      (cooldown ? " `cooldown` has no effect without a `key`." : "")
    : latest
      ? `Created a new notification for key "${key}" (the previous one is no longer active) and alerted the user's devices.`
      : `Created and alerted the user's devices. Send again with key "${key}" to update it instead of creating a new one.`;
  return { outcome: "created", reason, notification: fresh };
}

/** A rough duration for reasons: "45s", "12m", "3h 5m". */
function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
}
