# Oyee

A notification hub: agents, webhooks and scripts send notifications that reach the user's phone, laptop and browser,
and the user can answer them.

## Language

### Intents

**Intent**:
What a sender means by a notification. Every notification is exactly one of: inform, ask, progress.
_Avoid_: Template, kind, card type, layout

**Inform**:
A one-way notification: something the user should know. It carries no answer buttons.
_Avoid_: Message, alert

**Ask**:
A notification that needs a decision or text from the user; only agents send it, and they poll for the answer.
_Avoid_: Question, prompt, approval

**Progress**:
A notification about long-running work, updated in place until it ends as done or failed.
_Avoid_: Task, job, status

**Stopped reporting**:
The state of a progress whose sender went quiet for too long without finishing it; a later update revives it.
_Avoid_: Stale, stalled, timed out, dead

**Key**:
A name the sender chooses for a notification so later sends refer to the same one instead of creating a duplicate.
_Avoid_: Replace key, dedupe key, id

**Cooldown**:
The minimum time between two alerts for the same key; sends inside it update the notification silently.
_Avoid_: Throttle, rate limit

**Expiry**:
The moment an unanswered ask closes; after it the ask can no longer be answered.
_Avoid_: Timeout, deadline

**Severity**:
How urgently a notification needs the user: info, success, warning or critical. Every severity alerts; muting is the
receiver's choice, never the sender's.
_Avoid_: Priority, level, debug, silent

### Buttons

**Link button**:
A button that opens a URL on the device; nothing is sent back to the sender.
_Avoid_: URL action

**Answer button**:
A button on an ask that records the user's choice as the answer.
_Avoid_: Option, respond action, callback button
