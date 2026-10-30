# Changelog

## Unreleased (server and web)
- MCP `progress` tool: an agent reports long-running work by a key it chooses. The first report appears without
  sound, later reports update it silently, and `done` or `failed` alerts once; a finished progress stays in the inbox
  until read. The tool answers in plain text with the outcome and the next step. The web inbox draws progress with
  its own card (state pill, a real bar with its label, last report), and a failed progress is no longer listed under
  In progress. Silent notifications no longer go out as alerting, high-priority FCM messages.
- Notifications carry their intent: every notification returned by REST, WebSocket, push and MCP now also has
  `intent` (inform, ask or progress), `key` and an `inform` / `ask` / `progress` block (docs/protocol.md §1.1). Flat
  sends get the intent they most resemble and existing notifications are converted once; the flat card fields are
  unchanged, so current app builds keep working.
- Web: a simpler landing page that reads like a README. One line on what Oyee does, the two setup commands, a card
  you can answer to see the reply go back, and sign-in. The integration grid, feature tiles, platform previews and
  setup tabs are gone (downloads are in Help and the pairing dialog).
- Web: **Home** replaces the Connect and Devices pages. It shows what sends to you next to the devices it reaches,
  with **Add** (MCP URL or webhook), **Connect a device** (pairing code with direct app downloads) and a "This browser"
  row to turn on Web Push or explain that it's blocked. `/devices` redirects to Home; the apps and docs now say
  "Home → Connect a device".
- Web inbox: **Needs you** (questions, answerable from the list), **In progress** and **Updates** sections; repeats of
  the same thread or source + title stack into one row with a count. Resolve sits in the card's footer, appears on row
  hover, works by swiping a row right on touch screens, and with `E` (`J` / `K` move). The filter chips, status tabs
  and severity menu are gone: search sits behind a button, filters show as removable pills and Resolved is a row at
  the end of the list.
- Web inbox: blue means unread and nothing else. Info notifications no longer get a blue dot on the avatar (only
  critical and warning get a coloured mark), so read rows stop looking unread.
- Rate limits per account: 1,000 notifications, 5,000 updates and 1,000 replies a day, with per-minute burst limits,
  `429` + `Retry-After` when exceeded, and an inbox notice at 80% and 100%. Today's usage is in the web account menu.
- At most 10 devices, 20 tokens and 100 templates per account. Push notifications for rapid updates (progress bars)
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
