package dev.herald.android.transport

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.herald.android.HeraldApp
import dev.herald.android.data.InstantDelivery
import dev.herald.android.work.HeraldWorker
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Restarts instant delivery after reboot and after an app update (both are FGS-start exemptions). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val c = (context.applicationContext as HeraldApp).container
        val pending = goAsync()
        c.scope.launch {
            try {
                val settings = c.settings.current()
                if (!settings.paired) return@launch
                // Start the service right away while the exemption applies when we already know it's wanted.
                val fcmPossible = FcmSupport.isConfigured(context)
                if (settings.instantDelivery == InstantDelivery.ON ||
                    (settings.instantDelivery == InstantDelivery.AUTO && !fcmPossible)
                ) {
                    SocketService.start(context)
                }
                if (withTimeoutOrNull(8_000) { c.transport.refresh() } == null) {
                    HeraldWorker.enqueueRefreshTransport(context)
                }
                HeraldWorker.enqueueSync(context)
            } finally {
                pending.finish()
            }
        }
    }
}
