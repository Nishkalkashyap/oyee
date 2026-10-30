# 09: Keys across intents

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** If an agent reuses a key whose latest notification is still live and of a different intent (a running or stopped progress, an open ask), the call fails with a message naming the key, its intent, and how to fix it. If the latest one is no longer live, the new intent takes over the key.

**Blocked by:** 02, 05, 07

**Status:** ready-for-agent

- [ ] Inform, ask and progress each reject a key whose latest live notification has a different intent, with a how-to-fix message
- [ ] A finished progress, answered/expired/withdrawn ask, or resolved inform lets a different intent take the key
- [ ] Server tests through MCP and webhooks

## Comments

From 03: cooldown measures from the internal `alerted_at` column (written by the inform path only); the key rule should use the same last-alert source.
