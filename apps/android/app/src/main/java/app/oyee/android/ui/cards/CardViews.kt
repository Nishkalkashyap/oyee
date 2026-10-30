package app.oyee.android.ui.cards

import app.oyee.android.model.AskState
import app.oyee.android.model.Field
import app.oyee.android.model.InformBlock
import app.oyee.android.model.LinkButton
import app.oyee.android.model.Notification
import app.oyee.android.model.Progress
import app.oyee.android.model.ProgressState
import app.oyee.android.model.Severity
import app.oyee.android.util.Formatting
import java.net.URI
import java.time.Instant

/*
 * What each intent's card shows, derived from the intent-shaped notification. Pure, so the labels are unit-tested on
 * the shared v2 fixtures; the wording matches the web (apps/web/src/lib/ask.ts, progress.ts, inform.ts).
 */

// ─── Ask ────────────────────────────────────────────────────────────────────

data class AskOption(val label: String, val chosen: Boolean)

data class AskView(
    /** The ask's state; an open ask past its expiry already counts as expired (the server's broadcast follows). */
    val state: AskState,
    /** Answer buttons and the reply box only work while the ask is open. */
    val open: Boolean,
    /** Answer buttons; the one that was picked is `chosen`. */
    val options: List<AskOption>,
    /** The reply box's placeholder, while the ask is open and takes text. */
    val replyPlaceholder: String?,
    /** "Waiting 12m", "Answered: Approve · Pixel 9", "Expired" or "Withdrawn". */
    val status: String,
    /** "Expires in 48m" while the ask is open. */
    val expiry: String?,
    /** Why an expired or withdrawn ask can't be answered. */
    val note: String?,
)

/** "12m", "2h", "3d": how long the ask has been waiting. */
private fun waited(ms: Long): String {
    val m = ms / 60_000
    if (m < 60) return "${m}m"
    val h = m / 60
    return if (h < 24) "${h}h" else "${h / 24}d"
}

/** "48m", "1h", "2h 30m", to the nearest minute. */
private fun span(ms: Long): String {
    val m = Math.round(ms / 60_000.0)
    if (m < 60) return "${m}m"
    return if (m % 60 == 0L) "${m / 60}h" else "${m / 60}h ${m % 60}m"
}

private fun millis(iso: String?): Long? = Formatting.epochMillis(iso)

fun askView(n: Notification, now: Instant = Instant.now()): AskView {
    val ask = n.ask ?: app.oyee.android.model.AskBlock()
    val nowMs = now.toEpochMilli()
    val left = millis(ask.expiresAt)?.let { it - nowMs }
    val state = if (ask.state == AskState.OPEN && left != null && left <= 0) AskState.EXPIRED else ask.state
    val open = state == AskState.OPEN
    val answer = ask.answer
    val status = when {
        state == AskState.ANSWERED && answer != null -> {
            val what = listOfNotNull(answer.option, answer.text).filter { it.isNotEmpty() }.joinToString(": ")
            "Answered: $what" + (answer.deviceName?.takeIf { it.isNotEmpty() }?.let { " · $it" } ?: "")
        }
        state == AskState.ANSWERED -> "Answered"
        state == AskState.EXPIRED -> "Expired"
        state == AskState.WITHDRAWN -> "Withdrawn"
        else -> {
            val ms = nowMs - (millis(n.createdAt) ?: nowMs)
            if (ms < 60_000) "Just asked" else "Waiting ${waited(ms)}"
        }
    }
    val note = when (state) {
        AskState.EXPIRED -> {
            val lifetime = (millis(ask.expiresAt) ?: 0) - (millis(n.createdAt) ?: 0)
            "Nobody answered within ${span(lifetime)}, so the question was closed on every device."
        }
        AskState.WITHDRAWN -> "The sender withdrew this question before it was answered."
        else -> null
    }
    return AskView(
        state = state,
        open = open,
        options = ask.options.map { AskOption(it, chosen = answer?.option == it) },
        replyPlaceholder = if (open && ask.allowText) ask.replyPlaceholder?.takeIf { it.isNotEmpty() } ?: "Reply…" else null,
        status = status,
        expiry = when {
            !open || left == null -> null
            left < 30_000 -> "Expires in under a minute"
            else -> "Expires in ${span(left)}"
        },
        note = note,
    )
}

// ─── Progress ───────────────────────────────────────────────────────────────

/** Bar and state pill colour: ink while running (design.md), the outcome's colour once it ended, faint when stopped. */
enum class ProgressTone { INK, SUCCESS, WARNING, MUTED }

data class ProgressView(
    val state: ProgressState,
    /** "Running", "Done", "Failed" or "Stopped reporting after 40%". */
    val stateLabel: String,
    /** The sender's label, else "40%" (max 100) or "3/7". */
    val amount: String,
    /** 0..100. */
    val percent: Double,
    val tone: ProgressTone,
)

/**
 * Port of `stoppedReportingLabel` from @oyee/schema: "Stopped reporting after <last label or rounded percent>", e.g.
 * "Stopped reporting after 3/7 checks" or "Stopped reporting after 40%".
 */
fun stoppedReportingLabel(p: Progress): String {
    val ratio = if (p.max > 0) (p.value / p.max).coerceIn(0.0, 1.0) else 0.0
    return "Stopped reporting after ${p.label ?: "${Math.round(ratio * 100)}%"}"
}

fun progressView(p: Progress): ProgressView {
    val max = if (p.max > 0) p.max else 100.0
    val percent = if (p.value.isFinite()) (p.value / max * 100).coerceIn(0.0, 100.0) else 0.0
    val (label, tone) = when (p.state) {
        ProgressState.RUNNING -> "Running" to ProgressTone.INK
        ProgressState.DONE -> "Done" to ProgressTone.SUCCESS
        ProgressState.FAILED -> "Failed" to ProgressTone.WARNING
        ProgressState.STOPPED -> stoppedReportingLabel(p) to ProgressTone.MUTED
    }
    return ProgressView(p.state, label, Formatting.progressLabel(p), percent, tone)
}

// ─── Inform ─────────────────────────────────────────────────────────────────

sealed interface InformIcon {
    data class Emoji(val text: String) : InformIcon
    data class Image(val url: String) : InformIcon
}

data class InformView(
    val severity: Severity,
    val severityLabel: String,
    val resolved: Boolean,
    /** The sender's emoji or image; null falls back to the severity glyph. */
    val icon: InformIcon?,
    val image: String?,
    val rows: List<Field>,
    /** Link buttons, at most three, only with URLs safe to open. */
    val links: List<LinkButton>,
    /** Host of the URL a tap opens ("grafana.example.com"). */
    val openHost: String?,
)

private fun isHttpUrl(s: String?): Boolean = s != null && (s.startsWith("https://", ignoreCase = true) || s.startsWith("http://", ignoreCase = true))

private fun hostOf(url: String): String = runCatching { URI(url).host }.getOrNull()?.takeIf { it.isNotEmpty() } ?: url

fun severityLabel(s: Severity): String = s.wire.replaceFirstChar { it.uppercase() }

fun informView(n: Notification): InformView {
    val inform = n.inform ?: InformBlock()
    val icon = inform.icon?.trim()?.takeIf { it.isNotEmpty() }
    return InformView(
        severity = n.severity,
        severityLabel = severityLabel(n.severity),
        resolved = n.isResolved,
        icon = when {
            icon == null -> null
            isHttpUrl(icon) -> InformIcon.Image(icon)
            else -> InformIcon.Emoji(icon.codePoints().limit(2).toArray().let { String(it, 0, it.size) })
        },
        image = inform.image?.takeIf { isHttpUrl(it) },
        rows = inform.fields.map { Field(it.label, it.value.ifEmpty { "—" }) },
        links = inform.links.filter { isHttpUrl(it.url) }.take(3),
        openHost = n.url?.takeIf { isHttpUrl(it) }?.let(::hostOf),
    )
}
