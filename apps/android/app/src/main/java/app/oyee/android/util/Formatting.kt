package app.oyee.android.util

import app.oyee.android.model.Field
import app.oyee.android.model.ProgressBlock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.roundToLong

object Formatting {
    /** Formats a JSON number the way JavaScript's String(n) does for typical values: 3.0 → "3", 2.5 → "2.5". */
    fun number(n: Double): String =
        if (n.isFinite() && n == Math.floor(n) && kotlin.math.abs(n) < 1e15) n.toLong().toString() else n.toString()

    /**
     * Port of `progressText` from @oyee/schema: "▓▓▓░░░░░░░ 3/7", "▓▓▓▓▓░░░░░ 50%" or "▓▓▓▓░░░░░░ 3/7 checks".
     */
    fun progressText(p: ProgressBlock): String {
        val max = p.max
        val ratio = if (max > 0) (p.value / max).coerceIn(0.0, 1.0) else 0.0
        val filled = Math.round(ratio * 10).toInt()
        val bar = "▓".repeat(filled) + "░".repeat(10 - filled)
        return "$bar ${progressLabel(p)}"
    }

    /**
     * Port of `formatDuration` from @oyee/schema. Elapsed (default): the largest whole unit, rounded down: "45s", "12m",
     * "3h", "2d". Span: to the nearest second under a minute, else the nearest minute: "40s", "48m", "1h", "2h 30m".
     */
    fun duration(ms: Long, span: Boolean = false): String {
        if (span) {
            val s = maxOf(0L, Math.round(ms / 1000.0))
            if (s < 60) return "${s}s"
            val m = Math.round(ms / 60_000.0)
            if (m < 60) return "${m}m"
            return if (m % 60 == 0L) "${m / 60}h" else "${m / 60}h ${m % 60}m"
        }
        val s = maxOf(0L, Math.floorDiv(ms, 1000L))
        return when {
            s < 60 -> "${s}s"
            s < 3600 -> "${s / 60}m"
            s < 86_400 -> "${s / 3600}h"
            else -> "${s / 86_400}d"
        }
    }

    /** Port of `progressAmount` from @oyee/schema: the sender's label, else "42%" (max 100) or "3/7". */
    fun progressLabel(p: ProgressBlock): String {
        p.label?.let { return it }
        val ratio = if (p.max > 0) (p.value / p.max).coerceIn(0.0, 1.0) else 0.0
        return if (p.max == 100.0) "${Math.round(ratio * 100)}%" else "${number(p.value)}/${number(p.max)}"
    }

    /** Native progress values as ints for Notification APIs (scaled to keep precision for fractional max). */
    fun progressInts(p: ProgressBlock): Pair<Int, Int> {
        if (p.max <= 0) return 0 to 0
        val scale = if (p.max < 100 && p.max != Math.floor(p.max)) 100.0 else 1.0
        val max = (p.max * scale).roundToLong().coerceIn(1, Int.MAX_VALUE.toLong()).toInt()
        val value = (p.value * scale).roundToLong().coerceIn(0, max.toLong()).toInt()
        return value to max
    }

    /** `Label: value` lines appended to the expanded text (protocol §9). */
    fun fieldLines(fields: List<Field>): List<String> = fields.map { "${it.label}: ${it.value}" }

    fun parseInstant(iso: String?): Instant? = try {
        if (iso.isNullOrBlank()) null else Instant.parse(iso)
    } catch (_: Exception) {
        null
    }

    fun epochMillis(iso: String?): Long? = parseInstant(iso)?.toEpochMilli()

    /** "now", "5m", "3h", "2d", then a short date. */
    fun relative(iso: String?, now: Instant = Instant.now()): String {
        val t = parseInstant(iso) ?: return ""
        val d = Duration.between(t, now)
        return when {
            d.seconds < 60 -> "now"
            d.toMinutes() < 60 -> "${d.toMinutes()}m"
            d.toHours() < 24 -> "${d.toHours()}h"
            d.toDays() < 7 -> "${d.toDays()}d"
            else -> DateTimeFormatter.ofLocalizedDate(FormatStyle.SHORT).withZone(ZoneId.systemDefault()).format(t)
        }
    }

    fun absolute(iso: String?): String {
        val t = parseInstant(iso) ?: return ""
        return DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withZone(ZoneId.systemDefault()).format(t)
    }

    /** Emoji (or short text) icon vs. URL icon. */
    fun isUrlIcon(icon: String?): Boolean = icon != null && (icon.startsWith("https://") || icon.startsWith("http://"))
}
