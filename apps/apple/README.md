# Herald for macOS and iOS

Native Apple clients for [Herald](../../README.md): a menu-bar app for macOS and an iPhone/iPad app, both built
on the shared **HeraldKit** Swift package.

- **macOS** (main desktop experience): a menu-bar app that keeps a WebSocket to your Herald server open and turns events
  into native notifications. You get live progress, action buttons, inline replies, cross-device dismissal, an inbox
  window and launch at login.
- **iOS**: pairing, inbox, live updates while the app is open, and best-effort background catch-up.

> **No APNs.** Herald doesn't use Apple Push Notifications, because that needs a paid Apple Developer account and
> signing. Delivery is a WebSocket.
> - On **macOS** this works well: the menu-bar app runs in the background (turn on *Launch at login*).
> - On **iOS**, notifications are only **instant while the app is open** (plus about 25 s after you leave it). When
>   the app is suspended, iOS can't wake it. Herald then catches up with a `BGAppRefreshTask` when iOS decides to run
>   it (at best every ~15 min, often less), and fully when you open the app.

## Layout

```
Package.swift                 HeraldKit (library) + HeraldMac (executable); macOS 14 / iOS 17; Swift 6 language mode
Sources/HeraldKit/
  Models/                     Codable mirror of packages/schema (lenient: unknown keys/enum values, missing keys → defaults)
  Networking/HeraldAPI.swift  async REST client (Bearer device token, error envelope → HeraldAPIError)
  Networking/HeraldSocket.swift  /api/ws client: hello → sync(cursor), ping 30 s, backoff 1→60 s + jitter,
                              reconnect on network path change (NWPathMonitor) and wake from sleep (macOS)
  Store/                      InboxStore (@Observable; REST paging/filters + socket events + JSON cache),
                              HeraldModel (wires everything), CredentialStore
  Notifications/              NotificationPresenter (UserNotifications, dynamic categories, attachments)
  Support/                    pairing code/URL/deep-link parsing, markdown subset, progress text, backoff/sync cursor
  Views/                      shared SwiftUI: NotificationCardView, InboxListView, PairingView, …
Sources/HeraldMac/            macOS app: MenuBarExtra + inbox Window + Settings
iOS/                          iOS app: pairing → inbox → settings, foreground socket, background refresh
Tests/HeraldKitTests/         Swift Testing suites + JSON fixtures from docs/protocol.md
Resources/                    Info.plist files for both apps
project.yml                   XcodeGen spec (iOS + macOS app targets)
scripts/build-macos-app.sh    builds build/Herald.app without Xcode
scripts/test.sh               runs the tests (see "Tests")
scripts/typecheck-ios.sh      compile-checks the iOS code against Mac Catalyst (no iOS SDK needed)
```

## macOS: build without Xcode

You only need the Xcode **Command Line Tools** (`xcode-select --install`), with Swift 6 and the macOS 14+ SDK.

```sh
cd apps/apple
scripts/build-macos-app.sh          # swift build -c release → build/Herald.app, ad-hoc signed
mv build/Herald.app /Applications/
open /Applications/Herald.app
```

The app has no Dock icon. Look for the bell in the menu bar. On first launch it opens a window to pair it:

1. In the Herald web app, open **Devices → Pair a device**.
2. Enter the server URL and the `XXXX-XXXX` code, or click the `herald://pair?…` link on the Mac (the form is
   prefilled and you confirm with **Pair**).
3. Allow notifications when macOS asks.
4. In **Settings…**, turn on **Launch at login**. This needs the app in `/Applications`; macOS may ask you to approve
   it under *System Settings → General → Login Items*.

**Gatekeeper.** A Mac you built the app on runs it without complaint. If you copy or download the app to another Mac,
it's quarantined and unnotarized, so either right-click → **Open** the first time, or run:

```sh
xattr -dr com.apple.quarantine /Applications/Herald.app
```

Notes:
- If Xcode is installed but its license hasn't been accepted, `swift` fails. Either run `sudo xcodebuild -license`,
  or point the tools at the Command Line Tools with `export DEVELOPER_DIR=/Library/Developer/CommandLineTools` (the
  build script does this automatically).
- Running the bare binary (`swift run HeraldMac`) works for UI work, but system notifications are disabled because
  UserNotifications needs an app bundle. Use the script for the real thing.
- With the macOS 27 SDK, `@State` is a macro whose compiler plugin ships only with Xcode. The shared views therefore
  use `@ViewState` (a typealias of SwiftUI's `State` property wrapper; see `Views/ViewState.swift`), so everything
  builds with the Command Line Tools alone.

### What the Mac app does

- **Menu bar**: a bell with the unread count, a connection status dot, and a live list of active/unread
  notifications. Progress bars update in place, and you can use the action buttons right there. It also has
  **Open Inbox**, **Settings…** and **Quit**.
- **Inbox window**: list + detail (`NavigationSplitView`) with search, filters (status, severity, source, unread),
  infinite scroll, markdown bodies, fields, images, actions, reply box, responses, and read/resolve/delete.
- **System notifications**: one per Herald notification, with identifier = Herald id.
  - Updates replace it in place, silently unless the update has `alert: true`.
  - Read, resolved or deleted elsewhere → it's removed from Notification Center.
  - Action buttons and the reply box come from dynamic notification categories.
  - Tapping opens the `url` (if set) or the inbox detail, and marks the notification read.
  - Severity mapping: `critical`/`warning`/`info`/`success` → default sound and `.active`. `debug` → no sound and
    `.passive`. `silent` → never a sound. (Time-sensitive delivery needs an entitlement we can't get without a paid
    account.)
- **Settings**: server/account/device, reconnect, unpair, launch at login (`SMAppService.mainApp`), notification
  permission status, test notification.

## iOS: build with Xcode

Requires Xcode 16+ (iOS 17 SDK or later).

```sh
cd apps/apple
brew install xcodegen
xcodegen                     # generates Herald.xcodeproj (gitignored)
open Herald.xcodeproj
```

Select the **Herald-iOS** scheme. Under *Signing & Capabilities*, pick your team (or set `DEVELOPMENT_TEAM` in
`project.yml`). Then run it on your device.

- With a **free personal team**, the app is provisioned for 7 days. Re-run it from Xcode to re-sign. Free teams can't
  use push anyway, which Herald doesn't need.
- You may need to change the bundle id (`dev.herald.ios`) to something unique for your team.
- `UIDevice.current.name` returns a generic name ("iPhone") on iOS 16+ without a special entitlement, so devices
  show up as "iPhone" in the web app.

How iOS delivery works:
- **Foreground**: the WebSocket is connected. Events become local notifications (banners while the app is open) and
  the inbox updates live.
- **Leaving the app**: the socket stays up for about 25 s (a background task), then disconnects.
- **Background**: a `BGAppRefreshTask` (`dev.herald.ios.refresh`) runs REST `updatedSince` catch-up and posts local
  notifications for new items. iOS decides when it runs. Keep *Background App Refresh* enabled for Herald.
- **Launch / foreground**: the socket `sync` and a REST refresh catch up fully.

The **Herald-macOS** scheme in the same project builds the Mac app with Xcode too, which is handy for debugging.

## Local development

Run the server locally (`wrangler dev`, usually `http://localhost:8787`), then pair with the server URL
`http://localhost:8787`. Typing `localhost:8787` without a scheme also works. Both apps set
`NSAppTransportSecurity → NSAllowsLocalNetworking` in their Info.plist, so plain `http` is allowed for `localhost`
and `*.local` (debug use) while remote servers still need `https`. On a physical iPhone, use your Mac's LAN name
(e.g. `http://my-mac.local:8787`), not `localhost`.

## Tests

```sh
cd apps/apple
swift build                    # debug build of HeraldKit + HeraldMac
scripts/test.sh                # = swift test (+ a workaround, see below)
scripts/typecheck-ios.sh       # optional: compile-check the iOS app against Mac Catalyst
```

The tests use **Swift Testing** (`import Testing`). XCTest isn't available with the Command Line Tools alone. They
cover:
- model decoding against the protocol examples, including unknown fields, unknown enum values and missing keys
- the REST client (with a `URLProtocol` stub) and WebSocket message coding
- pairing code, server URL and deep-link parsing
- category id hashing stability, body composition (fields + `progressText`), and the markdown subset
- backoff, the sync cursor, InboxStore event handling and the cache, and credential file permissions

`scripts/test.sh` exists because, with only the Command Line Tools, SwiftPM sometimes fails to find the Swift
Testing macro plugin while compiling test files in parallel (`plugin for module 'TestingMacros' not found`). The
script passes `-load-plugin-library` explicitly, which makes it reliable. With Xcode installed, plain `swift test` is
fine.

## Where credentials are stored (and why not the Keychain)

The server URL and the device token (`hrd_dev_…`) are stored in
`~/Library/Application Support/Herald/credentials.json` (on iOS: the app container's Application Support):
- The file is written atomically with permissions `0600`, inside a `0700` directory.
- On iOS it also uses Data Protection (`completeUntilFirstUserAuthentication`), so background refresh can read it
  after the first unlock.

The Keychain ties items to the code signature of the app that created them. The Mac app is ad-hoc signed and rebuilt
from source, so every rebuild has a new signature, and macOS would ask for your login password on every launch after
a rebuild. A user-only file gives equivalent protection against other users on the machine, without the prompts. The
token is revocable from the web app (*Devices*) at any time.

The inbox cache (`inbox-cache.json`, latest 300 notifications + sync cursor) lives next to it, so the inbox shows
up instantly on launch.

## Limitations

- **No APNs**: iOS isn't instant in the background (see above). macOS needs the app running.
- The iOS app was developed without the iOS SDK. `scripts/typecheck-ios.sh` compile-checks it against Mac Catalyst,
  but it hasn't been built with Xcode for iOS or run on a device yet.
- No notification service extension. Images are downloaded by the app when it posts the notification, with a 10 s
  timeout; on failure the notification is shown without the image.
- No Live Activities and no time-sensitive or critical alerts (these need APNs and/or paid entitlements).
