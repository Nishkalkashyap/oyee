package app.oyee.android

import app.oyee.android.ui.inbox.InboxSectionId
import app.oyee.android.ui.inbox.flatSections
import app.oyee.android.ui.inbox.inboxSections
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same rules as the web (apps/web/src/lib/inbox.ts), on the shared v2 fixtures. */
class InboxSectionsTest {
    private fun f(name: String, id: String = name) = Fixtures.notification(name).copy(id = id)

    @Test
    fun `open asks need you, running or stopped progress is in progress, everything else is an update`() {
        val s = inboxSections(Fixtures.names.sorted().map { f(it) })
        assertEquals(listOf(InboxSectionId.NEEDS_YOU, InboxSectionId.IN_PROGRESS, InboxSectionId.UPDATES), s.map { it.id })
        assertEquals(listOf("ask-open", "ask-open-text-no-placeholder"), s[0].stacks.map { it.head.id })
        assertEquals(setOf("progress-running", "progress-running-percent", "progress-stopped"), s[1].stacks.map { it.head.id }.toSet())
        val updates = s[2].stacks.flatMap { st -> st.items.map { it.id } }.toSet()
        assertEquals(
            setOf(
                "inform-minimal", "inform-full", "inform-resolved", "inform-warning",
                "ask-answered-option", "ask-answered-text", "ask-expired", "ask-withdrawn",
                "progress-done", "progress-failed",
            ),
            updates,
        )
    }

    @Test
    fun `empty sections are dropped and the order is kept`() {
        assertEquals(listOf(InboxSectionId.UPDATES), inboxSections(listOf(f("inform-minimal"))).map { it.id })
        assertEquals(
            listOf(InboxSectionId.NEEDS_YOU, InboxSectionId.UPDATES),
            inboxSections(listOf(f("inform-warning"), f("ask-open"))).map { it.id },
        )
        assertTrue(inboxSections(emptyList()).isEmpty())
    }

    @Test
    fun `updates stack by source and key, else by source and title`() {
        val alert = f("inform-full")
        val s = inboxSections(
            listOf(
                alert.copy(id = "k1"),
                f("inform-warning", "d1"),
                alert.copy(id = "k2", title = "Disk 97% full on db-1"), // same key, new title: same stack
                alert.copy(id = "other-source", source = "grafana"), // same key, other source: its own stack
                f("inform-warning", "d2"),
                f("inform-warning", "d3").copy(source = "other"),
            ),
        )
        assertEquals(
            listOf(listOf("k1", "k2"), listOf("d1", "d2"), listOf("other-source"), listOf("d3")),
            s.single().stacks.map { st -> st.items.map { it.id } },
        )
    }

    @Test
    fun `open asks and live progress never stack`() {
        val s = inboxSections(listOf(f("ask-open", "a1"), f("ask-open", "a2"), f("progress-running", "p1"), f("progress-running", "p2")))
        assertEquals(listOf(listOf("a1"), listOf("a2")), s[0].stacks.map { st -> st.items.map { it.id } })
        assertEquals(listOf(listOf("p1"), listOf("p2")), s[1].stacks.map { st -> st.items.map { it.id } })
    }

    @Test
    fun `flatSections keeps every row`() {
        assertEquals(listOf("a", "b"), flatSections(listOf(f("inform-warning", "a"), f("inform-warning", "b")))[0].stacks.map { it.key })
        assertTrue(flatSections(emptyList()).isEmpty())
    }
}
