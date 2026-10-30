package app.oyee.android

import app.oyee.android.model.AskState
import app.oyee.android.model.ClientMessages
import app.oyee.android.model.Intent
import app.oyee.android.model.LinkButton
import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus
import app.oyee.android.model.OyeeJson
import app.oyee.android.model.Page
import app.oyee.android.model.PairResult
import app.oyee.android.model.ProgressBlock
import app.oyee.android.model.ProgressState
import app.oyee.android.model.ServerMessage
import app.oyee.android.model.Severity
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {
    @Test
    fun `every shared fixture decodes with its intent block`() {
        assertTrue("shared fixtures are on the test classpath", Fixtures.names.size >= 10)
        for (name in Fixtures.names) {
            val n = Fixtures.notification(name)
            val expected = Intent.entries.first { name.startsWith(it.wire) }
            assertEquals(name, expected, n.intent)
            when (n.intent) {
                Intent.INFORM -> assertNotNull(name, n.inform)
                Intent.ASK -> assertNotNull(name, n.ask)
                Intent.PROGRESS -> assertNotNull(name, n.progress)
            }
        }
    }

    @Test
    fun `decodes an inform with links, rows, image, icon and cooldown`() {
        val n = Fixtures.notification("inform-full")
        assertEquals("ntf_01JBXA0000000000000000INF2", n.id)
        assertEquals("alertmanager", n.source)
        assertEquals("disk-full-db1", n.key)
        assertEquals(Severity.CRITICAL, n.severity)
        assertEquals(NotificationStatus.ACTIVE, n.status)
        assertEquals("https://grafana.example.com/d/disk", n.url)
        assertEquals(3, n.version)
        assertEquals(listOf("dev_01JBXA00000000000000000PX9"), n.targetDeviceIds)
        val inform = n.inform!!
        assertEquals(LinkButton("Runbook", "https://wiki.example.com/runbooks/disk"), inform.links[1])
        assertEquals(listOf("Host" to "db-1", "Used" to "95%"), inform.fields.map { it.label to it.value })
        assertEquals("https://grafana.example.com/render/disk.png", inform.image)
        assertEquals("💾", inform.icon)
        assertEquals("1h", inform.cooldown)
        assertNull(n.ask)
    }

    @Test
    fun `decodes an open ask and an answered one`() {
        val open = Fixtures.notification("ask-open").ask!!
        assertEquals(listOf("Approve", "Reject", "Wait"), open.options)
        assertTrue(open.allowText)
        assertEquals("Reply…", open.replyPlaceholder)
        assertEquals("2026-10-30T10:00:00.000Z", open.expiresAt)
        assertNull(open.answer)
        assertEquals(AskState.OPEN, open.state)

        val answered = Fixtures.notification("ask-answered-option")
        assertEquals(AskState.ANSWERED, answered.ask!!.state)
        assertEquals("Approve", answered.ask!!.answer!!.option)
        assertNull(answered.ask!!.answer!!.text)
        assertEquals("Pixel 9", answered.ask!!.answer!!.deviceName)
        assertTrue(answered.shouldDismissSystemNotification)

        val text = Fixtures.notification("ask-answered-text").ask!!.answer!!
        assertNull(text.option)
        assertEquals("release/1.4", text.text)

        assertEquals(AskState.EXPIRED, Fixtures.notification("ask-expired").ask!!.state)
        assertEquals(AskState.WITHDRAWN, Fixtures.notification("ask-withdrawn").ask!!.state)
    }

    @Test
    fun `decodes progress in every state`() {
        val running = Fixtures.notification("progress-running").progress!!
        assertEquals(3.0, running.value, 0.0)
        assertEquals(7.0, running.max, 0.0)
        assertEquals("3/7 checks", running.label)
        assertEquals(ProgressState.RUNNING, running.state)
        assertEquals("30m", running.staleAfter)
        assertEquals("2026-10-30T09:03:00.000Z", running.lastReportAt)
        assertNull(Fixtures.notification("progress-running-percent").progress!!.label)
        assertEquals(ProgressState.DONE, Fixtures.notification("progress-done").progress!!.state)
        assertEquals(ProgressState.FAILED, Fixtures.notification("progress-failed").progress!!.state)
        assertEquals(ProgressState.STOPPED, Fixtures.notification("progress-stopped").progress!!.state)
    }

    @Test
    fun `ignores unknown fields and falls back on unknown enum values`() {
        val json = """
            {"id":"ntf_x","intent":"poll","source":"s","title":"t","severity":"debug","status":"archived",
             "futureField":{"nested":[1,2,3]},"ask":{"options":["A"],"state":"pondering","expiresAt":"x","extra":true},
             "progress":{"value":5,"state":"paused","newProp":"x"},"version":2,"createdAt":"2026-10-28T10:00:00.000Z",
             "updatedAt":"2026-10-28T10:00:00.000Z"}
        """.trimIndent()
        val n = OyeeJson.decodeFromString(Notification.serializer(), json)
        assertEquals(Intent.INFORM, n.intent)
        assertEquals(Severity.INFO, n.severity) // `debug` is gone: it reads as info
        assertEquals(NotificationStatus.ACTIVE, n.status)
        assertEquals(AskState.OPEN, n.ask!!.state)
        val p: ProgressBlock = n.progress!!
        assertEquals(100.0, p.max, 0.0) // max default 100
        assertEquals(ProgressState.RUNNING, p.state)
        assertEquals("30m", p.staleAfter) // the schema's default (LIMITS.defaultStaleAfter), as in Swift
        assertNull(n.body)
        assertNull(n.key)
    }

    @Test
    fun `a notification from before intents still shows title and body`() {
        val n = OyeeJson.decodeFromString(
            Notification.serializer(),
            """{"id":"ntf_old","source":"s","title":"Hello","body":"World","actions":[{"id":"a","label":"A"}],"tags":["x"]}""",
        )
        assertEquals(Intent.INFORM, n.intent)
        assertEquals("Hello", n.title)
        assertEquals("World", n.body)
        assertNull(n.inform)
    }

    @Test
    fun `explicit nulls on nullable fields decode as null`() {
        val json = """{"id":"ntf_x","title":"t","body":null,"key":null,"progress":null,"readAt":"2026-10-28T10:00:00.000Z","status":"resolved"}"""
        val n = OyeeJson.decodeFromString(Notification.serializer(), json)
        assertNull(n.body)
        assertNull(n.progress)
        assertTrue(n.isRead)
        assertTrue(n.isResolved)
        assertTrue(n.shouldDismissSystemNotification)
    }

    @Test
    fun `a notification survives a round trip through the tray extras`() {
        for (name in Fixtures.names) {
            val n = Fixtures.notification(name)
            assertEquals(name, n, OyeeJson.decodeFromString(Notification.serializer(), OyeeJson.encodeToString(Notification.serializer(), n)))
        }
    }

    @Test
    fun `parses a page and a pair result`() {
        val page = OyeeJson.decodeFromString(
            Page.serializer(Notification.serializer()),
            """{"items":[${Fixtures.json("ask-open")}],"nextCursor":null}""",
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
        val n = Fixtures.json("progress-running")
        assertTrue(ServerMessage.parse("""{"type":"hello","userId":"usr_1","deviceId":null,"serverTime":"x"}""") is ServerMessage.Hello)
        val created = ServerMessage.parse("""{"type":"notification.created","notification":$n}""")
        assertEquals("ntf_01JBXA0000000000000000PRG1", (created as ServerMessage.Created).notification.id)
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
        assertFalse(ClientMessages.ping().contains("since"))
    }
}
