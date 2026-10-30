# 10: Final MCP surface

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** Agents see exactly seven tools: `inform`, `ask`, `wait_for_response`, `progress`, `resolve`, `list_notifications`, `list_devices`, and the server instructions explain in a few lines when to use inform, ask and progress. `list_notifications` returns compact items an agent can read cheaply.

**Blocked by:** 02, 05, 07

**Status:** ready-for-agent

- [ ] `send_notification`, `update_notification`, `get_notification`, `resolve_notification` and the three template tools are removed from MCP; `resolve` replaces `resolve_notification`
- [ ] `list_notifications` filters by key, intent, status and source; `limit` defaults to 10 (max 50) with a cursor; items are `id, intent, key, title, status, state, answer, createdAt, ago`
- [ ] Server instructions describe the three intents and when to use each
- [ ] MCP tests: tools/list returns exactly the seven tools; list_notifications filters, paging and `ago`
