package app.oyee.android

import app.oyee.android.util.NotificationIds
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationIdsTest {
    @Test
    fun `fnv1a matches reference vectors`() {
        assertEquals(0x811C9DC5.toInt(), NotificationIds.fnv1a(""))
        assertEquals(0xE40C292C.toInt(), NotificationIds.fnv1a("a"))
        assertEquals(0xBF9CF968.toInt(), NotificationIds.fnv1a("foobar"))
    }

    @Test
    fun `ids are stable, positive and avoid reserved values`() {
        val id = "ntf_01JBX5Z8Q4H6M2N7P9R3S5T7V9"
        val a = NotificationIds.forNotification(id)
        assertEquals(a, NotificationIds.forNotification(id))
        assertEquals(NotificationIds.fnv1a(id) and 0x7FFFFFFF, a.takeIf { it > 16 } ?: (a - 17))
        repeat(5_000) { i ->
            val v = NotificationIds.forNotification("ntf_$i")
            assertTrue(v > 16)
            assertNotEquals(NotificationIds.FOREGROUND_SERVICE, v)
        }
    }

    @Test
    fun `distinct ids rarely collide`() {
        val ids = (0 until 10_000).map { NotificationIds.forNotification("ntf_01JBX%022d".format(it)) }.toSet()
        assertTrue("collisions: ${10_000 - ids.size}", ids.size >= 9_990)
    }

    @Test
    fun `summary ids differ from child ids`() {
        assertNotEquals(NotificationIds.forNotification("aws"), NotificationIds.forSummary("aws"))
        assertEquals("oyee.group.aws", NotificationIds.groupKey("aws"))
    }
}
