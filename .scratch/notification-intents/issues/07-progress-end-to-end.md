# 07: Progress end-to-end

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** An agent reports long-running work with one `progress` tool called repeatedly, identified by a key it chooses: the first call appears without sound, updates stay silent, and `done` or `failed` alerts once. A finished progress stays in the inbox until read. The web inbox shows a purpose-built progress card with a real bar.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] MCP `progress` takes key (required), title, value, max (default 100), label, status (`running | done | failed`), body, url, source, devices, platforms
- [ ] First call creates silently; later calls with the same `(source, key)` update silently; `done` alerts at success, `failed` alerts at warning; a `running` call after a finished progress starts a fresh one
- [ ] A finished progress stays `active` (not resolved) until read, so its alert is not cancelled
- [ ] Native progress on Android still works through the flat fields during the expand phase
- [ ] The web progress card shows running, done and failed states
- [ ] Server tests through MCP and WebSocket events (alert flags); web view-model tests on the shared fixtures
