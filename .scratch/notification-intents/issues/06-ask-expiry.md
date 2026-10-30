# 06: Ask expiry

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** An ask expires after `expiresIn` (default 1h, max 24h). When it expires it leaves every device's tray, the inbox shows it as "Expired" with its buttons disabled, and `wait_for_response` returns `expired`. An agent can withdraw an ask early with `resolve`, which shows as withdrawn.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] `expiresIn` validated (default 1h, max 24h); the stored ask has `expiresAt`
- [ ] The scheduler expires due asks: state expired, status resolved, broadcast so clients cancel the system notification
- [ ] `wait_for_response` returns `expired`; the pending text includes when the ask expires
- [ ] Answering an expired or withdrawn ask returns a conflict error
- [ ] The web ask card shows expired and withdrawn states
- [ ] Tests backdate `expiresAt` and fire the alarm, then observe via MCP, REST and WebSocket
