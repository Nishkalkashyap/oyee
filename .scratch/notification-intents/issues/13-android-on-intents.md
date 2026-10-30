# 13: Android on intents

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** The Android app decodes the intent-shaped notification and draws a purpose-built card per intent in the inbox and detail screen, sorts the inbox into the three sections, and posts system notifications per intent: inform by severity, ask with answer buttons and inline reply, progress with native progress that updates silently and alerts on done, failed and stopped.

**Blocked by:** 06, 08

**Status:** ready-for-agent

- [ ] Models mirror protocol v2 (intent blocks), decoding the shared fixtures
- [ ] Inform, ask (open, answered, expired, withdrawn) and progress (running, done, failed, stopped) cards in inbox and detail
- [ ] Inbox sections and stacking by intent and key
- [ ] System notifications per intent; answering from the notification posts to the respond endpoint; expired/answered asks are cancelled
- [ ] The debug channel is deleted on upgrade; tags, thread and silent handling removed
- [ ] Unit tests (models, inbox sections, card state labels) pass; screenshots of each card state attached for code review
