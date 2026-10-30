# Oyee for Android

Native Android client for [Oyee](../../README.md), written in Kotlin with Jetpack Compose (Material 3).
It handles pairing, a live inbox with one card per intent (inform, ask, progress), and system notifications per
intent: one channel per severity, in-place updates, progress (`Notification.ProgressStyle` on Android 16 / API 36+),
images, link and answer buttons, inline replies, grouping, and dismissal across devices.
Delivery uses **FCM** when it's available and falls back to a **WebSocket foreground service** when it isn't.

Oyee is never on the Play Store. You build the APK yourself and sideload it.

- minSdk 26 (Android 8.0), compile/target SDK 36, applicationId `app.oyee.android`
- Implements [`docs/protocol.md`](../../docs/protocol.md) (REST, pairing, WebSocket §6, FCM §7, rendering §9)

## Build

Requirements: JDK 17+ (tested with 21) and the Android SDK with `platforms;android-36` and `build-tools;36.0.0`.
Point `local.properties` at the SDK (this file is gitignored):

```properties
sdk.dir=/path/to/android-sdk
```

Then:

```bash
cd apps/android
./gradlew assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest      # JVM unit tests
./gradlew lintDebug              # Android lint
```

The server URL pre-filled on the pairing screen comes from `BuildConfig.DEFAULT_SERVER_URL`
(default `https://oyee.app`, the hosted instance). To change it:

```bash
./gradlew assembleDebug -PoyeeServerUrl=https://oyee.mydomain.dev
```

(or put `oyeeServerUrl=…` in `~/.gradle/gradle.properties`).

Debug builds are for development. Published APKs are release builds (HTTPS-only), signed by the release workflow
with the key from GitHub Actions secrets; to sign one locally set `OYEE_KEYSTORE_FILE`, `OYEE_KEYSTORE_PASSWORD`,
`OYEE_KEY_ALIAS` and `OYEE_KEY_PASSWORD` (see [docs/operations.md §3](../../docs/operations.md)). Without them
`assembleRelease` produces an unsigned APK. Release builds check GitHub Releases for updates
(`update/AppUpdater.kt`); debug builds don't.

## Install

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or copy the APK to the phone and open it (you'll need to allow installs from that source).
Updating over an existing install keeps the pairing, because debug builds from the same machine share the same
debug keystore. Building on another machine means uninstalling first.

## Pair

1. In the Oyee web app, open **Home → Connect a device**. You'll see a code like `K7Q2-9XMA` and a QR code.
2. Do one of these:
   - Scan the QR code with the camera. It opens `oyee://pair?server=…&code=…`, which pre-fills the form.
     Check the server and tap **Pair**. (The app asks you to confirm instead of pairing silently, so a malicious
     link can't attach your phone to someone else's server.)
   - Open the app, enter the server URL and the code. The code is case-insensitive and the dash is optional.
3. Allow notifications when Android asks (Android 13+).

The device registers as `Build.MODEL` with platform `android`. Its token is stored in DataStore, encrypted with an
AES-256-GCM key in the Android Keystore. **Settings → Unpair** calls `DELETE /api/devices/self`. If the device is
removed from the web app, the next request gets a 401 and the app unpairs itself.

Test the deep link from a computer:

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "oyee://pair?server=http%3A%2F%2F10.0.2.2%3A8787&code=K7Q2-9XMA"
```

## FCM setup (optional at build time)

Firebase is **optional**. The `com.google.gms.google-services` Gradle plugin is applied only when
`app/google-services.json` exists:

| `app/google-services.json` | Result |
|---|---|
| present | FCM is compiled in and initialised. The app registers its token with `PUT /api/devices/self { fcmToken }` and receives data messages (§7). |
| absent | The build still succeeds. At runtime `FirebaseApp.getApps()` is empty, so FCM is skipped and the WebSocket service turns on automatically. |

- **Hosted instance:** the maintainer commits the hosted Firebase project's `google-services.json` to
  `apps/android/app/google-services.json`, so a plain `./gradlew assembleDebug` gets push via FCM against the
  hosted backend. (This file is meant to be public; it is not a secret.)
- **Self-hosters:** create a Firebase project, add an Android app with package name `app.oyee.android`,
  download its `google-services.json` into `apps/android/app/` (replacing the committed one), and rebuild.
  On the server, set `FCM_SERVICE_ACCOUNT_JSON` to a service-account key **from the same Firebase project**.
  If the server has no FCM credentials (`GET /api/config` → `fcmEnabled: false`), the app detects it and uses the
  socket instead.

FCM also needs Google Play services on the phone. On de-Googled phones the token request fails and the app falls
back to the socket.

## How transport selection works

| Setting → *Instant delivery* | Behaviour |
|---|---|
| **Auto** (default) | FCM if the build has Firebase config, Play services issue a token, the token is registered and the server has FCM enabled. Otherwise the WebSocket foreground service starts automatically. |
| **On** | Always run the WebSocket service, in addition to FCM. Fastest, but uses a bit more battery. |
| **Off** | Never run the service. Without FCM, notifications only arrive while the app is open. |

Notes:

- **While the app is visible** it always holds a live WebSocket, even on FCM, so the inbox updates in real time.
- **Duplicates are filtered.** Events from every path (FCM, socket, REST catch-up, your own actions) go through one
  `EventProcessor`, which drops anything with a `version` it has already seen. Getting the same change from FCM
  and the socket is harmless.
- **The WebSocket service** (`SocketService`) connects to `GET /api/ws` with `Authorization: Bearer <token>`.
  It sends `{"type":"ping"}` every 30 s and reconnects if nothing arrives for 75 s. On every connect it sends
  `sync` with the stored cursor. Reconnects use exponential backoff with jitter (1 s → 60 s) and happen
  immediately when the default network changes. The service restarts after reboot (`BOOT_COMPLETED`) and after
  app updates (`MY_PACKAGE_REPLACED`).
- **Foreground service type `specialUse`.** `dataSync` is capped at 6 h per 24 h on Android 15 and can't start
  from `BOOT_COMPLETED`. `remoteMessaging` is meant for continuing a messaging conversation across devices. The
  service shows a silent, minimum-importance "Oyee connected" notification. To hide it, long-press it and
  turn off the *Connection status* channel; the service keeps running.
- **REST catch-up.** When the app comes to the foreground (and after FCM errors or deleted-message events) it
  calls `GET /api/notifications?updatedSince=<newest updatedAt seen>`. This cancels anything read or resolved
  elsewhere and posts anything created while the device was offline.

## Notifications

The app reads the notification's `intent` and its `inform` / `ask` / `progress` block (protocol v2). What each intent offers and how it alerts is decided in one pure place,
`notify/NotificationPlan.kt` (unit-tested); `NotificationRenderer` turns that into a system notification.

- **Channels:** `oyee.critical`, `oyee.warning`, `oyee.info`, `oyee.success`. Critical and warning are high
  importance (heads-up) with sound and vibration; info and success use default importance. Every severity alerts.
  The old `oyee.debug` channel is deleted on upgrade. Tune them under **Settings → Notifications → Channels**.
- **Identity:** each notification's tag is the Oyee id, and its numeric id is a stable FNV-1a hash of that id.
  Updates replace the notification in place with `setOnlyAlertOnce(true)` unless the event has `alert: true`.
- **Per intent:**
  - **Inform:** the severity's channel, the markdown body plus `Label: value` rows (`BigTextStyle`), the image
    (`BigPictureStyle`, downloaded with a 10 s timeout), an emoji or URL icon as the large icon. Buttons: its link
    buttons (open the URL and mark it read), then **✓ Resolve** if a slot is free.
  - **Ask** (always warning): its answer buttons (`POST …/respond {option}`, without opening the app) and, when it
    takes text, an inline reply (RemoteInput, `POST …/respond {text}`); a reply takes one of the 3 slots, so a third
    answer is only in the app. No Resolve button (resolving would withdraw the question). The first answer from any
    device resolves it, so it leaves the tray everywhere; it also leaves when it expires (`setTimeoutAfter`, and the
    server's broadcast) or is withdrawn. A late answer gets `409`: the notification is cancelled, not retried.
  - **Progress:** while running, `ProgressStyle` on API 36+ (`setProgress` below) and never a sound, including the
    first report. Done, failed and stopped alert once with "Done · 7/7 checks", "Failed · 4/7 checks" or "Stopped
    reporting after 40%"; a finished progress stays in the tray until it's read. Button: **✓ Resolve**.
- **Cancellation:** a notification is cancelled when it's read (`readAt` set), resolved or deleted anywhere.
- **Metadata:** `setWhen(createdAt)` and `setSubText(source)`. Grouped by `source`, with a group summary.
- **Taps:** tapping the body opens `url` (or the in-app detail) and calls `POST …/read`.
- **Offline:** answers, replies and Resolve are queued in WorkManager and retried when the network is back.
- **Swipe to dismiss** can mark the notification read. This is off by default; turn it on in Settings.

## Local development with `wrangler dev`

Debug builds allow cleartext HTTP to local addresses only: `localhost`, `10.0.2.2`, private and link-local IPs,
and `*.local`. This comes from a debug-only network security config plus a check in the app (`ServerUrl`).
Release builds are HTTPS-only.

| Where the app runs | Server URL to enter |
|---|---|
| Android emulator | `http://10.0.2.2:8787` (the host machine's `localhost`) |
| USB-connected phone | run `adb reverse tcp:8787 tcp:8787`, then use `http://localhost:8787` |
| Phone on the same Wi-Fi | `http://192.168.x.y:8787` (start wrangler with `--ip 0.0.0.0`) |

With `DEV_LOGIN=true` on the server, sign in to the web app through `/auth/dev-login`, create a pairing code, and
pair the emulator with it. FCM won't work against a local server unless it has `FCM_SERVICE_ACCOUNT_JSON`, so the
app uses the socket automatically.

## Battery optimisation

FCM high-priority data messages wake the app even in Doze, so most people don't need to change anything.
If you rely on the **WebSocket service** (no Play services, a self-hosted server without FCM, or Instant delivery
= On):

- Go to **Settings → Battery → Allow running in background**. This requests an exemption with
  `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. That permission is acceptable here because the app is sideloaded,
  not distributed through Play.
- Some manufacturers (Xiaomi, Huawei, Samsung, OnePlus, …) kill background apps aggressively despite this. Follow
  the per-vendor steps at <https://dontkillmyapp.com>. These usually involve "autostart" or "unrestricted battery".
- The inbox opens on **Active**, sorted like the web inbox (`ui/inbox/InboxSections.kt`): **Needs you** (open asks,
  answerable from the list), **In progress** (running or stopped progress) and **Updates**, where repeats with the same
  source and key, or source + title without a key, stack into one row with a count (tap to open the newest and expand
  the rest). The conversation view draws one card per intent (`ui/cards/`): inform, ask (waiting, answered, expired,
  withdrawn) and progress (running, done, failed, stopped); their labels come from the pure `ui/cards/CardViews.kt`.
  Swipe a row right to resolve it (a stack resolves as a whole); Resolve also sits in the card's footer and goes back
  to the list. Resolved notifications are a row at the end of the list ("All caught up" once everything is resolved).
- Blue in a row means unread and nothing else: only critical and warning put a coloured dot on the avatar.
- The connection status ("Live", "Reconnecting…", "Offline") is shown in the inbox header and on the Settings
  screen.

## Code map

```
app/src/main/java/app/oyee/android/
├── OyeeApp.kt                 Application + AppContainer (manual DI, process lifecycle, unpair)
├── model/                       kotlinx.serialization mirror of packages/schema (Notification, Device, WS + FCM messages)
├── data/                        SettingsStore (DataStore), TokenCipher (Keystore AES-GCM), OyeeApi (OkHttp REST),
│                                EventProcessor (dedupe + fan-out), SyncManager (REST catch-up)
├── notify/                      Channels, NotificationPlan (buttons / alerting per intent), NotificationRenderer,
│                                Intents (PendingIntents), NotificationActionReceiver,
│                                NotificationOpenActivity (tap trampoline), Images, Spans, PostedLog
├── transport/                   SocketClient (OkHttp WebSocket), SocketService (FGS), TransportManager, FcmSupport,
│                                OyeeMessagingService (FCM), BootReceiver
├── work/OyeeWorker.kt         WorkManager jobs: read, respond (offline retry), sync, FCM re-registration
├── util/                        PairingCode, ServerUrl, Formatting (progress text, fields), Markdown parser,
│                                NotificationIds (FNV-1a), Backoff
└── ui/                          MainActivity (navigation, deep links), pair/, inbox/, detail/, settings/, components/,
                                 cards/ (one card per intent + the pure views behind their labels)
```

## Dependency versions

All versions live in `gradle/libs.versions.toml`. Several libraries are pinned to the newest release that still
supports **compileSdk 36**, because newer ones require compileSdk 37:

| Library | Version used | Newer, but needs compileSdk 37 |
|---|---|---|
| androidx core | 1.18 | core 1.19 |
| Compose BOM | 2026.06.01 | BOM 2026.08+ |
| lifecycle | 2.10 | lifecycle 2.11 |
| OkHttp | 5.4 | OkHttp 5.5 |
| Coil | 3.5 | Coil 3.6 |

Lint lists these pins as "newer version available" warnings; that's expected. When the project moves to
compileSdk 37, bump them together.
