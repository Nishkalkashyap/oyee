package app.oyee.android.ui.inbox

import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus

/*
 * How the active inbox is laid out (same rules as the web, apps/web/src/lib/inbox.ts): live progress first, then
 * what's waiting on you, then everything else with repeats stacked into one row.
 */

/** An unanswered question: buttons that call back (not links) or a reply box, with no response yet. */
fun Notification.needsAnswer(): Boolean {
    if (status != NotificationStatus.ACTIVE || responses.isNotEmpty()) return false
    return reply != null || actions.any { it.url == null }
}

/** A job that's still running (progress below its max, or an indeterminate bar). */
fun Notification.inProgress(): Boolean {
    val p = progress ?: return false
    return status == NotificationStatus.ACTIVE && (p.indeterminate || p.value < p.max)
}

/** Repeats collapse by thread, otherwise by source + title. */
fun Notification.stackKey(): String = threadId?.let { "thread:$it" } ?: "title:$source\u0000$title"

/** Newest first; the first item is the row that's shown. */
data class InboxStack(val key: String, val items: List<Notification>) {
    val head: Notification get() = items.first()
}

enum class InboxSectionId(val title: String) { NEEDS_YOU("Needs you"), IN_PROGRESS("In progress"), UPDATES("Updates") }

data class InboxSection(val id: InboxSectionId, val stacks: List<InboxStack>)

/** Splits a createdAt-desc list into sections, dropping empty ones. Only Updates stacks repeats. */
fun inboxSections(items: List<Notification>): List<InboxSection> {
    val needs = mutableListOf<InboxStack>()
    val live = mutableListOf<InboxStack>()
    val updates = LinkedHashMap<String, MutableList<Notification>>()
    for (n in items) {
        when {
            // A running job's buttons (Pause, Roll back) are controls, not questions.
            n.inProgress() -> live += InboxStack(n.id, listOf(n))
            n.needsAnswer() -> needs += InboxStack(n.id, listOf(n))
            else -> updates.getOrPut(n.stackKey()) { mutableListOf() } += n
        }
    }
    return listOf(
        InboxSection(InboxSectionId.NEEDS_YOU, needs),
        InboxSection(InboxSectionId.IN_PROGRESS, live),
        InboxSection(InboxSectionId.UPDATES, updates.map { (k, v) -> InboxStack(k, v) }),
    ).filter { it.stacks.isNotEmpty() }
}

/** One row per item, for the resolved list. */
fun flatSections(items: List<Notification>): List<InboxSection> =
    if (items.isEmpty()) emptyList() else listOf(InboxSection(InboxSectionId.UPDATES, items.map { InboxStack(it.id, listOf(it)) }))
