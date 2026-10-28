# Herald

**One inbox for AI agents, scripts and webhooks.** Send a notification with one HTTP call or one MCP tool call, and
receive it on Android, iOS, macOS and the web, with live-updating progress, action buttons, inline replies and
sync across devices.

- 🤖 **MCP server URL**: give Claude Code / Codex / any MCP client `send_notification`, `update_notification`, `ask`, `wait_for_response`…
- 🪝 **Webhooks**: paste a URL into Home Assistant, Alertmanager, Grafana, AWS SNS, cron or curl.
- 📱 **Native clients** you build yourself: Android (FCM + socket fallback), macOS menu-bar app, iOS.
- 🔄 **Live notifications** that update in place, resolve everywhere, and record your responses.
- 🧩 **Templates**: one platform-neutral card schema, rendered natively on each platform.

Free and open source (MIT). See [PLAN.md](PLAN.md) for the product plan and [docs/protocol.md](docs/protocol.md) for the API contract.

## Quick start

```bash
curl -d "Backup finished" "https://<your-herald>/hook/<webhook-token>?title=Backup&severity=success"
```

## Repository

| Path | What |
|---|---|
| `packages/schema` | Shared TypeScript types + zod schemas (protocol source of truth) |
| `apps/server` | Cloudflare Worker: API, MCP, webhooks, Durable Objects, push fan-out |
| `apps/web` | React web app (served by the worker) |
| `apps/android` | Android app (Kotlin, Compose) |
| `apps/apple` | macOS menu-bar app + iOS app (SwiftUI) + HeraldKit |

## Develop

```bash
pnpm install
pnpm dev          # wrangler dev + vite
pnpm test
pnpm android:build
pnpm macos:build
```
