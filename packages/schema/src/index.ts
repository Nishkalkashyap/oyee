/**
 * Oyee Protocol v2 — TypeScript source of truth.
 * Every notification is one intent (inform, ask, progress): GLOSSARY.md, docs/adr/0001-senders-send-intents.md.
 * Human-readable spec: docs/protocol.md. Kotlin (apps/android) and Swift (apps/apple) models mirror this file.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 2;

// ─── Primitives ──────────────────────────────────────────────────────────────

/** How urgently a notification needs the user. Every severity alerts; muting is the receiver's choice. */
export const Severity = z.enum(["info", "success", "warning", "critical"]);
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

/** A duration such as "30s", "30m", "1h", "24h" (units s, m, h). */
export const Duration = z.string().regex(/^[1-9][0-9]{0,5}[smh]$/, 'expected a duration such as "30m" or "1h"');
export type Duration = z.infer<typeof Duration>;

const DURATION_UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000 } as const;

/** "30m" → 1_800_000. */
export function durationMs(d: Duration): number {
  const unit = d.slice(-1) as keyof typeof DURATION_UNIT_MS;
  return Number(d.slice(0, -1)) * DURATION_UNIT_MS[unit];
}

// ─── Limits ──────────────────────────────────────────────────────────────────

export const LIMITS = {
  maxFields: 10,
  maxLinks: 3,
  maxOptions: 3,
  maxBodyBytes: 64 * 1024,
  fcmInlineMaxBytes: 3500,
  retentionDays: 30,
  maxNotificationsPerUser: 5000,
  sendsPerMinutePerToken: 60,
  maxDevicesPerUser: 10,
  maxTokensPerUser: 20,
  /** Pushes for updates to one notification are coalesced to at most one per interval (the socket gets every one). */
  updatePushIntervalMs: 2000,
  signupsPerIpPerDay: 5,
  authFailuresPerIpPerMinute: 30,
  /** An ask closes this long after it was sent unless the sender says otherwise. */
  defaultAskExpiry: "1h",
  /** The longest `expiresIn` an ask may set. */
  maxAskExpiry: "24h",
  /** A progress quiet for this long counts as Stopped reporting unless the sender says otherwise. */
  defaultStaleAfter: "30m",
  /** Bounds of a progress's `staleAfter`. */
  minStaleAfter: "1m",
  maxStaleAfter: "24h",
  /** wait_for_response holds for an answer at most this long. */
  askWaitSeconds: 50,
  /** list_notifications (MCP) returns this many items unless asked for more, and at most `maxListPage`. */
  defaultListPage: 10,
  maxListPage: 50,
  /** Bounds of an inform's `cooldown` (the minimum time between two alerts for its key). */
  minCooldown: "1m",
  maxCooldown: "168h",
} as const satisfies Record<string, number | Duration>;

/** A duration within [min, max], with an error naming the field and its bounds. */
const boundedDuration = (field: string, min: Duration, max: Duration) =>
  Duration.refine((d) => durationMs(d) >= durationMs(min) && durationMs(d) <= durationMs(max), {
    error: () => `${field} must be between ${min} and ${max}`,
  });

// ─── Notification parts ──────────────────────────────────────────────────────

/** What a sender means by a notification. Every notification is exactly one intent. */
export const Intent = z.enum(["inform", "ask", "progress"]);
export type Intent = z.infer<typeof Intent>;

/** Names a notification per source so later sends refer to the same one. Unique per `(source, key)`. */
export const Key = z.string().min(1).max(128);

export const Field = z.object({
  label: z.string().min(1).max(40),
  value: z.string().max(200),
});
export type Field = z.infer<typeof Field>;

/** A button that opens a URL on the device; nothing is sent back. */
export const LinkButton = z.object({
  label: z.string().min(1).max(32),
  url: httpsUrl,
});
export type LinkButton = z.infer<typeof LinkButton>;

export const InformBlock = z.object({
  links: z.array(LinkButton).max(LIMITS.maxLinks),
  fields: z.array(Field).max(LIMITS.maxFields),
  image: httpsUrl.nullable(),
  /** Emoji or https URL, shown next to the title. Only informs have one. */
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
  options: z.array(z.string().min(1).max(32)).max(LIMITS.maxOptions),
  /** Whether a free-text answer is accepted. */
  allowText: z.boolean(),
  /** Hint for the reply box; clients show their own ("Reply…") when it is null. */
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

// ─── Notification (stored / returned) ───────────────────────────────────────

/** Fields every intent shares. */
export const NotificationShared = z.object({
  id: z.string(),
  source: z.string().min(1).max(64),
  key: Key.nullable(),
  title: z.string().min(1).max(200),
  body: z.string().max(4000).nullable(),
  severity: Severity,
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
 * The stored / wire notification: shared fields plus exactly one block, named after its intent. Every intent in every
 * state, as shared test fixtures for all clients: packages/schema/fixtures/notifications.v2.json.
 */
export const Notification = z.discriminatedUnion("intent", [InformNotification, AskNotification, ProgressNotification]);
export type Notification = z.infer<typeof Notification>;

// ─── Intent inputs: one shared base, one schema per intent ──────────────────
// Each is a flat object (no oneOf) because it is also an MCP tool's input schema; every field is described.

/** Fields every intent input shares, with the same names for every sender. */
export const IntentInputBase = z.object({
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
});

/** Something the user should know. */
export const InformInput = IntentInputBase.extend({
  severity: Severity.optional().describe(
    "How urgently the user needs this. info: routine news (default). success: something finished well. " +
      "warning: needs attention soon. critical: broken now, act immediately. Every severity alerts.",
  ),
  links: z
    .array(LinkButton)
    .max(LIMITS.maxLinks)
    .optional()
    .describe(`Up to ${LIMITS.maxLinks} link buttons (label + url), e.g. the PR, the build log, a dashboard.`),
  fields: z
    .array(Field)
    .max(LIMITS.maxFields)
    .optional()
    .describe(`Up to ${LIMITS.maxFields} label/value rows for structured facts (region, duration, commit).`),
  image: httpsUrl
    .refine((u) => u.startsWith("https://"), "image must be an https URL")
    .optional()
    .describe("https URL of an image shown on the card, such as a chart or screenshot."),
  icon: z.string().min(1).max(2048).optional().describe("An emoji or an https image URL shown next to the title."),
  cooldown: boundedDuration("cooldown", LIMITS.minCooldown, LIMITS.maxCooldown)
    .optional()
    .describe(
      'With `key`: alert at most once per this duration (such as "30m", "1h", "24h"; units s, m, h; ' +
        `${LIMITS.minCooldown} to ${LIMITS.maxCooldown}). ` +
        "Sends inside it update the notification silently, or change nothing if the user resolved it.",
    ),
});
export type InformInput = z.infer<typeof InformInput>;

/**
 * Ask: a question for the user (GLOSSARY.md). Agents only, over MCP; they poll the answer with wait_for_response.
 * Always alerts at `warning`. With neither `options` nor `allowText`, a reply box is added.
 */
export const AskInput = IntentInputBase.extend({
  title: z.string().min(1).max(200).describe("The question, short enough for a notification title."),
  body: z
    .string()
    .max(4000)
    .optional()
    .describe("Context for the decision. Markdown subset: **bold**, *italic*, `code`, [links](https://…), line breaks."),
  options: z
    .array(z.string().min(1).max(32))
    .max(LIMITS.maxOptions)
    .optional()
    .describe(`Up to ${LIMITS.maxOptions} answer-button labels, e.g. ["Approve", "Reject"]. The label tapped is the answer.`),
  allowText: z.boolean().optional().describe("Also accept a typed answer. Implied when there are no options."),
  expiresIn: Duration.refine((d) => durationMs(d) <= durationMs(LIMITS.maxAskExpiry), {
    message: `at most ${LIMITS.maxAskExpiry}`,
  })
    .optional()
    .describe(
      `How long the question stays answerable, e.g. "15m", "2h" (default ${LIMITS.defaultAskExpiry}, at most ` +
        `${LIMITS.maxAskExpiry}). Then it leaves every device and wait_for_response reports it expired.`,
    ),
  url: httpsUrl.optional().describe("Opens when the user taps the notification, e.g. the PR to review before answering."),
  key: Key.optional().describe(
    "Names this question. Asking again with the key of an open ask returns that ask instead of alerting again.",
  ),
});
export type AskInput = z.infer<typeof AskInput>;

/** How a sender reports progress: `running` while working, then `done` or `failed` once. */
export const ProgressStatus = z.enum(["running", "done", "failed"]);
export type ProgressStatus = z.infer<typeof ProgressStatus>;

/**
 * Report long-running work (MCP `progress`). Called repeatedly with the same `key`: the first report appears without
 * sound, later ones update it silently, `done` / `failed` alert once. Omitted fields keep the previous report's value.
 */
export const ProgressInput = IntentInputBase.extend({
  key: Key.describe('Names this task, e.g. "deploy-api". Reuse it on every report so they update one notification.'),
  title: z.string().min(1).max(200).describe('What is running, e.g. "Deploying api to prod".'),
  value: z.number().min(0).optional().describe("Work done so far, out of `max`. With status done it defaults to `max`."),
  max: z.number().positive().optional().describe("Total amount of work (default 100, so `value` is a percentage)."),
  label: z.string().max(64).optional().describe('Short text next to the bar, e.g. "3/7 checks" (default: the percent).'),
  status: ProgressStatus.default("running").describe(
    "running (default): update silently. done: finished well, alerts once. failed: finished badly, alerts once.",
  ),
  staleAfter: boundedDuration("staleAfter", LIMITS.minStaleAfter, LIMITS.maxStaleAfter)
    .optional()
    .describe(
      'How long this may go without a report before the user is told it stopped reporting, e.g. "2h" for a long ' +
        `silent step (default "${LIMITS.defaultStaleAfter}", from "${LIMITS.minStaleAfter}" to ` +
        `"${LIMITS.maxStaleAfter}"). A later report revives it.`,
    ),
  url: httpsUrl.optional().describe("Opens when the user taps the notification, e.g. the build log."),
});
export type ProgressInput = z.infer<typeof ProgressInput>;

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

/** An answer to an open ask: the label of one of its answer buttons, a typed text (when it allows text), or both. */
export const RespondInput = z
  .object({
    option: z.string().min(1).max(32).optional(),
    text: z.string().min(1).max(2000).optional(),
  })
  .refine((v) => v.option !== undefined || v.text !== undefined, { message: "option or text is required" });
export type RespondInput = z.infer<typeof RespondInput>;

export const ListNotificationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  source: z.string().optional(),
  severity: Severity.optional(),
  status: NotificationStatus.optional(),
  q: z.string().max(200).optional(),
  updatedSince: z.string().optional(),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuery>;

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

export const McpWaitInput = z.object({
  id: z.string().describe("The id returned by ask (ntf_…)."),
  timeoutSeconds: z
    .number()
    .int()
    .min(1)
    .max(LIMITS.askWaitSeconds)
    .default(LIMITS.askWaitSeconds)
    .describe(`How long to hold for an answer, at most ${LIMITS.askWaitSeconds} s. Call again while it is pending.`),
});
export type McpWaitInput = z.infer<typeof McpWaitInput>;

/**
 * wait_for_response: the first answer; still pending (with when it was asked and when it expires, so the agent needs
 * no date maths); or closed unanswered because it expired or its sender withdrew it.
 */
export type McpWaitResult =
  | { status: "answered"; answer: AskAnswer; askedAt: string }
  | { status: "pending" | "expired" | "withdrawn"; askedAt: string; expiresAt: string | null };

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

// ─── Constants ──────────────────────────────────────────────────────────────

export const TOKEN_PREFIX = { webhook: "oyee_wh_", mcp: "oyee_mcp_", device: "oyee_dev_" } as const;
export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ANDROID_CHANNELS: Record<Severity, string> = {
  critical: "oyee.critical",
  warning: "oyee.warning",
  info: "oyee.info",
  success: "oyee.success",
};

// ─── Quotas (per account; docs/protocol.md §3.1) ─────────────────────────────

export const QuotaKind = z.enum(["send", "update", "respond", "read", "pairing"]);
export type QuotaKind = z.infer<typeof QuotaKind>;

/** Daily limits reset at 00:00 UTC; per-minute limits use fixed one-minute windows. */
export const QUOTAS: Record<QuotaKind, { perDay: number; perMinute: number | null; label: string }> = {
  send: { perDay: 1000, perMinute: 120, label: "Notifications sent" },
  update: { perDay: 5000, perMinute: null, label: "Updates" },
  respond: { perDay: 1000, perMinute: 30, label: "Answers" },
  read: { perDay: 20000, perMinute: 300, label: "Reads" },
  pairing: { perDay: 20, perMinute: 5, label: "Pairing codes" },
};

export const Usage = z.object({
  day: z.string(),
  resetsAt: isoDate,
  items: z.array(z.object({ kind: QuotaKind, label: z.string(), used: z.number().int(), limit: z.number().int() })),
});
export type Usage = z.infer<typeof Usage>;

// ─── Display helpers shared by server and web ───────────────────────────────

/**
 * What every client shows for a progress that stopped reporting: "Stopped reporting after <last label or percent>",
 * e.g. "Stopped reporting after 3/7 checks" or "Stopped reporting after 40%". The stored `label` stays the sender's.
 */
export function stoppedReportingLabel(p: { value: number; max: number; label?: string }): string {
  const ratio = p.max > 0 ? Math.max(0, Math.min(1, p.value / p.max)) : 0;
  return `Stopped reporting after ${p.label ?? `${Math.round(ratio * 100)}%`}`;
}

/** Text progress bar used where native progress isn't available: "▓▓▓░░░░ 3/7". */
export function progressText(p: { value: number; max?: number; label?: string }): string {
  const max = p.max ?? 100;
  const ratio = Math.max(0, Math.min(1, p.value / max));
  const filled = Math.round(ratio * 10);
  const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
  return `${bar} ${p.label ?? (max === 100 ? `${Math.round(ratio * 100)}%` : `${p.value}/${max}`)}`;
}
