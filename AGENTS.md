# Oyee: guide for agents and maintainers

Start here. This file plus the docs it links are everything needed to continue work on Oyee in a fresh session.

**Oyee** is an open-source (MIT), non-monetized notification hub. AI agents (MCP), webhooks (Home Assistant,
Alertmanager, GitHub Actions…) and scripts send live, actionable notifications (progress bars, buttons, replies,
in-place updates) to Android, macOS and the web. Hosted at **https://oyee.app**; repo
**https://github.com/Nishkalkashyap/oyee** (public, single branch `main`).

## Docs index

| Doc | What's in it |
|---|---|
| [docs/operations.md](docs/operations.md) | **Runbook**: deploy, release apps, secrets, schema changes, rollback, verification, gotchas |
| [docs/setup.md](docs/setup.md) | Bringing up an instance from zero (Cloudflare, Google OAuth, Firebase) and building every client |
| [docs/protocol.md](docs/protocol.md) | The API contract: card schema, REST, webhooks, MCP tools, WebSocket, push payloads, limits (§3.1) |
| [docs/design.md](docs/design.md) | Design language (copied from the maintainer's Gluon app): tokens, components, layouts |
| [PLAN.md](PLAN.md) | Architecture, decisions and their reasons, status (§10) and open follow-ups |
| [CHANGELOG.md](CHANGELOG.md) | Per app release, plus "Unreleased (server and web)" |
| `apps/*/README.md` | Per-app internals: structure, build, behaviour |

## Repo map (pnpm monorepo)

```
packages/schema   @oyee/schema: zod schemas + types shared by server and web (Notification, inputs, LIMITS, QUOTAS)
apps/server       Cloudflare Worker (Hono) + InboxDO (one Durable Object per user, SQLite) + D1 via Drizzle
apps/web          React + Vite + Tailwind + TanStack Query; served by the Worker as static assets
apps/android      Kotlin + Compose (app.oyee.android); FCM + WebSocket fallback; self-update via GitHub Releases
apps/apple        Swift: OyeeKit package, OyeeMac menu-bar app (app.oyee.mac), iOS app (build-from-source only)
docs/             protocol, setup, design, operations, brand (logo SVGs), screenshots
.github/workflows/release.yml   v* tag → signed APK + universal macOS zip on GitHub Releases
```

## Hard rules (decided by the maintainer; don't change without asking)

- **Never write the backup domain into any tracked file** (code, docs, commits, PR text). A second hostname points to
  the same Worker; it lives only in the git-ignored `apps/server/.extra-domains`. Refer to it as "the backup domain".
- **Always deploy with `pnpm deploy`** from the repo root, never bare `wrangler deploy`: Wrangler replaces the Worker's
  custom domains on every deploy, and only `apps/server/scripts/deploy.mjs` re-adds the backup domain.
- **Android must never request `REQUEST_INSTALL_PACKAGES`** or install APKs itself: Play Protect then blocks the app
  ("Harmful app blocked", happened with v0.2.0/0.2.1). Updates download via the system DownloadManager.
- **Secrets never go into git**: they live in Cloudflare, the git-ignored `secrets/` folder, GitHub Actions secrets,
  and `~/oyee-release-signing/` (see docs/operations.md §1).
- **`DEV_LOGIN` stays `"false"` in production** (`apps/server/wrangler.jsonc`).
- Keep accepting legacy `hrd_` token prefixes alongside `oyee_` (Oyee was called Herald until 2026-10-28).
- D1 schema changes go through Drizzle (`src/db/schema.ts` → `db:generate`), never hand-written SQL migrations.
- Focus platforms: web, Android, macOS. iOS code exists but is deprioritized (no APNs, no distribution).
- UI follows docs/design.md (warm paper palette, Figtree, pill buttons, light-blue selection). The maintainer rejected
  gradient-heavy "Vercel-style" mockups.
- Releases are user-facing: Macs auto-install them and phones get notified. Publish only when asked.

## Common commands

```sh
pnpm install
pnpm dev                                    # wrangler dev :8787 + vite (needs apps/server/.dev.vars, see setup §9)
pnpm typecheck && pnpm test                 # schema + server (vitest in workerd) + web
pnpm deploy                                 # web build → D1 migrations (remote) → worker deploy (+ backup domain)

export JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd apps/android && ./gradlew testDebugUnitTest assembleDebug
cd apps/apple && swift test && scripts/build-macos-app.sh   # → build/Oyee.app

git tag vX.Y.Z && git push origin vX.Y.Z    # app release (full checklist: docs/operations.md §3)
```

## Conventions

- Work on `main` and push directly (no PR flow so far). Commit messages: short imperative subject, body explaining why.
- When behaviour changes, update in the same commit: `docs/protocol.md` (API), the app README, `CHANGELOG.md`
  ("Unreleased (server and web)" or the next app version), and `PLAN.md` §10 if status changes.
- Tests live next to each app (`apps/server/test`, `apps/web/src/test`, `apps/android/app/src/test`,
  `apps/apple/Tests`). Add tests with features; the server suite runs real Durable Objects and D1 in workerd.
- Limits and quotas live in one place: `LIMITS` / `QUOTAS` in `packages/schema/src/index.ts`.
- Web UI can be checked without a backend in mock mode: `pnpm --filter @oyee/web dev`, open `/?mock=1`.

## Current state (2026-10-30)

- Live: server + web at oyee.app (rate limits, help/download dialog, usage meter). Latest app release **v0.2.11**.
- Verified in production: web (Brave push), Android (Galaxy S23 Ultra), macOS (menu-bar app, self-update).
- Protocol v2 (notification intents, no flat card) is implemented but not released: app 0.3.0 must ship before the
  server deploy, because 0.2.x apps only read the flat card.
- Open follow-ups: PLAN.md §10.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded on
each issue file's `Status:` line. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/` (created lazily by `/domain-modeling`). See
`docs/agents/domain.md`.
