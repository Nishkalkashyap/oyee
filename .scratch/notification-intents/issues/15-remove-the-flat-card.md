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

## Comments

From 07: ProgressInput duplicates the shared fields InformInput has; fold them into one shared base.

From 10: `progressResultText` in the inbox progress module builds the result shape inline; route it through the MCP text helper.

From 12: web mock data (mock mode) is still v1 flat-shaped; convert it to v2 intents. Remove the `threadId` list parameter from the web API client and the server list endpoint.

From 06: the web Needs you section uses `ask.state` only; treat an open ask past `expiresAt` as expired client-side too. wait_for_response also returns `withdrawn` (document in protocol v2).

From 11: remove the flat fallback for JSON bodies without `intent` that use v1-only fields (actions, replaceKey, template…); update web `lib/snippets.ts` examples (still replaceKey, tags, flat progress).

From 13: web sw.js builds the stopped label from `progressAmount`, which differs from `stoppedReportingLabel` when max != 100 and there is no label ("3/7" vs "43%"); make sw.js/webpush.ts match it. docs/protocol.md §9 still lists `oyee.debug`.

From 14: rewrite protocol §9 (Apple threadIdentifier is now the source; no debug or silent). Add a fixture for an ask without a reply placeholder. The Swift fixture copy is guarded by a drift test, so update it when the fixtures change.
