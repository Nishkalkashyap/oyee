package app.oyee.android.notify

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import app.oyee.android.R
import app.oyee.android.model.Notification
import app.oyee.android.ui.MainActivity

/**
 * PendingIntents for notification interactions. Each gets a unique data URI so PendingIntents for different
 * notifications/actions never collapse into one (extras don't count for PendingIntent equality).
 */
object Intents {
    const val EXTRA_ID = "oyee.id"
    const val EXTRA_URL = "oyee.url"
    const val EXTRA_OPTION = "oyee.option"
    const val KEY_REPLY = "oyee.reply"

    const val ACTION_ANSWER = "app.oyee.android.ANSWER"
    const val ACTION_REPLY = "app.oyee.android.REPLY"
    const val ACTION_DISMISSED = "app.oyee.android.DISMISSED"
    const val ACTION_RESOLVE = "app.oyee.android.RESOLVE"

    private const val IMMUTABLE = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

    private fun uri(id: String, vararg parts: String): Uri =
        Uri.Builder().scheme("oyee").authority("notification").appendPath(id).apply { parts.forEach { appendPath(it) } }.build()

    /** Body tap: open `url` (if any) or the in-app detail, and mark read. */
    fun open(context: Context, n: Notification): PendingIntent {
        val intent = Intent(context, NotificationOpenActivity::class.java)
            .setData(uri(n.id, "open"))
            .putExtra(EXTRA_ID, n.id)
            .putExtra(EXTRA_URL, n.url)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, 0, intent, IMMUTABLE)
    }

    fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        IMMUTABLE,
    )

    /** An inform's link button: opens the browser through the trampoline, which also marks the notification read. */
    fun linkAction(context: Context, n: Notification, index: Int, label: String, url: String): NotificationCompat.Action {
        val pi = PendingIntent.getActivity(
            context,
            0,
            Intent(context, NotificationOpenActivity::class.java)
                .setData(uri(n.id, "link", index.toString()))
                .putExtra(EXTRA_ID, n.id)
                .putExtra(EXTRA_URL, url)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            IMMUTABLE,
        )
        return NotificationCompat.Action.Builder(R.drawable.ic_stat_oyee, label, pi).setShowsUserInterface(true).build()
    }

    /** An ask's answer button: `POST …/respond { option }` from the background, without opening the app. */
    fun answerAction(context: Context, n: Notification, index: Int, option: String): NotificationCompat.Action {
        val pi = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, NotificationActionReceiver::class.java)
                .setAction(ACTION_ANSWER)
                .setData(uri(n.id, "answer", index.toString()))
                .putExtra(EXTRA_ID, n.id)
                .putExtra(EXTRA_OPTION, option),
            IMMUTABLE,
        )
        return NotificationCompat.Action.Builder(R.drawable.ic_stat_oyee, option, pi).setShowsUserInterface(false).build()
    }

    /** An ask's inline reply (RemoteInput): `POST …/respond { text }`. */
    fun replyAction(context: Context, n: Notification, placeholder: String): NotificationCompat.Action {
        val label = context.getString(R.string.reply_default_label)
        val remoteInput = RemoteInput.Builder(KEY_REPLY)
            .setLabel(placeholder.takeIf { it.isNotBlank() } ?: label)
            .build()
        // RemoteInput requires a mutable PendingIntent (the system fills in the typed text). The intent is explicit.
        val pi = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, NotificationActionReceiver::class.java)
                .setAction(ACTION_REPLY)
                .setData(uri(n.id, "reply"))
                .putExtra(EXTRA_ID, n.id),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Action.Builder(R.drawable.ic_stat_oyee, label, pi)
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(false)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build()
    }

    /** "✓ Resolve" button: resolves the notification everywhere without opening the app. */
    fun resolveAction(context: Context, n: Notification): NotificationCompat.Action {
        val pi = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, NotificationActionReceiver::class.java)
                .setAction(ACTION_RESOLVE)
                .setData(uri(n.id, "resolve"))
                .putExtra(EXTRA_ID, n.id),
            IMMUTABLE,
        )
        return NotificationCompat.Action.Builder(R.drawable.ic_stat_oyee, context.getString(R.string.action_resolve), pi)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build()
    }

    fun dismissed(context: Context, n: Notification): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, NotificationActionReceiver::class.java)
            .setAction(ACTION_DISMISSED)
            .setData(uri(n.id, "dismissed"))
            .putExtra(EXTRA_ID, n.id),
        IMMUTABLE,
    )
}
