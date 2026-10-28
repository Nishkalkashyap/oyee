package dev.herald.android

import dev.herald.android.model.HeraldJson
import dev.herald.android.model.PairInput
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class PairInputTest {
    @Test
    fun `pair request always includes platform`() {
        val json = HeraldJson.parseToJsonElement(
            HeraldJson.encodeToString(PairInput.serializer(), PairInput("QVAUAGYD", "SM-S918B", "android")),
        ).jsonObject
        assertEquals("android", json["platform"]?.jsonPrimitive?.content)
        assertEquals("QVAUAGYD", json["code"]?.jsonPrimitive?.content)
        assertEquals("SM-S918B", json["name"]?.jsonPrimitive?.content)
    }
}
