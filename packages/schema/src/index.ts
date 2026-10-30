/**
 * Oyee Protocol v1 — TypeScript source of truth.
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

// ─── Intents (protocol v2; GLOSSARY.md, docs/adr/0001-senders-send-intents.md) ─

/** What a sender means by a notification. Every notification is exactly one intent. */
export const Intent = z.enum(["inform", "ask", "progress"]);
export type Intent = z.infer<typeof Intent>;

/** Protocol v2 severities: every one alerts (`debug` is gone; muting is the receiver's choice). */
export const IntentSeverity = z.enum(["info", "success", "warning", "critical"]);
export type IntentSeverity = z.infer<typeof IntentSeverity>;

/** A duration such as "30s", "30m", "1h", "24h" (units s, m, h). */
export const Duration = z.string().regex(/^[1-9][0-9]{0,5}[smh]$/, 'expected a duration such as "30m" or "1h"');
export type Duration = z.infer<typeof Duration>;

/** Names a notification per source so later sends refer to the same one. Unique per `(source, key)`. */
export const Key = z.string().min(1).max(128);

/** A button that opens a URL on the device; nothing is sent back. */
export const LinkButton = z.object({
  label: z.string().min(1).max(32),
  url: httpsUrl,
});
export type LinkButton = z.infer<typeof LinkButton>;

export const InformBlock = z.object({
  links: z.array(LinkButton).max(3),
  fields: z.array(Field).max(10),
  image: httpsUrl.nullable(),
  /** Emoji or https URL. */
  icon: z.string().max(2048).nullable(),
  /** Minimum time between two alerts for this notification's key. */
  cooldown: Duration.nullable(),
});
export type InformBlock = z.infer<typeof InformBlock>;

/** `open` until the first answer (`answered`), its expiry (`expired`) or the sender withdrawing it (`withdrawn`). */
export const AskState = z.enum(["open", "answered", "expired", "withdrawn"]);
export type AskState = z.infer<typeof AskState>;

export const AskAnswer = z.object({
  /** Label of the answer button chosen, or null for a text answer. */
  option: z.string().nullable(),
  text: z.string().max(2000).nullable(),
  deviceId: z.string().nullable(),
  deviceName: z.string().nullable(),
  at: isoDate,
});
export type AskAnswer = z.infer<typeof AskAnswer>;

export const AskBlock = z.object({
  /** Answer-button labels. */
  options: z.array(z.string().min(1).max(32)).max(3),
  /** Whether a free-text answer is accepted. */
  allowText: z.boolean(),
  replyPlaceholder: z.string().max(64).nullable(),
  expiresAt: isoDate,
  /** The first answer, from any device. */
  answer: AskAnswer.nullable(),
  state: AskState,
});
export type AskBlock = z.infer<typeof AskBlock>;

/** `stopped` = Stopped reporting: the sender went quiet for longer than `staleAfter`; a later update revives it. */
export const ProgressState = z.enum(["running", "done", "failed", "stopped"]);
export type ProgressState = z.infer<typeof ProgressState>;

export const ProgressBlock = z.object({
  value: z.number().min(0),
  max: z.number().positive(),
  label: z.string().max(64).optional(),
  state: ProgressState,
  /** How long the progress may go quiet before it counts as stopped. */
  staleAfter: Duration,
  lastReportAt: isoDate,
});
export type ProgressBlock = z.infer<typeof ProgressBlock>;

/** How a sender reports progress: `running` while working, then `done` or `failed` once. */
export const ProgressStatus = z.enum(["running", "done", "failed"]);
export type ProgressStatus = z.infer<typeof ProgressStatus>;

/**
 * Report long-running work (MCP `progress`). Called repeatedly with the same `key`: the first report appears without
 * sound, later ones update it silently, `done` / `failed` alert once. Omitted fields keep the previous report's value.
 */
export const ProgressInput = z.object({
  key: Key.describe("Names this task, e.g. \"deploy-api\". Reuse it on every report so they update one notification."),
  title: z.string().min(1).max(200).describe("What is running, e.g. \"Deploying api to prod\"."),
  value: z.number().min(0).optional().describe("Work done so far, out of `max`. With status done it defaults to `max`."),
  max: z.number().positive().optional().describe("Total amount of work (default 100, so `value` is a percentage)."),
  label: z.string().max(64).optional().describe("Short text next to the bar, e.g. \"3/7 checks\" (default: the percent)."),
  status: ProgressStatus.default("running").describe(
    "running (default): update silently. done: finished well, alerts once. failed: finished badly, alerts once.",
  ),
  staleAfter: Duration.refine(
    (d) => durationMs(d) >= durationMs(LIMITS.minStaleAfter) && durationMs(d) <= durationMs(LIMITS.maxStaleAfter),
    { error: () => `staleAfter must be between ${LIMITS.minStaleAfter} and ${LIMITS.maxStaleAfter}` },
  )
    .optional()
    .describe(
      'How long this may go without a report before the user is told it stopped reporting, e.g. "2h" for a long ' +
        'silent step (default "30m", from "1m" to "24h"). A later report revives it.',
    ),
  body: z.string().max(4000).optional().describe("Detail under the title. Markdown: **bold**, _italic_, `code`, links."),
  url: httpsUrl.optional().describe("Opens when the user taps the notification, e.g. the build log."),
  source: z.string().min(1).max(64).optional().describe("Who is reporting (defaults to this connection's name)."),
  devices: z
    .array(z.string().min(1).max(64))
    .max(20)
    .optional()
    .describe("Alert only these devices (names or ids from list_devices). Default: every device."),
  platforms: z.array(Platform).max(4).optional().describe("Alert only devices on these platforms (android, macos, web, ios)."),
});
export type ProgressInput = z.infer<typeof ProgressInput>;

/** Fields every intent shares. */
export const NotificationShared = z.object({
  id: z.string(),
  source: z.string().min(1).max(64),
  key: Key.nullable(),
  title: z.string().min(1).max(200),
  body: z.string().max(4000).nullable(),
  severity: IntentSeverity,
  status: NotificationStatus,
  /** Opens when the notification is tapped. */
  url: httpsUrl.nullable(),
  version: z.number().int().positive(),
  createdAt: isoDate,
  updatedAt: isoDate,
  readAt: isoDate.nullable(),
  resolvedAt: isoDate.nullable(),
  /**
   * Devices that get a system notification / push for this item. `null` (or absent, for older items) = every device.
   * Every inbox still lists the notification; only alerting is targeted.
   */
  targetDeviceIds: z.array(z.string()).nullable().optional(),
});

export const InformNotification = NotificationShared.extend({ intent: z.literal("inform"), inform: InformBlock });
export const AskNotification = NotificationShared.extend({ intent: z.literal("ask"), ask: AskBlock });
export const ProgressNotification = NotificationShared.extend({ intent: z.literal("progress"), progress: ProgressBlock });

/**
 * Protocol v2 notification: shared fields plus exactly one block, named after its intent. Every intent in every state,
 * as shared test fixtures for all clients: packages/schema/fixtures/notifications.v2.json.
 */
export const IntentNotification = z.discriminatedUnion("intent", [InformNotification, AskNotification, ProgressNotification]);
export type IntentNotification = z.infer<typeof IntentNotification>;

// ─── Notification (stored / returned) ───────────────────────────────────────

/** Protocol v1 flat card as stored and sent before intents. Removed with the flat card (ticket 15). */
export const FlatNotification = CardContent.extend({
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
  /**
   * Devices that get a system notification / push for this item. `null` (or absent, for older items) = every device.
   * Every inbox still lists the notification; only alerting is targeted.
   */
  targetDeviceIds: z.array(z.string()).nullable().optional(),
});
export type FlatNotification = z.infer<typeof FlatNotification>;

const flatOnly = FlatNotification.omit({ progress: true }).shape;

/**
 * The stored / wire notification while both protocols overlap: the v2 intent shape plus every v1 flat field, so
 * older app builds keep rendering. `progress` is the v1 bar on inform/ask and the v2 block (a superset of the v1 bar)
 * on progress. Becomes IntentNotification when the flat card is removed.
 */
export const Notification = z.discriminatedUnion("intent", [
  InformNotification.extend({ ...flatOnly, progress: Progress.nullable() }),
  AskNotification.extend({ ...flatOnly, progress: Progress.nullable() }),
  ProgressNotification.extend({ ...flatOnly, progress: ProgressBlock.extend({ indeterminate: z.boolean().default(false) }) }),
]);
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
  /** Deliver only to these devices: ids (`dev_…`) or names (case-insensitive; a unique partial match works). */
  devices: z.array(z.string().min(1).max(64)).max(20).optional(),
  /** Deliver only to devices on these platforms. Combined with `devices` as a union. */
  platforms: z.array(Platform).max(4).optional(),
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
    /** The label of an ask's answer button (protocol v2; `actionId` is the v1 way to pick one). */
    option: z.string().min(1).max(32).optional(),
    text: z.string().min(1).max(2000).optional(),
  })
  .refine((v) => v.actionId !== undefined || v.option !== undefined || v.text !== undefined, {
    message: "option, actionId or text is required",
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

// ─── Intent inputs (protocol v2): one set of shared fields, one schema per intent ─
// Each is a flat object (no oneOf) because it is also an MCP tool's input schema; every field is described.

/** Fields every intent input shares, with the same names for every sender. */
export const IntentInputShared = {
  title: z.string().min(1).max(200).describe("Headline, at most 200 characters. The only required field."),
  body: z
    .string()
    .max(4000)
    .optional()
    .describe("Detail in markdown (bold, italic, `code`, links, line breaks), at most 4000 characters."),
  url: httpsUrl.optional().describe("Opens when the user taps the notification."),
  key: Key.optional().describe(
    "Names this notification so a later send with the same key (from the same source) updates it instead of creating a duplicate.",
  ),
  source: z.string().min(1).max(64).optional().describe("Who is sending, shown on the card. Defaults to the token's name."),
  devices: z
    .array(z.string().min(1).max(64))
    .max(20)
    .optional()
    .describe('Alert only these devices: names or ids from list_devices (a unique partial name such as "macbook" works). Default: every device.'),
  platforms: z
    .array(Platform)
    .max(4)
    .optional()
    .describe("Alert only devices on these platforms; combined with `devices` as a union."),
};

/** Something the user should know. */
export const InformInput = z.object({
  ...IntentInputShared,
  severity: IntentSeverity.optional().describe(
    "How urgently the user needs this. info: routine news (default). success: something finished well. " +
      "warning: needs attention soon. critical: broken now, act immediately. Every severity alerts.",
  ),
  links: z.array(LinkButton).max(3).optional().describe("Up to 3 link buttons (label + url), e.g. the PR, the build log, a dashboard."),
  fields: z.array(Field).max(10).optional().describe("Up to 10 label/value rows for structured facts (region, duration, commit)."),
  image: httpsUrl
    .refine((u) => u.startsWith("https://"), "image must be an https URL")
    .optional()
    .describe("https URL of an image shown on the card, such as a chart or screenshot."),
  icon: z.string().min(1).max(2048).optional().describe("An emoji or an https image URL shown next to the title."),
  cooldown: Duration.refine(
    (d) => durationMs(d) >= durationMs(LIMITS.minCooldown) && durationMs(d) <= durationMs(LIMITS.maxCooldown),
    { error: () => `cooldown must be between ${LIMITS.minCooldown} and ${LIMITS.maxCooldown}` },
  )
    .optional()
    .describe(
      'With `key`: alert at most once per this duration (such as "30m", "1h", "24h"; units s, m, h; 1m to 168h). ' +
        "Sends inside it update the notification silently, or change nothing if the user resolved it.",
    ),
});
export type InformInput = z.infer<typeof InformInput>;

/**
 * What a send did. `created`: a new notification, alerted. `alerted`: the keyed one was updated and alerted again.
 * `updated_silently`: updated without alerting (inside the cooldown). `suppressed`: nothing changed. `reused` (ask): an
 * open ask with the same key was returned instead.
 */
export const SendOutcome = z.enum(["created", "updated_silently", "alerted", "suppressed", "reused"]);
export type SendOutcome = z.infer<typeof SendOutcome>;

/**
 * Webhook and REST send body (`POST /hook/:token`, `POST /api/notifications`): an intent input tagged with `intent`,
 * the same field names as the MCP tools. Senders may omit `intent` (it defaults to `inform`); ask is for agents over
 * MCP, so it isn't accepted here.
 */
export const IntentSendInput = z.discriminatedUnion("intent", [
  InformInput.extend({ intent: z.literal("inform") }),
  ProgressInput.extend({ intent: z.literal("progress") }),
]);
export type IntentSendInput = z.infer<typeof IntentSendInput>;
/** What a sender writes (defaults not yet applied), e.g. the web composer's request body. */
export type IntentSendBody = z.input<typeof IntentSendInput>;

/** The answer to a webhook or REST send: what happened (SendOutcome) and why, in one sentence. */
export interface IntentSendResult {
  id: string;
  version: number;
  outcome: SendOutcome;
  reason: string;
}

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
  /** HMAC key for X-Oyee-Signature on action callbacks. Shown once. */
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

export const RenameDeviceInput = z.object({ name: z.string().trim().min(1).max(64) });
export type RenameDeviceInput = z.infer<typeof RenameDeviceInput>;

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

/** wait_for_response holds at most this long (exported as LIMITS.askWaitSeconds; defined here because LIMITS comes later). */
const ASK_WAIT_SECONDS = 50;

/**
 * Ask: a question for the user (GLOSSARY.md). Agents only, over MCP; they poll the answer with wait_for_response.
 * Always alerts at `warning`. With neither `options` nor `allowText`, a reply box is added.
 */
export const AskInput = z.object({
  title: z.string().min(1).max(200).describe("The question, short enough for a notification title."),
  body: z
    .string()
    .max(4000)
    .optional()
    .describe("Context for the decision. Markdown subset: **bold**, *italic*, `code`, [links](https://…), line breaks."),
  options: z
    .array(z.string().min(1).max(32))
    .max(3)
    .optional()
    .describe("Up to 3 answer-button labels, e.g. [\"Approve\", \"Reject\"]. The label tapped is the answer."),
  allowText: z.boolean().optional().describe("Also accept a typed answer. Implied when there are no options."),
  url: httpsUrl.optional().describe("Opens when the user taps the notification, e.g. the PR to review before answering."),
  key: Key.optional().describe(
    "Names this question. Asking again with the key of an open ask returns that ask instead of alerting again.",
  ),
  source: z.string().min(1).max(64).optional().describe("Who is asking. Defaults to the token's label."),
  devices: z
    .array(z.string().min(1).max(64))
    .max(20)
    .optional()
    .describe("Alert only these devices: names or ids from list_devices (a unique partial name such as \"macbook\" works)."),
  platforms: z.array(Platform).max(4).optional().describe("Alert only devices on these platforms (union with devices)."),
});
export type AskInput = z.infer<typeof AskInput>;

export const McpWaitInput = z.object({
  id: z.string().describe("The id returned by ask (ntf_…)."),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(ASK_WAIT_SECONDS)
    .default(ASK_WAIT_SECONDS)
    .describe(`How long to hold for an answer, at most ${ASK_WAIT_SECONDS} s. Call again while it is pending.`),
});
export type McpWaitInput = z.infer<typeof McpWaitInput>;

/** wait_for_response: the first answer, or still pending (with when it was asked, so the agent needs no date maths). */
export type McpWaitResult =
  | { status: "answered"; answer: AskAnswer; askedAt: string }
  | { status: "pending"; askedAt: string; expiresAt: string | null };

// ─── Constants ──────────────────────────────────────────────────────────────

export const TOKEN_PREFIX = { webhook: "oyee_wh_", mcp: "oyee_mcp_", device: "oyee_dev_" } as const;
export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ANDROID_CHANNELS: Record<Severity, string> = {
  critical: "oyee.critical",
  warning: "oyee.warning",
  info: "oyee.info",
  success: "oyee.success",
  debug: "oyee.debug",
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
  maxDevicesPerUser: 10,
  maxTokensPerUser: 20,
  maxTemplatesPerUser: 100,
  /** Pushes for updates to one notification are coalesced to at most one per interval (the socket gets every one). */
  updatePushIntervalMs: 2000,
  signupsPerIpPerDay: 5,
  authFailuresPerIpPerMinute: 30,
  /** An ask closes this long after it was sent unless the sender says otherwise. */
  defaultAskExpiry: "1h",
  /** A progress quiet for this long counts as Stopped reporting unless the sender says otherwise. */
  defaultStaleAfter: "30m",
  /** Bounds of a progress's `staleAfter`. */
  minStaleAfter: "1m",
  maxStaleAfter: "24h",
  /** wait_for_response holds for an answer at most this long. */
  askWaitSeconds: ASK_WAIT_SECONDS,
  /** list_notifications (MCP) returns this many items unless asked for more, and at most `maxListPage`. */
  defaultListPage: 10,
  maxListPage: 50,
  /** Bounds of an inform's `cooldown` (the minimum time between two alerts for its key). */
  minCooldown: "1m",
  maxCooldown: "168h",
} as const satisfies Record<string, number | Duration>;

// ─── MCP list_notifications ─────────────────────────────────────────────────

export const McpListInput = z.object({
  key: Key.optional().describe("Only notifications with this key."),
  intent: Intent.optional().describe("Only this intent: inform, ask or progress."),
  status: NotificationStatus.optional().describe("active (still on the user's devices) or resolved."),
  source: z.string().min(1).max(64).optional().describe("Only notifications from this source."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.maxListPage)
    .default(LIMITS.defaultListPage)
    .describe(`How many to return, newest first (default ${LIMITS.defaultListPage}, at most ${LIMITS.maxListPage}).`),
  cursor: z.string().optional().describe("nextCursor from the previous page, to get older notifications."),
});
export type McpListInput = z.infer<typeof McpListInput>;

/** One list_notifications item: only what an agent needs, with the age precomputed ("12m") so it needs no date maths. */
export interface McpListItem {
  id: string;
  intent: Intent;
  key: string | null;
  title: string;
  status: NotificationStatus;
  /** ask: open | answered | expired | withdrawn; progress: running | done | failed | stopped; inform: null. */
  state: AskState | ProgressState | null;
  /** An ask's answer; null otherwise. */
  answer: { option: string | null; text: string | null; device: string | null } | null;
  createdAt: string;
  ago: string;
}

// ─── Quotas (per account; docs/protocol.md §3.1) ─────────────────────────────

export const QuotaKind = z.enum(["send", "update", "respond", "read", "pairing"]);
export type QuotaKind = z.infer<typeof QuotaKind>;

/** Daily limits reset at 00:00 UTC; per-minute limits use fixed one-minute windows. */
export const QUOTAS: Record<QuotaKind, { perDay: number; perMinute: number | null; label: string }> = {
  send: { perDay: 1000, perMinute: 120, label: "Notifications sent" },
  update: { perDay: 5000, perMinute: null, label: "Updates" },
  respond: { perDay: 1000, perMinute: 30, label: "Replies and actions" },
  read: { perDay: 20000, perMinute: 300, label: "Reads" },
  pairing: { perDay: 20, perMinute: 5, label: "Pairing codes" },
};

export const Usage = z.object({
  day: z.string(),
  resetsAt: isoDate,
  items: z.array(z.object({ kind: QuotaKind, label: z.string(), used: z.number().int(), limit: z.number().int() })),
});
export type Usage = z.infer<typeof Usage>;

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

// ─── Durations ──────────────────────────────────────────────────────────────

const DURATION_UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000 } as const;

/** "30m" → 1_800_000. */
export function durationMs(d: Duration): number {
  const unit = d.slice(-1) as keyof typeof DURATION_UNIT_MS;
  return Number(d.slice(0, -1)) * DURATION_UNIT_MS[unit];
}

// ─── Flat card → intent (expand step; removed with the flat card) ───────────

/** A flat-card button is a link button when it only opens a URL. */
export const isLinkAction = (a: Pick<Action, "url" | "callback">): boolean => a.url !== undefined && !a.callback;

/**
 * Infers the intent block of a flat (protocol v1) card: non-link actions or a reply → ask; progress → progress;
 * otherwise inform (link actions become links). `legacy` is for cards stored before intents existed, whose sender can
 * no longer act: an unanswered ask is `expired` and an unfinished progress has `stopped`. Live cards are `open`
 * (`withdrawn` once resolved unanswered) and `running` (`done` at max).
 */
export function inferIntent(
  n: FlatNotification & { key?: string | null },
  opts: { legacy?: boolean } = {},
): Notification {
  const { inform: _i, ask: _a, intent: _t, ...rest } = n as FlatNotification & Partial<Record<"inform" | "ask" | "intent", unknown>>;
  const flat = { ...rest, key: n.key ?? null };
  if (n.actions.some((a) => !isLinkAction(a)) || n.reply) {
    const last = n.responses[n.responses.length - 1];
    const answer: AskAnswer | null = last
      ? {
          option: last.actionId === null ? null : (n.actions.find((a) => a.id === last.actionId)?.label ?? last.actionId),
          text: last.text,
          deviceId: last.deviceId,
          deviceName: last.deviceName,
          at: last.at,
        }
      : null;
    const state: AskState = answer ? "answered" : opts.legacy ? "expired" : n.status === "resolved" ? "withdrawn" : "open";
    return {
      ...flat,
      intent: "ask",
      ask: {
        options: n.actions.filter((a) => !isLinkAction(a)).map((a) => a.label),
        allowText: n.reply !== null,
        replyPlaceholder: n.reply?.placeholder ?? null,
        expiresAt: new Date(Date.parse(n.createdAt) + durationMs(LIMITS.defaultAskExpiry)).toISOString(),
        answer,
        state,
      },
    };
  }
  if (n.progress) {
    const p = n.progress;
    const atMax = !p.indeterminate && p.value >= p.max;
    // Re-inferring a stored progress (read, resolve…) keeps how its sender finished it, whether it stopped reporting,
    // and when it last reported.
    const prior = p as Partial<ProgressBlock>;
    const kept = prior.state === "done" || prior.state === "failed" || prior.state === "stopped" ? prior.state : null;
    return {
      ...flat,
      intent: "progress",
      progress: {
        ...p,
        state: kept ?? (atMax ? "done" : opts.legacy ? "stopped" : "running"),
        staleAfter: prior.staleAfter ?? LIMITS.defaultStaleAfter,
        lastReportAt: prior.lastReportAt ?? n.updatedAt,
      },
    };
  }
  return {
    ...flat,
    intent: "inform",
    inform: {
      links: n.actions.filter(isLinkAction).map((a) => ({ label: a.label, url: a.url! })),
      fields: n.fields,
      image: n.image,
      icon: n.icon,
      cooldown: null,
    },
  };
}

/**
 * What every client shows for a progress that stopped reporting: "Stopped reporting after <last label or percent>",
 * e.g. "Stopped reporting after 3/7 checks" or "Stopped reporting after 40%". The stored `label` stays the sender's.
 */
export function stoppedReportingLabel(p: { value: number; max: number; label?: string }): string {
  const ratio = p.max > 0 ? Math.max(0, Math.min(1, p.value / p.max)) : 0;
  return `Stopped reporting after ${p.label ?? `${Math.round(ratio * 100)}%`}`;
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
