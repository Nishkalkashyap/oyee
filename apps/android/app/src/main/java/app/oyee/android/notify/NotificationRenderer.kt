package app.oyee.android.notify

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import android.service.notification.StatusBarNotification
import android.text.SpannableStringBuilder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.oyee.android.R
import app.oyee.android.model.Intent
import app.oyee.android.model.OyeeJson
import app.oyee.android.model.Notification
import app.oyee.android.model.ProgressState
import app.oyee.android.model.Severity
import app.oyee.android.ui.cards.InformIcon
import app.oyee.android.ui.cards.informView
import app.oyee.android.util.Formatting
import app.oyee.android.util.Markdown
import app.oyee.android.util.NotificationIds
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Turns Oyee notifications into rich Android notifications (protocol §9):
 * channel per severity, tag = Oyee id + stable hashed id, in-place updates (`setOnlyAlertOnce` unless alert),
 * BigText / BigPicture / ProgressStyle (API 36+) with setProgress fallback, up to 3 actions incl. RemoteInput reply,
 * grouping by source with a summary, cancellation on read / resolved / deleted.
 */
class NotificationRenderer(private val context: Context, private val images: Images, private val posted: PostedLog) {
    private val compat = NotificationManagerCompat.from(context)
    private val system = context.getSystemService(NotificationManager::class.java)
    private val mutex = Mutex()

    fun canPost(): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return compat.areNotificationsEnabled()
    }

    /** The currently showing system notification for a Oyee id, if any. */
    fun shown(oyeeId: String): StatusBarNotification? = try {
        val id = NotificationIds.forNotification(oyeeId)
        system.activeNotifications.firstOrNull { it.tag == oyeeId && it.id == id }
    } catch (e: Exception) {
        null
    }

    fun isShowing(oyeeId: String): Boolean = shown(oyeeId) != null

    /** The Oyee notification as last rendered (kept in the notification extras), for re-rendering offline. */
    fun lastRendered(oyeeId: String): Notification? =
        shown(oyeeId)?.notification?.extras?.getString(EXTRA_JSON)?.let {
            runCatching { OyeeJson.decodeFromString(Notification.serializer(), it) }.getOrNull()
        }

    /**
     * Applies an event to the system tray.
     * @param alert make sound/vibration (never for a running progress, see [NotificationPlan.alerts]); otherwise silent.
     * @param postIfAbsent post even if nothing is currently showing (true for `created` and alerting updates).
     * @param postIfNeverPosted post if nothing is showing *and* this device has never posted this id (an active,
     *   unread notification whose `created` push was collapsed away).
     * @param note short status line (e.g. "Reply sent") shown above the body; forces a re-post.
     * @param replyHistory text shown as RemoteInput history after an inline reply; forces a re-post.
     * @param force re-post even if the shown version is current (e.g. to clear a RemoteInput spinner).
     */
    suspend fun apply(
        n: Notification,
        alert: Boolean,
        postIfAbsent: Boolean,
        postIfNeverPosted: Boolean = false,
        note: String? = null,
        replyHistory: CharSequence? = null,
        force: Boolean = false,
    ) = mutex.withLock {
        // Read or resolved anywhere (answered, expired and withdrawn asks are resolved), or an ask past its expiry.
        if (NotificationPlan.dismiss(n)) {
            cancelLocked(n.id)
            return@withLock
        }
        val current = shown(n.id)
        if (current == null && !postIfAbsent && !(postIfNeverPosted && !posted.wasPosted(n.id))) return@withLock
        val forced = force || note != null || replyHistory != null
        if (current != null && !forced && current.notification.extras.getInt(EXTRA_VERSION, 0) >= n.version) return@withLock
        try {
            postLocked(n, alert = NotificationPlan.alerts(n, alert), note = note, replyHistory = replyHistory)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to post notification ${n.id}", e)
        }
    }

    suspend fun cancel(oyeeId: String) = mutex.withLock { cancelLocked(oyeeId) }

    suspend fun cancelAll() = mutex.withLock {
        posted.clear()
        system.activeNotifications.filter { it.id != NotificationIds.FOREGROUND_SERVICE || it.tag != null }
            .forEach { compat.cancel(it.tag, it.id) }
    }

    private fun cancelLocked(oyeeId: String) {
        val sbn = shown(oyeeId)
        compat.cancel(oyeeId, NotificationIds.forNotification(oyeeId))
        val source = sbn?.notification?.extras?.getString(EXTRA_SOURCE)
        if (source != null) updateSummaryLocked(source, added = null, removedTag = oyeeId)
    }

    // Permission is checked by canPost() at the top (POST_NOTIFICATIONS on 33+ and app-level enablement).
    @SuppressLint("MissingPermission")
    private suspend fun postLocked(n: Notification, alert: Boolean, note: String?, replyHistory: CharSequence?) {
        if (!canPost()) {
            Log.i(TAG, "Notifications not permitted; skipping ${n.id}")
            return
        }
        // The shade tints Oyee's icon, progress and buttons with the brand blue (severity shows in the app).
        val color = context.getColor(R.color.brand)
        val body = n.body?.takeIf { it.isNotBlank() }
        // Each intent draws from its own block: an inform's rows, image and icon; a progress's bar or outcome.
        val inform = if (n.intent == Intent.INFORM) informView(n) else null
        val progress = n.progress?.takeIf { n.intent == Intent.PROGRESS }
        val running = progress?.state == ProgressState.RUNNING
        val fieldLines = inform?.rows.orEmpty()
        // While running: native Notification.ProgressStyle (via NotificationCompat.ProgressStyle) on API 36+,
        // setProgress below that. Once done, failed or stopped the outcome is a line of text ("Done · 7/7 checks").
        val styledProgress = progress?.takeIf { running && Build.VERSION.SDK_INT >= 36 }
        val progressSummary = progress?.let { if (running) Formatting.progressLabel(it) else NotificationPlan.progressLine(it) }

        // Collapsed one-liner.
        val collapsed: CharSequence? = listOfNotNull(
            note,
            progressSummary,
            body?.let { firstLine(Markdown.toPlainText(it)) }
                ?: fieldLines.firstOrNull()?.let { "${it.label}: ${it.value}" },
        ).joinToString(" · ").ifBlank { null }

        // Expanded text: note, markdown body, `Label: value` lines, progress label or outcome.
        val big = SpannableStringBuilder()
        note?.let { big.append(Spans.bold(it)) }
        body?.let { if (big.isNotEmpty()) big.append("\n"); big.append(Spans.fromMarkdown(it)) }
        if (fieldLines.isNotEmpty()) {
            if (big.isNotEmpty()) big.append("\n")
            fieldLines.forEachIndexed { i, f ->
                if (i > 0) big.append("\n")
                big.append(Spans.bold("${f.label}: ")).append(f.value)
            }
        }
        if (progressSummary != null && styledProgress == null) {
            if (big.isNotEmpty()) big.append("\n")
            big.append(if (running) progressSummary else Spans.bold(progressSummary))
        }

        val b = NotificationCompat.Builder(context, n.severity.channelId)
            .setSmallIcon(R.drawable.ic_stat_oyee)
            .setColor(color)
            .setContentTitle(n.title)
            .setContentText(collapsed)
            .setSubText(n.source.ifBlank { null })
            .setWhen(Formatting.epochMillis(n.createdAt) ?: System.currentTimeMillis())
            .setShowWhen(true)
            .setGroup(NotificationIds.groupKey(n.source))
            .setOnlyAlertOnce(!alert)
            .setAutoCancel(true)
            .setPriority(priority(n.severity))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setTicker(n.title)
            .setContentIntent(Intents.open(context, n))
            .setDeleteIntent(Intents.dismissed(context, n))
            .addExtras(
                Bundle().apply {
                    putString(EXTRA_ID, n.id)
                    putInt(EXTRA_VERSION, n.version)
                    putString(EXTRA_SOURCE, n.source)
                    putString(EXTRA_SEVERITY, n.severity.wire)
                    putString(EXTRA_JSON, OyeeJson.encodeToString(Notification.serializer(), n))
                },
            )
        category(n)?.let { b.setCategory(it) }
        // Non-alerting posts (updates, a running progress): no sound/vibration regardless of channel settings.
        if (!alert) b.setSilent(true)
        // An ask leaves the tray by itself when it expires, even if the server's broadcast never reaches this device.
        if (n.intent == Intent.ASK) {
            Formatting.epochMillis(n.ask?.expiresAt)?.let { at -> (at - System.currentTimeMillis()).takeIf { it > 0 }?.let(b::setTimeoutAfter) }
        }

        // Large icon: an inform's emoji rendered to a bitmap, or its downloaded https icon.
        val largeIcon: Bitmap? = when (val icon = inform?.icon) {
            null -> null
            is InformIcon.Image -> images.download(icon.url, 256)
            is InformIcon.Emoji -> images.emojiBitmap(icon.text)
        }
        largeIcon?.let { b.setLargeIcon(it) }

        val picture = inform?.image?.let { images.download(it, 1440) }
        when {
            picture != null -> {
                val style = NotificationCompat.BigPictureStyle()
                    .bigPicture(picture)
                    .setBigContentTitle(n.title)
                if (big.isNotEmpty()) style.setSummaryText(big)
                if (largeIcon == null) b.setLargeIcon(picture)
                style.bigLargeIcon(null as Bitmap?)
                b.setStyle(style)
            }
            styledProgress != null -> {
                val (value, max) = Formatting.progressInts(styledProgress)
                b.setStyle(
                    NotificationCompat.ProgressStyle()
                        .setProgressSegments(listOf(NotificationCompat.ProgressStyle.Segment(max.coerceAtLeast(1)).setColor(color)))
                        .setProgress(value)
                        .setStyledByProgress(true),
                )
            }
            big.isNotEmpty() -> b.setStyle(NotificationCompat.BigTextStyle().bigText(big).setBigContentTitle(n.title))
        }
        if (progress != null && running && styledProgress == null) {
            val (value, max) = Formatting.progressInts(progress)
            b.setProgress(max, value, false)
        }

        // Up to 3 buttons (Android's limit), per intent: answers + inline reply, links + Resolve, or Resolve.
        NotificationPlan.buttons(n).forEachIndexed { i, button ->
            b.addAction(
                when (button) {
                    is NotificationPlan.Button.Answer -> Intents.answerAction(context, n, i, button.option)
                    is NotificationPlan.Button.Reply -> Intents.replyAction(context, n, button.placeholder)
                    is NotificationPlan.Button.Link -> Intents.linkAction(context, n, i, button.label, button.url)
                    NotificationPlan.Button.Resolve -> Intents.resolveAction(context, n)
                },
            )
        }
        if (replyHistory != null) {
            @Suppress("DEPRECATION")
            b.setRemoteInputHistory(arrayOf(replyHistory))
        }

        compat.notify(n.id, NotificationIds.forNotification(n.id), b.build())
        posted.markPosted(n.id)
        updateSummaryLocked(n.source, added = SummaryChild(n.id, n.title, n.severity), removedTag = null)
    }

    private data class SummaryChild(val tag: String, val title: String, val severity: Severity)

    /**
     * Posts/updates/cancels the per-source group summary. [added]/[removedTag] compensate for the system's
     * active-notification list lagging right after notify()/cancel().
     */
    @SuppressLint("MissingPermission") // guarded by canPost()
    private fun updateSummaryLocked(source: String, added: SummaryChild?, removedTag: String?) {
        val key = NotificationIds.groupKey(source)
        val children = system.activeNotifications
            .filter {
                it.notification.group == key &&
                    (it.notification.flags and android.app.Notification.FLAG_GROUP_SUMMARY) == 0 &&
                    it.tag != removedTag && it.tag != added?.tag
            }
            .sortedByDescending { it.postTime }
            .map {
                SummaryChild(
                    tag = it.tag ?: "",
                    title = it.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString() ?: "",
                    severity = Severity.fromWire(it.notification.extras.getString(EXTRA_SEVERITY)) ?: Severity.INFO,
                )
            }
            .let { if (added != null) listOf(added) + it else it }

        val summaryTag = NotificationIds.summaryTag(source)
        val summaryId = NotificationIds.forSummary(source)
        if (children.isEmpty()) {
            compat.cancel(summaryTag, summaryId)
            return
        }
        if (!canPost()) return
        val top = children.maxBy { it.severity.ordinal }.severity
        val style = NotificationCompat.InboxStyle().setSummaryText(source.ifBlank { null })
        children.take(6).forEach { style.addLine(it.title) }
        val summary = NotificationCompat.Builder(context, top.channelId)
            .setSmallIcon(R.drawable.ic_stat_oyee)
            .setColor(context.getColor(R.color.brand))
            .setContentTitle(source.ifBlank { context.getString(R.string.app_name) })
            .setContentText(context.resources.getQuantityString(R.plurals.group_summary_title, children.size, children.size))
            .setSubText(source.ifBlank { null })
            .setStyle(style)
            .setGroup(key)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(Intents.openApp(context))
            .build()
        compat.notify(summaryTag, summaryId, summary)
    }

    fun severityColor(s: Severity): Int = context.getColor(
        when (s) {
            Severity.CRITICAL -> R.color.severity_critical
            Severity.WARNING -> R.color.severity_warning
            Severity.INFO -> R.color.severity_info
            Severity.SUCCESS -> R.color.severity_success
        },
    )

    private fun priority(s: Severity) = when (s) {
        Severity.CRITICAL -> NotificationCompat.PRIORITY_MAX
        Severity.WARNING -> NotificationCompat.PRIORITY_HIGH
        Severity.INFO, Severity.SUCCESS -> NotificationCompat.PRIORITY_DEFAULT
    }

    private fun category(n: Notification): String? = when {
        n.intent == Intent.PROGRESS && n.progress?.state == ProgressState.RUNNING -> NotificationCompat.CATEGORY_PROGRESS
        n.intent == Intent.ASK -> NotificationCompat.CATEGORY_REMINDER
        n.severity == Severity.CRITICAL -> NotificationCompat.CATEGORY_ERROR
        else -> null
    }

    private fun firstLine(s: String): String = s.lineSequence().firstOrNull { it.isNotBlank() }?.trim() ?: s.trim()

    companion object {
        private const val TAG = "NotificationRenderer"
        const val EXTRA_ID = "oyee.id"
        const val EXTRA_VERSION = "oyee.version"
        const val EXTRA_SOURCE = "oyee.source"
        const val EXTRA_SEVERITY = "oyee.severity"
        const val EXTRA_JSON = "oyee.json"
    }
}
