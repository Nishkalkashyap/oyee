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

> **Targeted delivery.** `devices` / `platforms` on send (REST, MCP `inform` / `ask` / `progress`, webhook `?devices=` /
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

**Intent (protocol v2, being introduced).** Every notification also carries `intent` (`"inform" | "ask" |
"progress"`), `key` (string ≤ 128 | null; today the send's `replaceKey`) and one block named after its intent, next
to the flat fields above (which stay until every client reads intents):

```jsonc
"inform":   { "links": [{ "label": "Open PR", "url": "https://…" }], "fields": [], "image": null, "icon": "🚀", "cooldown": null },
"ask":      { "options": ["Approve", "Reject"], "allowText": false, "replyPlaceholder": null,
              "expiresAt": "…", "answer": { "option": "Approve", "text": null, "deviceId": "dev_…", "deviceName": "Pixel 9", "at": "…" } | null,
              "state": "open" },          // "open" | "answered" | "expired" | "withdrawn"
"progress": { "value": 3, "max": 7, "label": "3/7 checks", "indeterminate": false,
              "state": "running",         // "running" | "done" | "failed" | "stopped" (Stopped reporting)
              "staleAfter": "30m", "lastReportAt": "…" }   // on a progress intent, `progress` is this block (a superset of the bar)
```

Flat sends get the intent they most resemble: non-link actions or a reply → ask (`answered` once it has a response,
`withdrawn` if resolved unanswered, otherwise `open`, expiring 1 h after creation); progress → progress (`done` at
max, otherwise `running`); anything else → inform (link actions become `links`). Notifications stored before intents
were converted the same way, except that an unanswered ask became `expired` and an unfinished progress `stopped`.
Example notifications for every intent and state: `packages/schema/fixtures/notifications.v2.json`.

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
- `POST /api/notifications` (session only; devices may not send; used by the web Send page) takes the same
  intent-tagged body as a webhook (§4): `{ "intent": "inform" | "progress", …the intent's fields }`, `intent`
  defaulting to `inform`; `"ask"` gets `400` (asks are for agents over MCP). Answers
  `{ "id", "version", "outcome", "reason", "notification": Notification }`, `201` when the outcome is `created`,
  otherwise `200`. Until the flat card is removed, a body without `intent` that uses a v1-only field (`actions`,
  `reply`, `progress`, `template`, `vars`, `tags`, `threadId`, `silent`, `replaceKey`) still takes the v1 path and
  answers `201 Notification`.
- `PATCH /api/notifications/:id` `UpdateNotificationInput` → `Notification` (session only)
- `POST /api/notifications/:id/respond` `{ "option"?: string, "actionId"?: string, "text"?: string }` (at least one) →
  `Notification`. On an ask, `option` is an answer-button label (`actionId` is the v1 way to pick one) and `text`
  needs `allowText`; the first answer from any device sets `ask.answer`, resolves the ask and marks it read; a later
  answer gets `409 conflict` ("This ask was already answered: Approve · Pixel 9").
- `POST /api/notifications/:id/read` → `Notification`
- `POST /api/notifications/read-all` `{ "source"?: string }` → `{ "updated": n }`
- `POST /api/notifications/:id/resolve` → `Notification`
- `DELETE /api/notifications/:id` → `204`
- `GET /api/sources` → `{ "items": [{ "source": "aws-monitor", "count": 12, "unread": 3, "lastAt": "…" }] }`
  (`unread` counts only unread **active** notifications: resolved ones never need attention, so they don't badge.)

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
| `send` | 1,000 | 120 (and 60 per webhook/MCP token) | new notifications, and keyed informs that alert again |
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

Every webhook send is an intent with the same field names as the MCP tools (§5): **inform** (the default) or
**progress**. Asks are for agents over MCP, which poll for the answer; a webhook ask gets `400` saying so. Webhook
sends go through the same inbox operations as MCP, so `key`, `cooldown`, the cross-intent key conflict (`409`) and
stopped reporting behave exactly as for agents.

Resolution order:
1. `application/json` body:
   - Alertmanager (`body.alerts` array + `body.version`) → one **inform** per group, keyed `am:<groupKey>` (hashed
     when longer than 128 chars). Title = `[FIRING:n] alertname`, severity from `labels.severity` (critical/warning/
     info; below-info levels such as `debug` → `info`), `fields` from `commonLabels`. A repeat while firing updates
     the inform and alerts again. Status `resolved` → the keyed inform shows `[RESOLVED] alertname` at `success` and is
     resolved without alerting (with none active, a resolved inform is recorded); firing again later creates a new one.
   - Grafana unified alerting (`body.alerts` + `body.orgId` or `body.state`) → same mapping, keyed `grafana:<groupKey>`.
   - AWS SNS (`body.Type` = `SubscriptionConfirmation` → server GETs `SubscribeURL`, returns 200; `Notification` → an
     inform with title = `Subject`, body = `Message`).
   - Otherwise an intent body: `{ "intent"?: "inform" | "progress", …the intent's fields }`:
     ```jsonc
     { "title": "Backup done" }                                         // inform
     { "title": "Disk 91% full", "severity": "warning", "key": "disk", "cooldown": "1h" }
     { "intent": "progress", "key": "deploy", "title": "Deploying api", "value": 3, "max": 7 }
     { "intent": "progress", "key": "deploy", "title": "Deployed api", "status": "done" }
     ```
     Inform fields: `title`, `body`, `severity`, `url`, `key`, `cooldown`, `links`, `fields`, `image`, `icon`,
     `source`, `devices`, `platforms`. Progress fields: `key` (required), `title`, `value`, `max`, `label`, `status`
     (`running | done | failed`), `staleAfter`, `body`, `url`, `source`, `devices`, `platforms`. Until the flat card is
     removed, a body without `intent` that uses a v1-only field (`actions`, `reply`, `progress`, `template`, `vars`,
     `tags`, `threadId`, `silent`, `replaceKey`) is still read as a v1 card and answered `{ "id", "version" }`.
2. `text/plain` (or any other content type) body → `body`, and the rest comes from:
   - query params: `intent` (`inform` default, or `progress`), `title`, `source`, `url` (or `click`), `key`, and
     - for inform: `severity`, `priority`, `icon`, `cooldown`;
     - for progress: `value`, `max`, `label`, `status`;
   - ntfy-style headers: `Title`/`X-Title`, `Priority`/`X-Priority` (1–3 → info, 4 → warning, 5 → critical),
     `Click`/`X-Click`, `Icon`/`X-Icon`. `Tags` headers are ignored.
   - `?replaceKey=` and `?template=` are no longer accepted (`400`, pointing to `key`); `threadId`, `tags` and
     `var.*` parameters are ignored.
3. `GET` → everything from query params (`body` or `message` param too).

If `title` is missing on a text or GET send, the first line of the body (max 200 chars) becomes the title, or
`"Notification"`. `?devices=` / `?platforms=` (comma-separated) target devices for any payload type.

Response: `200 { "id": "ntf_…", "version": 1, "outcome": "created", "reason": "…" }`, where `outcome` is `created`,
`alerted`, `updated_silently` or `suppressed` (inform, see §5 `inform`) or `created`, `updated_silently`, `alerted`
(progress), and `reason` says what happened in one sentence. An Alertmanager/Grafana resolution answers
`{ "id", "version", "status": "resolved" }`.

---

## 5. MCP — `/mcp/:token` or `/mcp` (Bearer)

Streamable HTTP, stateless. Server name `oyee`. Exactly seven tools (the input schemas are the zod schemas from
`@oyee/schema`); the server `instructions` say in a few lines when to use inform, ask and progress.

| Tool | Input | Output |
|---|---|---|
| `inform` | `InformInput` (below) | result text (below): `created` / `updated_silently` / `alerted` / `suppressed` |
| `ask` | `AskInput`: `{ title, body?, options?: string[] (≤3), allowText?, expiresIn?: duration (default "1h", max "24h"), url?, key?, source?, devices?, platforms? }` | result text: `created` (`Asked the user (expires in 1h). Call wait_for_response with id "ntf_…" to get the answer.`), or `reused` for an open ask with the same `(source, key)` (`Already asked 12m ago, still waiting (expires in 48m); the user was not alerted again. …`, no new alert) |
| `wait_for_response` | `{ id, timeoutSeconds?: number (1..50, default 50) }` | result text: `answered` (`The user answered "Approve" from Pixel 9.` / `The user replied from MacBook Pro: "main"`) `pending` (`No answer yet: asked 3m ago, expires in 57m. Call wait_for_response again with id "ntf_…" to keep waiting.`), `expired` (`The ask expired without an answer…`) or `withdrawn` (`The ask was withdrawn without an answer…`) |
| `progress` | `ProgressInput`: `{ key, title, value?, max? (default 100), label?, status?: "running"\|"done"\|"failed" (default running), body?, url?, source?, devices?, platforms? }` | result text: `created` / `updated_silently` / `alerted`, then the next step |
| `resolve` | `{ id }` | result text: `resolved` (`Resolved "…": it is gone from the user's devices.`) or `withdrawn` for an open ask (it can no longer be answered) |
| `list_notifications` | `McpListInput`: `{ key?, intent?, status?, source?, limit? (default 10, max 50), cursor? }` | JSON `{ items: McpListItem[], nextCursor }`, newest first |
| `list_devices` | `{}` | JSON `{ items: Device[] }` |

**Result text.** Every tool that acts answers in one shape: an `outcome:` line, an `id:` line, then what happened and
the next step in words, so a model reads the outcome and id the same way from every tool:

```
outcome: pending
id: ntf_01J…
No answer yet: asked 3m ago, expires in 57m. Call wait_for_response again with id "ntf_01J…" to keep waiting.
```

Errors are `isError` results with the text `<code>: <message>` (for example `not_found: notification not found`).

**`list_notifications` items** are slim so a listing costs few tokens and needs no date maths:
`{ id, intent, key, title, status, state, answer, createdAt, ago }`. `state` is the ask's (`open` / `answered` /
`expired` / `withdrawn`) or the progress's (`running` / `done` / `failed` / `stopped`), `null` for an inform;
`answer` is an ask's `{ option, text, device }` or `null`; `ago` is the age such as `45s`, `12m`, `3h`, `2d`. Pass
`nextCursor` as `cursor` for older ones (`null` = no more).

`wait_for_response` returns the answer immediately if there is one. An ask always alerts at `warning`; with neither
options nor `allowText` it gets a reply box. Its `ask.expiresAt` is `expiresIn` (default one hour, at most 24 hours)
after it was sent. **Expiry**: when that time is up the inbox's alarm sets `ask.state: "expired"` and
`status: "resolved"` and broadcasts `notification.updated` (`reason: "resolved"`, `alert: false`), so every device
takes it out of the tray; a held `wait_for_response` returns at once with the expiry. Not charged to quotas.
**Withdrawing**: resolving an open ask (`resolve` or `POST /api/notifications/:id/resolve`) sets
`ask.state: "withdrawn"`, the same way. Answering an answered, expired or withdrawn ask (or one past `expiresAt`)
returns `409 conflict`.
Responses are plain JSON (no SSE stream); `GET`/`DELETE` on the MCP endpoint return 405.

For app builds that predate intents, `ask` options also become flat actions with ids `option_1..3` (first `primary`,
each `resolves: true`) and `allowText` adds `reply`; answering with `actionId: "option_2"` records the option `"Reject"`.

**`inform`** (something the user should know; one-way). `InformInput`: `title` (required, ≤ 200), `body?` (markdown,
≤ 4000), `severity?` (`info` default \| `success` \| `warning` \| `critical`; every severity alerts), `url?` (opens on
tap), `key?` (≤ 128), `source?` (default: the token's name), `devices?`, `platforms?`, `links?` (≤ 3 link buttons
`{ label ≤ 32, url }`), `fields?` (≤ 10 `{ label, value }` rows), `image?` (https), `icon?` (emoji or https URL),
`cooldown?` (duration such as `"30m"`, `"1h"`, `"24h"`; units s, m, h; `LIMITS.minCooldown` 1m to
`LIMITS.maxCooldown` 168h; only meaningful with `key`, stored as `inform.cooldown`).
Keys are unique per `(source, key)`; another source using the same key gets its own notification. With a key whose
latest notification is an inform, the send's `cooldown` is measured from the key's last alert, whatever the
notification's status (silent updates don't move it):

| Latest inform with the key | Inside the cooldown | Cooldown passed, or no cooldown |
|---|---|---|
| none (or another intent) | `created`: new inform, alerts | `created` |
| active | `updated_silently`: content replaced, `version` + 1, `notification.updated` with `alert: false`, read state kept | `alerted`: content replaced, `version` + 1, unread again, `notification.updated` with `alert: true` |
| resolved | `suppressed`: nothing changes, nothing is broadcast; the reason says when it was resolved and when the cooldown ends | `created`: new inform, alerts |

A created or alerted send counts against the `send` quota, a silent update against `update`, a suppressed one against
neither (the per-token rate limit still applies). The result is text:

```
outcome: updated_silently
id: ntf_01J…
Updated the notification with key "disk-full" without alerting: it alerted 12m ago, inside its 1h cooldown. The card shows the new text; sends with this key can alert again from 2026-10-30T13:05:00.000Z (in 48m).
```

Until the flat card is removed, an inform also carries the flat fields: `links` become link `actions`
(`link_1..3`, `url` set), and `fields`, `image`, `icon` are copied, so app builds from before intents still draw it.

`progress` reports long-running work by `(source, key)`. No running (or stopped) active progress with that key →
create one; the first report appears without sound (`created` event with flat `silent: true`). Otherwise the report
updates it in place (`updated`, `alert: false`); fields left out keep the previous report's value (the label only while
value and max are unchanged). `done` (value defaults to max, severity `success`) and `failed` (severity `warning`)
finish it with one alert (`updated`, `alert: true`, `silent: false`, unread again). A finished progress stays `active`
(not resolved) so its alert isn't cancelled; the next report with the key starts a fresh progress. New progress counts
as `send` (and the per-token rate limit), reports to a live one as `update`.

**Stopped reporting.** `staleAfter` (duration `"1m"`…`"24h"`, default `"30m"`; kept across reports until a report
changes it) is how long a running progress may go without a report. When `lastReportAt + staleAfter` passes, the
inbox's alarm marks it `state: "stopped"` with one alert (`updated`, `alert: true`, `reason: "update"`, severity
`warning`, flat `silent: false`, unread again); not charged to quotas. `value`, `max`, `label` and `lastReportAt` stay
what the sender last reported; every client shows "Stopped reporting after <label, else the rounded percent>"
(`stoppedReportingLabel` in `@oyee/schema`), e.g. "Stopped reporting after 3/7 checks" or "… after 40%". The next
report with the key revives it as `running` silently (`outcome: updated_silently`, and the tool text says it had
stopped reporting). A finished (`done`/`failed`) or resolved progress never stops; resolving a stopped one keeps
`stopped`.

**Keys across intents.** While the latest notification under a `(source, key)` is live (a running or stopped
progress, or an open, unexpired ask), the key belongs to that intent: `inform`, `ask` or `progress` with the key and
another intent fails with `conflict` (`409` over REST/webhooks once they send intents), and the message names the key,
the live notification's intent and id, and the fix (use a different key, or finish the progress with `done` /
`failed`, or withdraw the ask with resolve):

```
conflict: key "deploy" belongs to a running progress (id ntf_01J…). Use a different key for this inform, or first finish that progress by reporting it with key "deploy" and status "done" or "failed".
```

Once it is no longer live (finished progress, answered, expired or withdrawn ask, any inform, resolved or not) the
next intent takes the key over and creates a new notification; the old one is left as it was.

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

The server sends **data-only** messages (FCM v1 `android.priority = "HIGH"` when the event alerts (`created` unless
`silent`, or `updated` with `alert`) and for `critical`/`warning`, `"NORMAL"` otherwise). `alert` on `created` is
`"false"` for a `silent` notification (the first report of a running progress). `android.collapse_key` = notification id. Data map (all string values):

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

The browser popup is drawn from the intent block (`public/sw.js`, mirrored by `apps/web/src/lib/webpush.ts`):

- Buttons (browsers show at most two): an open ask shows its first two answer buttons (action `answer:<label>` →
  `POST …/respond { "option": "<label>" }`; a failure opens the notification in the inbox), then `Reply…` if it takes
  text and there's room (opens `/inbox/<id>?reply=1`). An inform shows its first two link buttons (action
  `link:<url>` → open the URL and `POST …/read`; nothing is sent back). Progress and closed asks have no buttons.
- Body: the markdown-stripped body, then an inform's rows as `Label: value` lines or a progress's line: the text bar
  while running, `Done · 7/7 checks` / `Failed · 4/7 checks` once finished, `Stopped reporting after 40%` when stopped.
- Icon and image come from the inform block. `critical` stays on screen (`requireInteraction`). Every severity
  alerts; only a running progress is shown silently.

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
