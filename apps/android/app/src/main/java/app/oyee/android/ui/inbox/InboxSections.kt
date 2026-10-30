package app.oyee.android.ui.inbox

import app.oyee.android.model.AskState
import app.oyee.android.model.Intent
import app.oyee.android.model.Notification
import app.oyee.android.model.ProgressState

/*
 * How the active inbox is laid out, by intent (GLOSSARY.md; same rules as the web, apps/web/src/lib/inbox.ts): open
 * asks first (Needs you), then running or stopped progress (In progress), then everything else (Updates) with repeats
 * stacked into one row.
 */

enum class InboxSectionId(val title: String) { NEEDS_YOU("Needs you"), IN_PROGRESS("In progress"), UPDATES("Updates") }

/** Which section a notification belongs in: decided by its intent and state only. */
fun Notification.section(): InboxSectionId = when {
    intent == Intent.ASK && ask?.state == AskState.OPEN -> InboxSectionId.NEEDS_YOU
    intent == Intent.PROGRESS && (progress?.state == ProgressState.RUNNING || progress?.state == ProgressState.STOPPED) ->
        InboxSectionId.IN_PROGRESS
    else -> InboxSectionId.UPDATES
}

/** Repeats collapse by `(source, key)` when there is a key, otherwise by source + title ("Front door left open" ×4). */
fun Notification.stackKey(): String = key?.let { "key:$source\u0000$it" } ?: "title:$source\u0000$title"

/** Newest first; the first item is the row that's shown. */
data class InboxStack(val key: String, val items: List<Notification>) {
    val head: Notification get() = items.first()
}

data class InboxSection(val id: InboxSectionId, val stacks: List<InboxStack>)

/**
 * Splits a createdAt-desc list into sections, in the order Needs you, In progress, Updates; empty sections are dropped.
 * Only Updates stacks repeats: an open ask or a live progress is always its own row.
 */
fun inboxSections(items: List<Notification>): List<InboxSection> {
    val needs = mutableListOf<InboxStack>()
    val live = mutableListOf<InboxStack>()
    val updates = LinkedHashMap<String, MutableList<Notification>>()
    for (n in items) {
        when (n.section()) {
            InboxSectionId.NEEDS_YOU -> needs += InboxStack(n.id, listOf(n))
            InboxSectionId.IN_PROGRESS -> live += InboxStack(n.id, listOf(n))
            InboxSectionId.UPDATES -> updates.getOrPut(n.stackKey()) { mutableListOf() } += n
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
