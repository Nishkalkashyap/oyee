# Senders send intents, not cards

Every sender (agents over MCP, webhooks, REST, the web composer) sends one of three intents (inform, ask, progress),
each with a short schema, using the same field names everywhere; the MCP surface is one tool per intent. The intent
carries all the way through: the stored notification is intent-shaped (shared fields plus one block for its intent)
and every client draws a purpose-built card per intent, replacing the generic everything-optional card. A model picks the
right tool far more reliably than it picks the right subset of ~17 optional card fields, and one vocabulary for
agents and webhooks keeps the docs and the mental model single.

## Considered Options

- **A `kind` enum on one `send_notification` tool** (discriminated union per kind): rejected because MCP clients and
  models handle `oneOf`/`anyOf` schemas unevenly, which flattens it back into one large schema.
- **Intents for agents, the flat card for webhooks**: briefly chosen, then rejected for two vocabularies and two sets
  of docs; machine senders get what they need through intent fields instead.
- **Keep the flat card and improve its descriptions**: rejected because it doesn't remove the choice that confuses
  agents.
- **Saved templates** (`{{var}}` presets): removed; intents make them unnecessary.

## Consequences

- Older app builds read only the shared fields (title, body, severity) until updated; server, web and apps release
  together.
- Senders never reason about platforms: every intent renders on Android, macOS and the web, with fallbacks owned by
  Oyee.
- A card field that no intent exposes is effectively dead; adding one is a deliberate schema change to an intent.
- Only agents can ask: they poll for the answer with a standard tool call. Webhook senders get no answers, so
  callback buttons and signed callbacks are gone.
- Repeat suppression is a server rule (`key` + `cooldown`), not something an agent works out from history.
