package dev.herald.android.transport

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dev.herald.android.HeraldApp
import dev.herald.android.R
import dev.herald.android.notify.Channels
import dev.herald.android.notify.Intents
import dev.herald.android.util.NotificationIds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * "Instant delivery" foreground service that keeps the WebSocket open.
 *
 * Foreground service type: `specialUse`.
 *  - `dataSync` is limited to 6 h per 24 h on Android 15+ (then onTimeout() stops it) and may not be started from
 *    BOOT_COMPLETED on Android 15+, both fatal for an always-on push connection.
 *  - `remoteMessaging` has no time limit but is meant for continuing a messaging conversation across devices.
 *  - `specialUse` has no time limit, is allowed from BOOT_COMPLETED, and is the documented type for use cases not
 *    covered by the others. Its Play-review justification is irrelevant here (sideloaded only), but the subtype
 *    property is declared in the manifest anyway.
 */
class SocketService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val container get() = (application as HeraldApp).container

    override fun onCreate() {
        super.onCreate()
        Channels.ensure(this)
        if (!goForeground(SocketClient.State.CONNECTING)) {
            stopSelf()
            return
        }
        _running.value = true
        container.socket.acquire(HOLDER)
        scope.launch {
            container.socket.state.collect { goForeground(it) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground(container.socket.state.value)
        return START_STICKY
    }

    override fun onDestroy() {
        _running.value = false
        container.socket.release(HOLDER)
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun goForeground(state: SocketClient.State): Boolean {
        val title = when (state) {
            SocketClient.State.CONNECTED -> R.string.service_connected
            SocketClient.State.WAITING_FOR_NETWORK -> R.string.service_offline
            else -> R.string.service_connecting
        }
        val notification = NotificationCompat.Builder(this, Channels.SERVICE)
            .setSmallIcon(R.drawable.ic_stat_herald)
            .setContentTitle(getString(title))
            .setContentText(getString(R.string.service_text))
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(Intents.openApp(this))
            .build()
        return try {
            ServiceCompat.startForeground(
                this,
                NotificationIds.FOREGROUND_SERVICE,
                notification,
                if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
            )
            true
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException / missing permission: give up quietly.
            Log.w(TAG, "startForeground failed", e)
            false
        }
    }

    companion object {
        private const val TAG = "HeraldSocketService"
        private const val HOLDER = "service"

        private val _running = MutableStateFlow(false)
        val running: StateFlow<Boolean> = _running.asStateFlow()

        /** Returns false if Android refused (e.g. app in background without an exemption). */
        fun start(context: Context): Boolean = try {
            ContextCompat.startForegroundService(context, Intent(context, SocketService::class.java))
            true
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't start foreground service", e)
            false
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SocketService::class.java))
        }
    }
}
