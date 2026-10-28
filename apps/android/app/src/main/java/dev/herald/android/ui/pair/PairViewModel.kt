package dev.herald.android.ui.pair

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.herald.android.AppContainer
import dev.herald.android.BuildConfig
import dev.herald.android.data.HeraldApiException
import dev.herald.android.util.PairingCode
import dev.herald.android.util.ServerUrl
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException

data class PairUiState(
    val serverUrl: String = "",
    val code: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    /** Set when the values came from a herald://pair link: the user confirms with one tap. */
    val fromLink: Boolean = false,
)

class PairViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(PairUiState())
    val state: StateFlow<PairUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            val saved = container.settings.current().serverUrl
            _state.update { if (it.serverUrl.isEmpty()) it.copy(serverUrl = saved) else it }
        }
    }

    fun onServerUrl(v: String) = _state.update { it.copy(serverUrl = v, error = null) }

    fun onCode(v: String) = _state.update { it.copy(code = PairingCode.formatForDisplay(v), error = null) }

    fun prefill(server: String?, code: String?) = _state.update {
        it.copy(
            serverUrl = server?.takeIf { s -> s.isNotBlank() } ?: it.serverUrl,
            code = code?.let(PairingCode::formatForDisplay) ?: it.code,
            fromLink = true,
            error = null,
        )
    }

    fun pair() {
        val s = _state.value
        if (s.busy) return
        val url = when (val r = ServerUrl.normalize(s.serverUrl, allowCleartextLocal = BuildConfig.DEBUG)) {
            is ServerUrl.Result.Ok -> r.url
            is ServerUrl.Result.Invalid -> return _state.update { it.copy(error = r.reason) }
        }
        val code = PairingCode.normalize(s.code)
            ?: return _state.update { it.copy(error = "The pairing code has 8 characters, like K7Q2-9XMA") }
        _state.update { it.copy(busy = true, error = null, serverUrl = url) }
        viewModelScope.launch {
            try {
                val name = (Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android").take(64)
                val result = container.api.pair(url, code, name)
                container.settings.savePairing(url, result.token, result.device.id, result.device.name, result.user.email)
                container.scope.launch { container.onPaired() }
                _state.update { it.copy(busy = false, code = "", fromLink = false) }
            } catch (e: HeraldApiException) {
                val msg = when (e.status) {
                    400, 404, 410 -> "That code is invalid or expired. Create a new one in the web app."
                    429 -> "Too many attempts. Wait a minute and try again."
                    else -> e.message
                }
                _state.update { it.copy(busy = false, error = msg) }
            } catch (e: IOException) {
                _state.update { it.copy(busy = false, error = "Couldn't reach $url (${e.message ?: "network error"})") }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, error = "Unexpected response from the server: ${e.message}") }
            }
        }
    }
}
