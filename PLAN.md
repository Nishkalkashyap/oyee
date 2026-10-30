# Oyee — Plan

> One inbox for everything that wants your attention: AI agents, cron jobs, Home Assistant, CI, infra monitors.
> Send a notification with one HTTP call or one MCP tool call, receive it on your phone, laptop and browser —
> with live-updating progress, action buttons and inline replies.

Oyee is a free, open-source project (public repo, MIT). It is not monetized. The web app/backend is hosted on
Cloudflare Workers. The Android APK (release-signed) and the macOS app (universal, ad-hoc signed, not notarized) are
published on **GitHub Releases** by CI on every `v*` tag; anyone can also build them from source. iOS is
build-from-source only (distribution needs a paid Apple account).

---

## 1. Why we're building it

1. **Agents run in the background now.** Claude Code, Codex, custom Slack agents and scheduled jobs monitor AWS,
   run long tasks, and need a way to say "done", "broken" or "I need a decision".
2. **The current options are heavy.** Slack/Discord/Telegram need accounts, bot apps, tokens and scopes just to
   send yourself a message. Every agent vendor is building its own notification channel, so alerts end up spread
   over many apps.
3. **Home Assistant and other tools only need a webhook.** Paste a URL into HA, and notifications arrive on every device.
4. **Simple push isn't enough for agents.** Agents produce *runs* that make progress, finish, fail and sometimes
   need an answer. Oyee treats notifications as live objects: they can be updated in place, resolved, answered and
   grouped into threads, and all of that stays in sync across devices.

Existing tools (ntfy, Pushover, Gotify, Pushcut, Bark, and MCP-specific apps like Pushary/AlertMCP) each cover part
of this. Oyee combines **MCP + webhook ingestion + live updates + two-way actions + cross-device sync + rich cards**
in one open-source, self-hostable package that we fully control.

## 2. Product summary

- Sign in to the web app with **Google**.
- The Home page shows what sends to you and the devices it reaches. **Add** creates an **MCP server URL** or a
  **webhook**: a scoped, revocable token and shows copy-paste snippets (Claude Code, Codex, generic MCP JSON, curl, Home Assistant YAML).
- **Pair devices** (Android, iOS, macOS) with a short pairing code / QR / deep link. The browser can also enable Web Push.
- **Inbox** (web + every client): sectioned by intent (Needs you, In progress, Updates), filter (source, severity,
  status, text), paginate, and act on notifications live.
- **MCP tools** (one per intent, docs/protocol.md §5): `inform`, `ask`, `wait_for_response`, `progress`, `resolve`,
  `list_notifications`, `list_devices`.

### Core concepts

| Concept | Meaning |
|---|---|
| **Notification** | A live object: shared fields (title, body, severity, url, status) plus exactly one **intent** block. Has a `version` that increments on every change. |
| **Intent** | `inform` (something to know: rows, image, icon, link buttons), `ask` (a question with answer buttons and/or a reply box, which expires) or `progress` (long-running work that can stop reporting). See GLOSSARY.md and docs/adr/0001. |
| **Source** | Who sent it ("aws-monitor", "home-assistant"). Defaults to the token's label. |
| **Key** | Optional name per source; sending again with it updates that notification (with an inform `cooldown` against repeat alerts). |
| **Severity** | `info` · `success` · `warning` · `critical`. Every severity alerts; the receiver decides what to mute. |
| **Status** | `active` or `resolved`. Resolving removes the system notification from every device. |
| **Answer** | The first answer to an ask (a button's label or typed text), from any device. Delivered to waiting MCP `wait_for_response` calls. |
| **Token** | `webhook` (send-only, via `/hook/<token>`), `mcp` (MCP tools), `device` (a paired client). Stored hashed and revocable. |

## 3. Delivery strategy per platform (decided)

| Platform | Primary transport | Fallback | Notes |
|---|---|---|---|
| **Android** | **FCM** data messages (wakes the app, battery-friendly) | **WebSocket foreground service** ("instant delivery" mode), for phones without Google services or builds without Firebase | `google-services.json` for the hosted instance's Firebase project is committed, so self-built APKs work against the hosted backend. Self-hosters swap in their own. The build must also succeed **without** that file (FCM is then disabled at runtime). |
| **macOS** | **WebSocket** from a menu-bar app (launch at login) → local `UNUserNotificationCenter` notifications | REST catch-up on reconnect | No APNs, because push requires a paid Apple Developer account and signing. An ad-hoc-signed, locally built app is enough. |
| **iOS** | **WebSocket** while the app is in the foreground or recently backgrounded → local notifications | `BGAppRefreshTask` best-effort catch-up + REST sync on launch | **No APNs (decided).** iOS won't get instant delivery while the app is suspended. This limitation is documented clearly. Built with Xcode using a free personal team (7-day provisioning) or a paid team. |
| **Web** | **WebSocket** for the live inbox | **Web Push (VAPID)** via service worker for background notifications | Web Push supports only title/body/icon/image + up to ~2 actions. Text replies open the inbox. |

## 4. Architecture

```
            ┌──────────── agents / scripts / HA / CI ─────────────┐
            │  MCP (Streamable HTTP)      Webhook POST/GET        │
            └──────────────┬───────────────────────┬──────────────┘
                           ▼                       ▼
   ┌─────────────────────────── Cloudflare Worker (apps/server) ───────────────────────────┐
   │  Hono router · Google OAuth · sessions · token auth · MCP handler · webhook adapters  │
   │  serves the SPA (apps/web build) from Workers static assets                           │
   │                                                                                       │
   │   D1 (global): users, sessions, tokens, devices, pairing codes                        │
   │   InboxDO (one per user, SQLite storage): notifications (one intent each), alarms,    │
   │            hibernatable WebSockets, MCP wait_for_response waiters, retention alarm    │
   │   Fan-out: WebSocket broadcast + FCM HTTP v1 + Web Push (VAPID, aes128gcm)            │
   └───────────────────────────────────────────────────────────────────────────────────────┘
          ▲ WebSocket / REST          ▲ FCM               ▲ Web Push           ▲ WebSocket / REST
     macOS menu-bar app           Android app          Browser (SW)          iOS app
```

### Repository layout (pnpm monorepo)

```
oyee/
├── PLAN.md                 ← this file
├── README.md
├── docs/protocol.md        ← THE contract: REST API, WebSocket protocol, FCM payload, intent schema, auth
├── packages/schema/        ← @oyee/schema: TypeScript types + zod schemas for the contract (source of truth for TS)
├── apps/server/            ← @oyee/server: Cloudflare Worker + Durable Objects + D1 (Hono, MCP, webhooks, push)
├── apps/web/               ← @oyee/web: React + Vite SPA (inbox, home, send); built into server assets
├── apps/android/           ← Kotlin + Jetpack Compose app (Gradle; not a pnpm package)
└── apps/apple/             ← Swift: OyeeKit package (shared) + macOS menu-bar app + iOS app (XcodeGen; not a pnpm package)
```

### Tech choices

- **Server**: TypeScript, Hono, Cloudflare Workers, Durable Objects (SQLite-backed, WebSocket Hibernation API),
  D1, Workers Static Assets, MCP via the official TypeScript SDK / Cloudflare `agents` stateless handler, zod.
  Tests: Vitest + `@cloudflare/vitest-pool-workers`.
- **Web**: React, Vite, TypeScript, React Router, TanStack Query, Tailwind CSS v4. Service worker for Web Push.
- **Android**: Kotlin, Jetpack Compose (Material 3), OkHttp (REST + WebSocket), kotlinx.serialization, DataStore,
  Firebase Messaging (optional at build time). minSdk 26, compile/target SDK 36. Uses `Notification.ProgressStyle` on API 36+.
- **Apple**: Swift 6, SwiftUI. `OyeeKit` Swift package (models, API client, `URLSessionWebSocketTask` client, local
  notification presenter, shared SwiftUI card views). macOS app buildable **without Xcode** via `swift build` + a script
  that assembles an ad-hoc-signed `.app` bundle. iOS app via XcodeGen `project.yml` (requires Xcode).

## 5. Features in detail

### 5.1 Ingestion
- **MCP**: `https://<host>/mcp/<mcp-token>` (token in the URL, for clients that can't set headers) or `https://<host>/mcp`
  with `Authorization: Bearer <mcp-token>`. Streamable HTTP transport, stateless.
- **Webhook**: `POST|GET https://<host>/hook/<webhook-token>`. Accepts:
  - JSON matching the send schema,
  - `text/plain` body (becomes `body`), with title/severity/etc. from query params or ntfy-style headers
    (`Title`/`X-Title`, `Priority`/`X-Priority` 1–5, `Click`/`X-Click`),
  - auto-detected **Prometheus Alertmanager**, **Grafana**, and **AWS SNS** payloads (SNS subscription confirmation is handled automatically).
- **Web composer + REST** `POST /api/notifications` for manual sends and tests.

### 5.2 Live updates and two-way answers
- Sending again with a notification's `key` updates it in place and increments `version`: a keyed inform alerts
  again unless inside its `cooldown`, a progress report updates silently until it finishes. Clients replace the system
  notification in place.
- Informs carry up to 3 link buttons (they open a URL; nothing is sent back).
- `ask` = up to 3 answer buttons and/or a reply box (Android `RemoteInput`, Apple `UNTextInputNotificationAction`,
  web: opens the inbox), then `wait_for_response` (long-poll ≤ 50 s per call, repeatable) for human-in-the-loop
  agents. The first answer closes it everywhere; it expires after `expiresIn`.

### 5.3 Cross-device sync
- Read / resolve / respond / delete on any device is broadcast to all others, which clear or update their system notification.
- Reconnecting clients catch up with `sync` (by `updatedAt` cursor).

### 5.4 Templates (removed)
- Templates were dropped with the flat card (protocol v2): senders send the fields themselves.

### 5.5 Rendering per platform (best effort from one schema; details in docs/protocol.md §9)

| Field | Android | macOS / iOS | Web Push | In-app inbox (all) |
|---|---|---|---|---|
| title / body | ✅ BigTextStyle | ✅ | ✅ | ✅ markdown subset |
| severity | channel per severity | relevance score | `requireInteraction` for critical | color + icon |
| inform rows | appended to big text | appended to body | appended to body | key/value grid |
| progress | `ProgressStyle` (36+) / `setProgress` | text in body; live bar in menu bar & inbox | text | progress card |
| inform image | BigPictureStyle | attachment (downloaded) | `image` | inline |
| inform links / ask answers | ✅ up to 3 | ✅ dynamic categories | ✅ up to 2 | ✅ |
| ask reply | RemoteInput | text-input action | opens inbox | text box |
| source | `setGroup` | `threadIdentifier` | `tag` | grouping |

### 5.6 Security
- Tokens are random and 32+ bytes, prefixed (`oyee_wh_`, `oyee_mcp_`, `oyee_dev_`), stored as SHA-256 hashes, shown in plaintext once, and revocable.
- Scopes: session = everything; `mcp` = notification tools; `webhook` = send only; `device` = read/act on notifications, register its own push transport, open a WebSocket.
- Optional `ALLOWED_EMAILS` allowlist so an instance can be private.
- Per-account daily quotas (1,000 sends, 5,000 updates, 1,000 answers, 20,000 reads), per-minute bursts, 60 sends/min
  per token, caps on devices/tokens, coalesced update pushes, per-IP sign-up and failed-auth limits, and
  payload size limits (docs/protocol.md §3.1).
- `DEV_LOGIN=true` enables a local-only login bypass for development and tests. It must never be enabled in production.

### 5.7 Retention
- Notifications are kept for 30 days and capped at 5,000 per user (configurable). A DO alarm prunes them daily.

## 6. Configuration (server)

| Variable | Purpose |
|---|---|
| `PUBLIC_URL` | e.g. `https://oyee.example.workers.dev` (used in snippets, OAuth redirect, deep links) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth (web app sign-in) |
| `SESSION_SECRET` | HMAC key for session cookies and the per-IP sign-up counters |
| `ALLOWED_EMAILS` | optional comma-separated allowlist |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push |
| `FCM_SERVICE_ACCOUNT_JSON` | Firebase service account for FCM HTTP v1 (same project as the Android `google-services.json`) |
| `DEV_LOGIN` | `true` only in local dev |
| `AUTH_FAILURES` (binding) | Workers Rate Limiting: failed token / pairing-code attempts per IP (`ratelimits` in wrangler.jsonc) |

## 7. Milestones

**M1 — built now, in parallel (one agent per app)**
- `packages/schema` + `docs/protocol.md` (done before the agents start: the contract).
- `apps/server`: auth (Google + dev login), tokens, pairing, devices, notifications CRUD, InboxDO + WebSocket,
  webhook (+ adapters), MCP tools, templates, FCM + Web Push fan-out, retention, tests.
- `apps/web`: login, Connect page (MCP URL / webhook with snippets), Inbox (live), notification detail with actions/reply,
  Devices (pairing code + QR, Web Push toggle), Templates editor with platform previews, Composer.
- `apps/android`: pairing, inbox, FCM + WebSocket foreground service, rich notifications (channels, progress, actions,
  reply, grouping, in-place updates, cross-device dismissal), settings.
- `apps/apple`: OyeeKit, macOS menu-bar app (live WebSocket, local notifications with dynamic actions/reply, inbox
  window, launch at login), iOS app (pairing, inbox, foreground socket, background refresh).

**M2 — later**
- Routing rules (severity → devices, quiet hours, digests, escalation if not acknowledged).
- MCP OAuth (instead of / in addition to the token URL).
- Optional bring-your-own APNs key for users with paid Apple accounts (real iOS push + Live Activities).
- AI digest/summaries of noisy sources, dedupe/collapse.
- Desktop clients for Windows/Linux (Tauri) if wanted.

## 8. Build & distribution

**Step-by-step setup for all three tested platforms (Cloudflare, Google OAuth, Firebase, web, Android, macOS):
[docs/setup.md](docs/setup.md).**

- Web/server: `pnpm install && pnpm deploy` (builds the web app, applies D1 migrations, deploys the worker). Secrets live in Cloudflare and persist across deploys.
- **Releases:** `git tag vX.Y.Z && git push origin vX.Y.Z` → `.github/workflows/release.yml` builds and publishes
  `Oyee-X.Y.Z.apk` (signed with the release key from Actions secrets; versionCode = X·10000 + Y·100 + Z) and
  `Oyee-X.Y.Z-macOS.zip` (universal arm64 + x86_64, ad-hoc signed), with `SHA256SUMS.txt` and install notes. The
  release keystore must be kept: every APK has to be signed with it for updates to install. No Play Store.
- **Self-update:** release builds check GitHub Releases (`releases/latest`). macOS (`OyeeAutoUpdate` in Info.plist,
  set by the release build) downloads the zip, verifies SHA256SUMS, swaps the bundle and relaunches automatically.
  Android notifies and shows a banner; Update downloads the APK with the system DownloadManager (public Downloads,
  Android 10+; older versions fall back to the browser), and the "Download complete" notification or the Downloads
  app opens the installer. No REQUEST_INSTALL_PACKAGES: Play Protect blocks sideloaded apps that hold it with
  "Harmful app blocked". Not the browser either: Brave stalls APK downloads at 100%.
- Android from source: `cd apps/android && ./gradlew assembleDebug` → sideload `app-debug.apk`.
- macOS from source: `apps/apple/scripts/build-macos-app.sh` → `Oyee.app` (ad-hoc signed; `UNIVERSAL=1` for both
  architectures). No notarization.
- iOS: `cd apps/apple && xcodegen && open Oyee.xcodeproj` → run on device with your own (free or paid) team.
- Every client lets you configure the **server URL**, so self-hosted instances work everywhere.

## 9. Definition of done (M1)

- `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build` pass.
- `wrangler dev` runs locally. With `DEV_LOGIN=true`, a full flow works end to end: log in → create webhook → curl a
  notification → it appears live in the web inbox → update/resolve via MCP → the inbox updates.
- Android: `./gradlew assembleDebug` succeeds (with and without `google-services.json`).
- Apple: `swift build` + `swift test` for OyeeKit succeed; the macOS `.app` bundle script succeeds. The iOS project is
  generated by XcodeGen and is unverified until Xcode is installed.

## 10. Status (2026-10-30)

M1 is implemented. Live at **https://oyee.app**. Latest app release: **v0.2.11** (GitHub Releases). Operating
procedures: [docs/operations.md](docs/operations.md).

**Notification intents (protocol v2)** are implemented on every client and the flat card is removed
(docs/protocol.md, `.scratch/notification-intents/`). Not yet released or deployed. 0.2.x app builds still decode v2
notifications (their decoders only require `id`) and show title, body and the progress bar; they lose icon, image,
rows, links and answering asks, and Android 0.2.x buzzes on the first progress report. Shipping app 0.3.0 alongside
the server deploy is recommended, not required.

### Platforms

| Platform | Status | Verified |
|---|---|---|
| **Web** | ✅ Tested in production | Google sign-in, live inbox, Web Push in Brave (needs "Use Google services for push messaging"), answering an ask, dismissal syncing across devices |
| **Android** | ✅ Tested in production | Galaxy S23 Ultra, Android 16: pairing, FCM + socket, progress updating in place, ask buttons answered from the notification, grouping |
| **macOS** | ✅ Tested in production | Menu-bar app (Xcode and no-Xcode builds): pairing, live socket, progress updating in place, inbox window, dismissal syncing across devices |
| **Server** | ✅ Deployed | Cloudflare Worker + DO + D1 (Drizzle migrations), MCP tools exercised end to end, FCM v1 and Web Push in production, per-account rate limits, 70 tests |
| **Releases + self-update** | ✅ Verified | macOS installed 0.2.0 → 0.2.5 by itself; Android notification + in-app DownloadManager download (0.2.4+) |
| **iOS** | ⏳ Pending | Code written. Not yet built with the iOS SDK or run on a device (deprioritized) |
| Windows / Linux | ⏳ Pending | Not started (M2) |

### Open follow-ups
- Android and macOS don't show quota usage yet (web shows it in the account menu); they show the server's 429 message.
- The release workflow doesn't retry a `macos-15` job that GitHub cancels in the queue (re-run manually).
- The Android update flow via DownloadManager (0.2.4+) has only been exercised by the maintainer's phone.
- Security hardening: an Origin check on cookie-authenticated POSTs.
- Web Push payload has no `alert` flag, so the browser re-alerts on visible updates.
- Android pins libraries compatible with compileSdk 36; bumping to 37 unlocks the newer AndroidX/Compose/OkHttp/Coil.
- Apple: no notification service extension and no device-rename UI.
- Per-source mute settings: with `debug` and `silent` gone every severity alerts, so the receiver should be able to
  mute or quiet a noisy source per device (spec: the receiver decides what to mute).
- The web inbox's `E` / `J` / `K` shortcuts aren't on macOS (plain-letter shortcuts would fire while typing a reply).
- The new inbox layout (sections, stacks, Resolve in the card footer) is unverified on the iOS app, which isn't built
  in CI.
