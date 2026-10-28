# Oyee

**One inbox for AI agents, scripts and webhooks.** Send a notification with one HTTP call or one MCP tool call, and
receive it on Android, macOS and the web, with live-updating progress, action buttons, inline replies and sync across
devices.

![Oyee web inbox: a notification from an agent asking a question, with answer buttons and a reply box](docs/screenshots/web-inbox-light.png)

- 🤖 **MCP server URL**: give Claude Code, Codex or any MCP client `send_notification`, `update_notification`, `ask`,
  `wait_for_response` and more. Target one device (`devices: ["macbook"]`) or all of them.
- 🪝 **Webhooks**: paste a URL into Home Assistant, Alertmanager, Grafana, AWS SNS, GitHub Actions, cron or curl.
- 🔄 **Live notifications** that update in place (progress, status), resolve everywhere, and record your answers.
- 💬 **Two-way**: agents ask, you tap a button or type a reply on any device, and the agent gets the answer.
- 🧩 **Templates**: one platform-neutral card schema, rendered natively everywhere.

Free and open source (MIT).

## Screenshots

| Web (dark) | macOS |
|---|---|
| ![Web inbox in dark mode](docs/screenshots/web-inbox-dark.png) | ![macOS inbox window with a conversation](docs/screenshots/macos-inbox.png) |

| Connect an agent or webhook | Android | Web on a phone |
|---|---|---|
| ![Connect page with MCP and webhook buttons](docs/screenshots/web-connect-light.png) | <img src="docs/screenshots/android-inbox.png" alt="Android inbox" width="260"> | <img src="docs/screenshots/web-mobile-light.png" alt="Web inbox on a phone" width="260"> |

## Download

| Platform | Get it |
|---|---|
| **Web** | <https://oyee.app>: sign in with Google, nothing to install |
| **Android** (8.0+) | `Oyee-x.y.z.apk` from [Releases](../../releases/latest). Allow *Install unknown apps* when asked |
| **macOS** (14+, Apple Silicon and Intel) | `Oyee-x.y.z-macOS.zip` from [Releases](../../releases/latest). Not notarized: the first time, **right-click → Open** (or `xattr -dr com.apple.quarantine /Applications/Oyee.app`) |
| **iOS** | Build from source ([docs/setup.md](docs/setup.md)). iOS can't be distributed without a paid Apple account |

Then pair the device: on the web, **Devices → Pair a device**, and enter the code in the app.

**Updates:** the macOS app updates itself from GitHub Releases in the background (download, checksum check, restart;
can be turned off in Settings). The Android app notifies you about a new release; **Update** downloads the APK in
your browser, and you tap it to install. (The app doesn't install APKs itself: Play Protect blocks sideloaded apps
that can.) Releases are built and
signed by GitHub Actions ([release.yml](.github/workflows/release.yml)); each one includes `SHA256SUMS.txt`.

## Quick start

1. Sign in at <https://oyee.app> (or [run your own instance](docs/setup.md)).
2. On **Connect**, create an MCP server URL for your agent or a webhook for everything else.
3. Send something:

```bash
# Webhook
curl -d "Backup finished" "https://oyee.app/hook/<webhook-token>?title=Backup&severity=success"

# Claude Code
claude mcp add --transport http oyee https://oyee.app/mcp/<mcp-token>
```

## Docs

| | |
|---|---|
| [docs/setup.md](docs/setup.md) | Run your own instance: Cloudflare, Google sign-in, Firebase, web, Android, macOS |
| [docs/protocol.md](docs/protocol.md) | The API contract: REST, WebSocket, webhooks, MCP tools, push payloads |
| [docs/design.md](docs/design.md) | Design language (shared by web, macOS and Android) |
| [PLAN.md](PLAN.md) | Product plan, decisions and status |

## Repository

| Path | What |
|---|---|
| `packages/schema` | Shared TypeScript types + zod schemas (protocol source of truth) |
| `apps/server` | Cloudflare Worker: API, MCP, webhooks, Durable Objects, D1 (Drizzle), push fan-out |
| `apps/web` | React web app (served by the worker) |
| `apps/android` | Android app (Kotlin, Compose) |
| `apps/apple` | macOS menu-bar app + iOS app (SwiftUI) + OyeeKit |

## Develop

```bash
pnpm install
pnpm dev          # wrangler dev + vite
pnpm test
pnpm android:build
pnpm macos:build
```

**Releasing:** `git tag v0.2.0 && git push origin v0.2.0` builds the signed APK and the universal macOS app and
publishes them on GitHub Releases.
