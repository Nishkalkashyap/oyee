package app.oyee.android.data

import app.oyee.android.model.OyeeEvent
import app.oyee.android.model.Notification
import app.oyee.android.notify.NotificationRenderer
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Single entry point for notification events from every transport (WebSocket, FCM, REST catch-up, local actions).
 * De-duplicates by `version` (FCM and the socket may both deliver the same change), updates the system tray via
 * [NotificationRenderer] and broadcasts [OyeeEvent]s to the in-app inbox.
 */
class EventProcessor(
    private val renderer: NotificationRenderer,
    private val settings: SettingsStore,
) {
    private val _events = MutableSharedFlow<OyeeEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<OyeeEvent> = _events.asSharedFlow()

    private val lock = Mutex()
    private val seen = object : LinkedHashMap<String, Int>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Int>?): Boolean = size > 2_000
    }

    /** True if [n] is newer than anything already processed for its id. */
    private suspend fun accept(n: Notification): Boolean = lock.withLock {
        val prev = seen[n.id]
        if (prev != null && n.version <= prev) {
            false
        } else {
            seen[n.id] = n.version
            true
        }
    }

    /** Targeted at other devices → keep it in the inbox but never touch the system tray here. */
    private suspend fun forThisDevice(n: Notification): Boolean = n.isTargetedAt(settings.current().deviceId)

    private suspend fun record(n: Notification, alert: Boolean, isNew: Boolean) {
        settings.advanceLastUpdatedAt(n.updatedAt)
        _events.emit(OyeeEvent.Upsert(n, alert, isNew))
    }

    /** `notification.created` → post a system notification (alerts unless silent). */
    suspend fun onCreated(n: Notification) {
        if (!accept(n)) return
        val mine = forThisDevice(n)
        record(n, alert = mine, isNew = true)
        if (mine) renderer.apply(n, alert = true, postIfAbsent = true)
    }

    /**
     * `notification.updated` → replace in place if showing (or post when `alert`, or when this device never showed
     * it); cancel if read/resolved.
     */
    suspend fun onUpdated(n: Notification, alert: Boolean) {
        if (!accept(n)) return
        val mine = forThisDevice(n)
        record(n, alert = alert && mine, isNew = false)
        if (!mine) return
        // Not showing and not alerting → leave it alone, unless this device never showed it (collapsed FCM push).
        renderer.apply(n, alert = alert, postIfAbsent = alert, postIfNeverPosted = true)
    }

    /** `notification.deleted` → cancel + remove from the inbox. Late events for the id are ignored afterwards. */
    suspend fun onDeleted(id: String) {
        lock.withLock { seen[id] = Int.MAX_VALUE }
        _events.emit(OyeeEvent.Removed(id))
        renderer.cancel(id)
    }

    /**
     * Item from a WebSocket `sync.result` or REST catch-up. Items created after [postNewSince] (i.e. while this
     * device was offline) are posted; older ones only update/cancel what's showing. `null` = initial sync: no posts.
     */
    suspend fun onSynced(n: Notification, postNewSince: String?) {
        if (!accept(n)) return
        record(n, alert = false, isNew = false)
        if (!forThisDevice(n)) return
        val createdWhileAway = postNewSince != null && n.createdAt > postNewSince
        renderer.apply(n, alert = createdWhileAway, postIfAbsent = createdWhileAway)
    }

    /** Result of this device's own action (respond/read/resolve): update silently, optionally with a status note. */
    suspend fun onLocal(n: Notification, note: String? = null, replyHistory: CharSequence? = null) {
        if (accept(n)) record(n, alert = false, isNew = false)
        renderer.apply(n, alert = false, postIfAbsent = false, note = note, replyHistory = replyHistory)
    }
}
