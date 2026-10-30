package app.oyee.android.ui.detail

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oyee.android.AppContainer
import app.oyee.android.data.OyeeApiException
import app.oyee.android.data.Session
import app.oyee.android.model.OyeeEvent
import app.oyee.android.model.Notification
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DetailUiState(
    val notification: Notification? = null,
    val loading: Boolean = true,
    val busy: Boolean = false,
    val error: String? = null,
    val deleted: Boolean = false,
    val replyText: String = "",
    val toast: String? = null,
    /** Resolved from this screen: go back to the list. */
    val resolvedHere: Boolean = false,
)

class DetailViewModel(private val c: AppContainer, private val id: String) : ViewModel() {
    private val _state = MutableStateFlow(DetailUiState())
    val state: StateFlow<DetailUiState> = _state.asStateFlow()
    private var autoRead = false

    init {
        viewModelScope.launch {
            c.processor.events.collect { e ->
                when (e) {
                    is OyeeEvent.Upsert -> if (e.notification.id == id) setNotification(e.notification)
                    is OyeeEvent.Removed -> if (e.id == id) _state.update { it.copy(deleted = true) }
                }
            }
        }
        load()
    }

    fun load() {
        viewModelScope.launch {
            val s = c.settings.session() ?: return@launch
            _state.update { it.copy(loading = it.notification == null, error = null) }
            try {
                setNotification(c.api.get(s, id))
                maybeAutoRead(s)
            } catch (e: OyeeApiException) {
                if (e.isNotFound) _state.update { it.copy(loading = false, deleted = true) }
                else _state.update { it.copy(loading = false, error = e.message) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "Couldn't load") }
            }
        }
    }

    private fun setNotification(n: Notification) = _state.update {
        val cur = it.notification
        if (cur != null && cur.version > n.version) it else it.copy(notification = n, loading = false)
    }

    /** Opening the detail counts as reading it (like tapping the system notification). */
    private suspend fun maybeAutoRead(s: Session) {
        val n = _state.value.notification ?: return
        if (autoRead || n.isRead) return
        autoRead = true
        runCatching { c.api.markRead(s, id) }.onSuccess { c.processor.onLocal(it) }
    }

    fun onReplyText(v: String) = _state.update { it.copy(replyText = v) }

    fun consumeToast() = _state.update { it.copy(toast = null) }

    fun respond(actionId: String, label: String) = act("Sent: $label") { s -> c.api.respond(s, id, actionId = actionId) }

    fun sendReply() {
        val text = _state.value.replyText.trim()
        if (text.isEmpty()) return
        act("Reply sent", clearReply = true) { s -> c.api.respond(s, id, text = text) }
    }

    fun markRead() = act(null) { s -> c.api.markRead(s, id) }

    fun resolve() = act("Resolved", onDone = { it.copy(resolvedHere = true) }) { s -> c.api.resolve(s, id) }

    fun delete() {
        viewModelScope.launch {
            val s = c.settings.session() ?: return@launch
            _state.update { it.copy(busy = true) }
            try {
                c.api.delete(s, id)
                c.processor.onDeleted(id)
                _state.update { it.copy(busy = false, deleted = true) }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, toast = e.message ?: "Delete failed") }
            }
        }
    }

    private fun act(
        success: String?,
        clearReply: Boolean = false,
        onDone: (DetailUiState) -> DetailUiState = { it },
        block: suspend (Session) -> Notification,
    ) {
        if (_state.value.busy) return
        viewModelScope.launch {
            val s = c.settings.session() ?: return@launch
            _state.update { it.copy(busy = true) }
            try {
                val n = block(s)
                c.processor.onLocal(n)
                setNotification(n)
                _state.update { onDone(it.copy(busy = false, toast = success, replyText = if (clearReply) "" else it.replyText)) }
            } catch (e: Exception) {
                _state.update { it.copy(busy = false, toast = e.message ?: "Request failed") }
            }
        }
    }
}
