package app.oyee.android.update

import android.app.Application
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.net.toUri
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.oyee.android.BuildConfig
import app.oyee.android.OyeeApp
import app.oyee.android.R
import app.oyee.android.notify.Channels
import app.oyee.android.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** A published release on GitHub. */
data class Release(val version: String, val apkName: String, val apkUrl: String, val sumsUrl: String?, val pageUrl: String)

/** Semantic versions like "0.2.1" (a leading "v" is ignored). */
object Versions {
    fun parse(v: String): List<Int>? =
        v.trim().removePrefix("v").split('.').takeIf { it.size == 3 }?.map { it.toIntOrNull() ?: return null }

    fun isNewer(candidate: String, current: String): Boolean {
        val a = parse(candidate) ?: return false
        val b = parse(current) ?: return true
        for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]
        return false
    }
}

/**
 * Update notifications from GitHub Releases (release builds only). Checks `releases/latest`; "Update" opens the APK
 * download in the browser and the user installs it from there.
 *
 * The app deliberately does not download or install APKs itself: Play Protect blocks sideloaded apps that hold
 * REQUEST_INSTALL_PACKAGES ("Harmful app blocked"). Authenticity is still guaranteed by Android, which only accepts an
 * update signed with the same key as the installed app.
 */
class AppUpdater(private val app: Application, private val http: OkHttpClient, private val scope: CoroutineScope) {
    sealed interface State {
        data object Idle : State
        data object Checking : State
        data object UpToDate : State
        data class Available(val release: Release) : State
        data class Failed(val message: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()
    val currentVersion: String = BuildConfig.VERSION_NAME

    /** Self-update only makes sense for the signed builds published on GitHub. */
    val enabled: Boolean = !BuildConfig.DEBUG
    private val prefs = app.getSharedPreferences("updates", Context.MODE_PRIVATE)

    fun schedule() {
        if (!enabled) return
        val work = PeriodicWorkRequestBuilder<UpdateCheckWorker>(12, TimeUnit.HOURS).build()
        WorkManager.getInstance(app).enqueueUniquePeriodicWork("update-check", ExistingPeriodicWorkPolicy.KEEP, work)
    }

    /** Checks GitHub for a newer release. With [notify], posts a notification once per new version. */
    suspend fun check(notify: Boolean): Release? {
        if (!enabled) return null
        _state.value = State.Checking
        return try {
            val release = fetchLatest()
            if (release != null && Versions.isNewer(release.version, currentVersion)) {
                _state.value = State.Available(release)
                if (notify && prefs.getString("notified", null) != release.version) {
                    postNotification(release)
                    prefs.edit().putString("notified", release.version).apply()
                }
                release
            } else {
                _state.value = State.UpToDate
                null
            }
        } catch (e: Exception) {
            Log.d(TAG, "update check failed: ${e.message}")
            _state.value = State.Failed("Couldn't check for updates")
            null
        }
    }

    /** Opens the latest APK download in the browser (checking first if needed). */
    fun update() {
        scope.launch {
            val release = (_state.value as? State.Available)?.release ?: check(notify = false) ?: return@launch
            app.startActivity(Intent(Intent.ACTION_VIEW, release.apkUrl.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    private suspend fun fetchLatest(): Release? = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("https://api.github.com/repos/$REPO/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) error("GitHub responded ${res.code}")
            val json = Json.parseToJsonElement(res.body.string()).jsonObject
            val tag = json["tag_name"]?.jsonPrimitive?.content ?: return@withContext null
            val assets = json["assets"]?.jsonArray?.map { it.jsonObject }.orEmpty()
            fun url(a: JsonObject) = a["browser_download_url"]?.jsonPrimitive?.content
            val apk = assets.firstOrNull { it["name"]?.jsonPrimitive?.content?.endsWith(".apk") == true } ?: return@withContext null
            val sums = assets.firstOrNull { it["name"]?.jsonPrimitive?.content == "SHA256SUMS.txt" }
            Release(
                version = tag.removePrefix("v"),
                apkName = apk["name"]!!.jsonPrimitive.content,
                apkUrl = url(apk) ?: return@withContext null,
                sumsUrl = sums?.let { url(it) },
                pageUrl = json["html_url"]?.jsonPrimitive?.content ?: "https://github.com/$REPO/releases",
            )
        }
    }

    private fun postNotification(release: Release) {
        val open = PendingIntent.getActivity(
            app,
            UPDATE_NOTIFICATION_ID,
            Intent(app, MainActivity::class.java).putExtra(MainActivity.EXTRA_UPDATE, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(app, Channels.UPDATES)
            .setSmallIcon(R.drawable.ic_stat_oyee)
            .setColor(app.getColor(R.color.brand))
            .setContentTitle("Oyee ${release.version} is available")
            .setContentText("Tap to download the update (you have ${currentVersion}).")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { app.getSystemService(NotificationManager::class.java).notify(UPDATE_NOTIFICATION_ID, n) }
    }

    companion object {
        const val REPO = "Nishkalkashyap/oyee"
        private const val TAG = "OyeeUpdater"
        private const val UPDATE_NOTIFICATION_ID = 0x0E0E
    }
}

/** Periodic background check (posts the "update available" notification). */
class UpdateCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        (applicationContext as OyeeApp).container.updater.check(notify = true)
        return Result.success()
    }
}
