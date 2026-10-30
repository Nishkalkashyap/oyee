# 02: Inform end-to-end

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** An agent calls the MCP `inform` tool with a title (and optionally body, severity, url, links, fields, image, icon, key) and the user receives it on every device; the web inbox shows it with a purpose-built inform card. Sending again with the same key from the same source updates the existing inform instead of creating a duplicate. The tool result tells the agent what happened (`created` / `alerted`) in plain text.

**Blocked by:** 01

**Status:** resolved

- [ ] MCP `inform` tool exists with the inform input schema; every field has a one-line description; severity is `info | success | warning | critical`, each described by when to use it
- [ ] `key` is unique per `(source, key)`: a second inform with the same key updates the latest active one and alerts; a different source with the same key creates its own
- [ ] Links become link buttons on every client (≤ 3), and the flat fields are still populated for old clients
- [ ] The tool result states the outcome and the notification id
- [ ] The web inbox and detail view draw inform with a purpose-built card (severity, body, rows, image, link buttons), following docs/design.md
- [ ] Server tests through MCP `tools/call`; web card/view-model tests on the shared fixtures

## Comments

Resolved in 9253cdd on `notification-intents`. Inform rules in the inbox `inform` module; MCP tool in its own module; web InformCard.
