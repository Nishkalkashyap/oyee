package app.oyee.android

import app.oyee.android.model.OyeeJson
import app.oyee.android.model.PairInput
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class PairInputTest {
    @Test
    fun `pair request always includes platform`() {
        val json = OyeeJson.parseToJsonElement(
            OyeeJson.encodeToString(PairInput.serializer(), PairInput("QVAUAGYD", "SM-S918B", "android")),
        ).jsonObject
        assertEquals("android", json["platform"]?.jsonPrimitive?.content)
        assertEquals("QVAUAGYD", json["code"]?.jsonPrimitive?.content)
        assertEquals("SM-S918B", json["name"]?.jsonPrimitive?.content)
    }
}
