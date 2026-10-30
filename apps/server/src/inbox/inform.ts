/**
 * Inform (GLOSSARY.md): pure rules for turning an InformInput into a stored notification, given the latest notification
 * with the same `(source, key)`. The InboxDO does the I/O (lookup, quota, save, broadcast, push).
 */
import type { InformInput, Notification, SendOutcome } from "@oyee/schema";
import type { Actor } from "./model";

export interface InformResult {
  outcome: SendOutcome;
  /** One sentence for the sender: what happened and what to do next. */
  reason: string;
  notification: Notification;
}

/** A new inform, carrying the flat (protocol v1) card fields too so older app builds keep rendering it. */
export function buildInform(
  id: string,
  input: InformInput,
  actor: Actor,
  now: string,
  targetDeviceIds: string[] | null,
): Extract<Notification, { intent: "inform" }> {
  const links = input.links ?? [];
  const fields = input.fields ?? [];
  const image = input.image ?? null;
  const icon = input.icon ?? null;
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
    inform: { links, fields, image, icon, cooldown: null },
    // flat card (removed in ticket 15)
    threadId: null,
    icon,
    image,
    fields,
    progress: null,
    actions: links.map((l, i) => ({ id: `link_${i + 1}`, label: l.label, url: l.url, style: "default", resolves: false })),
    reply: null,
    tags: [],
    silent: false,
    template: null,
    responses: [],
  };
}

/**
 * Applies a fresh inform to its key: the latest notification for the key, if it is an active inform, is updated in
 * place and alerts again; otherwise (no key, nothing under the key, or the latest one is resolved or another intent)
 * the fresh one is created.
 */
export function applyInform(latest: Notification | null, fresh: Extract<Notification, { intent: "inform" }>, now: string): InformResult {
  const key = fresh.key;
  if (key && latest?.intent === "inform" && latest.status === "active") {
    return {
      outcome: "alerted",
      reason: `Updated the notification with key "${key}" in place and alerted the user's devices again.`,
      notification: {
        ...fresh,
        id: latest.id,
        createdAt: latest.createdAt,
        version: latest.version + 1,
        updatedAt: now,
        readAt: null, // it alerted again, so it's unread again
      },
    };
  }
  const reason = !key
    ? "Created and alerted the user's devices. Give it a `key` next time to update it instead of sending a new one."
    : latest
      ? `Created a new notification for key "${key}" (the previous one is no longer active) and alerted the user's devices.`
      : `Created and alerted the user's devices. Send again with key "${key}" to update it instead of creating a new one.`;
  return { outcome: "created", reason, notification: fresh };
}
