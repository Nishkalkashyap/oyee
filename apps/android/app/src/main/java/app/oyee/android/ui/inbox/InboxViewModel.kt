package app.oyee.android.ui.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oyee.android.AppContainer
import app.oyee.android.data.NotificationQuery
import app.oyee.android.model.OyeeEvent
import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus
import app.oyee.android.model.Severity
import app.oyee.android.model.SourceSummary
import app.oyee.android.transport.SocketClient
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class InboxFilters(
    val source: String? = null,
    val severity: Severity? = null,
    val status: NotificationStatus? = null,
) {
    fun matches(n: Notification) =
        (source == null || n.source == source) &&
            (severity == null || n.severity == severity) &&
            (status == null || n.status == status)

    val isActive get() = source != null || severity != null || status != null
}

data class InboxUiState(
    val items: List<Notification> = emptyList(),
    val nextCursor: String? = null,
    val loading: Boolean = true,
    val refreshing: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
    val filters: InboxFilters = InboxFilters(),
    val sources: List<SourceSummary> = emptyList(),
    val connection: SocketClient.State = SocketClient.State.IDLE,
)

class InboxViewModel(private val c: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(InboxUiState())
    val state: StateFlow<InboxUiState> = _state.asStateFlow()
    private var loadJob: Job? = null

    init {
        load(initial = true)
        viewModelScope.launch { c.processor.events.collect(::onEvent) }
        viewModelScope.launch { c.socket.state.collect { s -> _state.update { it.copy(connection = s) } } }
    }

    fun refresh() = load(initial = false)

    fun setFilters(f: InboxFilters) {
        if (f == _state.value.filters) return
        _state.update { it.copy(filters = f, items = emptyList(), nextCursor = null, loading = true) }
        load(initial = true)
    }

    private fun load(initial: Boolean) {
        loadJob?.cancel()
        _state.update { if (initial) it.copy(loading = true, error = null) else it.copy(refreshing = true, error = null) }
        loadJob = viewModelScope.launch {
            val session = c.settings.session() ?: return@launch
            val f = _state.value.filters
            try {
                val page = c.api.list(session, NotificationQuery(limit = PAGE, source = f.source, severity = f.severity, status = f.status))
                _state.update { it.copy(items = page.items, nextCursor = page.nextCursor, loading = false, refreshing = false) }
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, refreshing = false, error = e.message ?: "Couldn't load notifications") }
            }
            runCatching { c.api.sources(session) }.onSuccess { s -> _state.update { it.copy(sources = s) } }
        }
    }

    fun loadMore() {
        val s = _state.value
        val cursor = s.nextCursor ?: return
        if (s.loadingMore || s.loading) return
        _state.update { it.copy(loadingMore = true) }
        viewModelScope.launch {
            val session = c.settings.session() ?: return@launch
            val f = s.filters
            try {
                val page = c.api.list(session, NotificationQuery(limit = PAGE, cursor = cursor, source = f.source, severity = f.severity, status = f.status))
                _state.update { st ->
                    val known = st.items.mapTo(HashSet()) { it.id }
                    st.copy(items = st.items + page.items.filter { it.id !in known }, nextCursor = page.nextCursor, loadingMore = false)
                }
            } catch (e: Exception) {
                _state.update { it.copy(loadingMore = false, error = e.message) }
            }
        }
    }

    fun markAllRead() {
        viewModelScope.launch {
            val session = c.settings.session() ?: return@launch
            try {
                c.api.readAll(session, _state.value.filters.source)
                // The server broadcasts the read updates; refresh to be safe if the socket isn't connected.
                load(initial = false)
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    private fun onEvent(e: OyeeEvent) = _state.update { st ->
        when (e) {
            is OyeeEvent.Removed -> st.copy(items = st.items.filterNot { it.id == e.id })
            is OyeeEvent.Upsert -> {
                val n = e.notification
                val idx = st.items.indexOfFirst { it.id == n.id }
                when {
                    !st.filters.matches(n) -> if (idx >= 0) st.copy(items = st.items.filterNot { it.id == n.id }) else st
                    idx >= 0 -> st.copy(items = st.items.toMutableList().also { it[idx] = n })
                    else -> {
                        // New or newly matching: insert in createdAt order, unless it's older than the loaded page.
                        val oldest = st.items.lastOrNull()?.createdAt
                        if (st.nextCursor != null && oldest != null && n.createdAt < oldest) {
                            st
                        } else {
                            st.copy(items = (st.items + n).sortedByDescending { it.createdAt })
                        }
                    }
                }
            }
        }
    }

    private companion object {
        const val PAGE = 50
    }
}
