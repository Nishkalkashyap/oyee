# 11: Webhooks, REST and the web composer on intents

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** Scripts and webhook integrations send intents with the same field names as the MCP tools: JSON `{ "intent": "progress", … }` (default inform) or `?intent=` for plain-text, GET and header sends. Asks over webhooks are rejected with a clear message. Alertmanager, Grafana and SNS still work, producing keyed informs. The web Send page composes an inform or a progress.

**Blocked by:** 03, 07

**Status:** ready-for-agent

- [ ] Webhook JSON bodies are intent inputs with `intent` defaulting to inform; `key` and `cooldown` work as for agents
- [ ] `intent: "ask"` on a webhook returns 400 explaining ask is for agents over MCP
- [ ] Plain text, query parameters and ntfy-style headers produce an inform; `?intent=progress` with key/value/status works
- [ ] Alertmanager/Grafana produce informs keyed by group key (severity from labels; below-info levels map to info); resolution resolves the keyed inform; SNS produces an inform
- [ ] `POST /api/notifications` takes the intent-tagged body; the web Send page offers inform and progress with the intent fields (no templates, tags or silent)
- [ ] Webhook and API server tests; web composer tests

## Comments

From 09: add a webhook test for the cross-intent key 409.

## Comments

From 08: progress sent via webhooks/REST must also register the stale deadline (same progress operation as MCP).
