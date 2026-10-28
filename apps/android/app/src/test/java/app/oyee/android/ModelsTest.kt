package app.oyee.android

import app.oyee.android.model.ActionStyle
import app.oyee.android.model.ClientMessages
import app.oyee.android.model.OyeeJson
import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus
import app.oyee.android.model.Page
import app.oyee.android.model.PairResult
import app.oyee.android.model.ServerMessage
import app.oyee.android.model.Severity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {
    @Test
    fun `parses the protocol example notification`() {
        val n = OyeeJson.decodeFromString(Notification.serializer(), Fixtures.FULL_NOTIFICATION)
        assertEquals("ntf_01JBX0000000000000000000", n.id)
        assertEquals("aws-monitor", n.source)
        assertEquals("run-42", n.threadId)
        assertEquals(Severity.CRITICAL, n.severity)
        assertEquals(NotificationStatus.ACTIVE, n.status)
        assertEquals("🔥", n.icon)
        assertEquals(1, n.fields.size)
        assertEquals("Region", n.fields[0].label)
        val p = n.progress!!
        assertEquals(3.0, p.value, 0.0)
        assertEquals(7.0, p.max, 0.0)
        assertEquals("3/7 checks", p.label)
        assertEquals(3, n.actions.size)
        assertEquals(ActionStyle.PRIMARY, n.actions[0].style)
        assertTrue(n.actions[0].resolves)
        assertEquals("https://example.com/cb", n.actions[1].callback!!.url)
        assertEquals(ActionStyle.DEFAULT, n.actions[2].style) // style omitted → default
        assertEquals("https://console.aws.amazon.com", n.actions[2].url)
        assertEquals("Tell the agent…", n.reply!!.placeholder)
        assertEquals(listOf("prod", "aws"), n.tags)
        assertEquals(3, n.version)
        assertNull(n.readAt)
        assertEquals("Pixel 9", n.responses.single().deviceName)
        assertNull(n.responses.single().text)
        assertFalse(n.shouldDismissSystemNotification)
    }

    @Test
    fun `ignores unknown fields and coerces unknown enum values`() {
        val json = """
            {"id":"ntf_x","source":"s","title":"t","severity":"apocalyptic","status":"archived",
             "futureField":{"nested":[1,2,3]},"actions":[{"id":"a","label":"A","style":"neon","extra":true}],
             "progress":{"value":5,"newProp":"x"},"version":2,"createdAt":"2026-10-28T10:00:00.000Z",
             "updatedAt":"2026-10-28T10:00:00.000Z"}
        """.trimIndent()
        val n = OyeeJson.decodeFromString(Notification.serializer(), json)
        assertEquals(Severity.INFO, n.severity)
        assertEquals(NotificationStatus.ACTIVE, n.status)
        assertEquals(ActionStyle.DEFAULT, n.actions.single().style)
        val p = n.progress!!
        assertEquals(100.0, p.max, 0.0) // max default 100
        assertFalse(p.indeterminate)
        assertTrue(n.fields.isEmpty())
        assertNull(n.body)
    }

    @Test
    fun `explicit nulls on nullable fields decode as null`() {
        val json = """{"id":"ntf_x","title":"t","body":null,"progress":null,"reply":null,"readAt":"2026-10-28T10:00:00.000Z","status":"resolved"}"""
        val n = OyeeJson.decodeFromString(Notification.serializer(), json)
        assertNull(n.body)
        assertNull(n.progress)
        assertTrue(n.isRead)
        assertTrue(n.isResolved)
        assertTrue(n.shouldDismissSystemNotification)
    }

    @Test
    fun `parses a page and a pair result`() {
        val page = OyeeJson.decodeFromString(
            Page.serializer(Notification.serializer()),
            """{"items":[${Fixtures.FULL_NOTIFICATION}],"nextCursor":null}""",
        )
        assertEquals(1, page.items.size)
        assertNull(page.nextCursor)

        val pair = OyeeJson.decodeFromString(
            PairResult.serializer(),
            """{"device":{"id":"dev_1","name":"Pixel 9","platform":"android","transports":["fcm","carrier-pigeon"],
               "createdAt":"2026-10-28T10:00:00.000Z","lastSeenAt":null},"token":"oyee_dev_abc",
               "user":{"id":"usr_1","email":"a@b.c","name":null,"avatarUrl":null}}""",
        )
        assertEquals("oyee_dev_abc", pair.token)
        assertEquals(listOf("fcm", "carrier-pigeon"), pair.device.transports)
        assertEquals("a@b.c", pair.user.email)
    }

    @Test
    fun `parses every websocket server message`() {
        val n = Fixtures.FULL_NOTIFICATION
        assertTrue(ServerMessage.parse("""{"type":"hello","userId":"usr_1","deviceId":null,"serverTime":"x"}""") is ServerMessage.Hello)
        val created = ServerMessage.parse("""{"type":"notification.created","notification":$n}""")
        assertEquals("ntf_01JBX0000000000000000000", (created as ServerMessage.Created).notification.id)
        val updated = ServerMessage.parse("""{"type":"notification.updated","notification":$n,"alert":true,"reason":"read"}""")
        assertTrue((updated as ServerMessage.Updated).alert)
        assertEquals("read", updated.reason)
        assertEquals("ntf_9", (ServerMessage.parse("""{"type":"notification.deleted","id":"ntf_9"}""") as ServerMessage.Deleted).id)
        val sync = ServerMessage.parse("""{"type":"sync.result","notifications":[$n],"deletedIds":["ntf_2"],"cursor":"c1","hasMore":true,"x":1}""")
        sync as ServerMessage.SyncResult
        assertEquals(1, sync.notifications.size)
        assertEquals(listOf("ntf_2"), sync.deletedIds)
        assertEquals("c1", sync.cursor)
        assertTrue(sync.hasMore)
        assertEquals(ServerMessage.Pong, ServerMessage.parse("""{"type":"pong"}"""))
    }

    @Test
    fun `unknown or malformed frames are ignored`() {
        assertNull(ServerMessage.parse("""{"type":"presence.changed","who":"x"}"""))
        assertNull(ServerMessage.parse("not json"))
        assertNull(ServerMessage.parse("""{"no":"type"}"""))
    }

    @Test
    fun `client messages`() {
        assertEquals("ping", Json.parseToJsonElement(ClientMessages.ping()).jsonObject["type"]!!.jsonPrimitive.content)
        val nullSync = Json.parseToJsonElement(ClientMessages.sync(null)).jsonObject
        assertEquals("sync", nullSync["type"]!!.jsonPrimitive.content)
        assertTrue("since must be an explicit null", nullSync.containsKey("since"))
        assertEquals(JsonNull, nullSync["since"])
        assertEquals("c1", Json.parseToJsonElement(ClientMessages.sync("c1")).jsonObject["since"]!!.jsonPrimitive.content)
    }
}
