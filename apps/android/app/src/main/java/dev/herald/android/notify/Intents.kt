package dev.herald.android.notify

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import dev.herald.android.R
import dev.herald.android.model.Action
import dev.herald.android.model.Notification
import dev.herald.android.model.Reply
import dev.herald.android.ui.MainActivity

/**
 * PendingIntents for notification interactions. Each gets a unique data URI so PendingIntents for different
 * notifications/actions never collapse into one (extras don't count for PendingIntent equality).
 */
object Intents {
    const val EXTRA_ID = "herald.id"
    const val EXTRA_URL = "herald.url"
    const val EXTRA_ACTION_ID = "herald.actionId"
    const val EXTRA_ACTION_LABEL = "herald.actionLabel"
    const val EXTRA_RESOLVES = "herald.resolves"
    const val KEY_REPLY = "herald.reply"

    const val ACTION_RESPOND = "dev.herald.android.RESPOND"
    const val ACTION_REPLY = "dev.herald.android.REPLY"
    const val ACTION_DISMISSED = "dev.herald.android.DISMISSED"

    private const val IMMUTABLE = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT

    private fun uri(id: String, vararg parts: String): Uri =
        Uri.Builder().scheme("herald").authority("notification").appendPath(id).apply { parts.forEach { appendPath(it) } }.build()

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

    /** `url` actions open the browser (through the trampoline, which also marks read); others POST /respond. */
    fun action(context: Context, n: Notification, a: Action): NotificationCompat.Action {
        val pi = if (a.url != null) {
            PendingIntent.getActivity(
                context,
                0,
                Intent(context, NotificationOpenActivity::class.java)
                    .setData(uri(n.id, "action", a.id))
                    .putExtra(EXTRA_ID, n.id)
                    .putExtra(EXTRA_URL, a.url)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                IMMUTABLE,
            )
        } else {
            PendingIntent.getBroadcast(
                context,
                0,
                Intent(context, NotificationActionReceiver::class.java)
                    .setAction(ACTION_RESPOND)
                    .setData(uri(n.id, "respond", a.id))
                    .putExtra(EXTRA_ID, n.id)
                    .putExtra(EXTRA_ACTION_ID, a.id)
                    .putExtra(EXTRA_ACTION_LABEL, a.label)
                    .putExtra(EXTRA_RESOLVES, a.resolves),
                IMMUTABLE,
            )
        }
        return NotificationCompat.Action.Builder(R.drawable.ic_stat_herald, a.label, pi)
            .setShowsUserInterface(a.url != null)
            .build()
    }

    fun replyAction(context: Context, n: Notification, reply: Reply): NotificationCompat.Action {
        val label = reply.buttonLabel?.takeIf { it.isNotBlank() } ?: context.getString(R.string.reply_default_label)
        val remoteInput = RemoteInput.Builder(KEY_REPLY)
            .setLabel(reply.placeholder?.takeIf { it.isNotBlank() } ?: label)
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
        return NotificationCompat.Action.Builder(R.drawable.ic_stat_herald, label, pi)
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(false)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
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
