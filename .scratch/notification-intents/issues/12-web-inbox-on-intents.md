# 12: Web inbox on intents

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** The web inbox is organised by intent: Needs you (open asks), In progress (running or stopped progress), Updates (everything else), and notifications with the same `(source, key)` stack as one. Tag chips, tag search, the thread filter and the Templates page are gone.

**Blocked by:** 02, 05, 07

**Status:** ready-for-agent

- [ ] Sections are computed from intent and state, not from actions/progress fields
- [ ] Stacking groups by `(source, key)` when a key exists, otherwise source and title
- [ ] Tag chips, tag search, thread filter and the Templates page/route/nav item are removed
- [ ] Web inbox tests on the shared fixtures

## Comments

From 02: the web service worker (sw.js, mirrored by webpush.ts) still drops link buttons from the browser popup; show inform links there (first two buttons).

From 05: the respond endpoint now takes `{option}` (first answer wins, 409 after). Update this client's respond calls (web: sw.js + webpush.ts) to send `option`.
