# @oyee/web

The Oyee web app: a React + Vite SPA (TypeScript, Tailwind CSS v4, React Router, TanStack Query).
In production, the Cloudflare Worker (`apps/server`) serves the build from `apps/web/dist`.

## Develop

```bash
pnpm install

# 1. API (wrangler dev on :8787). First run: cp apps/server/.dev.vars.example apps/server/.dev.vars
pnpm --filter @oyee/server dev

# 2. Web (Vite on :5173)
pnpm --filter @oyee/web dev
```

Open the Vite URL (http://localhost:5173). Vite proxies `/api` (including the `/api/ws` WebSocket), `/auth`, `/hook`,
`/mcp` and `/healthz` to `http://localhost:8787`. Set `OYEE_API=http://host:port` to point it somewhere else.
With `DEV_LOGIN=true` on the server, the login page shows a dev email form.

Note: token URLs shown after "Create webhook / MCP server URL" use the server's `PUBLIC_URL` (e.g.
`http://localhost:8787/hook/…`). That's the right URL for scripts. The UI itself keeps working through Vite.

### Mock mode (no backend)

Explore the UI with fixtures and simulated live updates:

- open `http://localhost:5173/?mock=1` (sticky; `?mock=0` exits), or
- run `VITE_MOCK=1 pnpm --filter @oyee/web dev`.

The mock layer (`src/lib/mock.ts`) is lazy-loaded and isn't part of the main bundle.

## Scripts

| Command | What |
|---|---|
| `pnpm --filter @oyee/web dev` | Vite dev server |
| `pnpm --filter @oyee/web build` | Typecheck + production build to `dist/` |
| `pnpm --filter @oyee/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @oyee/web test` | Vitest unit tests (`src/test`) |

Optional env: `VITE_REPO_URL` (where the Devices page links for building the native apps from source).

## Layout

```
src/
  main.tsx, App.tsx          bootstrap (QueryClient, router, mock mode), routes + auth gate
  lib/api.ts                 typed REST client (@oyee/schema types, error envelope, swappable transport)
  lib/queries.ts             TanStack Query hooks + live cache patching (applyLiveEvents)
  lib/live.ts                /api/ws client: ping 30 s, sync with cursor, backoff 1 s → 60 s with jitter
  lib/cache.ts               pure reducers that patch the list/detail caches from events
  lib/markdown.ts            markdown subset parser (AST, no raw HTML, safe hrefs only)
  lib/webpush.ts, push.ts    Web Push presentation (mirrors public/sw.js) and subscription helpers
  lib/snippets.ts            Claude Code / Codex / JSON / curl / Home Assistant / Alertmanager / Grafana / GH Actions
  lib/composer.ts, card.ts   composer → SendNotificationInput, template rendering for previews
  components/                NotificationCard, PlatformPreviews, Layout, UI primitives
  pages/                     Login, Connect, Inbox (+ detail), Devices, Templates, Send
public/sw.js                 service worker: push → showNotification / close, notificationclick → respond / read / open
```

`public/sw.js` is plain JS (no build step) and duplicates the presentation logic in `src/lib/webpush.ts`;
`src/test/webpush.test.ts` runs the real `sw.js` and asserts that both produce identical notifications.
