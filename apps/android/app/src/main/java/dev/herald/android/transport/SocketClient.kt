package dev.herald.android.transport

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.SystemClock
import android.util.Log
import dev.herald.android.data.EventProcessor
import dev.herald.android.data.Session
import dev.herald.android.data.SettingsStore
import dev.herald.android.model.ClientMessages
import dev.herald.android.model.ServerMessage
import dev.herald.android.util.Backoff
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * Herald WebSocket client (protocol §6): Bearer auth, JSON ping every 30 s with a silence watchdog, `sync` with the
 * persisted cursor on every connect, exponential backoff with jitter (1 s → 60 s), immediate reconnect when the
 * default network changes. Reference-counted: the foreground service and the visible UI each hold it open.
 */
class SocketClient(
    private val context: Context,
    http: OkHttpClient,
    private val settings: SettingsStore,
    private val processor: EventProcessor,
    private val scope: CoroutineScope,
    private val onUnauthorized: suspend () -> Unit,
) {
    enum class State { IDLE, CONNECTING, CONNECTED, BACKING_OFF, WAITING_FOR_NETWORK }

    private val _state = MutableStateFlow(State.IDLE)
    val state: StateFlow<State> = _state.asStateFlow()

    private val client = http.newBuilder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // long-lived; liveness is handled by the ping watchdog
        .build()

    private val holders = mutableSetOf<String>()
    private var loopJob: Job? = null
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private val backoff = Backoff()

    @Volatile private var socket: WebSocket? = null
    @Volatile private var hasNetwork = true
    @Volatile private var connectedNetwork: Network? = null

    @Synchronized
    fun acquire(holder: String) {
        holders += holder
        if (loopJob?.isActive != true) loopJob = scope.launch { runLoop() }
    }

    @Synchronized
    fun release(holder: String) {
        holders -= holder
        if (holders.isEmpty()) {
            loopJob?.cancel()
            loopJob = null
            socket?.close(1000, "bye")
            socket = null
            _state.value = State.IDLE
        }
    }

    /** Drop the current connection (if any) and reconnect immediately, e.g. after re-pairing. */
    fun reconnectNow() {
        backoff.reset()
        socket?.cancel()
        wake.trySend(Unit)
    }

    private suspend fun runLoop() {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                hasNetwork = true
                val current = connectedNetwork
                // Switched networks (e.g. Wi-Fi → mobile): the old socket is dead even if it doesn't know yet.
                if (current != null && current != network) socket?.cancel()
                backoff.reset()
                wake.trySend(Unit)
            }

            override fun onLost(network: Network) {
                hasNetwork = cm.activeNetwork != null
                if (network == connectedNetwork) socket?.cancel()
            }
        }
        try {
            cm.registerDefaultNetworkCallback(callback)
        } catch (e: RuntimeException) {
            Log.w(TAG, "registerDefaultNetworkCallback failed", e)
        }
        hasNetwork = cm.activeNetwork != null
        try {
            while (currentCoroutineContext().isActive) {
                val session = settings.session()
                if (session == null) {
                    _state.value = State.IDLE
                    withTimeoutOrNull(60_000) { settings.pairedFlow.drop(1).first() }
                    continue
                }
                if (!hasNetwork) {
                    _state.value = State.WAITING_FOR_NETWORK
                    withTimeoutOrNull(60_000) { wake.receive() }
                    hasNetwork = hasNetwork || cm.activeNetwork != null
                    continue
                }
                _state.value = State.CONNECTING
                connectedNetwork = cm.activeNetwork
                val unauthorized = connectOnce(session)
                connectedNetwork = null
                if (unauthorized) {
                    _state.value = State.IDLE
                    onUnauthorized()
                    continue
                }
                if (!currentCoroutineContext().isActive) break
                val delayMs = backoff.nextDelayMs()
                _state.value = if (hasNetwork) State.BACKING_OFF else State.WAITING_FOR_NETWORK
                Log.d(TAG, "reconnecting in ${delayMs}ms")
                withTimeoutOrNull(delayMs) { wake.receive() }
            }
        } finally {
            runCatching { cm.unregisterNetworkCallback(callback) }
            socket?.cancel()
            socket = null
        }
    }

    /** Connects and suspends until the socket closes. Returns true if the server rejected the token (401). */
    private suspend fun connectOnce(session: Session): Boolean = coroutineScope {
        val frames = Channel<String>(Channel.UNLIMITED)
        val closed = CompletableDeferred<Boolean>()
        val request = Request.Builder()
            .url(session.serverUrl.trimEnd('/') + "/api/ws")
            .header("Authorization", "Bearer ${session.token}")
            .build()
        val ws = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    frames.trySend(OPENED)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    frames.trySend(text)
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    frames.close()
                    closed.complete(false)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    Log.d(TAG, "socket failure: ${t.message} (${response?.code})")
                    frames.close()
                    closed.complete(response?.code == 401)
                }
            },
        )
        socket = ws
        var lastFrameAt = SystemClock.elapsedRealtime()
        var initialSync = false
        var syncThreshold: String? = null

        val consumer = launch {
            for (text in frames) {
                lastFrameAt = SystemClock.elapsedRealtime()
                if (text == OPENED) {
                    _state.value = State.CONNECTED
                    backoff.reset()
                    // Items created after this point while we were away get posted; see EventProcessor.onSynced.
                    syncThreshold = settings.lastUpdatedAt()
                    val since = settings.syncCursor() ?: syncThreshold
                    initialSync = since == null
                    ws.send(ClientMessages.sync(since))
                    continue
                }
                try {
                    when (val m = ServerMessage.parse(text)) {
                        is ServerMessage.Created -> processor.onCreated(m.notification)
                        is ServerMessage.Updated -> processor.onUpdated(m.notification, m.alert)
                        is ServerMessage.Deleted -> processor.onDeleted(m.id)
                        is ServerMessage.SyncResult -> {
                            val threshold = if (initialSync) null else syncThreshold
                            m.notifications.forEach { processor.onSynced(it, postNewSince = threshold) }
                            m.deletedIds.forEach { processor.onDeleted(it) }
                            m.cursor?.let { settings.setSyncCursor(it) }
                            if (m.hasMore && m.cursor != null) ws.send(ClientMessages.sync(m.cursor))
                        }
                        is ServerMessage.Hello, ServerMessage.Pong, null -> Unit
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to handle frame", e)
                }
            }
        }
        val pinger = launch {
            while (isActive) {
                delay(PING_INTERVAL_MS)
                if (SystemClock.elapsedRealtime() - lastFrameAt > SILENCE_TIMEOUT_MS) {
                    Log.d(TAG, "no frames for ${SILENCE_TIMEOUT_MS}ms; reconnecting")
                    ws.cancel()
                    break
                }
                ws.send(ClientMessages.ping())
            }
        }
        try {
            closed.await()
        } finally {
            pinger.cancel()
            ws.cancel()
            frames.close()
            consumer.join()
            if (socket === ws) socket = null
        }
    }

    private companion object {
        const val TAG = "HeraldSocket"
        const val OPENED = "\u0000opened"
        const val PING_INTERVAL_MS = 30_000L
        const val SILENCE_TIMEOUT_MS = 75_000L
    }
}
