package app.oyee.android.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.RemoteInput
import app.oyee.android.OyeeApp
import app.oyee.android.R
import app.oyee.android.data.OyeeApiException
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
                        Intents.ACTION_ANSWER -> answer(app, id, intent)
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

    /** An answer button: the first answer from any device wins and resolves the ask, which takes it out of the tray. */
    private suspend fun answer(app: OyeeApp, id: String, intent: Intent) {
        val c = app.container
        val option = intent.getStringExtra(Intents.EXTRA_OPTION) ?: return
        val session = c.settings.session() ?: return
        try {
            c.processor.onLocal(c.api.respond(session, id, option = option))
        } catch (e: OyeeApiException) {
            if (e.isConflict) closed(app, id) else queue(app, id, option = option, text = null, e)
        } catch (e: Exception) {
            queue(app, id, option = option, text = null, e)
        }
    }

    private suspend fun reply(app: OyeeApp, id: String, intent: Intent) {
        val c = app.container
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Intents.KEY_REPLY)?.toString()?.trim()
        if (text.isNullOrEmpty()) {
            // Re-post to clear the RemoteInput spinner.
            c.renderer.lastRendered(id)?.let { c.renderer.apply(it, alert = false, postIfAbsent = false, force = true) }
            return
        }
        val session = c.settings.session() ?: return
        try {
            c.processor.onLocal(c.api.respond(session, id, text = text), note = app.getString(R.string.reply_sent), replyHistory = text)
        } catch (e: OyeeApiException) {
            if (e.isConflict) closed(app, id) else queue(app, id, option = null, text = text, e)
        } catch (e: Exception) {
            queue(app, id, option = null, text = text, e)
        }
    }

    /** Answered on another device, expired or withdrawn meanwhile (409): nothing to retry, the ask leaves the tray. */
    private suspend fun closed(app: OyeeApp, id: String) {
        val c = app.container
        c.renderer.cancel(id)
        val session = c.settings.session() ?: return
        runCatching { c.api.get(session, id) }.getOrNull()?.let { c.processor.onLocal(it) }
    }

    private suspend fun queue(app: OyeeApp, id: String, option: String?, text: String?, e: Exception) {
        Log.w(TAG, "answer failed, queueing", e)
        val c = app.container
        OyeeWorker.enqueueRespond(app, id, option = option, text = text)
        c.renderer.lastRendered(id)?.let {
            c.renderer.apply(it, alert = false, postIfAbsent = false, note = app.getString(R.string.action_failed), replyHistory = text)
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
