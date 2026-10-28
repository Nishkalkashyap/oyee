/**
 * Herald Protocol v1 — TypeScript source of truth.
 * Human-readable spec: docs/protocol.md. Kotlin (apps/android) and Swift (apps/apple) models mirror this file.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

// ─── Primitives ──────────────────────────────────────────────────────────────

export const Severity = z.enum(["debug", "info", "success", "warning", "critical"]);
export type Severity = z.infer<typeof Severity>;

export const NotificationStatus = z.enum(["active", "resolved"]);
export type NotificationStatus = z.infer<typeof NotificationStatus>;

export const Platform = z.enum(["android", "ios", "macos", "web"]);
export type Platform = z.infer<typeof Platform>;

export const Transport = z.enum(["fcm", "websocket", "webpush"]);
export type Transport = z.infer<typeof Transport>;

export const TokenKind = z.enum(["webhook", "mcp"]);
export type TokenKind = z.infer<typeof TokenKind>;

const isoDate = z.string().datetime({ offset: true });
const httpsUrl = z.string().url().max(2048);

// ─── Card parts ──────────────────────────────────────────────────────────────

export const Field = z.object({
  label: z.string().min(1).max(40),
  value: z.string().max(200),
});
export type Field = z.infer<typeof Field>;

export const Progress = z.object({
  value: z.number().min(0),
  max: z.number().positive().default(100),
  label: z.string().max(64).optional(),
  indeterminate: z.boolean().default(false),
});
export type Progress = z.infer<typeof Progress>;

export const ActionCallback = z.object({
  url: httpsUrl,
  headers: z.record(z.string(), z.string()).optional(),
});
export type ActionCallback = z.infer<typeof ActionCallback>;

export const ActionStyle = z.enum(["default", "primary", "destructive"]);
export type ActionStyle = z.infer<typeof ActionStyle>;

export const Action = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  label: z.string().min(1).max(32),
  style: ActionStyle.default("default"),
  url: httpsUrl.optional(),
  callback: ActionCallback.optional(),
  resolves: z.boolean().default(false),
});
export type Action = z.infer<typeof Action>;

export const Reply = z.object({
  placeholder: z.string().max(64).optional(),
  buttonLabel: z.string().max(32).optional(),
});
export type Reply = z.infer<typeof Reply>;

export const Response = z.object({
  actionId: z.string().nullable(),
  text: z.string().max(2000).nullable(),
  deviceId: z.string().nullable(),
  deviceName: z.string().nullable(),
  at: isoDate,
});
export type Response = z.infer<typeof Response>;

// ─── Content fields shared by send / update / stored notification ───────────

export const CardContent = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(4000).nullable(),
  severity: Severity,
  icon: z.string().max(2048).nullable(),
  image: httpsUrl.nullable(),
  url: httpsUrl.nullable(),
  fields: z.array(Field).max(10),
  progress: Progress.nullable(),
  actions: z.array(Action).max(3),
  reply: Reply.nullable(),
  tags: z.array(z.string().min(1).max(32)).max(10),
  silent: z.boolean(),
});
export type CardContent = z.infer<typeof CardContent>;

// ─── Notification (stored / returned) ───────────────────────────────────────

export const Notification = CardContent.extend({
  id: z.string(),
  source: z.string().min(1).max(64),
  threadId: z.string().min(1).max(128).nullable(),
  status: NotificationStatus,
  template: z.string().nullable(),
  version: z.number().int().positive(),
  createdAt: isoDate,
  updatedAt: isoDate,
  readAt: isoDate.nullable(),
  resolvedAt: isoDate.nullable(),
  responses: z.array(Response).max(20),
});
export type Notification = z.infer<typeof Notification>;

// ─── Inputs ─────────────────────────────────────────────────────────────────

/** Create. `title` is required unless a template provides it (validated server-side after rendering). */
export const SendNotificationInput = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(4000).optional(),
  severity: Severity.optional(),
  source: z.string().min(1).max(64).optional(),
  threadId: z.string().min(1).max(128).optional(),
  icon: z.string().max(2048).optional(),
  image: httpsUrl.optional(),
  url: httpsUrl.optional(),
  fields: z.array(Field).max(10).optional(),
  progress: Progress.optional(),
  actions: z.array(Action).max(3).optional(),
  reply: Reply.optional(),
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
  silent: z.boolean().optional(),
  template: z.string().regex(/^[a-z0-9_-]{1,64}$/).optional(),
  vars: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  replaceKey: z.string().min(1).max(128).optional(),
});
export type SendNotificationInput = z.infer<typeof SendNotificationInput>;

/** Patch. `null` clears nullable fields. `alert: true` re-alerts devices. */
export const UpdateNotificationInput = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(4000).nullable().optional(),
  severity: Severity.optional(),
  icon: z.string().max(2048).nullable().optional(),
  image: httpsUrl.nullable().optional(),
  url: httpsUrl.nullable().optional(),
  fields: z.array(Field).max(10).optional(),
  progress: Progress.nullable().optional(),
  actions: z.array(Action).max(3).optional(),
  reply: Reply.nullable().optional(),
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
  silent: z.boolean().optional(),
  alert: z.boolean().optional(),
});
export type UpdateNotificationInput = z.infer<typeof UpdateNotificationInput>;

export const RespondInput = z
  .object({
    actionId: z.string().max(32).optional(),
    text: z.string().min(1).max(2000).optional(),
  })
  .refine((v) => v.actionId !== undefined || v.text !== undefined, {
    message: "actionId or text is required",
  });
export type RespondInput = z.infer<typeof RespondInput>;

export const ListNotificationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  source: z.string().optional(),
  severity: Severity.optional(),
  status: NotificationStatus.optional(),
  threadId: z.string().optional(),
  q: z.string().max(200).optional(),
  updatedSince: z.string().optional(),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuery>;

// ─── Templates ──────────────────────────────────────────────────────────────

export const TemplateName = z.string().regex(/^[a-z0-9_-]{1,64}$/);

/**
 * A template card is a partial send input whose strings may contain {{var}} / {{var|fallback}}.
 * URL fields are plain strings here (e.g. "image": "{{img}}"); the rendered result is validated as SendNotificationInput.
 */
const templateUrl = z.string().max(2048);
export const TemplateCard = SendNotificationInput.omit({ template: true, vars: true }).extend({
  image: templateUrl.optional(),
  url: templateUrl.optional(),
  actions: z
    .array(
      Action.extend({
        url: templateUrl.optional(),
        callback: ActionCallback.extend({ url: templateUrl }).optional(),
      }),
    )
    .max(3)
    .optional(),
});
export type TemplateCard = z.infer<typeof TemplateCard>;

export const Template = z.object({
  id: z.string(),
  name: TemplateName,
  description: z.string().max(500).nullable(),
  card: TemplateCard,
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Template = z.infer<typeof Template>;

export const UpsertTemplateInput = z.object({
  description: z.string().max(500).optional(),
  card: TemplateCard,
});
export type UpsertTemplateInput = z.infer<typeof UpsertTemplateInput>;

// ─── Users, tokens, devices ─────────────────────────────────────────────────

export const User = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type User = z.infer<typeof User>;

export const TokenInfo = z.object({
  id: z.string(),
  kind: TokenKind,
  label: z.string(),
  prefix: z.string(),
  defaultSource: z.string().nullable(),
  createdAt: isoDate,
  lastUsedAt: isoDate.nullable(),
});
export type TokenInfo = z.infer<typeof TokenInfo>;

export const CreateTokenInput = z.object({
  kind: TokenKind,
  label: z.string().min(1).max(64),
  defaultSource: z.string().min(1).max(64).optional(),
});
export type CreateTokenInput = z.infer<typeof CreateTokenInput>;

export const CreateTokenResult = z.object({
  token: TokenInfo,
  secret: z.string(),
  url: z.string(),
  /** HMAC key for X-Herald-Signature on action callbacks. Shown once. */
  callbackSecret: z.string().optional(),
});
export type CreateTokenResult = z.infer<typeof CreateTokenResult>;

export const Device = z.object({
  id: z.string(),
  name: z.string(),
  platform: Platform,
  transports: z.array(Transport),
  createdAt: isoDate,
  lastSeenAt: isoDate.nullable(),
});
export type Device = z.infer<typeof Device>;

export const PairingCode = z.object({
  code: z.string(),
  expiresAt: isoDate,
  deepLink: z.string(),
});
export type PairingCode = z.infer<typeof PairingCode>;

export const PairInput = z.object({
  code: z.string().min(8).max(9),
  name: z.string().min(1).max(64),
  platform: Platform.exclude(["web"]),
});
export type PairInput = z.infer<typeof PairInput>;

export const PairResult = z.object({ device: Device, token: z.string(), user: User });
export type PairResult = z.infer<typeof PairResult>;

export const UpdateSelfDeviceInput = z.object({
  name: z.string().min(1).max(64).optional(),
  fcmToken: z.string().max(4096).nullable().optional(),
});
export type UpdateSelfDeviceInput = z.infer<typeof UpdateSelfDeviceInput>;

export const WebPushSubscription = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export type WebPushSubscription = z.infer<typeof WebPushSubscription>;

export const RegisterWebDeviceInput = z.object({
  name: z.string().min(1).max(64),
  subscription: WebPushSubscription,
});
export type RegisterWebDeviceInput = z.infer<typeof RegisterWebDeviceInput>;

export const SourceSummary = z.object({
  source: z.string(),
  count: z.number().int(),
  unread: z.number().int(),
  lastAt: isoDate,
});
export type SourceSummary = z.infer<typeof SourceSummary>;

export const ServerConfig = z.object({
  version: z.string(),
  vapidPublicKey: z.string().nullable(),
  fcmEnabled: z.boolean(),
  devLogin: z.boolean(),
});
export type ServerConfig = z.infer<typeof ServerConfig>;

// ─── Generic envelopes ──────────────────────────────────────────────────────

export const ErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "payload_too_large",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export interface ApiError {
  error: { code: ErrorCode; message: string };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ─── WebSocket protocol ─────────────────────────────────────────────────────

export type UpdateReason = "update" | "read" | "resolved" | "responded";

export type ServerMessage =
  | { type: "hello"; userId: string; deviceId: string | null; serverTime: string }
  | { type: "notification.created"; notification: Notification }
  | { type: "notification.updated"; notification: Notification; alert: boolean; reason: UpdateReason }
  | { type: "notification.deleted"; id: string }
  | {
      type: "sync.result";
      notifications: Notification[];
      deletedIds: string[];
      cursor: string;
      hasMore: boolean;
    }
  | { type: "pong" };

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("sync"), since: z.string().nullable() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ─── Push payloads ──────────────────────────────────────────────────────────

export type PushEventType = "notification.created" | "notification.updated" | "notification.deleted";

/** FCM data map — all values are strings. `notification` omitted when too large (client then GETs it). */
export interface FcmData {
  type: PushEventType;
  id: string;
  version: string;
  alert: "true" | "false";
  notification?: string;
}

export interface WebPushPayload {
  type: PushEventType;
  id: string;
  notification: Notification | null;
}

// ─── MCP tool inputs ────────────────────────────────────────────────────────

export const McpAskInput = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  options: z.array(z.string().min(1).max(32)).max(3).optional(),
  allowText: z.boolean().optional(),
  severity: Severity.optional(),
  source: z.string().min(1).max(64).optional(),
  threadId: z.string().min(1).max(128).optional(),
});
export type McpAskInput = z.infer<typeof McpAskInput>;

export const McpWaitInput = z.object({
  id: z.string(),
  timeoutSeconds: z.number().int().min(1).max(55).default(50),
});
export type McpWaitInput = z.infer<typeof McpWaitInput>;

export type McpWaitResult = { status: "answered"; response: Response } | { status: "pending" };

// ─── Constants ──────────────────────────────────────────────────────────────

export const TOKEN_PREFIX = { webhook: "hrd_wh_", mcp: "hrd_mcp_", device: "hrd_dev_" } as const;
export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ANDROID_CHANNELS: Record<Severity, string> = {
  critical: "herald.critical",
  warning: "herald.warning",
  info: "herald.info",
  success: "herald.success",
  debug: "herald.debug",
};
export const LIMITS = {
  maxFields: 10,
  maxActions: 3,
  maxTags: 10,
  maxResponses: 20,
  maxBodyBytes: 64 * 1024,
  fcmInlineMaxBytes: 3500,
  retentionDays: 30,
  maxNotificationsPerUser: 5000,
  sendsPerMinutePerToken: 60,
} as const;

// ─── Template rendering (shared by server + web preview) ────────────────────

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.-]+)\s*(?:\|([^}]*))?\}\}/g;

export function renderTemplateString(
  input: string,
  vars: Record<string, string | number | boolean> = {},
): string {
  return input.replace(PLACEHOLDER, (_m, name: string, fallback?: string) => {
    const v = vars[name];
    return v === undefined ? (fallback ?? "") : String(v);
  });
}

/** Deep-renders every string in `value`. */
export function renderTemplateValue<T>(value: T, vars: Record<string, string | number | boolean> = {}): T {
  if (typeof value === "string") return renderTemplateString(value, vars) as T;
  if (Array.isArray(value)) return value.map((v) => renderTemplateValue(v, vars)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, renderTemplateValue(v, vars)]),
    ) as T;
  }
  return value;
}

/** Text progress bar used where native progress isn't available: "▓▓▓░░░░ 3/7". */
export function progressText(p: { value: number; max?: number; label?: string; indeterminate?: boolean }): string {
  if (p.indeterminate) return p.label ?? "In progress…";
  const max = p.max ?? 100;
  const ratio = Math.max(0, Math.min(1, p.value / max));
  const filled = Math.round(ratio * 10);
  const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
  return `${bar} ${p.label ?? (max === 100 ? `${Math.round(ratio * 100)}%` : `${p.value}/${max}`)}`;
}
