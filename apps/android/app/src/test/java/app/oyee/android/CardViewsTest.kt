package app.oyee.android

import app.oyee.android.model.AskState
import app.oyee.android.model.Field
import app.oyee.android.model.LinkButton
import app.oyee.android.model.ProgressBlock
import app.oyee.android.model.ProgressState
import app.oyee.android.model.Severity
import app.oyee.android.ui.cards.AskOption
import app.oyee.android.ui.cards.InformIcon
import app.oyee.android.ui.cards.ProgressTone
import app.oyee.android.ui.cards.askView
import app.oyee.android.ui.cards.informView
import app.oyee.android.ui.cards.progressView
import app.oyee.android.ui.cards.stoppedReportingLabel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** The labels each intent's card shows (same wording as the web's lib/ask.ts, lib/progress.ts, lib/inform.ts). */
class CardViewsTest {
    private val nine12: Instant = Instant.parse("2026-10-30T09:12:00Z")

    @Test
    fun `an open ask says how long it has waited and when it expires`() {
        val v = askView(Fixtures.notification("ask-open"), nine12)
        assertEquals(AskState.OPEN, v.state)
        assertTrue(v.open)
        assertEquals("Waiting 12m", v.status)
        assertEquals("Expires in 48m", v.expiry)
        assertEquals(listOf(AskOption("Approve", false), AskOption("Reject", false), AskOption("Wait", false)), v.options)
        assertEquals("Reply…", v.replyPlaceholder)
        assertNull(v.note)
    }

    @Test
    fun `an ask that takes text without a placeholder shows the app's own`() {
        val v = askView(Fixtures.notification("ask-open-text-no-placeholder"), nine12)
        assertTrue(v.open)
        assertTrue(v.options.isEmpty())
        assertEquals("Reply…", v.replyPlaceholder)
    }

    @Test
    fun `waiting and expiry read naturally at the edges`() {
        val n = Fixtures.notification("ask-open")
        assertEquals("Just asked", askView(n, Instant.parse("2026-10-30T09:00:30Z")).status)
        assertEquals("Expires in under a minute", askView(n, Instant.parse("2026-10-30T09:59:40Z")).expiry)
        val long = n.copy(ask = n.ask!!.copy(expiresAt = "2026-10-30T14:00:00.000Z"))
        assertEquals("Waiting 2h", askView(long, Instant.parse("2026-10-30T11:30:00Z")).status)
        assertEquals("Expires in 2h 30m", askView(long, Instant.parse("2026-10-30T11:30:00Z")).expiry)
        assertEquals("Expires in 4h", askView(long, Instant.parse("2026-10-30T10:00:00Z")).expiry)
    }

    @Test
    fun `an open ask past its expiry already reads as expired`() {
        val v = askView(Fixtures.notification("ask-open"), Instant.parse("2026-10-30T10:00:01Z"))
        assertEquals(AskState.EXPIRED, v.state)
        assertFalse(v.open)
        assertEquals("Expired", v.status)
        assertNull(v.expiry)
        assertNull(v.replyPlaceholder)
    }

    @Test
    fun `an answered ask names the answer and the device`() {
        val option = askView(Fixtures.notification("ask-answered-option"), nine12)
        assertEquals("Answered: Approve · Pixel 9", option.status)
        assertEquals(listOf(AskOption("Approve", true), AskOption("Reject", false)), option.options)
        assertFalse(option.open)
        assertNull(option.expiry)
        assertNull(option.replyPlaceholder)
        assertEquals("Answered: release/1.4 · MacBook Pro", askView(Fixtures.notification("ask-answered-text"), nine12).status)
    }

    @Test
    fun `expired and withdrawn asks say why they can't be answered`() {
        val expired = askView(Fixtures.notification("ask-expired"), nine12)
        assertEquals("Expired", expired.status)
        assertEquals("Nobody answered within 1h, so the question was closed on every device.", expired.note)
        val withdrawn = askView(Fixtures.notification("ask-withdrawn"), nine12)
        assertEquals(AskState.WITHDRAWN, withdrawn.state)
        assertEquals("Withdrawn", withdrawn.status)
        assertEquals("The sender withdrew this question before it was answered.", withdrawn.note)
    }

    @Test
    fun `progress states and amounts`() {
        val running = progressView(Fixtures.notification("progress-running").progress!!)
        assertEquals(ProgressState.RUNNING, running.state)
        assertEquals("Running", running.stateLabel)
        assertEquals("3/7 checks", running.amount)
        assertEquals(300.0 / 7, running.percent, 1e-9)
        assertEquals(ProgressTone.INK, running.tone)
        assertEquals("40%", progressView(Fixtures.notification("progress-running-percent").progress!!).amount)

        val done = progressView(Fixtures.notification("progress-done").progress!!)
        assertEquals("Done" to ProgressTone.SUCCESS, done.stateLabel to done.tone)
        val failed = progressView(Fixtures.notification("progress-failed").progress!!)
        assertEquals("Failed" to ProgressTone.WARNING, failed.stateLabel to failed.tone)
        val stopped = progressView(Fixtures.notification("progress-stopped").progress!!)
        assertEquals("Stopped reporting after 40%" to ProgressTone.MUTED, stopped.stateLabel to stopped.tone)
    }

    @Test
    fun `stopped reporting names the last label, else the rounded percent`() {
        assertEquals("Stopped reporting after 3/7 checks", stoppedReportingLabel(ProgressBlock(value = 3.0, max = 7.0, label = "3/7 checks")))
        assertEquals("Stopped reporting after 43%", stoppedReportingLabel(ProgressBlock(value = 3.0, max = 7.0)))
        assertEquals("Stopped reporting after 0%", stoppedReportingLabel(ProgressBlock(value = 5.0, max = 0.0)))
    }

    @Test
    fun `an inform shows its rows, safe links and where a tap goes`() {
        val v = informView(Fixtures.notification("inform-full"))
        assertEquals(Severity.CRITICAL, v.severity)
        assertEquals("Critical", v.severityLabel)
        assertEquals(InformIcon.Emoji("💾"), v.icon)
        assertEquals("https://grafana.example.com/render/disk.png", v.image)
        assertEquals(listOf(Field("Host", "db-1"), Field("Used", "95%")), v.rows)
        assertEquals(listOf("Dashboard", "Runbook"), v.links.map { it.label })
        assertEquals("grafana.example.com", v.openHost)
        assertFalse(v.resolved)
    }

    @Test
    fun `an inform without extras falls back to its severity glyph`() {
        val minimal = informView(Fixtures.notification("inform-minimal"))
        assertNull(minimal.icon)
        assertNull(minimal.openHost)
        assertTrue(minimal.links.isEmpty())
        assertTrue(informView(Fixtures.notification("inform-resolved")).resolved)

        val n = Fixtures.notification("inform-full")
        val odd = n.copy(
            inform = n.inform!!.copy(
                icon = "https://cdn.example.com/i.png",
                image = "javascript:alert(1)",
                fields = listOf(Field("Empty", "")),
                links = listOf(LinkButton("Bad", "javascript:alert(1)"), LinkButton("Ok", "https://ok.example.com")),
            ),
        )
        val v = informView(odd)
        assertEquals(InformIcon.Image("https://cdn.example.com/i.png"), v.icon)
        assertNull(v.image)
        assertEquals(listOf(Field("Empty", "—")), v.rows)
        assertEquals(listOf("Ok"), v.links.map { it.label })
    }
}
