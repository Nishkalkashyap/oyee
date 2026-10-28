package dev.herald.android.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dev.herald.android.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.heraldDataStore: DataStore<Preferences> by preferencesDataStore(name = "herald")

/** User choice for the WebSocket foreground service. AUTO = on only when FCM can't deliver. */
enum class InstantDelivery { AUTO, ON, OFF }

data class Session(
    val serverUrl: String,
    val token: String,
    val deviceId: String,
    val deviceName: String,
    val userEmail: String,
)

data class AppSettings(
    val serverUrl: String,
    val paired: Boolean,
    val deviceId: String?,
    val deviceName: String?,
    val userEmail: String?,
    val instantDelivery: InstantDelivery,
    val dismissMarksRead: Boolean,
    val registeredFcmToken: String?,
)

/** All persisted state. The device token is stored encrypted (see [TokenCipher]). */
class SettingsStore(private val context: Context) {
    private object Keys {
        val SERVER_URL = stringPreferencesKey("server_url")
        val TOKEN_ENC = stringPreferencesKey("device_token_enc")
        val DEVICE_ID = stringPreferencesKey("device_id")
        val DEVICE_NAME = stringPreferencesKey("device_name")
        val USER_EMAIL = stringPreferencesKey("user_email")
        val INSTANT_DELIVERY = stringPreferencesKey("instant_delivery")
        val DISMISS_MARKS_READ = booleanPreferencesKey("dismiss_marks_read")
        val SYNC_CURSOR = stringPreferencesKey("sync_cursor")
        val LAST_UPDATED_AT = stringPreferencesKey("last_updated_at")
        val FCM_TOKEN_REGISTERED = stringPreferencesKey("fcm_token_registered")
    }

    private val store get() = context.heraldDataStore

    @Volatile private var cachedToken: Pair<String, String>? = null

    val settings: Flow<AppSettings> = store.data.map { p ->
        AppSettings(
            serverUrl = p[Keys.SERVER_URL] ?: BuildConfig.DEFAULT_SERVER_URL,
            paired = p[Keys.TOKEN_ENC] != null,
            deviceId = p[Keys.DEVICE_ID],
            deviceName = p[Keys.DEVICE_NAME],
            userEmail = p[Keys.USER_EMAIL],
            instantDelivery = p[Keys.INSTANT_DELIVERY]?.let { runCatching { InstantDelivery.valueOf(it) }.getOrNull() }
                ?: InstantDelivery.AUTO,
            dismissMarksRead = p[Keys.DISMISS_MARKS_READ] ?: false,
            registeredFcmToken = p[Keys.FCM_TOKEN_REGISTERED],
        )
    }.distinctUntilChanged()

    val pairedFlow: Flow<Boolean> = settings.map { it.paired }.distinctUntilChanged()

    suspend fun current(): AppSettings = settings.first()

    /** Current session, or null when unpaired (or when the token can't be decrypted). */
    suspend fun session(): Session? {
        val p = store.data.first()
        val enc = p[Keys.TOKEN_ENC] ?: return null
        val token = cachedToken?.takeIf { it.first == enc }?.second
            ?: TokenCipher.decrypt(enc)?.also { cachedToken = enc to it }
            ?: return null
        return Session(
            serverUrl = p[Keys.SERVER_URL] ?: BuildConfig.DEFAULT_SERVER_URL,
            token = token,
            deviceId = p[Keys.DEVICE_ID] ?: "",
            deviceName = p[Keys.DEVICE_NAME] ?: "",
            userEmail = p[Keys.USER_EMAIL] ?: "",
        )
    }

    suspend fun savePairing(serverUrl: String, token: String, deviceId: String, deviceName: String, userEmail: String) {
        val enc = TokenCipher.encrypt(token)
        cachedToken = enc to token
        store.edit {
            it[Keys.SERVER_URL] = serverUrl
            it[Keys.TOKEN_ENC] = enc
            it[Keys.DEVICE_ID] = deviceId
            it[Keys.DEVICE_NAME] = deviceName
            it[Keys.USER_EMAIL] = userEmail
            it.remove(Keys.SYNC_CURSOR)
            it.remove(Keys.LAST_UPDATED_AT)
            it.remove(Keys.FCM_TOKEN_REGISTERED)
        }
    }

    /** Forget the pairing but keep the server URL and preferences. */
    suspend fun clearPairing() {
        cachedToken = null
        store.edit {
            it.remove(Keys.TOKEN_ENC)
            it.remove(Keys.DEVICE_ID)
            it.remove(Keys.DEVICE_NAME)
            it.remove(Keys.USER_EMAIL)
            it.remove(Keys.SYNC_CURSOR)
            it.remove(Keys.LAST_UPDATED_AT)
            it.remove(Keys.FCM_TOKEN_REGISTERED)
        }
    }

    suspend fun setServerUrl(url: String) = store.edit { it[Keys.SERVER_URL] = url }

    suspend fun setInstantDelivery(mode: InstantDelivery) = store.edit { it[Keys.INSTANT_DELIVERY] = mode.name }

    suspend fun setDismissMarksRead(value: Boolean) = store.edit { it[Keys.DISMISS_MARKS_READ] = value }

    suspend fun setRegisteredFcmToken(token: String?) = store.edit {
        if (token == null) it.remove(Keys.FCM_TOKEN_REGISTERED) else it[Keys.FCM_TOKEN_REGISTERED] = token
    }

    /** Opaque WebSocket sync cursor from the last `sync.result`. */
    suspend fun syncCursor(): String? = store.data.first()[Keys.SYNC_CURSOR]

    suspend fun setSyncCursor(cursor: String?) = store.edit {
        if (cursor == null) it.remove(Keys.SYNC_CURSOR) else it[Keys.SYNC_CURSOR] = cursor
    }

    /** Newest `updatedAt` seen from any transport (ISO-8601), used for REST `updatedSince` catch-up. */
    suspend fun lastUpdatedAt(): String? = store.data.first()[Keys.LAST_UPDATED_AT]

    suspend fun advanceLastUpdatedAt(iso: String) {
        if (iso.isBlank()) return
        store.edit {
            val cur = it[Keys.LAST_UPDATED_AT]
            // ISO-8601 UTC strings with the same format compare lexicographically.
            if (cur == null || iso > cur) it[Keys.LAST_UPDATED_AT] = iso
        }
    }
}
