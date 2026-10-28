package app.oyee.android.notify

import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import app.oyee.android.R
import app.oyee.android.model.Severity

/** One channel per severity (protocol §9) + a low-importance channel for the foreground-service notification. */
object Channels {
    const val SERVICE = "oyee.service"
    private const val GROUP_ALERTS = "oyee.alerts"
    private const val GROUP_SYSTEM = "oyee.system"

    fun nameRes(severity: Severity): Int = when (severity) {
        Severity.CRITICAL -> R.string.channel_critical
        Severity.WARNING -> R.string.channel_warning
        Severity.INFO -> R.string.channel_info
        Severity.SUCCESS -> R.string.channel_success
        Severity.DEBUG -> R.string.channel_debug
    }

    private fun descRes(severity: Severity): Int = when (severity) {
        Severity.CRITICAL -> R.string.channel_critical_desc
        Severity.WARNING -> R.string.channel_warning_desc
        Severity.INFO -> R.string.channel_info_desc
        Severity.SUCCESS -> R.string.channel_success_desc
        Severity.DEBUG -> R.string.channel_debug_desc
    }

    /** Android has no channel above IMPORTANCE_HIGH (MAX is unused), so critical vs warning differ by vibration/category. */
    fun importance(severity: Severity): Int = when (severity) {
        Severity.CRITICAL, Severity.WARNING -> NotificationManager.IMPORTANCE_HIGH
        Severity.INFO, Severity.SUCCESS -> NotificationManager.IMPORTANCE_DEFAULT
        Severity.DEBUG -> NotificationManager.IMPORTANCE_LOW
    }

    /** Idempotent: safe to call on every start. Existing channels keep the user's customisations. */
    fun ensure(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannelGroups(
            listOf(
                NotificationChannelGroup(GROUP_ALERTS, "Notifications"),
                NotificationChannelGroup(GROUP_SYSTEM, "App"),
            ),
        )
        val audio = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val channels = Severity.entries.reversed().map { sev ->
            NotificationChannel(sev.channelId, context.getString(nameRes(sev)), importance(sev)).apply {
                description = context.getString(descRes(sev))
                group = GROUP_ALERTS
                setShowBadge(sev != Severity.DEBUG)
                when (sev) {
                    Severity.CRITICAL -> {
                        enableVibration(true)
                        vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 600)
                        enableLights(true)
                        lightColor = context.getColor(R.color.severity_critical)
                        setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audio)
                        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    }
                    Severity.WARNING -> {
                        enableVibration(true)
                        vibrationPattern = longArrayOf(0, 250, 150, 250)
                        setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audio)
                    }
                    Severity.INFO, Severity.SUCCESS -> {
                        enableVibration(true)
                        setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audio)
                    }
                    Severity.DEBUG -> {
                        enableVibration(false)
                        setSound(null, null)
                    }
                }
            }
        }
        val service = NotificationChannel(SERVICE, context.getString(R.string.channel_service), NotificationManager.IMPORTANCE_MIN).apply {
            description = context.getString(R.string.channel_service_desc)
            group = GROUP_SYSTEM
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
        }
        nm.createNotificationChannels(channels + service)
    }
}
