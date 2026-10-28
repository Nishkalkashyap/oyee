package dev.herald.android.util

/** Stable Android notification ids derived from Herald ids. The tag is always the Herald id itself. */
object NotificationIds {
    /** Reserved ids used by the app itself (untagged). */
    const val FOREGROUND_SERVICE = 1

    /** FNV-1a 32-bit hash: stable across processes, devices and app versions (unlike relying on JVM internals). */
    fun fnv1a(s: String): Int {
        var h = 0x811C9DC5.toInt()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            h = h xor (b.toInt() and 0xFF)
            h *= 0x01000193
        }
        return h
    }

    /** Positive, never equal to a reserved id. */
    fun forNotification(heraldId: String): Int {
        val v = fnv1a(heraldId) and 0x7FFFFFFF
        return if (v <= 16) v + 17 else v
    }

    fun groupKey(source: String): String = "herald.group.$source"

    fun summaryTag(source: String): String = "summary:$source"

    fun forSummary(source: String): Int = forNotification("summary:$source")
}
