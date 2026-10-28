package app.oyee.android.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** WebSocket server → client messages (protocol §6). */
@Serializable
@JsonClassDiscriminator("type")
sealed interface ServerMessage {
    @Serializable
    @SerialName("hello")
    data class Hello(val userId: String = "", val deviceId: String? = null, val serverTime: String = "") : ServerMessage

    @Serializable
    @SerialName("notification.created")
    data class Created(val notification: Notification) : ServerMessage

    @Serializable
    @SerialName("notification.updated")
    data class Updated(
        val notification: Notification,
        val alert: Boolean = false,
        val reason: String = "update",
    ) : ServerMessage

    @Serializable
    @SerialName("notification.deleted")
    data class Deleted(val id: String) : ServerMessage

    @Serializable
    @SerialName("sync.result")
    data class SyncResult(
        val notifications: List<Notification> = emptyList(),
        val deletedIds: List<String> = emptyList(),
        val cursor: String? = null,
        val hasMore: Boolean = false,
    ) : ServerMessage

    @Serializable
    @SerialName("pong")
    data object Pong : ServerMessage

    companion object {
        /** Returns null for malformed frames and unknown message types (forward compatibility). */
        fun parse(text: String): ServerMessage? = try {
            OyeeJson.decodeFromString(serializer(), text)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}

/** WebSocket client → server messages. */
object ClientMessages {
    fun ping(): String = """{"type":"ping"}"""

    fun sync(since: String?): String = buildJsonObject {
        put("type", "sync")
        put("since", since)
    }.toString()
}

/** Transport-independent event fed into [app.oyee.android.data.EventProcessor]. */
sealed interface OyeeEvent {
    data class Upsert(val notification: Notification, val alert: Boolean, val isNew: Boolean) : OyeeEvent
    data class Removed(val id: String) : OyeeEvent
}

/**
 * FCM data message (protocol §7). All values are strings. `notification` is omitted when the encoded message would
 * exceed 3.5 KB; the client must then GET /api/notifications/:id.
 */
data class FcmMessage(
    val type: String,
    val id: String,
    val version: Int,
    val alert: Boolean,
    /** Parsed inline notification, or null if absent / unparseable (→ fetch by id). */
    val notification: Notification?,
) {
    val isCreated get() = type == TYPE_CREATED
    val isUpdated get() = type == TYPE_UPDATED
    val isDeleted get() = type == TYPE_DELETED

    companion object {
        const val TYPE_CREATED = "notification.created"
        const val TYPE_UPDATED = "notification.updated"
        const val TYPE_DELETED = "notification.deleted"

        /** Returns null if the map isn't a Oyee message (unknown type or missing id). */
        fun parse(data: Map<String, String>): FcmMessage? {
            val type = data["type"] ?: return null
            if (type != TYPE_CREATED && type != TYPE_UPDATED && type != TYPE_DELETED) return null
            val inline = data["notification"]?.takeIf { it.isNotBlank() }?.let { raw ->
                try {
                    OyeeJson.decodeFromString(Notification.serializer(), raw)
                } catch (_: SerializationException) {
                    null
                } catch (_: IllegalArgumentException) {
                    null
                }
            }
            val id = data["id"]?.takeIf { it.isNotBlank() } ?: inline?.id ?: return null
            return FcmMessage(
                type = type,
                id = id,
                version = data["version"]?.toIntOrNull() ?: inline?.version ?: 0,
                alert = data["alert"].equals("true", ignoreCase = true),
                notification = inline?.takeIf { it.id == id },
            )
        }
    }
}
