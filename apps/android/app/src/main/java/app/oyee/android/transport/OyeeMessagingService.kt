package app.oyee.android.transport

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import app.oyee.android.OyeeApp
import app.oyee.android.data.OyeeApiException
import app.oyee.android.model.FcmMessage
import app.oyee.android.work.OyeeWorker
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/** FCM data messages (protocol §7). Only ever invoked when Firebase was configured at build time. */
class OyeeMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val msg = FcmMessage.parse(message.data) ?: return
        val c = (application as OyeeApp).container
        if (runBlocking { c.settings.session() } == null) return // stale push for an unpaired device
        // onMessageReceived runs on a background thread with a ~20 s budget; blocking here is the intended model.
        runBlocking {
            try {
                withTimeout(15_000) {
                    if (msg.isDeleted) {
                        c.processor.onDeleted(msg.id)
                        return@withTimeout
                    }
                    val n = msg.notification ?: run {
                        val session = c.settings.session() ?: return@withTimeout
                        c.api.get(session, msg.id)
                    }
                    if (msg.isCreated) c.processor.onCreated(n) else c.processor.onUpdated(n, msg.alert)
                }
            } catch (e: OyeeApiException) {
                if (e.isNotFound) c.processor.onDeleted(msg.id) else OyeeWorker.enqueueSync(this@OyeeMessagingService)
            } catch (e: Exception) {
                Log.w(TAG, "FCM handling failed for ${msg.id}; scheduling catch-up", e)
                OyeeWorker.enqueueSync(this@OyeeMessagingService)
            }
        }
    }

    /** Messages were dropped server-side (device offline too long): catch up over REST. */
    override fun onDeletedMessages() {
        OyeeWorker.enqueueSync(this)
    }

    @Deprecated("Replaced by onRegistered in firebase-messaging 26; kept for the getToken() flow.")
    override fun onNewToken(token: String) = handleToken(token)

    override fun onRegistered(token: String) = handleToken(token)

    private fun handleToken(token: String) {
        Log.i(TAG, "New FCM token")
        val c = (application as OyeeApp).container
        runBlocking {
            try {
                withTimeout(10_000) { c.transport.registerFcmToken(token) }
            } catch (e: Exception) {
                OyeeWorker.enqueueRefreshTransport(this@OyeeMessagingService)
            }
        }
    }

    private companion object {
        const val TAG = "OyeeFcm"
    }
}
