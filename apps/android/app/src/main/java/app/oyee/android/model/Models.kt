package app.oyee.android.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * Kotlin mirror of packages/schema/src/index.ts (Oyee protocol v2: notifications are intents, docs/protocol.md §1).
 * JSON names are camelCase (identical to the property names). Unknown keys are ignored and unknown enum values
 * fall back to the property default (see OyeeJson), so newer servers don't break older clients. The v1 flat card
 * fields the server still sends alongside the intent blocks (actions, reply, tags, threadId, silent…) aren't read.
 */

/** Every severity alerts (`debug` is gone: an old `debug` value decodes as the default, info). */
@Serializable
enum class Severity(val wire: String) {
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

/** What the sender means (GLOSSARY.md): something to know, a question, or long-running work. */
@Serializable
enum class Intent(val wire: String) {
    @SerialName("inform") INFORM("inform"),
    @SerialName("ask") ASK("ask"),
    @SerialName("progress") PROGRESS("progress"),
}

/** `open` until the first answer (`answered`), its expiry (`expired`) or the sender withdrawing it (`withdrawn`). */
@Serializable
enum class AskState {
    @SerialName("open") OPEN,
    @SerialName("answered") ANSWERED,
    @SerialName("expired") EXPIRED,
    @SerialName("withdrawn") WITHDRAWN,
}

/** `stopped` = Stopped reporting: the sender went quiet for longer than `staleAfter`; a later report revives it. */
@Serializable
enum class ProgressState {
    @SerialName("running") RUNNING,
    @SerialName("done") DONE,
    @SerialName("failed") FAILED,
    @SerialName("stopped") STOPPED,
}

@Serializable
data class Field(
    val label: String,
    val value: String = "",
)

/** A button that opens a URL on the device; nothing is sent back. */
@Serializable
data class LinkButton(
    val label: String,
    val url: String,
)

@Serializable
data class InformBlock(
    val links: List<LinkButton> = emptyList(),
    val fields: List<Field> = emptyList(),
    val image: String? = null,
    /** Emoji or https URL. */
    val icon: String? = null,
    /** Minimum time between two alerts for this notification's key, e.g. "1h". */
    val cooldown: String? = null,
)

@Serializable
data class AskAnswer(
    /** Label of the answer button chosen, or null for a text answer. */
    val option: String? = null,
    val text: String? = null,
    val deviceId: String? = null,
    val deviceName: String? = null,
    val at: String = "",
)

@Serializable
data class AskBlock(
    /** Answer-button labels (at most 3). */
    val options: List<String> = emptyList(),
    /** Whether a free-text answer is accepted. */
    val allowText: Boolean = false,
    val replyPlaceholder: String? = null,
    val expiresAt: String = "",
    /** The first answer, from any device. */
    val answer: AskAnswer? = null,
    val state: AskState = AskState.OPEN,
)

/**
 * The progress block. On the wire `progress` is both this block and (until the flat card is removed) the v1 bar,
 * which is where `indeterminate` comes from.
 */
@Serializable
data class Progress(
    val value: Double = 0.0,
    val max: Double = 100.0,
    val label: String? = null,
    val indeterminate: Boolean = false,
    val state: ProgressState = ProgressState.RUNNING,
    /** How long the progress may go quiet before it counts as stopped, e.g. "30m". */
    val staleAfter: String? = null,
    val lastReportAt: String? = null,
)

@Serializable
data class Notification(
    val id: String,
    val intent: Intent = Intent.INFORM,
    val source: String = "",
    /** Names the notification per source so later sends refer to the same one. */
    val key: String? = null,
    val title: String = "",
    val body: String? = null,
    val severity: Severity = Severity.INFO,
    val status: NotificationStatus = NotificationStatus.ACTIVE,
    /** Opens when the notification is tapped. */
    val url: String? = null,
    val version: Int = 1,
    val createdAt: String = "",
    val updatedAt: String = "",
    val readAt: String? = null,
    val resolvedAt: String? = null,
    /** Devices that should alert for this item; `null` = every device (protocol: targeted delivery). */
    val targetDeviceIds: List<String>? = null,
    // Exactly one block, named after the intent.
    val inform: InformBlock? = null,
    val ask: AskBlock? = null,
    val progress: Progress? = null,
) {
    /** Whether this device should show a system notification. Every device still lists it in the inbox. */
    fun isTargetedAt(deviceId: String?): Boolean = targetDeviceIds == null || deviceId == null || deviceId in targetDeviceIds

    val isRead: Boolean get() = readAt != null
    val isResolved: Boolean get() = status == NotificationStatus.RESOLVED

    /** Read elsewhere or resolved (which includes answered, expired and withdrawn asks) → cancel the system notification. */
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
