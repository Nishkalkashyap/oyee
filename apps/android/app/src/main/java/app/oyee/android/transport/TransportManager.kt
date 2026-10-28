package app.oyee.android.transport

import android.content.Context
import android.util.Log
import app.oyee.android.data.OyeeApi
import app.oyee.android.data.InstantDelivery
import app.oyee.android.data.SettingsStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout

/**
 * Chooses the delivery transport:
 *  - FCM when Firebase is configured in this build, Play services hand out a token, the token is registered with
 *    the server (`PUT /api/devices/self`) and the server has FCM enabled (`GET /api/config`).
 *  - The WebSocket foreground service when the user forces "Instant delivery" ON, or (AUTO) whenever FCM can't
 *    deliver. OFF disables it (notifications then only arrive via FCM or while the app is open).
 */
class TransportManager(
    private val context: Context,
    private val settings: SettingsStore,
    private val api: OyeeApi,
) {
    sealed interface FcmState {
        data object Unpaired : FcmState
        data object Checking : FcmState
        /** No google-services.json at build time. */
        data object NotConfigured : FcmState
        /** The server reports `fcmEnabled: false` (no FCM_SERVICE_ACCOUNT_JSON). */
        data object ServerDisabled : FcmState
        data class Failed(val reason: String) : FcmState
        data class Registered(val token: String) : FcmState
    }

    private val _fcm = MutableStateFlow<FcmState>(FcmState.Checking)
    val fcm: StateFlow<FcmState> = _fcm.asStateFlow()
    val socketServiceRunning: StateFlow<Boolean> get() = SocketService.running

    private val mutex = Mutex()

    /** Re-evaluates FCM + the foreground service. Call on start, after pairing, on settings changes and on boot. */
    suspend fun refresh() = mutex.withLock {
        val session = settings.session()
        if (session == null) {
            _fcm.value = FcmState.Unpaired
            SocketService.stop(context)
            return@withLock
        }
        val state = resolveFcm()
        _fcm.value = state
        applySocketPreference(state)
    }

    fun markUnpaired() {
        _fcm.value = FcmState.Unpaired
        SocketService.stop(context)
    }

    /** Applies the instant-delivery preference using the last known FCM state (no network). */
    suspend fun applySocketPreference(state: FcmState = _fcm.value) {
        if (settings.session() == null) {
            SocketService.stop(context)
            return
        }
        val want = when (settings.current().instantDelivery) {
            InstantDelivery.ON -> true
            InstantDelivery.OFF -> false
            InstantDelivery.AUTO -> state !is FcmState.Registered
        }
        if (want) SocketService.start(context) else SocketService.stop(context)
    }

    /** Called from FirebaseMessagingService.onNewToken. */
    suspend fun registerFcmToken(token: String) {
        val session = settings.session() ?: return
        api.updateSelf(session, fcmToken = token)
        settings.setRegisteredFcmToken(token)
        if (_fcm.value !is FcmState.ServerDisabled) _fcm.value = FcmState.Registered(token)
        applySocketPreference()
    }

    private suspend fun resolveFcm(): FcmState {
        if (!FcmSupport.isConfigured(context)) return FcmState.NotConfigured
        val session = settings.session() ?: return FcmState.Unpaired
        val token = try {
            withTimeout(20_000) { FcmSupport.token() }
        } catch (e: Exception) {
            Log.w(TAG, "FCM token unavailable", e)
            return FcmState.Failed(e.message ?: e.javaClass.simpleName)
        }
        if (token != settings.current().registeredFcmToken) {
            try {
                api.updateSelf(session, fcmToken = token)
                settings.setRegisteredFcmToken(token)
            } catch (e: Exception) {
                Log.w(TAG, "FCM token registration failed", e)
                return FcmState.Failed("Couldn't register token: ${e.message}")
            }
        }
        val serverEnabled = runCatching { api.config(session.serverUrl).fcmEnabled }.getOrNull()
        return if (serverEnabled == false) FcmState.ServerDisabled else FcmState.Registered(token)
    }

    private companion object {
        const val TAG = "OyeeTransport"
    }
}
