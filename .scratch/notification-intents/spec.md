# Notification intents

Status: ready-for-agent

Vocabulary: `GLOSSARY.md` (Intent, Inform, Ask, Progress, Stopped reporting, Key, Cooldown, Expiry, Severity, Link
button, Answer button). Decision record: `docs/adr/0001-senders-send-intents.md`.

## Problem Statement

Oyee's sending surface is one flat "card" with about 17 optional fields (title, body, severity, icon, image, url,
fields, progress, actions, reply, tags, silent, threadId, template…). An agent connected over MCP has to decide which
subset of those fields expresses what it means, and it often gets that wrong: it adds buttons nobody listens to,
picks a field combination that renders oddly, or never learns that a progress bar or a question is possible. Saved
templates add a second concept that sounds like "the kinds of notification Oyee supports" but is really a per-user
preset with `{{var}}` placeholders, which agents don't need. A cron-driven agent has no reliable way to avoid nagging:
it would have to read past notifications and do timestamp arithmetic, which models do badly. An agent that asks a
question and then dies leaves the question on the user's phone forever, and an agent that crashes mid-task leaves a
progress bar frozen at 40%. On the receiving side, every app draws one generic card that tries to show every field,
so nothing looks purpose-built for what it is.

## Solution

Every notification is exactly one **intent**: **inform** (something you should know), **ask** (I need a decision or
text from you) or **progress** (long-running work, updated in place). Senders say which intent they mean and fill a
short schema for it; Oyee owns how it looks on every platform.

- Agents get one MCP tool per intent (`inform`, `ask`, `progress`) plus `wait_for_response`, `resolve`,
  `list_notifications` and `list_devices`. Each tool's schema is small, every field is described, and tool results
  tell the agent what to do next.
- Webhooks, REST and the web composer use the same intents and field names (inform and progress only; ask is for
  agents, who can poll for the answer).
- Repeat suppression is a server rule: a **key** names a notification so later sends update it, and a **cooldown**
  limits how often it alerts. An ask with the key of an open ask reuses it.
- Asks **expire** (default 1 hour), and a progress that goes quiet is marked **Stopped reporting after 40%**.
- Web, Android and macOS draw a purpose-built card per intent, and the inbox sections are the intents: Needs you
  (open asks), In progress (running progress), Updates (everything else).
- Templates, callback buttons, threadId, tags, `silent` and the `debug` severity are removed everywhere.

## User Stories

### Agents (MCP)

1. As an agent, I want a tool named after each thing I can mean (inform, ask, progress), so that choosing how to notify the user is a choice of tool rather than of field combinations.
2. As an agent, I want each tool's schema to contain only the fields that matter for that intent, each with a one-line description, so that I can fill it correctly on the first try.
3. As an agent, I want to inform the user with just a title, so that the simplest notification needs one field.
4. As an agent, I want to add a markdown body (bold, italic, code, links, line breaks) to an inform, so that I can give detail without a separate field for each part.
5. As an agent, I want to set a severity of info, success, warning or critical, each described by when to use it, so that the user's devices alert with the right urgency.
6. As an agent, I want to attach up to three link buttons to an inform, so that the user can jump to the PR, the build log or the dashboard.
7. As an agent, I want to set a url that opens when the user taps the notification, so that the most relevant page is one tap away.
8. As an agent, I want to add up to ten label/value rows to an inform, so that structured facts (region, duration, commit) read cleanly.
9. As an agent, I want to add an image and an icon to an inform, so that a chart or a recognisable emoji makes it scannable.
10. As an agent, I want to give an inform a key, so that sending again about the same thing updates the existing notification instead of creating a duplicate.
11. As an agent running on a schedule, I want to give an inform a cooldown such as "1h", so that the user is alerted at most once per hour about an ongoing problem even though I check every five minutes.
12. As an agent, I want sends inside the cooldown to update the notification's text silently, so that the user sees the latest state without being buzzed again.
13. As an agent, I want the inform result to tell me whether it was created, updated silently, alerted, or suppressed, and why, so that I can report accurately without reasoning about timestamps.
14. As an agent, I want a send to be suppressed when the user resolved the notification inside the cooldown, so that I don't re-alert someone who just said "I know".
15. As an agent, I want to ask the user a question with up to three answer buttons, so that they can decide with one tap.
16. As an agent, I want to let the user type a free-text answer, alone or alongside answer buttons, so that I can ask open questions.
17. As an agent, I want to set a url on an ask that opens when tapped, so that the user can review the PR before approving it.
18. As an agent, I want an ask to expire after a duration I choose (default one hour, at most 24 hours), so that a question I can no longer act on doesn't linger.
19. As an agent, I want the ask result to tell me to call wait_for_response with the returned id, so that I know the next step.
20. As an agent, I want wait_for_response to hold for up to 50 seconds and return the answer as soon as it arrives, so that I get answers quickly without hammering the server.
21. As an agent, I want a pending wait_for_response result to say how long ago I asked, when the ask expires, and to call again with the same id, so that I keep waiting instead of treating "pending" as final.
22. As an agent, I want wait_for_response to report "expired" when the ask expired, so that I can stop waiting and decide what to do.
23. As an agent, I want wait_for_response to return the answer and which device it came from, so that I can act on it and mention where it was answered.
24. As an agent running on a schedule, I want asking again with the key of an open, unexpired ask to return that ask instead of alerting again, so that I never nag the user with the same question.
25. As an agent, I want to report progress with one tool called repeatedly, identified by a key I choose, so that I can continue the same progress notification even after my context was compacted or a new run started.
26. As an agent, I want to set value, max and a label on progress, so that the user sees "3/7 checks" or "40%".
27. As an agent, I want to finish progress with status done or failed, so that the user gets one alert at the moment they care about.
28. As an agent, I want my first progress report to appear without sound, so that starting a task doesn't interrupt the user.
29. As an agent, I want to say how long my progress may go quiet before it counts as stopped (default 30 minutes), so that long silent steps aren't falsely flagged.
30. As an agent, I want a progress update after it was marked stopped to bring it back to running, so that a slow step doesn't permanently mark my task as dead.
31. As an agent, I want a clear error when I reuse a key that belongs to a different, still-live intent (a running progress or an open ask), so that I can pick another key or finish the first one.
32. As an agent, I want to withdraw an inform or ask that no longer matters, so that the user isn't asked about something already settled.
33. As an agent, I want to list my recent notifications filtered by key, intent, status and source, so that I can see what I already told or asked the user.
34. As an agent, I want each listed notification to be compact (id, intent, key, title, status, answer, created time and a precomputed "ago" such as "12m"), so that a listing costs few tokens and needs no date arithmetic.
35. As an agent, I want the listing to default to 10 items with a cursor for more, so that I only page when I need to.
36. As an agent, I want to list the user's devices and target some of them by name or platform, so that I can send a notification to "the MacBook" only.
37. As an agent, I want the MCP server's instructions to explain in a few lines when to use inform, ask and progress, so that I choose correctly without reading external docs.
38. As an agent, I want rate-limit and validation errors to say what went wrong and how to fix it, so that I can correct the call.

### Webhook and script senders

39. As a script author, I want to POST `{"title": "Backup done"}` and get an inform, so that the simplest webhook stays one line.
40. As a script author, I want to pick the intent with an `intent` field in JSON or `?intent=` in the query, so that I can report progress from a CI job.
41. As a script author, I want the same field names as the MCP tools, so that one set of docs covers every sender.
42. As a script author, I want plain-text bodies, query parameters and ntfy-style headers to keep working and produce an inform, so that existing curl one-liners don't break.
43. As a CI author, I want to report progress by key from successive webhook calls and finish it as done or failed, so that a pipeline shows live progress on my phone.
44. As a webhook sender, I want key and cooldown to work exactly as for agents, so that a noisy script can't spam me.
45. As a webhook sender, I want a clear 400 when I try to send an ask, explaining that asks are for agents, so that I'm not left guessing.
46. As an Alertmanager or Grafana user, I want firing groups to arrive as informs keyed by the group and resolved when the group resolves, so that my alerting setup keeps working.
47. As an AWS SNS user, I want subscription confirmation and notifications to keep working as informs, so that nothing on the AWS side changes.

### The person receiving notifications

48. As a user, I want each notification's card to look purpose-built for what it is (a message, a question, a running task), so that I understand it at a glance.
49. As a user, I want an inform card to show its severity, body, rows, image and link buttons cleanly, so that alerts and "task done" messages are easy to read.
50. As a user, I want an ask card to show the answer buttons and reply box prominently, with how long it has been waiting and when it expires, so that I know someone is blocked on me.
51. As a user, I want to answer an ask from the system notification (buttons and inline reply on Android and macOS; buttons in the browser popup), so that I don't have to open the app.
52. As a user, I want the first answer from any device to close the ask everywhere and show "Answered: Approve · Pixel 9", so that I never answer twice.
53. As a user, I want an expired ask to disappear from my notification tray and show "Expired" in the inbox with its buttons disabled, so that I don't answer into the void.
54. As a user, I want a progress card with a real progress bar and label, so that I can see where a task stands.
55. As a user, I want a running progress to update silently, so that it doesn't buzz on every step.
56. As a user, I want to be alerted once when a progress finishes, with "Done" or "Failed" clearly shown, so that I know the outcome.
57. As a user, I want a finished progress to stay visible until I read it, so that the "done" alert doesn't vanish the moment it arrives.
58. As a user, I want to be alerted once with "Stopped reporting after 40%" when an agent goes quiet mid-task, so that I know the agent died instead of believing the task is still running.
59. As a user, I want my inbox split into Needs you (open asks), In progress (running progress) and Updates (everything else), so that what needs me is on top.
60. As a user, I want repeated notifications with the same key from the same source to stack as one, so that my inbox doesn't fill with duplicates.
61. As a user, I want every severity to alert, so that the sender can't make something important silent.
62. As a user, I want the browser popup to show the first two buttons and the full card in the inbox to show all of them, so that the web stays usable despite its two-button limit.
63. As a user, I want my existing notifications to keep appearing after the upgrade, each shown as the intent it most resembles, so that history isn't lost.
64. As a user with an app that hasn't updated yet, I want new notifications to still show their title and body, so that nothing is lost while I update.
65. As a user, I want the web Send page to let me send an inform or a progress with the same fields agents use, so that I can test what agents will produce.
66. As a user, I want the Templates page gone, so that the app has no feature I can't use meaningfully.

### Maintainer

67. As the maintainer, I want one schema package that defines the three intents and the stored notification, so that the server and web can't disagree.
68. As the maintainer, I want the protocol doc rewritten as v2 around intents, so that Android and Swift models can mirror it exactly.
69. As the maintainer, I want server, web, Android and macOS released together as v0.3.0, so that the old and new formats overlap as briefly as possible.

## Implementation Decisions

### Schema package (shared by server and web)

- Three send-input schemas: **InformInput**, **AskInput**, **ProgressInput**, built from one set of shared fields
  so the field names are identical across intents and senders. The MCP tool schemas are these inputs (ask without
  anything machine-specific); webhook and REST bodies are the same inputs plus an `intent` discriminator defaulting
  to `inform`.
- Shared fields: `title` (required, ≤ 200), `body` (≤ 4000, markdown subset), `severity`
  (`info | success | warning | critical`, default `info`), `url`, `key`, `source` (defaults to the token label),
  `devices`, `platforms`.
- Inform adds: `links` (≤ 3 link buttons `{label, url}`), `fields` (≤ 10 `{label, value}`), `image` (https), `icon`
  (emoji or https), `cooldown` (duration; meaningful only with `key`).
- Ask adds: `options` (≤ 3 answer-button labels), `allowText` (boolean, optional reply placeholder), `expiresIn`
  (duration, default `1h`, max `24h`). Ask has no `severity` input: it always alerts at `warning`. At least one of
  options/allowText is implied; with neither, a reply box is added (as today).
- Progress adds: `key` (required for progress), `value`, `max` (default 100), `label`, `status`
  (`running | done | failed`, default `running`), `staleAfter` (duration, default `30m`). Progress has no
  `severity` input: running is silent, done alerts at `success`, failed and stopped reporting alert at `warning`.
- Durations are strings like `"30m"`, `"1h"`, `"24h"` (units s, m, h), validated with limits in `LIMITS`.
- The stored/wire **Notification** is intent-shaped: shared fields (`id, intent, source, key, title, body,
  severity, status, url, icon` where applicable, `createdAt, updatedAt, readAt, resolvedAt, targetDeviceIds,
  version`) plus exactly one block for its intent:
  - `inform`: `links, fields, image, icon, cooldown`
  - `ask`: `options, allowText, replyPlaceholder, expiresAt, answer` (`{option | text, deviceId, deviceName, at}`
    or null), and a derived state `open | answered | expired | withdrawn`
  - `progress`: `value, max, label, state` (`running | done | failed | stopped`), `staleAfter`, `lastReportAt`
  Common top-level fields keep their current names so older app builds still render title and body.
- Removed from every schema: `template`/`vars`/Template types, `actions` with `callback`, `reply` as a generic
  field, `threadId`, `tags`, `silent`, `replaceKey` (replaced by `key`), the `debug` severity, and the generic
  `UpdateNotificationInput`.
- Limits and quotas stay in `LIMITS`/`QUOTAS`; new limits (max ask expiry, staleAfter bounds, list page size 10/50)
  are added there.

### Server: intent service inside the inbox Durable Object

- The inbox Durable Object exposes one operation per intent (inform, ask, progress) plus resolve, respond, read,
  list and wait. All senders (MCP, webhook, REST) call these, so the key, cooldown, expiry and stopped-reporting rules
  live in exactly one place.
- **Keys** are unique per `(source, key)`. A key refers to its latest notification.
  - Inform with a key: no notification with that key → create and alert. Latest one active and last alert within the
    cooldown → update its content silently. Latest one resolved within the cooldown → change nothing, return
    `suppressed` with the reason. Cooldown passed (or no cooldown) → update the active one and alert, or create a new
    one if the latest is resolved. Cooldown is measured from the last alert for that key, whatever its status.
  - Ask with a key of an open, unexpired ask → return that ask's id with "already asked N ago, still waiting"; no new
    alert. Otherwise create a new ask.
  - Progress with a key: no live progress → create (silently). Live progress → update; `done`/`failed` finish it and
    alert. An update to a `stopped` progress revives it as `running`.
  - Different intent on a key whose latest notification is live (running/stopped progress, open ask) → error naming
    the key, its intent, and how to fix it. Otherwise the new intent takes over the key.
- Every send result reports an **outcome**: `created`, `updated_silently`, `alerted`, `suppressed`, or
  `reused` (ask), with a human-readable reason. MCP returns it as text the agent can follow; REST and webhooks return
  it as JSON alongside `id` and `version`.
- **Expiry** and **stopped reporting** run off the Durable Object's single alarm, which today only runs the daily
  retention prune. The alarm is rescheduled to the earliest of: the next ask expiry, the next progress stale
  deadline (`lastReportAt + staleAfter`) and the next daily prune. On firing it expires asks (state expired,
  status resolved, broadcast so devices remove them) and marks quiet progress as stopped (alert once at `warning`,
  label "Stopped reporting after <last label or percent>").
- **Responding** is valid only on an open ask: the first answer (option or text, from any device) sets the answer,
  resolves the ask and broadcasts. Answers to answered, expired or withdrawn asks get a conflict error the client
  can show.
- A finished progress (done/failed) stays `active` until read, so its alert is not cancelled by resolution.
- Push and WebSocket events keep their current types; the payload carries the intent-shaped notification. Alert
  rules: inform alerts on create and on cooldown-passed updates; ask alerts on create; progress alerts only on
  done, failed and stopped.
- Storage migration (in-code, the inbox's own SQLite, not D1): add `intent` and `key` columns with an index on
  `(source, key)`, drop thread/replace-key/template storage, and convert existing rows once: rows with non-link
  actions or a reply become an ask (answered if they have a response, otherwise expired); rows with progress become
  a progress (state done if at max, otherwise stopped); everything else becomes an inform. `debug` becomes `info`;
  tags and threadId are discarded; link actions become links.
- Quotas: a new notification counts as `send`; a progress update, a silent inform update and alarm-driven changes
  count as `update` (alarm changes are not charged to the user); answers count as `respond`.

### Server: MCP surface

- Exactly seven tools: `inform`, `ask`, `wait_for_response`, `progress`, `resolve`, `list_notifications`,
  `list_devices`. Removed: `send_notification`, `update_notification`, `resolve_notification` (renamed `resolve`),
  `get_notification`, `list_templates`, `upsert_template`, `delete_template`.
- The server instructions explain the three intents in a few lines and when to use each.
- Tool results are text written for a model: what happened plus the next step (for ask: call wait_for_response with
  this id; for pending: asked N ago, expires in M, call again with the same id; for expired: the ask expired).
- `wait_for_response` holds for up to 50 seconds, returns `answered` (with answer and device), `pending` or
  `expired`.
- `list_notifications` takes filters `key, intent, status, source`, `limit` (default 10, max 50) and `cursor`, and
  returns slim items: `id, intent, key, title, status, state, answer, createdAt, ago`.

### Server: webhooks and REST

- Webhook JSON bodies are intent inputs with an `intent` field (default `inform`); `intent: "ask"` returns 400
  explaining that ask is for agents over MCP. `?intent=` selects the intent for plain-text, GET and header-based
  sends; existing query parameters and ntfy headers map to inform fields (`replaceKey` and `template` parameters
  are no longer accepted; `key` and `cooldown` are).
- Alertmanager and Grafana adapters produce informs keyed by the group key (severity from labels, `debug`-like
  levels map to `info`); group resolution resolves the keyed inform. SNS produces an inform.
- REST: `POST /api/notifications` takes the same `intent`-tagged body (session only, used by the web composer).
  Removed: `PATCH /api/notifications/:id` and every `/api/templates` route. The respond endpoint applies only to
  open asks.
- Token creation no longer returns `callbackSecret`; the D1 tokens table drops the callback-secret column through a
  Drizzle-generated migration. Callback delivery and signing code is deleted.

### Clients (web, Android, macOS)

- Each client decodes the intent-shaped notification (mirroring protocol v2 exactly) and draws one purpose-built
  card per intent, in the inbox and the detail view, following `docs/design.md`. The generic everything-optional
  card and its helpers are removed. Visual design is settled in code review from screenshots.
- Card states the user must be able to tell apart: inform by severity; ask open (with buttons, reply box, waiting
  time and expiry), answered ("Answered: <answer> · <device>"), expired ("Expired"), withdrawn; progress running,
  done, failed, stopped ("Stopped reporting after 40%").
- Inbox sections: Needs you = open asks; In progress = running or stopped progress; Updates = everything else.
  Stacking groups by `(source, key)` when a key exists, otherwise source and title.
- System notifications per intent: inform maps severity to importance as today; ask shows answer buttons and
  inline reply (Android RemoteInput, macOS text-input action, browser: first two buttons); progress uses native
  progress on Android and the text bar elsewhere, updating silently while running.
- Removed client features: tag chips and tag search, the thread filter, the Templates page, template fields in the
  composer, `silent`, and Android's debug notification channel (deleted on upgrade).
- The web Send page composes an inform or a progress using the same fields as the intent inputs.

### Docs and release

- `docs/protocol.md` rewritten as protocol v2 around intents; app READMEs, `CHANGELOG.md`, `PLAN.md` §10 and the web
  help dialog's snippets updated; `GLOSSARY.md` and ADR 0001 already describe the model.
- Server, web, Android and macOS release together as v0.3.0.

## Testing Decisions

- Good tests exercise behaviour through a public surface and assert on what a sender or receiver observes (tool
  results, HTTP responses, stored notifications as returned by the API, WebSocket events, client view models). They
  don't reach into private helpers or assert on SQL.
- **Server, one seam: the public endpoints in workerd.** MCP `tools/call`, `/hook/:token`, REST and WebSocket,
  driven like the existing MCP, webhook, API and WebSocket test files. Covers: each intent's validation and
  defaults; key semantics per intent; cooldown outcomes (created, updated silently, alerted, suppressed after a user
  resolve); ask reuse by key; first-answer-wins and conflicts on late answers; wait_for_response answered, pending
  and expired; list_notifications filters, slim items, `ago` and paging; the cross-intent key error; webhook intent
  selection, the ask rejection, plain-text/ntfy/query mapping and the Alertmanager/Grafana/SNS adapters; removed
  routes and tools are gone; the one-time migration of old rows.
- **Time-based rules** (cooldown, expiry, stopped reporting) use the existing pattern from the retention test:
  backdate a stored row's timestamps through the Durable Object, then fire its alarm, then observe through the API
  and WebSocket. No fake clock and no test-only routes.
- **Clients, one seam each: the existing pure-logic tests.** Web inbox/card tests, Android model and
  inbox-sections tests, Swift model-decoding and inbox-sections tests, extended to cover decoding the
  intent-shaped notification, sorting into the three sections, stacking by key, and each card's state label.
- **Shared wire fixtures:** one set of example notifications in protocol v2 (every intent in every state), used by
  all three clients' decoding tests so they read one format identically.
- No automated visual tests; card designs are reviewed from screenshots in code review.

## Out of Scope

- Per-source mute or quiet settings on the receiving side (the follow-up that replaces `debug`/`silent`; log it in
  PLAN.md §10).
- MCP Tasks (the spec's experimental async-task primitive) as an alternative to polling wait_for_response.
- Asks from webhook senders, callback buttons and signed callbacks.
- Any intent beyond inform, ask and progress.
- iOS app changes beyond keeping the shared Swift package compiling (iOS is deprioritised).
- Visual regression testing.

## Further Notes

- The MCP surface breaks without a compatibility period: the maintainer is the only user, and MCP clients re-read
  the tool list on connect.
- Installed app builds that haven't updated decode missing fields with defaults (checked for Android and Swift), so
  they show title and body only until updated; this is accepted because everything ships together.
- Web Push shows at most two buttons; the full card in the inbox shows all three. Accepted, not capped.
- Ask expiry and stopped reporting must share the inbox's single alarm with the daily retention prune; getting
  the rescheduling right (always the earliest deadline) is the subtlest part of the server work.
