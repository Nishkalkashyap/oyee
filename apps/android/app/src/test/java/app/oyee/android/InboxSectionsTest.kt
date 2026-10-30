package app.oyee.android

import app.oyee.android.model.Action
import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus
import app.oyee.android.model.Progress
import app.oyee.android.model.Reply
import app.oyee.android.model.Response
import app.oyee.android.ui.inbox.InboxSectionId
import app.oyee.android.ui.inbox.flatSections
import app.oyee.android.ui.inbox.inProgress
import app.oyee.android.ui.inbox.inboxSections
import app.oyee.android.ui.inbox.needsAnswer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InboxSectionsTest {
    private val yes = Action(id = "yes", label = "Yes")
    private fun n(id: String, source: String = "test", title: String = "Title $id", threadId: String? = null) =
        Notification(id = id, source = source, title = title, threadId = threadId)

    @Test
    fun `needsAnswer means unanswered callback buttons or a reply box`() {
        assertTrue(n("a").copy(actions = listOf(yes)).needsAnswer())
        assertTrue(n("b").copy(reply = Reply()).needsAnswer())
        assertFalse(n("c").needsAnswer())
        assertFalse(n("d").copy(actions = listOf(Action(id = "open", label = "Open", url = "https://x.dev"))).needsAnswer())
        assertFalse(n("e").copy(actions = listOf(yes), responses = listOf(Response(actionId = "yes", at = "2026-10-30T00:00:00Z"))).needsAnswer())
        assertFalse(n("f").copy(actions = listOf(yes), status = NotificationStatus.RESOLVED).needsAnswer())
    }

    @Test
    fun `inProgress means unfinished or indeterminate progress`() {
        assertTrue(n("a").copy(progress = Progress(value = 2.0, max = 7.0)).inProgress())
        assertFalse(n("b").copy(progress = Progress(value = 7.0, max = 7.0)).inProgress())
        assertTrue(n("c").copy(progress = Progress(value = 0.0, indeterminate = true)).inProgress())
    }

    @Test
    fun `sections in order, empty ones dropped, running jobs with buttons stay in progress`() {
        val s = inboxSections(
            listOf(
                n("u1"),
                n("p1").copy(progress = Progress(value = 1.0, max = 3.0), actions = listOf(yes)),
                n("q1").copy(actions = listOf(yes)),
            ),
        )
        assertEquals(listOf(InboxSectionId.NEEDS_YOU, InboxSectionId.IN_PROGRESS, InboxSectionId.UPDATES), s.map { it.id })
        assertEquals(listOf("q1"), s[0].stacks.map { it.head.id })
        assertEquals(listOf("p1"), s[1].stacks.map { it.head.id })
        assertEquals(listOf(InboxSectionId.UPDATES), inboxSections(listOf(n("only"))).map { it.id })
    }

    @Test
    fun `repeats stack by thread, else by source and title`() {
        val s = inboxSections(
            listOf(
                n("w1", source = "archiver", title = "Warning"),
                n("t1", threadId = "deploy"),
                n("w2", source = "archiver", title = "Warning"),
                n("x", source = "other", title = "Warning"),
                n("t2", threadId = "deploy", title = "Something else"),
            ),
        )
        assertEquals(listOf(listOf("w1", "w2"), listOf("t1", "t2"), listOf("x")), s.single().stacks.map { st -> st.items.map { it.id } })
    }

    @Test
    fun `questions never stack and flatSections keeps every row`() {
        assertEquals(2, inboxSections(listOf(n("a", threadId = "t").copy(actions = listOf(yes)), n("b", threadId = "t").copy(actions = listOf(yes))))[0].stacks.size)
        assertEquals(listOf("a", "b"), flatSections(listOf(n("a", title = "Same"), n("b", title = "Same")))[0].stacks.map { it.key })
        assertTrue(flatSections(emptyList()).isEmpty())
    }
}
