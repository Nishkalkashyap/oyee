package app.oyee.android.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oyee.android.AppContainer
import app.oyee.android.data.AppSettings
import app.oyee.android.data.InstantDelivery
import app.oyee.android.transport.SocketClient
import app.oyee.android.transport.TransportManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(private val c: AppContainer) : ViewModel() {
    val settings: StateFlow<AppSettings?> = c.settings.settings.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val fcm: StateFlow<TransportManager.FcmState> = c.transport.fcm
    val socket: StateFlow<SocketClient.State> = c.socket.state
    val serviceRunning: StateFlow<Boolean> = c.transport.socketServiceRunning

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    fun consumeMessage() {
        _message.value = null
    }

    fun setInstantDelivery(mode: InstantDelivery) = viewModelScope.launch {
        c.settings.setInstantDelivery(mode)
        c.transport.applySocketPreference()
    }

    fun setDismissMarksRead(v: Boolean) = viewModelScope.launch { c.settings.setDismissMarksRead(v) }

    fun recheckTransport() = viewModelScope.launch {
        c.transport.refresh()
        _message.value = "Delivery re-checked"
    }

    fun syncNow() = viewModelScope.launch {
        _message.value = try {
            val n = c.sync.catchUp()
            c.socket.reconnectNow()
            "Synced $n notification${if (n == 1) "" else "s"}"
        } catch (e: Exception) {
            "Sync failed: ${e.message}"
        }
    }

    fun unpair() = c.scope.launch { c.unpair(remote = true) }
}
