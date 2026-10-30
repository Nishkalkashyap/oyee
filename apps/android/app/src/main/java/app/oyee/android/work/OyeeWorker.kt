package app.oyee.android.work

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import app.oyee.android.OyeeApp
import app.oyee.android.R
import app.oyee.android.data.OyeeApiException
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Durable background operations that must survive the caller (notification taps, offline replies, FCM fallbacks). */
class OyeeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as OyeeApp
        val c = app.container
        val session = c.settings.session() ?: return Result.success()
        val id = inputData.getString(KEY_ID)
        return try {
            when (inputData.getString(KEY_OP)) {
                OP_READ -> c.processor.onLocal(c.api.markRead(session, id!!))
                OP_RESOLVE -> c.processor.onLocal(c.api.resolve(session, id!!))
                OP_RESPOND -> {
                    val text = inputData.getString(KEY_TEXT)
                    val option = inputData.getString(KEY_OPTION)
                    val n = c.api.respond(session, id!!, option = option, text = text)
                    // An answered ask is resolved, so this takes it out of the tray.
                    val note = if (text != null) app.getString(R.string.reply_sent) else app.getString(R.string.action_sent, option)
                    c.processor.onLocal(n, note = note, replyHistory = text)
                }
                OP_SYNC -> c.sync.catchUp()
                OP_REFRESH_TRANSPORT -> c.transport.refresh()
            }
            Result.success()
        } catch (e: OyeeApiException) {
            Log.w(TAG, "op failed: ${e.status} ${e.code}", e)
            when {
                e.isNotFound && id != null -> {
                    c.processor.onDeleted(id)
                    Result.success()
                }
                // Answered elsewhere, expired or withdrawn meanwhile: the ask is closed for good. Show it as it is now.
                e.isConflict && id != null -> {
                    c.renderer.cancel(id)
                    runCatching { c.api.get(session, id) }.getOrNull()?.let { c.processor.onLocal(it) }
                    Result.success()
                }
                e.status == 408 || e.status == 429 || e.status >= 500 -> Result.retry()
                else -> Result.failure()
            }
        } catch (e: IOException) {
            Result.retry()
        } catch (e: SerializationException) {
            Result.failure()
        }
    }

    companion object {
        private const val TAG = "OyeeWorker"
        private const val KEY_OP = "op"
        private const val KEY_ID = "id"
        private const val KEY_OPTION = "option"
        private const val KEY_TEXT = "text"
        private const val OP_READ = "read"
        private const val OP_RESPOND = "respond"
        private const val OP_RESOLVE = "resolve"
        private const val OP_SYNC = "sync"
        private const val OP_REFRESH_TRANSPORT = "refresh_transport"

        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        private fun enqueue(context: Context, name: String, policy: ExistingWorkPolicy, vararg data: Pair<String, Any?>) {
            val req = OneTimeWorkRequestBuilder<OyeeWorker>()
                .setInputData(workDataOf(*data))
                .setConstraints(online)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(name, policy, req)
        }

        fun enqueueRead(context: Context, id: String) =
            enqueue(context, "read:$id", ExistingWorkPolicy.KEEP, KEY_OP to OP_READ, KEY_ID to id)

        fun enqueueResolve(context: Context, id: String) =
            enqueue(context, "resolve:$id", ExistingWorkPolicy.KEEP, KEY_OP to OP_RESOLVE, KEY_ID to id)

        fun enqueueRespond(context: Context, id: String, option: String?, text: String?) =
            enqueue(
                context,
                "respond:$id:${option ?: "text"}:${text?.hashCode() ?: 0}",
                ExistingWorkPolicy.KEEP,
                KEY_OP to OP_RESPOND, KEY_ID to id, KEY_OPTION to option, KEY_TEXT to text,
            )

        fun enqueueSync(context: Context) = enqueue(context, "sync", ExistingWorkPolicy.REPLACE, KEY_OP to OP_SYNC)

        fun enqueueRefreshTransport(context: Context) =
            enqueue(context, "refresh_transport", ExistingWorkPolicy.REPLACE, KEY_OP to OP_REFRESH_TRANSPORT)
    }
}
