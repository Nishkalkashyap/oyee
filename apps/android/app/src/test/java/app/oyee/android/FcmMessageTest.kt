package app.oyee.android

import app.oyee.android.model.FcmMessage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FcmMessageTest {
    private val inline = Json.parseToJsonElement(Fixtures.FULL_NOTIFICATION).toString() // compact JSON string

    @Test
    fun `created with inline notification`() {
        val m = FcmMessage.parse(
            mapOf(
                "type" to "notification.created",
                "id" to "ntf_01JBX0000000000000000000",
                "version" to "3",
                "alert" to "true",
                "notification" to inline,
            ),
        )!!
        assertTrue(m.isCreated)
        assertEquals(3, m.version)
        assertTrue(m.alert)
        assertNotNull(m.notification)
        assertEquals("prod-api CPU high", m.notification!!.title)
    }

    @Test
    fun `updated without inline notification must be fetched`() {
        val m = FcmMessage.parse(mapOf("type" to "notification.updated", "id" to "ntf_big", "version" to "12", "alert" to "false"))!!
        assertTrue(m.isUpdated)
        assertEquals("ntf_big", m.id)
        assertEquals(12, m.version)
        assertFalse(m.alert)
        assertNull("absent → client GETs /api/notifications/:id", m.notification)
    }

    @Test
    fun `deleted message`() {
        val m = FcmMessage.parse(mapOf("type" to "notification.deleted", "id" to "ntf_1", "version" to "4", "alert" to "false"))!!
        assertTrue(m.isDeleted)
        assertNull(m.notification)
    }

    @Test
    fun `malformed inline notification falls back to fetching`() {
        val m = FcmMessage.parse(mapOf("type" to "notification.created", "id" to "ntf_1", "version" to "1", "alert" to "true", "notification" to "{broken"))!!
        assertNull(m.notification)
        assertEquals("ntf_1", m.id)
    }

    @Test
    fun `inline notification with unknown fields still parses`() {
        val withExtra = Json.parseToJsonElement(inline).let { JsonObject(it as JsonObject + ("brandNew" to Json.parseToJsonElement("[1]"))) }.toString()
        val m = FcmMessage.parse(mapOf("type" to "notification.updated", "id" to "ntf_01JBX0000000000000000000", "version" to "3", "alert" to "false", "notification" to withExtra, "unknownKey" to "x"))!!
        assertNotNull(m.notification)
    }

    @Test
    fun `inline notification with a different id is ignored`() {
        val m = FcmMessage.parse(mapOf("type" to "notification.created", "id" to "ntf_other", "version" to "3", "alert" to "true", "notification" to inline))!!
        assertNull(m.notification)
    }

    @Test
    fun `non-oyee or incomplete messages are rejected`() {
        assertNull(FcmMessage.parse(emptyMap()))
        assertNull(FcmMessage.parse(mapOf("type" to "something.else", "id" to "x")))
        assertNull(FcmMessage.parse(mapOf("type" to "notification.created")))
    }

    @Test
    fun `missing version and alert default safely`() {
        val m = FcmMessage.parse(mapOf("type" to "notification.created", "id" to "ntf_1"))!!
        assertEquals(0, m.version)
        assertFalse(m.alert)
    }
}
