package app.oyee.android

import app.oyee.android.model.LinkButton
import app.oyee.android.notify.NotificationPlan
import app.oyee.android.notify.NotificationPlan.Button.Answer
import app.oyee.android.notify.NotificationPlan.Button.Link
import app.oyee.android.notify.NotificationPlan.Button.Reply
import app.oyee.android.notify.NotificationPlan.Button.Resolve
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** What the system notification for each intent offers and how it alerts (Android allows at most 3 buttons). */
class NotificationPlanTest {
    private val nine12: Instant = Instant.parse("2026-10-30T09:12:00Z")
    private val askOpen = Fixtures.notification("ask-open")

    @Test
    fun `an open ask offers its answers and, when it takes text, an inline reply`() {
        val onlyOptions = askOpen.copy(ask = askOpen.ask!!.copy(allowText = false))
        assertEquals(listOf(Answer("Approve"), Answer("Reject"), Answer("Wait")), NotificationPlan.buttons(onlyOptions, nine12))
        // Three answers and a reply box: the reply keeps its slot, the third answer is left to the app.
        assertEquals(listOf(Answer("Approve"), Answer("Reject"), Reply("Reply…")), NotificationPlan.buttons(askOpen, nine12))
        val textOnly = Fixtures.notification("ask-answered-text").let {
            it.copy(status = askOpen.status, readAt = null, ask = it.ask!!.copy(state = askOpen.ask!!.state, answer = null))
        }
        assertEquals(listOf(Reply("Branch name")), NotificationPlan.buttons(textOnly, nine12))
    }

    @Test
    fun `an ask without a reply placeholder gets the app's own`() {
        val n = Fixtures.notification("ask-open-text-no-placeholder")
        assertNull(n.ask!!.replyPlaceholder)
        assertEquals(listOf(Reply("Reply…")), NotificationPlan.buttons(n, nine12))
    }

    @Test
    fun `a closed or expired ask offers nothing and leaves the tray`() {
        for (name in listOf("ask-answered-option", "ask-answered-text", "ask-expired", "ask-withdrawn")) {
            val n = Fixtures.notification(name)
            assertTrue(name, NotificationPlan.buttons(n, nine12).isEmpty())
            assertTrue(name, NotificationPlan.dismiss(n, nine12))
        }
        val pastExpiry = Instant.parse("2026-10-30T10:00:00Z")
        assertTrue(NotificationPlan.buttons(askOpen, pastExpiry).isEmpty())
        assertTrue(NotificationPlan.dismiss(askOpen, pastExpiry))
        assertFalse(NotificationPlan.dismiss(askOpen, nine12))
    }

    @Test
    fun `an inform offers its links, then Resolve while a slot is free`() {
        val full = Fixtures.notification("inform-full")
        assertEquals(
            listOf(Link("Dashboard", "https://grafana.example.com/d/disk"), Link("Runbook", "https://wiki.example.com/runbooks/disk"), Resolve),
            NotificationPlan.buttons(full, nine12),
        )
        val three = full.copy(inform = full.inform!!.copy(links = full.inform!!.links + LinkButton("Logs", "https://logs.example.com")))
        assertEquals(3, NotificationPlan.buttons(three, nine12).count { it is Link })
        assertFalse(Resolve in NotificationPlan.buttons(three, nine12))
        assertEquals(listOf(Resolve), NotificationPlan.buttons(Fixtures.notification("inform-minimal"), nine12))
    }

    @Test
    fun `progress offers Resolve in every state`() {
        for (name in listOf("progress-running", "progress-done", "progress-stopped")) {
            assertEquals(name, listOf(Resolve), NotificationPlan.buttons(Fixtures.notification(name), nine12))
        }
    }

    @Test
    fun `a running progress never makes a sound, everything else alerts when the event does`() {
        assertFalse(NotificationPlan.alerts(Fixtures.notification("progress-running"), eventAlert = true))
        for (name in listOf("progress-done", "progress-failed", "progress-stopped", "ask-open", "inform-minimal", "inform-warning")) {
            assertTrue(name, NotificationPlan.alerts(Fixtures.notification(name), eventAlert = true))
            assertFalse(name, NotificationPlan.alerts(Fixtures.notification(name), eventAlert = false))
        }
    }

    @Test
    fun `a finished progress stays in the tray until it is read`() {
        assertFalse(NotificationPlan.dismiss(Fixtures.notification("progress-done"), nine12))
        assertTrue(NotificationPlan.dismiss(Fixtures.notification("progress-failed"), nine12)) // read on another device
        assertTrue(NotificationPlan.dismiss(Fixtures.notification("inform-resolved"), nine12))
    }

    @Test
    fun `the progress line reads like the browser popup`() {
        assertEquals("▓▓▓▓░░░░░░ 3/7 checks", NotificationPlan.progressLine(Fixtures.notification("progress-running").progress!!))
        assertEquals("Done · 7/7 checks", NotificationPlan.progressLine(Fixtures.notification("progress-done").progress!!))
        assertEquals("Failed · 4/7 checks", NotificationPlan.progressLine(Fixtures.notification("progress-failed").progress!!))
        assertEquals("Stopped reporting after 40%", NotificationPlan.progressLine(Fixtures.notification("progress-stopped").progress!!))
        assertNull(NotificationPlan.progressLine(null))
    }
}
