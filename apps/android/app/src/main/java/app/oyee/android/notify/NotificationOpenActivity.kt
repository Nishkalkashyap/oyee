package app.oyee.android.notify

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.core.net.toUri
import app.oyee.android.OyeeApp
import app.oyee.android.ui.MainActivity
import app.oyee.android.work.OyeeWorker
import kotlinx.coroutines.launch

/**
 * Invisible trampoline for notification taps (Android 12+ forbids starting activities from broadcast receivers).
 * Marks the notification read (via WorkManager so it survives this activity finishing immediately), removes it from
 * the tray, then opens the URL in the browser or the in-app detail screen.
 */
class NotificationOpenActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra(Intents.EXTRA_ID)
        val url = intent.getStringExtra(Intents.EXTRA_URL)
        if (id != null) {
            OyeeWorker.enqueueRead(this, id)
            val app = application as OyeeApp
            app.container.scope.launch { app.container.renderer.cancel(id) }
        }
        val target = if (url != null) {
            Intent(Intent.ACTION_VIEW, url.toUri()).addCategory(Intent.CATEGORY_BROWSABLE)
        } else {
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_NOTIFICATION, id)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        try {
            startActivity(target.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Log.w("OyeeOpen", "No activity for $url", e)
            startActivity(
                Intent(this, MainActivity::class.java)
                    .putExtra(MainActivity.EXTRA_OPEN_NOTIFICATION, id)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            )
        }
        finish()
    }
}
