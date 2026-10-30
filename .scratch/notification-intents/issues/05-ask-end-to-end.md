# 05: Ask end-to-end

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** An agent calls `ask` with a question, up to three options and/or a text reply box, and an optional url; the user answers from any device; the agent gets the answer from `wait_for_response`. The first answer closes the ask everywhere and every device shows "Answered: <answer> · <device>". Asking again with the key of an open ask returns that ask instead of alerting again. The web inbox shows a purpose-built ask card.

**Blocked by:** 01

**Status:** resolved

- [ ] MCP `ask` takes title, body, options (≤ 3), allowText, url, key, source, devices, platforms; it always alerts at `warning`; with neither options nor allowText a reply box is added
- [ ] The `ask` result text tells the agent to call `wait_for_response` with the returned id; a reused ask says "already asked N ago, still waiting"
- [ ] `wait_for_response` holds up to 50 s and returns answered (answer + device) or pending; the pending text says how long ago it was asked and to call again with the same id
- [ ] The first answer (option or text, any device) records the answer, resolves the ask and broadcasts; later answers get a conflict error
- [ ] The web ask card shows open (buttons, reply box, waiting time) and answered states
- [ ] Server tests through MCP and the respond endpoint; web view-model tests on the shared fixtures

## Comments

Resolved: work 4c522b4, merged into `notification-intents` at 4ac26b9 (combined with 07).
