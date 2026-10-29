package app.oyee.android.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput
import app.oyee.android.OyeeApp
import app.oyee.android.R
import app.oyee.android.work.OyeeWorker
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * Handles notification buttons, inline replies and swipe-dismissal. Network calls run under goAsync() with a
 * timeout; on failure the work is handed to WorkManager (retries when online) and the notification says so.
 */
class NotificationActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as OyeeApp
        val id = intent.getStringExtra(Intents.EXTRA_ID) ?: return
        val pending = goAsync()
        app.container.scope.launch {
            try {
                withTimeout(9_000) {
                    when (intent.action) {
                        Intents.ACTION_RESPOND -> respond(app, id, intent)
                        Intents.ACTION_REPLY -> reply(app, id, intent)
                        Intents.ACTION_DISMISSED -> dismissed(app, id)
                        Intents.ACTION_RESOLVE -> resolve(app, id)
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Notification action failed for $id", e)
            } finally {
                pending.finish()
            }
        }
    }

    private suspend fun respond(app: OyeeApp, id: String, intent: Intent) {
        val c = app.container
        val actionId = intent.getStringExtra(Intents.EXTRA_ACTION_ID) ?: return
        val label = intent.getStringExtra(Intents.EXTRA_ACTION_LABEL) ?: actionId
        val resolves = intent.getBooleanExtra(Intents.EXTRA_RESOLVES, false)
        val session = c.settings.session() ?: return
        try {
            val updated = c.api.respond(session, id, actionId = actionId)
            if (resolves || updated.shouldDismissSystemNotification) {
                c.renderer.cancel(id)
                c.processor.onLocal(updated)
            } else {
                c.processor.onLocal(updated, note = app.getString(R.string.action_sent, label))
            }
        } catch (e: Exception) {
            Log.w(TAG, "respond failed, queueing", e)
            OyeeWorker.enqueueRespond(app, id, actionId = actionId, text = null, label = label)
            c.renderer.lastRendered(id)?.let {
                c.renderer.apply(it, alert = false, postIfAbsent = false, note = app.getString(R.string.action_failed))
            }
        }
    }

    private suspend fun reply(app: OyeeApp, id: String, intent: Intent) {
        val c = app.container
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Intents.KEY_REPLY)?.toString()?.trim()
        val last = c.renderer.lastRendered(id)
        if (text.isNullOrEmpty()) {
            // Re-post to clear the RemoteInput spinner.
            last?.let { c.renderer.apply(it, alert = false, postIfAbsent = false, force = true) }
            return
        }
        val session = c.settings.session() ?: return
        try {
            val updated = c.api.respond(session, id, text = text)
            c.processor.onLocal(updated, note = app.getString(R.string.reply_sent), replyHistory = text)
        } catch (e: Exception) {
            Log.w(TAG, "reply failed, queueing", e)
            OyeeWorker.enqueueRespond(app, id, actionId = null, text = text)
            last?.let {
                c.renderer.apply(it, alert = false, postIfAbsent = false, note = app.getString(R.string.action_failed), replyHistory = text)
            }
        }
    }

    /** "✓ Resolve": the notification goes away at once; the server call is retried later if it fails. */
    private suspend fun resolve(app: OyeeApp, id: String) {
        val c = app.container
        c.renderer.cancel(id)
        val session = c.settings.session() ?: return
        try {
            c.processor.onLocal(c.api.resolve(session, id))
        } catch (e: Exception) {
            Log.w(TAG, "resolve failed, queueing", e)
            OyeeWorker.enqueueResolve(app, id)
        }
    }

    private suspend fun dismissed(app: OyeeApp, id: String) {
        if (app.container.settings.current().dismissMarksRead) OyeeWorker.enqueueRead(app, id)
    }

    private companion object {
        const val TAG = "OyeeAction"
    }
}
