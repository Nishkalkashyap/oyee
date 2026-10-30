# 16: Release v0.3.0

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** Server and web are deployed and the Android and macOS apps are released together as v0.3.0, following docs/operations.md §3. Releases are user-facing, so this happens only when the maintainer asks.

**Blocked by:** 15

**Status:** ready-for-human

- [ ] Maintainer has asked for the release
- [ ] `pnpm deploy` from the repo root (never bare wrangler deploy)
- [ ] Versions bumped, tag `v0.3.0` pushed, GitHub Release has the signed APK and macOS zip
- [ ] Verified in production: an inform, an ask (answered and expired) and a progress (done and stopped) on web, Android and macOS

## Comments

All build tickets (01–15) are resolved on `notification-intents`, code-reviewed and fixed (f4105a5). Release order: 0.2.x apps decode v2 notifications (title, body, progress bar) but lose icons, images, rows, links and answering asks, so ship the apps alongside the deploy; app-first is recommended, not required. Android has no screenshots (no emulator): check the cards on the Galaxy before tagging.
