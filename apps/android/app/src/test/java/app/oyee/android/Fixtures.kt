package app.oyee.android

import app.oyee.android.model.Notification
import app.oyee.android.model.OyeeJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * The protocol v2 example notifications shared by every client (packages/schema/fixtures/notifications.v2.json, put on
 * the test classpath by build.gradle.kts): every intent in every state, keyed by name ("ask-open", "progress-stopped"…).
 */
object Fixtures {
    private val all: JsonObject by lazy {
        val url = requireNotNull(javaClass.classLoader!!.getResource("notifications.v2.json")) { "shared fixtures missing" }
        Json.parseToJsonElement(url.readText()).jsonObject
    }

    val names: Set<String> get() = all.keys

    /** One fixture as compact JSON, as it arrives on the wire. */
    fun json(name: String): String = requireNotNull(all[name]) { "no fixture $name" }.toString()

    fun notification(name: String): Notification = OyeeJson.decodeFromString(Notification.serializer(), json(name))
}
