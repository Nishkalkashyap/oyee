package app.oyee.android.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Kotlin mirror of packages/schema/src/index.ts (Oyee protocol v1).
 * JSON names are camelCase (identical to the property names). Unknown keys are ignored and unknown enum values
 * fall back to the property default (see OyeeJson), so newer servers don't break older clients.
 */

@Serializable
enum class Severity(val wire: String) {
    @SerialName("debug") DEBUG("debug"),
    @SerialName("info") INFO("info"),
    @SerialName("success") SUCCESS("success"),
    @SerialName("warning") WARNING("warning"),
    @SerialName("critical") CRITICAL("critical");

    /** Android notification channel id (ANDROID_CHANNELS in the schema). */
    val channelId: String get() = "oyee.$wire"

    companion object {
        fun fromWire(value: String?): Severity? = entries.firstOrNull { it.wire == value }
    }
}

@Serializable
enum class NotificationStatus(val wire: String) {
    @SerialName("active") ACTIVE("active"),
    @SerialName("resolved") RESOLVED("resolved"),
}

@Serializable
enum class ActionStyle {
    @SerialName("default") DEFAULT,
    @SerialName("primary") PRIMARY,
    @SerialName("destructive") DESTRUCTIVE,
}

@Serializable
data class Field(
    val label: String,
    val value: String = "",
)

@Serializable
data class Progress(
    val value: Double = 0.0,
    val max: Double = 100.0,
    val label: String? = null,
    val indeterminate: Boolean = false,
)

@Serializable
data class ActionCallback(
    val url: String,
    val headers: Map<String, String>? = null,
)

@Serializable
data class Action(
    val id: String,
    val label: String,
    val style: ActionStyle = ActionStyle.DEFAULT,
    val url: String? = null,
    val callback: ActionCallback? = null,
    val resolves: Boolean = false,
)

@Serializable
data class Reply(
    val placeholder: String? = null,
    val buttonLabel: String? = null,
)

@Serializable
data class Response(
    val actionId: String? = null,
    val text: String? = null,
    val deviceId: String? = null,
    val deviceName: String? = null,
    val at: String,
)

@Serializable
data class Notification(
    val id: String,
    val source: String = "",
    val threadId: String? = null,
    val title: String = "",
    val body: String? = null,
    val severity: Severity = Severity.INFO,
    val status: NotificationStatus = NotificationStatus.ACTIVE,
    val icon: String? = null,
    val image: String? = null,
    val url: String? = null,
    val fields: List<Field> = emptyList(),
    val progress: Progress? = null,
    val actions: List<Action> = emptyList(),
    val reply: Reply? = null,
    val tags: List<String> = emptyList(),
    val silent: Boolean = false,
    val template: String? = null,
    val version: Int = 1,
    val createdAt: String = "",
    val updatedAt: String = "",
    val readAt: String? = null,
    val resolvedAt: String? = null,
    val responses: List<Response> = emptyList(),
    /** Devices that should alert for this item; `null` = every device (protocol: targeted delivery). */
    val targetDeviceIds: List<String>? = null,
) {
    /** Whether this device should show a system notification. Every device still lists it in the inbox. */
    fun isTargetedAt(deviceId: String?): Boolean = targetDeviceIds == null || deviceId == null || deviceId in targetDeviceIds

    val isRead: Boolean get() = readAt != null
    val isResolved: Boolean get() = status == NotificationStatus.RESOLVED

    /** Read elsewhere or resolved → the system notification must be cancelled (protocol §6). */
    val shouldDismissSystemNotification: Boolean get() = isRead || isResolved
}

@Serializable
data class User(
    val id: String,
    val email: String = "",
    val name: String? = null,
    val avatarUrl: String? = null,
)

/** `platform` and `transports` are kept as strings so unknown future values don't fail decoding. */
@Serializable
data class Device(
    val id: String,
    val name: String = "",
    val platform: String = "android",
    val transports: List<String> = emptyList(),
    val createdAt: String = "",
    val lastSeenAt: String? = null,
)

@Serializable
data class PairInput(
    val code: String,
    val name: String,
    // No default: OyeeJson has encodeDefaults = false, so a defaulted value would be omitted from the request.
    val platform: String,
)

@Serializable
data class PairResult(
    val device: Device,
    val token: String,
    val user: User,
)

@Serializable
data class Page<T>(
    val items: List<T> = emptyList(),
    val nextCursor: String? = null,
)

@Serializable
data class SourceSummary(
    val source: String,
    val count: Int = 0,
    val unread: Int = 0,
    val lastAt: String = "",
)

@Serializable
data class SourceList(val items: List<SourceSummary> = emptyList())

@Serializable
data class ServerConfig(
    val version: String = "",
    val vapidPublicKey: String? = null,
    val fcmEnabled: Boolean = false,
    val devLogin: Boolean = false,
)

@Serializable
data class ApiErrorBody(val error: ApiErrorDetail)

@Serializable
data class ApiErrorDetail(val code: String = "internal", val message: String = "")

@Serializable
data class ReadAllResult(val updated: Int = 0)
