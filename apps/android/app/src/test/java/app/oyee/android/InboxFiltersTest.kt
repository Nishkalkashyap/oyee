package app.oyee.android

import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus
import app.oyee.android.model.OyeeJson
import app.oyee.android.ui.inbox.InboxFilters
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InboxFiltersTest {
    private fun n(status: String, source: String = "codex") = OyeeJson.decodeFromString(
        Notification.serializer(),
        """{"id":"ntf_$status","source":"$source","title":"t","status":"$status"}""",
    )

    @Test
    fun `default view shows only active notifications`() {
        val f = InboxFilters()
        assertTrue(f.matches(n("active")))
        assertFalse(f.matches(n("resolved")))
        assertFalse(f.isNarrowed)
    }

    @Test
    fun `resolved and all tabs`() {
        assertTrue(InboxFilters(status = NotificationStatus.RESOLVED).matches(n("resolved")))
        assertFalse(InboxFilters(status = NotificationStatus.RESOLVED).matches(n("active")))
        assertTrue(InboxFilters(status = null).matches(n("resolved")))
        assertTrue(InboxFilters(status = null).matches(n("active")))
    }

    @Test
    fun `source narrows within the tab`() {
        val f = InboxFilters(source = "aws")
        assertTrue(f.isNarrowed)
        assertFalse(f.matches(n("active")))
        assertTrue(f.matches(n("active", source = "aws")))
    }
}
