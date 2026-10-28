package app.oyee.android

import android.app.Application
import android.os.Build
import android.util.Log
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import app.oyee.android.data.EventProcessor
import app.oyee.android.data.OyeeApi
import app.oyee.android.data.SettingsStore
import app.oyee.android.data.SyncManager
import app.oyee.android.notify.Channels
import app.oyee.android.notify.Images
import app.oyee.android.notify.NotificationRenderer
import app.oyee.android.notify.PostedLog
import app.oyee.android.transport.FcmSupport
import app.oyee.android.transport.SocketClient
import app.oyee.android.transport.SocketService
import app.oyee.android.transport.TransportManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

class OyeeApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        Channels.ensure(this)
        container.start()
    }
}

/** Manual dependency container (one per process). */
class AppContainer(private val app: Application) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** The user-visible device name ("Galaxy S23 Ultra"), which agents use to target notifications. */
    fun deviceName(): String =
        android.provider.Settings.Global.getString(app.contentResolver, android.provider.Settings.Global.DEVICE_NAME)
            ?.takeIf { it.isNotBlank() }
            ?: listOf(Build.MANUFACTURER.replaceFirstChar { it.uppercase() }, Build.MODEL).joinToString(" ").trim()

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("User-Agent", "Oyee-Android/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE}; ${Build.MODEL})")
                    .build(),
            )
        }
        .build()

    val settings = SettingsStore(app)
    val api = OyeeApi(http) { onUnauthorized() }
    val images = Images(http)
    val renderer = NotificationRenderer(app, images, PostedLog(app))
    val processor = EventProcessor(renderer, settings)
    val sync = SyncManager(api, settings, processor)
    val socket = SocketClient(app, http, settings, processor, scope) { onUnauthorized() }
    val transport = TransportManager(app, settings, api)

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** One-off user-facing messages (e.g. "This device was removed from your account"). */
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    private val unpairMutex = Mutex()

    fun start() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                // Live inbox while the app is visible, even when FCM is the background transport.
                socket.acquire(UI_HOLDER)
                scope.launch { runCatching { sync.catchUp() }.onFailure { Log.d(TAG, "catch-up failed: ${it.message}") } }
                scope.launch { transport.refresh() }
            }

            override fun onStop(owner: LifecycleOwner) {
                socket.release(UI_HOLDER)
            }
        })
        scope.launch {
            // Process started in the background (FCM, boot, WorkManager): keep the service state consistent.
            // (refresh resolves the FCM state first, so an FCM-woken process doesn't start the socket needlessly.)
            if (settings.current().paired) transport.refresh()
        }
    }

    /** Called after a successful pairing. */
    suspend fun onPaired() {
        socket.reconnectNow()
        transport.refresh()
        runCatching { sync.catchUp() }
    }

    /**
     * Unpairs locally (and on the server when [remote]). Clears the token, stops the socket service, removes all
     * Oyee notifications from the tray.
     */
    suspend fun unpair(remote: Boolean) = unpairMutex.withLock {
        val session = settings.session()
        if (remote && session != null) {
            runCatching { api.deleteSelf(session) }.onFailure { Log.w(TAG, "DELETE /api/devices/self failed", it) }
        }
        FcmSupport.deleteToken(app)
        settings.clearPairing()
        SocketService.stop(app)
        socket.reconnectNow()
        renderer.cancelAll()
        // Not transport.refresh(): unpair can run from inside refresh() (401 → onUnauthorized) and its mutex isn't
        // reentrant.
        transport.markUnpaired()
    }

    private suspend fun onUnauthorized() {
        if (settings.session() == null) return
        Log.w(TAG, "Device token rejected (401): unpairing")
        unpair(remote = false)
        _messages.tryEmit("This device was removed from your Oyee account. Pair it again to keep receiving notifications.")
    }

    private companion object {
        const val TAG = "Oyee"
        const val UI_HOLDER = "ui"
    }
}
