# 14: macOS on intents

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** The Mac menu-bar app (and the shared Swift package) decodes the intent-shaped notification, draws a purpose-built card per intent, sorts the inbox into the three sections, and posts system notifications per intent: answer buttons and text reply for asks, the text progress bar for progress, alerting only on done, failed and stopped.

**Blocked by:** 06, 08

**Status:** ready-for-agent

- [ ] Swift models mirror protocol v2, decoding the shared fixtures
- [ ] Inform, ask (all states) and progress (all states) cards
- [ ] Inbox sections and stacking by intent and key
- [ ] System notifications per intent via categories and text-input actions; expired/answered asks are removed
- [ ] Tags, thread and silent handling removed; the iOS target still compiles
- [ ] `swift test` passes; screenshots of each card state attached for code review

## Comments

From 01: Swift tests need a copy of packages/schema/fixtures/notifications.v2.json inside their test target.

From 05: the respond endpoint now takes `{option}` (first answer wins, 409 after). Update this client's respond calls (web: sw.js + webpush.ts) to send `option`.
