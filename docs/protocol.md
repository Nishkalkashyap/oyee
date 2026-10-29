# Oyee Protocol v1

This is the contract between the server (`apps/server`), web (`apps/web`), Android (`apps/android`) and Apple
(`apps/apple`) clients. The TypeScript source of truth is `packages/schema/src/index.ts`. Kotlin and Swift models
must mirror it exactly (JSON field names are camelCase).

General rules:
- All bodies are JSON (`Content-Type: application/json`) unless stated otherwise.
- Timestamps are **ISO-8601 strings in UTC** (`2026-10-28T10:00:00.000Z`).
- IDs are opaque strings with a prefix: `usr_`, `ntf_`, `tok_`, `dev_`, `tpl_` + 26-char ULID (sortable by time).
- Errors: HTTP status + `{ "error": { "code": "not_found", "message": "Human readable" } }`.
  Codes: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `payload_too_large`, `internal`.
- Pagination: `?limit=` (default 50, max 200) & `?cursor=` (opaque). Response: `{ "items": [...], "nextCursor": "..." | null }`.
- Clients must ignore unknown JSON fields (forward compatibility).

---

## 1. Card / Notification schema

> **Targeted delivery.** `devices` / `platforms` on send (REST, MCP `send_notification` / `ask`, webhook `?devices=` /
> `?platforms=`) are resolved server-side to `targetDeviceIds` on the stored notification. Unknown or ambiguous targets
> → `400` listing the paired devices. Push (FCM / Web Push) goes only to target devices; WebSocket events still reach every
> client so inboxes stay in sync, and **clients must not post a system notification unless `targetDeviceIds` is null or
> contains their own device id**.

### 1.1 `Notification` (what the server stores and returns)

```jsonc
{
  "id": "ntf_01JBX...",
  "source": "aws-monitor",              // string 1..64
  "threadId": "run-42",                 // string 1..128 | null
  "title": "prod-api CPU high",         // string 1..200
  "body": "CPU above **90%** for 5m",   // string ≤ 4000 | null; markdown subset: **bold**, *italic*, `code`, [link](url), line breaks
  "severity": "critical",               // "debug" | "info" | "success" | "warning" | "critical"
  "status": "active",                   // "active" | "resolved"
  "icon": "🔥",                          // emoji or https URL | null
  "image": "https://…/graph.png",       // https URL | null
  "url": "https://console.aws…",        // opened when the notification body is tapped | null
  "fields": [{ "label": "Region", "value": "us-east-1" }],   // ≤ 10; label ≤ 40, value ≤ 200
  "progress": { "value": 3, "max": 7, "label": "3/7 checks", "indeterminate": false },  // | null; max default 100
  "actions": [                           // ≤ 3
    { "id": "ack", "label": "Acknowledge", "style": "primary", "resolves": true },
    { "id": "scale", "label": "Scale +2", "style": "default", "callback": { "url": "https://…" } },
    { "id": "open", "label": "Open console", "url": "https://console.aws…" }
  ],
  "reply": { "placeholder": "Tell the agent…", "buttonLabel": "Send" },   // | null
  "tags": ["prod", "aws"],               // ≤ 10, each ≤ 32
  "silent": false,                       // true → no sound/vibration anywhere
  "template": "aws-alarm",              // template used, informational | null
  "version": 3,                          // increments on every change
  "createdAt": "…", "updatedAt": "…",
  "readAt": "…" | null,
  "resolvedAt": "…" | null,
  "targetDeviceIds": ["dev_…"] | null,  // null/absent = every device alerts
  "responses": [                         // newest last, ≤ 20 kept
    { "actionId": "ack", "text": null, "deviceId": "dev_…" | null, "deviceName": "Pixel 9", "at": "…" }
  ]
}
```

`Action`:
- `id` — `[a-z0-9_-]{1,32}`, unique within the notification.
- `label` — 1..32 chars.
- `style` — `"default" | "primary" | "destructive"` (default `"default"`).
- `url` — if present, the client **opens this URL** and does **not** call respond.
- `callback` — `{ "url": "https://…", "headers"?: {…} }`. On response, the server POSTs
  `{ notification, response }` with header `X-Oyee-Signature: sha256=<hex hmac of body>`.
- `resolves` — boolean; responding with this action also resolves the notification.

### 1.2 `SendNotificationInput` (create)

Every `Notification` content field is optional except `title` (it's required unless a template provides it), plus:

```jsonc
{
  "title": "…", "body": "…", "severity": "info", "source": "…", "threadId": "…",
  "icon": "…", "image": "…", "url": "…", "fields": [], "progress": {}, "actions": [], "reply": {}, "tags": [], "silent": false,
  "template": "aws-alarm",               // optional
  "vars": { "service": "prod-api" },     // optional, used with template
  "devices": ["macbook"],                // optional: only these devices alert — ids or names (case-insensitive, unique partial match ok)
  "platforms": ["android"],              // optional: only devices on these platforms alert (union with `devices`)
  "replaceKey": "aws-cpu-prod-api"       // optional: if an ACTIVE notification with this key exists, REPLACE its card instead of creating
                                         // (dedupe): readAt is reset, version increments, broadcast as notification.updated with alert=true
}
```
Defaults: `severity` = `"info"`; `source` = the token label (or `"web"` / device name).

### 1.3 `UpdateNotificationInput` (patch)

Any content field (`title`, `body`, `severity`, `icon`, `image`, `url`, `fields`, `progress`, `actions`, `reply`, `tags`, `silent`).
`null` clears a nullable field. Plus `"alert": boolean` (default `false`): if true, devices re-alert (sound) instead of updating silently.
`status` can't be patched; use resolve.

### 1.4 Templates

```jsonc
{ "id": "tpl_…", "name": "aws-alarm",           // [a-z0-9_-]{1,64}, unique per user
  "description": "CloudWatch alarm",
  "card": { "title": "{{service}} {{metric}} high", "severity": "warning", "fields": [{"label":"Region","value":"{{region|us-east-1}}"}] },
  "createdAt": "…", "updatedAt": "…" }
```
Rendering: every string anywhere in `card` has `{{name}}` replaced by `vars[name]` (stringified) or by the fallback in
`{{name|fallback}}`, or by an empty string. Then the explicit fields in the send input override the rendered card (shallow merge).

---

## 2. Authentication

| Credential | How it's sent | Scope |
|---|---|---|
| Session cookie `oyee_session` (HttpOnly, Secure, SameSite=Lax) | browser | everything under `/api/*` |
| Device token `oyee_dev_…` | `Authorization: Bearer` (WebSocket: also `?token=` query, because some WS clients can't set headers) | notifications read/respond/read/resolve/delete, `/api/devices/self`, `/api/ws`, templates read, `/api/me` |
| MCP token `oyee_mcp_…` | URL path `/mcp/<token>` or `Authorization: Bearer` | MCP tools |
| Webhook token `oyee_wh_…` | URL path `/hook/<token>` | send only |

### 2.1 Web sign-in
- `GET /auth/google/login?redirect=/inbox` → 302 to Google.
- `GET /auth/google/callback` → creates/updates the user, sets the session cookie, 302 to `redirect`. On failure → 302 to `/login?error=<code>` (e.g. `not_allowed`, `oauth_failed`, `not_configured`).
- `POST /auth/logout` → `204`, clears the session.
- `GET /auth/dev-login?email=a@b.c&redirect=/` → only when `DEV_LOGIN=true`. Same effect as the Google login.

### 2.2 Device pairing
1. Web (session): `POST /api/devices/pairing-codes` → `{ "code": "K7Q2-9XMA", "expiresAt": "…", "deepLink": "oyee://pair?server=https%3A%2F%2Fhost&code=K7Q2-9XMA" }`
   (10 min TTL, single use, 8 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, shown as `XXXX-XXXX`; the dash is optional on input, case-insensitive).
2. Client (no auth): `POST /api/devices/pair` `{ "code": "K7Q29XMA", "name": "Pixel 9", "platform": "android" }`
   → `201 { "device": Device, "token": "oyee_dev_…", "user": User }`.
3. Client stores the server URL + token. `DELETE /api/devices/self` unpairs.

`platform`: `"android" | "ios" | "macos" | "web"`.

---

## 3. REST API

### Meta
- `GET /healthz` → `{ "ok": true }`
- `GET /api/config` (no auth) → `{ "version": "0.1.0", "vapidPublicKey": "…" | null, "fcmEnabled": true, "devLogin": false }`
- `GET /api/me` → `User` = `{ "id", "email", "name", "avatarUrl" }`
- `GET /api/usage` → `{ "day": "2026-10-29", "resetsAt": "…", "items": [{ "kind": "send", "label", "used", "limit" }] }` (today's quotas, §3.1)

### Tokens (session only)
- `GET /api/tokens` → `{ "items": TokenInfo[] }`. `TokenInfo` = `{ id, kind: "webhook"|"mcp", label, prefix: "oyee_wh_ab12", defaultSource, createdAt, lastUsedAt }`
- `POST /api/tokens` `{ "kind": "webhook"|"mcp", "label": "Home Assistant", "defaultSource"?: "home-assistant" }`
  → `201 { "token": TokenInfo, "secret": "oyee_wh_…", "url": "https://host/hook/oyee_wh_…", "callbackSecret": "…" }` (for MCP: `https://host/mcp/oyee_mcp_…`).
  The secret and callbackSecret are never shown again. `callbackSecret` is the HMAC key for `X-Oyee-Signature` on action callbacks of notifications sent with this token.
- `DELETE /api/tokens/:id` → `204`

### Devices
- `POST /api/devices/pairing-codes` (session) — see §2.2
- `POST /api/devices/pair` (no auth) — see §2.2
- `GET /api/devices` (session) → `{ "items": Device[] }`
  `Device` = `{ id, name, platform, transports: ("fcm"|"websocket"|"webpush")[], createdAt, lastSeenAt }`
- `PATCH /api/devices/:id` (session) `{ "name": "Galaxy S23 Ultra" }` → `Device` (names are what agents target)
- `DELETE /api/devices/:id` (session) → `204`
- `PUT /api/devices/self` (device token) `{ "name"?, "fcmToken"?: string|null }` → `Device`
- `DELETE /api/devices/self` (device token) → `204`
- `POST /api/devices/web` (session) `{ "name": "Chrome on Mac", "subscription": PushSubscriptionJSON }` → `201 Device`
  (creates or updates a `web` device keyed by the subscription endpoint)

### Notifications (session or device token)
- `GET /api/notifications?limit&cursor&source&severity&status&threadId&q&updatedSince`
  → `{ items: Notification[], nextCursor }`. Ordered by `createdAt` desc. With `updatedSince` the result is ordered by `updatedAt` asc (for sync).
- `GET /api/notifications/:id` → `Notification`
- `POST /api/notifications` `SendNotificationInput` → `201 Notification` (session only; devices may not send)
- `PATCH /api/notifications/:id` `UpdateNotificationInput` → `Notification` (session only)
- `POST /api/notifications/:id/respond` `{ "actionId"?: string, "text"?: string }` (at least one) → `Notification`
- `POST /api/notifications/:id/read` → `Notification`
- `POST /api/notifications/read-all` `{ "source"?: string }` → `{ "updated": n }`
- `POST /api/notifications/:id/resolve` → `Notification`
- `DELETE /api/notifications/:id` → `204`
- `GET /api/sources` → `{ "items": [{ "source": "aws-monitor", "count": 12, "unread": 3, "lastAt": "…" }] }`

### Templates
- `GET /api/templates` → `{ items: Template[] }`
- `GET /api/templates/:name` → `Template`
- `PUT /api/templates/:name` `{ "description"?, "card" }` → `Template` (session only, upsert)
- `DELETE /api/templates/:name` → `204` (session only)
- `POST /api/templates/:name/preview` `{ "vars": {} }` → rendered `SendNotificationInput` (session only)

### 3.1 Limits
Per account (all tokens, devices and the web app together). Daily limits reset at 00:00 UTC; per-minute limits use
fixed one-minute windows. Over a limit the server answers `429 rate_limited` with a `Retry-After` header (seconds) and
a message saying which limit was hit; MCP tools return the same message as a tool error. At 80% and 100% of the daily
send, update and reply limits the inbox gets one notice (source `oyee`). Values live in `QUOTAS` / `LIMITS` in
`packages/schema`.

| Quota | Per day | Per minute | Counts |
|---|---|---|---|
| `send` | 1,000 | 120 (and 60 per webhook/MCP token) | new notifications, including `replaceKey` replacements |
| `update` | 5,000 | — | update, resolve, read, read-all, delete |
| `respond` | 1,000 | 30 | replies and action taps |
| `read` | 20,000 | 300 | list, get, sources, templates, `wait_for_response`, WebSocket `sync` |
| `pairing` | 20 | 5 | pairing codes |

- At most 10 devices, 20 tokens and 100 templates per account (`409 conflict` beyond that).
- Pushes for updates to one notification are coalesced to one per 2 s: the first goes out at once, the latest one
  when the interval ends (with `alert` if any update in between asked for it). WebSocket clients get every update.
- Per IP: 5 new accounts per day (existing users can always sign in), and after 30 failed token or pairing-code
  attempts in a minute further failures get `429`.

---

## 4. Webhook ingestion — `POST|GET /hook/:token`

Resolution order:
1. `application/json` body:
   - Alertmanager (`body.alerts` array + `body.version`) → one notification per group. Title = `[FIRING:n] alertname`,
     severity from `labels.severity` (critical/warning/info), `replaceKey` = `groupKey`. status `resolved` → resolve the matching notification.
   - Grafana unified alerting (`body.alerts` + `body.orgId` or `body.state`) → same mapping.
   - AWS SNS (`body.Type` = `SubscriptionConfirmation` → server GETs `SubscribeURL`, returns 200; `Notification` → title = `Subject`, body = `Message`).
   - Otherwise, `SendNotificationInput`.
2. `text/plain` (or any other content type) body → `body`, and the metadata comes from:
   - query params: `title`, `severity`, `source`, `threadId`, `tags` (comma-separated), `url`, `icon`, `template`, `replaceKey`;
   - ntfy-style headers: `Title`/`X-Title`, `Priority`/`X-Priority` (1–2 → debug/info, 3 → info, 4 → warning, 5 → critical),
     `Tags`/`X-Tags`, `Click`/`X-Click`, `Icon`/`X-Icon`.
3. `GET` → everything from query params (`body` param too).

Response: `200 { "id": "ntf_…", "version": 1 }`. If `title` is missing, the first line of the body (max 200 chars) becomes the title,
or `"Notification"`.

---

## 5. MCP — `/mcp/:token` or `/mcp` (Bearer)

Streamable HTTP, stateless. Server name `oyee`. Tools (the input schemas are the zod schemas from `@oyee/schema`):

| Tool | Input | Output (JSON text content) |
|---|---|---|
| `send_notification` | `SendNotificationInput` | `Notification` |
| `update_notification` | `{ id, ...UpdateNotificationInput }` | `Notification` |
| `resolve_notification` | `{ id }` | `Notification` |
| `ask` | `{ title, body?, options?: string[] (≤3 → actions), allowText?: boolean, severity?, source?, threadId? }` | `{ id }` — the notification awaits a response |
| `wait_for_response` | `{ id, timeoutSeconds?: number (1..55, default 50) }` | `{ status: "answered", response } \| { status: "pending" }` (call again if pending) |
| `get_notification` | `{ id }` | `Notification` |
| `list_notifications` | `{ limit?, cursor?, source?, severity?, status?, threadId?, q? }` | `{ items, nextCursor }` |
| `list_templates` | `{}` | `{ items }` |
| `upsert_template` | `{ name, description?, card }` | `Template` |
| `delete_template` | `{ name }` | `{ ok: true }` |
| `list_devices` | `{}` | `{ items: Device[] }` |

`wait_for_response` returns the latest existing response immediately if one exists. `ask` with neither options nor `allowText` adds a reply box.
Responses are plain JSON (no SSE stream); `GET`/`DELETE` on the MCP endpoint return 405.

`ask` options become actions with ids `option_1..3` and labels set to the option text. Each `resolves: true`. `allowText` adds `reply`.

---

## 6. WebSocket — `GET /api/ws`

Auth: session cookie (browser) or device token (`Authorization: Bearer` or `?token=`). JSON text frames.

Server → client:
```jsonc
{ "type": "hello", "userId": "usr_…", "deviceId": "dev_…" | null, "serverTime": "…" }
{ "type": "notification.created", "notification": Notification }          // clients ALERT (unless silent)
{ "type": "notification.updated", "notification": Notification, "alert": false, "reason": "update"|"read"|"resolved"|"responded" }
{ "type": "notification.deleted", "id": "ntf_…" }
{ "type": "sync.result", "notifications": Notification[], "deletedIds": string[], "cursor": "…", "hasMore": false }
{ "type": "pong" }
```
Client → server:
```jsonc
{ "type": "ping" }                                  // every 30 s; the server answers with pong
{ "type": "sync", "since": "<cursor or ISO time or null>" }   // after (re)connect; null = last 50 active. ISO times compare with >= (duplicates possible; dedupe by id+version)
```
Client behavior on events:
- `created` → post a system notification (id = notification id).
- `updated` → if the system notification is showing (or `alert`), replace it in place (silently unless `alert`). If
  `readAt` is set (read elsewhere) or `status` is `resolved` → **cancel** the system notification.
- `deleted` → cancel the system notification and remove it from the inbox.

Reconnect with exponential backoff (1 s → 60 s max, with jitter). Send `sync` with the last cursor on every connect.

---

## 7. FCM payload (Android)

The server sends **data-only** messages (FCM v1 `android.priority = "HIGH"` for `created` and `critical`/`warning`,
`"NORMAL"` otherwise). `android.collapse_key` = notification id. Data map (all string values):

```jsonc
{
  "type": "notification.created" | "notification.updated" | "notification.deleted",
  "id": "ntf_…",
  "version": "3",
  "alert": "true" | "false",
  "notification": "<JSON string of Notification>"   // omitted if the encoded message would exceed 3.5 KB → client GETs /api/notifications/:id
}
```

## 8. Web Push payload

Encrypted (`aes128gcm`) JSON: `{ "type": "notification.created"|"notification.updated"|"notification.deleted", "notification": Notification | null, "id": "ntf_…" }`.
The service worker shows / replaces (`tag` = id) / closes notifications. Web Push is sent only to `web` devices, and only for
`created`, `updated` with `alert`, and close-worthy changes (read/resolved/deleted).

## 9. Platform rendering rules (all clients)

- One system notification per Oyee notification. The system id/tag is derived from the Oyee `id`.
- Severity → importance: `critical` = max/heads-up + sound, `warning` = high + sound, `info`/`success` = default, `debug` = low/silent.
  Android: one channel per severity (`oyee.critical`, `oyee.warning`, `oyee.info`, `oyee.success`, `oyee.debug`).
- `silent: true` → no sound or vibration.
- Updates that aren't alerts must not re-alert (Android `setOnlyAlertOnce(true)`; Apple: re-add with the same identifier and no sound).
- `fields` are appended to the expanded text as `Label: value` lines.
- `progress` → native progress where it's available, otherwise a `▓▓▓░░░ 3/7` text line.
- Tapping the body: if `url` is set → open it; otherwise → open the app's notification detail. Either way → `POST …/read`.
- Action tap: `url` action → open the URL; otherwise → `POST …/respond { actionId }`. Reply → `POST …/respond { text }`.
- Group by `source` (Android `setGroup`, Apple `threadIdentifier` = `threadId ?? source`).
