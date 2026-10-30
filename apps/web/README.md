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
With `DEV_LOGIN=true` on the server, the landing page shows a dev email form under the sign-in button.

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
  lib/inform.ts              the inform card's view model (severity, rows, ≤ 3 safe link buttons, tap target)
  lib/inbox.ts               inbox sections (Needs you / In progress / Updates) and stacking of repeats
  lib/useWebPush.ts          this browser as a push target (on / off / blocked / unavailable)
  components/                NotificationCard (InformCard for informs), PlatformPreviews, CreateTokenDialog, PairDialog (lazy), Layout, UI primitives
  pages/                     Landing (signed-out `/` and `/login`), Home (`/`), Inbox (+ detail), Templates, Send
public/sw.js                 service worker: push → showNotification / close, notificationclick → respond / read / open
```

## Inbox

- **Sections** (Active view, no search): *Needs you* (unanswered buttons or reply box, answerable right in the list),
  *In progress* (unfinished progress; a running job's buttons are controls, so it stays here), *Updates* (the rest).
  Headers only show when there's more than one section.
- **Stacks**: in Updates, items with the same thread, or else the same source + title, collapse into one row with a
  count. Clicking the row opens the newest and expands the rest; the row's resolve resolves the whole stack.
- **Blue means unread** and nothing else. The avatar mark appears only for critical (red) and warning (amber).
- **Resolve**: in the card footer of the conversation, on row hover (mouse), by swiping a row right (touch), or with
  `E`. `J` / `K` move through the list. After resolving the open item, wide screens open the next one; phones go
  back to the list. There's no un-resolve API, so there's no undo.
- Search is behind the header's search button; source / thread / severity filters (set from the conversation header or
  the URL) show as dismissible pills. Resolved items are one row at the end of the list (`?status=resolved`).

## Home

`/` after sign-in: **Sends to you** (MCP URLs and webhooks, with Add and Revoke) → **Reaches you on** (paired devices
with Rename / Remove, "Connect a device" for the pairing dialog, and a "This browser" row to turn on Web Push or explain
that it's blocked). `/devices` redirects here.

`public/sw.js` is plain JS (no build step) and duplicates the presentation logic in `src/lib/webpush.ts`;
`src/test/webpush.test.ts` runs the real `sw.js` and asserts that both produce identical notifications.
