# 03: Cooldown

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** A cron agent sends `inform({ key: "disk-full", cooldown: "1h", … })` every five minutes and the user is alerted at most once an hour, with the card's text kept current silently in between. If the user resolved it inside the cooldown, further sends change nothing and the agent is told why.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `cooldown` accepts durations like `30m`, `1h`, `24h` (bounds in LIMITS)
- [ ] Outcomes: no notification with the key → `created` (alerts); active and last alert within cooldown → `updated_silently`; resolved within cooldown → `suppressed` with a reason naming when it was resolved and when the cooldown ends; cooldown passed → `alerted` (updates the active one, or creates a new one if the latest is resolved)
- [ ] Cooldown is measured from the last alert for that key, whatever its status
- [ ] Silent updates are broadcast without alert and don't reset read state; alerted updates do
- [ ] Tests drive time by backdating the stored row through the Durable Object, then observe via MCP results and WebSocket events
