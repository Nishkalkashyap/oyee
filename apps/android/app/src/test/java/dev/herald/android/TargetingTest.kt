package dev.herald.android

import dev.herald.android.model.HeraldJson
import dev.herald.android.model.Notification
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TargetingTest {
    private fun parse(json: String) = HeraldJson.decodeFromString(Notification.serializer(), json)

    @Test
    fun `untargeted and older notifications alert everywhere`() {
        val n = parse("""{"id":"ntf_1","title":"t"}""")
        assertNull(n.targetDeviceIds)
        assertTrue(n.isTargetedAt("dev_phone"))
    }

    @Test
    fun `targeted notifications alert only their devices`() {
        val n = parse("""{"id":"ntf_1","title":"t","targetDeviceIds":["dev_mac"]}""")
        assertTrue(n.isTargetedAt("dev_mac"))
        assertFalse(n.isTargetedAt("dev_phone"))
    }
}
