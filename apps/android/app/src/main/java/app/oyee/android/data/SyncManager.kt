package app.oyee.android.data

import android.util.Log
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** REST catch-up (`GET /api/notifications?updatedSince=`) on app start / foreground and from FCM fallbacks. */
class SyncManager(
    private val api: OyeeApi,
    private val settings: SettingsStore,
    private val processor: EventProcessor,
) {
    private val mutex = Mutex()

    /** Returns the number of notifications processed. Throws on network errors. */
    suspend fun catchUp(): Int = mutex.withLock {
        val session = settings.session() ?: return@withLock 0
        val since = settings.lastUpdatedAt()
        if (since == null) {
            // First sync after pairing: learn the current state without flooding the tray with old notifications.
            val page = api.list(session, NotificationQuery(limit = 50))
            page.items.forEach { processor.onSynced(it, postNewSince = null) }
            return@withLock page.items.size
        }
        var cursor: String? = null
        var count = 0
        var pages = 0
        do {
            val page = api.list(session, NotificationQuery(limit = 200, updatedSince = since, cursor = cursor))
            page.items.forEach { processor.onSynced(it, postNewSince = since) }
            count += page.items.size
            cursor = page.nextCursor
            pages++
        } while (cursor != null && pages < MAX_PAGES)
        Log.d("OyeeSync", "catch-up processed $count since $since")
        count
    }

    private companion object {
        const val MAX_PAGES = 10
    }
}
