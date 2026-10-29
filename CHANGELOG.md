# Changelog

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
