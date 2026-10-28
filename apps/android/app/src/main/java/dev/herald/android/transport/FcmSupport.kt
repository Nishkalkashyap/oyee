package dev.herald.android.transport

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await

/**
 * Firebase is optional: without app/google-services.json the google-services plugin isn't applied, no FirebaseApp
 * is initialised, and every entry point here reports "not configured" so the app falls back to the WebSocket.
 */
object FcmSupport {
    fun isConfigured(context: Context): Boolean = try {
        FirebaseApp.getApps(context).isNotEmpty()
    } catch (t: Throwable) {
        Log.w("FcmSupport", "Firebase unavailable", t)
        false
    }

    /**
     * Fetches (or creates) the FCM registration token. Throws if Play services are missing/unavailable.
     * firebase-messaging 26 deprecates getToken() in favour of register() + onRegistered(), but getToken() keeps
     * working unless the app opts into the new mode via manifest meta-data; HeraldMessagingService handles both.
     */
    @Suppress("DEPRECATION")
    suspend fun token(): String = FirebaseMessaging.getInstance().token.await()

    suspend fun deleteToken(context: Context) {
        if (!isConfigured(context)) return
        @Suppress("DEPRECATION")
        runCatching { FirebaseMessaging.getInstance().deleteToken().await() }
    }
}
