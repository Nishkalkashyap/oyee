package app.oyee.android.notify

import android.content.Context
import androidx.core.content.edit

/**
 * Persisted, bounded log of Oyee ids this device has ever posted to the tray. Used to tell "the user dismissed
 * it" apart from "this device never saw it" — FCM's collapse_key (= notification id) can replace an undelivered
 * `created` message with a later `updated` one, which must then still be shown once.
 */
class PostedLog(context: Context) {
    private val prefs = context.getSharedPreferences("oyee_posted", Context.MODE_PRIVATE)
    private val ids: LinkedHashSet<String> by lazy {
        LinkedHashSet(prefs.getString(KEY, "")!!.split(',').filter { it.isNotBlank() })
    }

    @Synchronized
    fun wasPosted(id: String): Boolean = id in ids

    @Synchronized
    fun markPosted(id: String) {
        if (!ids.add(id)) return
        while (ids.size > MAX) ids.remove(ids.first())
        prefs.edit { putString(KEY, ids.joinToString(",")) }
    }

    @Synchronized
    fun clear() {
        ids.clear()
        prefs.edit { remove(KEY) }
    }

    private companion object {
        const val KEY = "ids"
        const val MAX = 1_000
    }
}
