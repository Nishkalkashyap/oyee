# 04: Deadline scheduler (prefactor)

Spec: `.scratch/notification-intents/spec.md`. Vocabulary: `GLOSSARY.md`.

**What to build:** The inbox's single Durable Object alarm, which today only runs the daily retention prune, becomes a scheduler that always fires at the earliest pending deadline: the next daily prune plus any future ask expiry or progress stale deadline. On firing it runs whatever is due and reschedules. Nothing user-visible changes yet; this makes tickets 06 and 08 easy.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A deadline can be registered or cleared, and the alarm is always set to the earliest of all pending deadlines and the next prune
- [ ] Firing the alarm runs everything that is due and reschedules for the next one
- [ ] The existing retention test still passes; a new test shows an earlier deadline pulls the alarm forward and a cleared one lets it fall back to the prune
- [ ] The interface is small enough that 06 and 08 only add a deadline kind and its handler
