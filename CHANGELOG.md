# Changelog

## Unreleased (server and web)
- **Protocol v2: the flat card is removed.** Every notification is exactly one intent (inform, ask or progress) with
  its block; the v1 card fields (`actions`, `reply`, the card-level `progress`, `icon`/`image`/`fields` outside the
  inform block, `threadId`, `tags`, `silent`, `template`, `responses`) are no longer sent. The `debug` severity is
  gone: stored debug notifications became `info`. Templates (`/api/templates`), `PATCH /api/notifications/:id`,
  action callbacks and the token's callback signing secret are deleted. A send that still uses a removed field
  (`replaceKey`, `template`, `vars`, `actions`, `reply`, `progress`, `threadId`, `tags`, `silent`, or severity
  `debug`) gets `400` naming what to use instead (webhook query sends ignore `?threadId=` and `?tags=`). Respond takes `{ "option" }` or
  `{ "text" }` and only on asks. The list endpoint drops `threadId`. Each inbox converts its stored notifications
  once (v1 cards to the intent they resemble); converted asks and unfinished progress are resolved, so they leave
  the inbox and the tray and free their key; each converted card gets a new version and `updatedAt` so every client syncs it again. docs/protocol.md is rewritten as protocol v2. **App builds before
  0.3.0** still decode v2 notifications (their decoders only require `id`) and show title, body and the progress
  bar; they lose icon, image, rows, links and answering asks, and Android 0.2.x buzzes on the first progress report.
  Shipping 0.3.0 alongside this deploy is recommended, not required.
- Web: cards, mock mode, the Send preview and the landing demo are intent-only; the token snippets use `key`,
  `cooldown` and progress intents. An open ask past its expiry leaves Needs you right away. Search also matches an
  ask's answer buttons and a progress's label, as on the server.
- Webhooks and REST send intents, with the same field names as the MCP tools: a JSON body is an inform by default or
  `{ "intent": "progress", "key": …, "value": … }`, and `?intent=progress` with `key`, `value`, `max`, `label` and
  `status` works for plain-text, GET and header sends. They go through the same inbox operations as agents, so `key`,
  `cooldown`, the cross-intent key conflict and stopped reporting behave identically. Responses add `outcome` and
  `reason` next to `id` and `version`. `intent: "ask"` gets `400`: asks are for agents over MCP. Alertmanager and
  Grafana produce informs keyed by the group (a `debug` severity label becomes info) and the group's resolution
  resolves that inform; SNS produces an inform. `?replaceKey=` and `?template=` are no longer accepted (`400`
  pointing to `key`); `?threadId=`, `?tags=` and ntfy `Tags` are ignored, so existing curl one-liners keep working,
  and ntfy priority 1 is info.
- `POST /api/notifications` takes the same intent-tagged body and answers `{ id, version, outcome, reason,
  notification }`. The web Send page composes an inform (severity, key, cooldown, icon, image, rows, link buttons) or
  a progress (key, value, max, label, status, staleAfter); thread, tags, silent, actions, reply and templates are gone
  from it.
- Asks expire: `ask` takes `expiresIn` (default 1h, at most 24h). When it runs out the ask leaves every device's
  tray, shows "Expired" in the inbox with its buttons disabled, and `wait_for_response` reports it expired (a pending
  result now also says when the ask expires). Resolving an open ask withdraws it ("Withdrawn"). Answers to an
  expired or withdrawn ask get `409`. The web ask card shows when an open ask expires and explains why a closed one
  can't be answered.
- Durations, progress amounts and the intent rules behind them ("open ask", "live progress", "quiet running
  progress") are display helpers in `@oyee/schema` (`formatDuration`, `progressAmount`, `isOpenAsk`,
  `isLiveProgress`, `isQuietProgress`) that the server and the web share, so tool results and cards say "12m",
  "2h 30m" and "3/7" the same way. An ask's last minute now reads "Expires in under a minute" (it said "1m" from
  30 s on), an ask shorter than a minute says "Nobody answered within 30s", and an empty progress label is shown as
  sent instead of falling back to the percent.
- Web inbox on intents: **Needs you** lists open asks (answer buttons and Reply right in the list), **In progress**
  running or stopped progress, **Updates** everything else. Notifications with the same key from the same source stack
  as one row (without a key: same source and title). Tag chips, tag search, the thread filter and the Templates page
  are gone (`/templates` redirects to Home). A running progress arrives without an in-app toast.
- Web Push popup on intents: an open ask shows its first two answer buttons and answers with `{ "option" }`; an inform
  shows its first two link buttons, which open their URL; a finished or stopped progress says how it ended ("Done ·
  7/7 checks", "Stopped reporting after 40%"); only a running progress is silent.
- MCP: agents now see exactly seven tools: `inform`, `ask`, `wait_for_response`, `progress`, `resolve`,
  `list_notifications` and `list_devices`. `send_notification`, `update_notification`, `get_notification` and the
  three template tools are gone, and `resolve` replaces `resolve_notification` (on an open ask it withdraws it). The
  server instructions explain in a few lines when to use inform, ask and progress. Every acting tool answers in one
  shape: `outcome:` and `id:` lines, then what happened and the next step. `list_notifications` filters by key,
  intent, status and source, returns 10 compact items by default (at most 50) with a cursor, and says how long ago
  each was sent (`"12m"`).
- Keys across intents: reusing a key whose latest notification is a running or stopped progress or an open ask, with
  a different intent (`inform`, `ask` or `progress`), now fails with a conflict that names the key, what holds it and
  how to fix it. Once that notification is finished, answered, expired or withdrawn, the new intent takes the key.
- Ask end-to-end: the MCP `ask` tool takes a question, up to three answer buttons and/or a text box, a `url` and a
  `key`, always alerts at warning, and answers in text that tells the agent to call `wait_for_response`; asking again
  with the key of an open ask returns it instead of alerting again. `wait_for_response` holds up to 50 s and says
  who answered from which device, or how long ago it asked. The first answer from any device closes the ask
  everywhere; later answers get `409`. Respond accepts
  `{ "option": "<label>" }`. The web inbox shows a purpose-built ask card: waiting time, buttons and reply box while
  open, "Answered: Approve · Pixel 9" once answered.
- MCP: new `inform` tool for one-way notifications (title, markdown body, severity, url, up to 3 link buttons, up to
  10 rows, image, icon, key). Sending again with the same key from the same source updates the active notification
  and alerts again instead of creating a duplicate. The result says what happened (`created` / `alerted`) and the id
  in plain text.
- MCP: `inform` takes a `cooldown` (such as `"1h"`, 1m to 168h) alongside its key, so a cron agent alerts the user at
  most once per cooldown: sends inside it update the card's text silently (`updated_silently`), and if the user
  resolved it inside the cooldown nothing changes (`suppressed`, with when it was resolved and when the cooldown
  ends). The cooldown runs from the key's last alert.
- Web: informs get their own card in the inbox's conversation view: icon and severity, body, rows in a soft inset,
  image and link buttons, with where a tap goes shown as the host.
- MCP `progress` tool: an agent reports long-running work by a key it chooses. The first report appears without
  sound, later reports update it silently, and `done` or `failed` alerts once; a finished progress stays in the inbox
  until read. The tool answers in plain text in the same shape as `inform`: an `outcome:` line (`created`,
  `updated_silently` or `alerted`), an `id:` line, then what happened at what amount ("at 3/7 checks") and the next
  step (report again with the key, finish with `done` or `failed`, and when it would count as stopped reporting).
  Webhooks and REST return the same `outcome` and `reason` as JSON. The web inbox draws progress with
  its own card (state pill, a real bar with its label, last report), and a failed progress is no longer listed under
  In progress. Silent notifications no longer go out as alerting, high-priority FCM messages.
- Web inbox: a progress that stopped reporting has its row bar greyed out, as on its card, so it no longer looks as
  alive as a running one.
- Stopped reporting: a running progress that gets no report for `staleAfter` (default 30m, `progress` tool input, 1m
  to 24h) alerts once at warning and shows "Stopped reporting after 40%" (its last label or percent). The next report
  brings it back as running, silently. The web progress card says how long it went quiet and that a report revives it.
- Notifications carry their intent: every notification returned by REST, WebSocket, push and MCP has `intent`
  (inform, ask or progress), `key` and an `inform` / `ask` / `progress` block (docs/protocol.md §1.1).
- Web: a simpler landing page that reads like a README. One line on what Oyee does, the two setup commands, a card
  you can answer to see the reply go back, and sign-in. The integration grid, feature tiles, platform previews and
  setup tabs are gone (downloads are in Help and the pairing dialog).
- Web: **Home** replaces the Connect and Devices pages. It shows what sends to you next to the devices it reaches,
  with **Add** (MCP URL or webhook), **Connect a device** (pairing code with direct app downloads) and a "This browser"
  row to turn on Web Push or explain that it's blocked. `/devices` redirects to Home; the apps and docs now say
  "Home → Connect a device".
- Web inbox: **Needs you** (questions, answerable from the list), **In progress** and **Updates** sections; repeats of
  the same key or source + title stack into one row with a count. Resolve sits in the card's footer, appears on row
  hover, works by swiping a row right on touch screens, and with `E` (`J` / `K` move). The filter chips, status tabs
  and severity menu are gone: search sits behind a button, filters show as removable pills and Resolved is a row at
  the end of the list.
- Web inbox: blue means unread and nothing else. Info notifications no longer get a blue dot on the avatar (only
  critical and warning get a coloured mark), so read rows stop looking unread.
- Rate limits per account: 1,000 notifications, 5,000 updates and 1,000 answers a day, with per-minute burst limits,
  `429` + `Retry-After` when exceeded, and an inbox notice at 80% and 100%. Today's usage is in the web account menu.
- At most 10 devices and 20 tokens per account. Push notifications for rapid updates (progress bars)
  are coalesced to one per 2 seconds per notification.
- Per-IP limits on new accounts and failed token attempts.
- Web: Help button in the sidebar with downloads for every platform and links to the docs.
- Install with an AI agent: copyable prompts (Help dialog and README) that have Claude Code, Codex or another agent
  download, checksum and install the macOS app, or the Android app over `adb`. The Gatekeeper workaround is now
  `xattr -cr`, which also clears flags other than quarantine.
- Inbox: resolved notifications leave the default view (`?status=resolved` / `?status=all` show them), with an
  "All caught up" state once everything is resolved.
  Unread counts (`GET /api/sources`, badges) count only active notifications.
- New accent colour: Ocean blue replaces orange across the web app (brand mark, unread counts, send buttons,
  selected chips, your reply bubbles), the favicon and the installable web-app icons.
- Avatars: the peach avatar tint is now slate, so no orange is left (sources and accounts that hashed to peach,
  such as your own account avatar, change colour).

## Unreleased (apps, next release: 0.3.0)
- **Protocol v2 only.** The apps read nothing but the intent blocks, so they keep working once the server stops
  sending the flat card. (0.2.x builds keep showing title, body and the progress bar from v2 notifications, but not
  icon, image, rows, links or answer buttons; shipping this alongside that server deploy is recommended.) An ask
  that takes text without a reply placeholder shows the app's own "Reply…".
- No more indeterminate progress (protocol v2 has none): Android drops the card's animated bar and the system
  notification's indeterminate flag, so a progress always shows how far it is. A progress that stopped reporting has
  a greyed-out bar (Android: card and inbox row; macOS: card).
- macOS on intents: the Mac app reads the intent-shaped notification and draws one card per intent. An **inform**
  shows its icon, severity, body, rows and up to three link buttons. An **ask** says how long it has waited and when
  it expires, with its answer buttons (answering sends `{ "option" }`) and the reply box as the conversation's
  composer; once closed it reads "Answered: Approve · Pixel 9", "Expired" or "Withdrawn" with its buttons disabled.
  A late answer (another device was first) shows who won. A **progress** has a real bar that reads Running, Done,
  Failed or "Stopped reporting after 40%".
- macOS inbox and menu bar: **Needs you** is open asks, **In progress** running or stopped progress, **Updates**
  everything else; repeats stack by source and key (without a key: source and title).
- macOS notifications: an open ask has its answer buttons and a text Reply; an inform its link buttons; a progress
  shows the text bar while running, updates silently, and alerts once when done, failed or stopped. Answered, expired
  and withdrawn asks leave Notification Center. Every severity alerts.
- macOS: tags, threads, `silent`, the `debug` severity and templates are gone from the app. The inbox cache from
  0.2.x is dropped once and refilled from the server.
- Android on intents: the app reads the `intent` and its `inform` / `ask` / `progress` block and draws one card per
  intent in the conversation view. Inform: icon and severity, body, rows, image, link buttons. Ask: "Waiting 12m" and
  "Expires in 48m" while open, answer buttons and the reply box, then "Answered: Approve · Pixel 9", "Expired" or
  "Withdrawn" with the buttons disabled. Progress: a state pill and a real bar ("Running", "Done", "Failed", "Stopped
  reporting after 40%"). The inbox sections are the intents (Needs you = open asks, In progress = running or stopped
  progress, Updates = the rest) and repeats stack by source and key.
- Android system notifications per intent: an inform alerts on its severity's channel with its link buttons; an open
  ask shows its answer buttons and an inline reply, answers with `{ "option" }` / `{ "text" }`, and leaves the tray
  once answered (from any device), expired or withdrawn (an answer that arrives too late is dropped, not retried); a
  running progress updates silently with native progress, and done, failed and stopped alert once. The Debug
  notification channel is deleted on upgrade; tags, threads and `silent` are gone.
- Android and macOS word durations and progress amounts exactly like the web (ports of `formatDuration` and
  `progressAmount` from `@oyee/schema`, tested on the same cases): an ask's last minute reads "Expires in under a
  minute".

## 0.2.11
- Inbox sorted like the web: **Needs you** (questions, answerable from the list), **In progress** and **Updates**;
  repeats of the same thread, or source + title, stack into one row with a count. The filter chips and status tabs
  are gone; Resolved is a row at the end of the list.
- Blue means unread and nothing else: info notifications no longer get a blue dot on the avatar.
- Resolve moved from the conversation header into the card's footer. Android goes back to the list afterwards and
  resolves a row with a swipe to the right; the Mac inbox window opens the next row and shows a ✓ on row hover.
- macOS menu bar: the same order, with repeats stacked; the ✓ on a stack resolves all of it.
- Pairing screens now say "Home → Connect a device", matching the web app.

## 0.2.10
- macOS: clicking the Settings test notification no longer shows "Notification test-… not found" in the inbox (it
  was sent to the server, which never had it). Acting on a notification that was deleted on another device now
  removes it quietly instead of leaving an error.

## 0.2.9
- macOS: a ✓ on each menu-bar notification resolves it in one tap.
- Android: notifications in the shade get a **✓ Resolve** button (when one of the 3 button slots is free), so you
  don't have to open them to dismiss them.
- macOS: when notifications are blocked in System Settings, a "Notifications are off · Turn on" notice appears in the
  menu bar and the inbox instead of banners silently not showing.
- macOS: brand-new notifications read "now" instead of "in 0 sec" when the Mac's clock is slightly behind.

## 0.2.8
- macOS and Android: the peach avatar tint is now slate, matching the web, so no orange is left.

## 0.2.7
- New accent colour: Ocean blue replaces orange in the macOS and Android apps, including the app icon, the Android
  launcher icon and the tint of Android system notifications.

## 0.2.6
- macOS and Android: the inbox opens on **Active**. Resolved notifications leave the default list and the macOS
  menu bar and move to a **Resolved** tab (**All** shows both); resolving everything leaves "All caught up".

## 0.2.5
- Update check demo: from 0.2.4, Android downloads this release in the app (download manager) instead of the browser.

## 0.2.4
- Android: Update downloads the APK with Android's download manager instead of the browser (Brave could stall at
  100%). The banner shows progress, then **Install** opens Downloads; or tap the "Download complete" notification.

## 0.2.3
- Update check demo: Android shows "Oyee 0.2.3 is available"; macOS installs it automatically.

## 0.2.2
- Android: Update now downloads the new APK in your browser instead of installing it from the app. Versions 0.2.0
  and 0.2.1 could install APKs themselves, which made Play Protect block them ("Harmful app blocked").

## 0.2.1 (withdrawn)
- Removed: its Android APK was blocked by Play Protect. Use 0.2.2 or later.

## 0.2.0 (withdrawn)
- Removed: its Android APK was blocked by Play Protect. Use 0.2.2 or later.
- New Oyee mark: an "o" speech bubble with an unread dot.
- Self-update from GitHub Releases: automatic on macOS; notification + one-tap install on Android.

## 0.1.0
- First release: web app at oyee.app, Android app (FCM + live connection), macOS menu-bar app.
- MCP tools and webhooks, live-updating notifications, two-way actions and replies, device targeting.
