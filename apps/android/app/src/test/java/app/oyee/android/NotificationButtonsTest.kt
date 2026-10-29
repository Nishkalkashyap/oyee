package app.oyee.android

import app.oyee.android.notify.NotificationButtons
import app.oyee.android.notify.NotificationButtons.Plan
import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationButtonsTest {
    @Test
    fun `resolve gets a free slot`() {
        assertEquals(Plan(actions = 0, resolve = true), NotificationButtons.plan(actionCount = 0, hasReply = false))
        assertEquals(Plan(actions = 2, resolve = true), NotificationButtons.plan(actionCount = 2, hasReply = false))
        assertEquals(Plan(actions = 1, resolve = true), NotificationButtons.plan(actionCount = 1, hasReply = true))
        assertEquals(Plan(actions = 0, resolve = true), NotificationButtons.plan(actionCount = 0, hasReply = true))
    }

    @Test
    fun `the sender's buttons and reply box win when slots run out`() {
        assertEquals(Plan(actions = 3, resolve = false), NotificationButtons.plan(actionCount = 3, hasReply = false))
        assertEquals(Plan(actions = 3, resolve = false), NotificationButtons.plan(actionCount = 5, hasReply = false))
        assertEquals(Plan(actions = 2, resolve = false), NotificationButtons.plan(actionCount = 2, hasReply = true))
        assertEquals(Plan(actions = 2, resolve = false), NotificationButtons.plan(actionCount = 4, hasReply = true))
    }
}
