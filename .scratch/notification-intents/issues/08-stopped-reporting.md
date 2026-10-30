# 08: Stopped reporting

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** If a running progress gets no update for `staleAfter` (default 30m), it alerts once at warning and shows "Stopped reporting after 40%" (the last label or percent). A later update from the agent revives it as running.

**Blocked by:** 04, 07

**Status:** ready-for-agent

- [ ] `staleAfter` validated with bounds in LIMITS; each report sets `lastReportAt` and registers the stale deadline
- [ ] The scheduler marks due progress as stopped, alerts once, and sets the stopped label from the last known state
- [ ] A later `progress` call on a stopped progress revives it as running (silently)
- [ ] The web progress card shows the stopped state
- [ ] Tests backdate `lastReportAt`, fire the alarm, and observe via MCP and WebSocket

## Comments

From 04: a due deadline ref is removed before its handler runs; decide whether stale refs need retry protection.
