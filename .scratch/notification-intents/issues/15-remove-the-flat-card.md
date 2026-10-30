# 15: Remove the flat card (contract)

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** The old flat card disappears everywhere: the server no longer stores or sends the flat fields, templates, callback buttons and signatures, threadId, tags, silent, the debug severity, `replaceKey` and `PATCH /api/notifications/:id`. The docs describe protocol v2.

**Blocked by:** 10, 11, 12, 13, 14

**Status:** ready-for-agent

- [ ] Flat card fields, Template types and UpdateNotificationInput are deleted from the schema package; the wire notification is shared fields + one intent block
- [ ] Template storage and `/api/templates` routes are deleted; `callbackSecret` is dropped from token creation and from the D1 tokens table via a Drizzle-generated migration; callback and signing code is deleted
- [ ] Stored `debug` severities become `info`; thread and replace-key storage is removed
- [ ] docs/protocol.md rewritten as v2; app READMEs, CHANGELOG (v0.3.0 and Unreleased), web help-dialog snippets updated; PLAN.md §10 logs per-source mute settings as a follow-up
- [ ] `pnpm typecheck && pnpm test`, Android unit tests and `swift test` all pass

## Comments

From 01: `icon` exists both top-level and in the inform block; pick one. The old-row conversion must survive deleting `inferIntent`.
