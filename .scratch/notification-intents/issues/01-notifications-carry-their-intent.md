# 01: Notifications carry their intent (expand)

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** Every stored and returned notification gains `intent` (inform | ask | progress), `key`, and one block for its intent (as described in the spec's Schema package section), while still carrying today's flat card fields so every existing client keeps rendering unchanged. Existing notifications are converted once with an inferred intent (non-link actions or a reply → ask, answered if it has a response else expired; progress → progress, done if at max else stopped; otherwise inform; link actions → links). Today's flat sends (REST, webhook, MCP `send_notification`, `ask`) produce the matching intent block too. This is the expand step: nothing is removed.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [ ] The intent-shaped Notification (shared fields + `inform` / `ask` / `progress` block) is defined in the schema package, alongside the existing flat fields
- [ ] Every notification returned by REST, WebSocket, push payloads and MCP includes `intent`, `key` and its intent block, and still includes the flat fields
- [ ] The inbox storage gains `intent` and `key` columns with an index on `(source, key)`; existing rows are converted once, idempotently
- [ ] Server tests (public endpoints in workerd) cover the intent inferred for each kind of flat send and for migrated old rows
- [ ] One shared set of protocol-v2 example notifications (every intent in every state) exists for the client decoding tests to use
- [ ] Web, Android and macOS test suites still pass unchanged

## Comments

Resolved in 2e987ee on `notification-intents`. Types and `inferIntent` in the schema package; fixtures at packages/schema/fixtures/notifications.v2.json.
