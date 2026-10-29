# Changelog

## Unreleased (server and web)
- Rate limits per account: 1,000 notifications, 5,000 updates and 1,000 replies a day, with per-minute burst limits,
  `429` + `Retry-After` when exceeded, and an inbox notice at 80% and 100%. Today's usage is in the web account menu.
- At most 10 devices, 20 tokens and 100 templates per account. Push notifications for rapid updates (progress bars)
  are coalesced to one per 2 seconds per notification.
- Per-IP limits on new accounts and failed token attempts.
- Web: Help button in the sidebar with downloads for every platform and links to the docs.
- Web: a landing page replaces the bare sign-in card for signed-out visitors (at `/` and `/login`): a live demo of an
  agent updating a card and asking a question, integration cards with official logos, feature tiles, platform previews with downloads and
  copy-paste setup snippets. Sign-in errors and the dev-login form are shown in the hero.
- Install with an AI agent: copyable prompts (landing page below the downloads, Help dialog and README) that have Claude Code, Codex or another agent
  download, checksum and install the macOS app, or the Android app over `adb`. The Gatekeeper workaround is now
  `xattr -cr`, which also clears flags other than quarantine.

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
