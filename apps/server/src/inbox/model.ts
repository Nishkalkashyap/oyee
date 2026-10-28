/** Pure notification logic shared by the InboxDO: building, template rendering, patching. */
import {
  LIMITS,
  SendNotificationInput,
  renderTemplateValue,
  type Notification,
  type Response as HeraldResponse,
  type Template,
  type UpdateNotificationInput,
} from "@herald/schema";
import { badRequest, parseOrThrow } from "../lib/errors";

/** Who is acting. Passed with every InboxDO call. */
export interface Actor {
  userId: string;
  /** Device that performed the action (device token), if any. */
  deviceId: string | null;
  deviceName: string | null;
  /** Webhook/MCP token used to send, if any (rate limit + callback signing). */
  tokenId: string | null;
  /** Default `source` for sends: token label/defaultSource, "web" or the device name. */
  defaultSource: string;
}

export interface SendOptions {
  /** Webhook rule: if no title, use the first body line (≤200 chars) or "Notification". */
  titleFallback?: boolean;
  /** Apply the per-token rate limit (webhook/MCP). */
  rateLimit?: boolean;
}

export type SendInput = SendNotificationInput;

/**
 * Renders the template (if any) and applies explicit overrides (shallow merge), returning a validated send input
 * plus the resolved title.
 */
export function resolveSendInput(input: SendInput, template: Template | null, opts: SendOptions = {}): SendInput & { title: string } {
  let merged: Record<string, unknown> = {};
  if (template) {
    merged = renderTemplateValue(structuredClone(template.card) as Record<string, unknown>, input.vars ?? {});
  }
  for (const [k, v] of Object.entries(input)) {
    if (k === "vars") continue;
    if (v !== undefined) merged[k] = v;
  }
  if (template) merged.template = template.name;

  // Template-rendered strings may be empty (e.g. "{{missing}}"); treat empty optional strings as absent.
  for (const k of ["body", "icon", "image", "url", "threadId", "source", "replaceKey"] as const) {
    if (merged[k] === "") delete merged[k];
  }

  if ((merged.title === undefined || merged.title === "") && opts.titleFallback) {
    const firstLine = typeof merged.body === "string" ? merged.body.split(/\r?\n/).find((l) => l.trim() !== "") : undefined;
    merged.title = firstLine ? firstLine.trim().slice(0, 200) : "Notification";
  }
  if (merged.title === undefined || merged.title === "") {
    throw badRequest(template ? `title: required (template "${template.name}" doesn't provide one)` : "title: required");
  }
  const parsed = parseOrThrow(SendNotificationInput, merged);
  return parsed as SendInput & { title: string };
}

export function buildNotification(
  id: string,
  input: SendInput & { title: string },
  actor: Actor,
  now: string,
): Notification {
  return {
    id,
    source: input.source ?? actor.defaultSource,
    threadId: input.threadId ?? null,
    title: input.title,
    body: input.body ?? null,
    severity: input.severity ?? "info",
    status: "active",
    icon: input.icon ?? null,
    image: input.image ?? null,
    url: input.url ?? null,
    fields: input.fields ?? [],
    progress: input.progress ?? null,
    actions: input.actions ?? [],
    reply: input.reply ?? null,
    tags: input.tags ?? [],
    silent: input.silent ?? false,
    template: input.template ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    readAt: null,
    resolvedAt: null,
    responses: [],
  };
}

/** replaceKey dedupe: the new send replaces the card content of the existing active notification. */
export function replaceContent(existing: Notification, fresh: Notification, now: string): Notification {
  return {
    ...fresh,
    id: existing.id,
    createdAt: existing.createdAt,
    responses: existing.responses,
    version: existing.version + 1,
    updatedAt: now,
    readAt: null, // a re-send re-alerts, so it's unread again
  };
}

const PATCHABLE = [
  "title",
  "body",
  "severity",
  "icon",
  "image",
  "url",
  "fields",
  "progress",
  "actions",
  "reply",
  "tags",
  "silent",
] as const;

export function applyPatch(n: Notification, patch: UpdateNotificationInput, now: string): Notification {
  const next: Notification = { ...n };
  for (const k of PATCHABLE) {
    const v = patch[k];
    if (v === undefined) continue;
    (next as Record<string, unknown>)[k] = v;
  }
  assertUniqueActionIds(next.actions);
  next.version = n.version + 1;
  next.updatedAt = now;
  return next;
}

export function assertUniqueActionIds(actions: Notification["actions"]): void {
  const seen = new Set<string>();
  for (const a of actions) {
    if (seen.has(a.id)) throw badRequest(`actions: duplicate action id "${a.id}"`);
    seen.add(a.id);
  }
}

export function appendResponse(n: Notification, r: HeraldResponse): HeraldResponse[] {
  return [...n.responses, r].slice(-LIMITS.maxResponses);
}

/** Lowercased text used for `q` search. */
export function searchText(n: Notification): string {
  return [n.title, n.body ?? "", n.source, n.tags.join(" "), n.fields.map((f) => `${f.label} ${f.value}`).join(" ")]
    .join("\n")
    .toLowerCase();
}
