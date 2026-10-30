package app.oyee.android.ui.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.oyee.android.AppContainer
import app.oyee.android.data.NotificationQuery
import app.oyee.android.data.OyeeApiException
import app.oyee.android.model.OyeeEvent
import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus
import app.oyee.android.model.Severity
import app.oyee.android.model.SourceSummary
import app.oyee.android.transport.SocketClient
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The inbox shows active notifications by default: resolving one moves it to the Resolved tab. `status = null` = all. */
data class InboxFilters(
    val source: String? = null,
    val severity: Severity? = null,
    val status: NotificationStatus? = NotificationStatus.ACTIVE,
) {
    fun matches(n: Notification) =
        (source == null || n.source == source) &&
            (severity == null || n.severity == severity) &&
            (status == null || n.status == status)

    /** Narrowed beyond the status tab (by source or severity). */
    val isNarrowed get() = source != null || severity != null
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
    /** Being resolved from the list: hidden right away (swipe / ✓), back if the request fails. */
    val resolving: Set<String> = emptySet(),
    /** The notification whose button was just tapped from the list. */
    val respondingId: String? = null,
    val toast: String? = null,
    /** Stacks whose older repeats are shown. Kept here: the inbox leaves composition while a conversation is open. */
    val expanded: Set<String> = emptySet(),
) {
    val visibleItems: List<Notification> get() = if (resolving.isEmpty()) items else items.filterNot { it.id in resolving }
}

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

    /** Active ⇄ Resolved (the "Resolved" row at the end of the list, and back). */
    fun showResolved(on: Boolean) =
        setFilters(_state.value.filters.copy(status = if (on) NotificationStatus.RESOLVED else NotificationStatus.ACTIVE))

    fun consumeToast() = _state.update { it.copy(toast = null) }

    fun toggleExpanded(key: String) = _state.update { it.copy(expanded = if (key in it.expanded) it.expanded - key else it.expanded + key) }

    /** Resolves one row or a whole stack of repeats. */
    fun resolve(ns: List<Notification>) {
        val targets = ns.filter { it.status == NotificationStatus.ACTIVE && it.id !in _state.value.resolving }
        if (targets.isEmpty()) return
        val ids = targets.mapTo(HashSet()) { it.id }
        _state.update { it.copy(resolving = it.resolving + ids) }
        viewModelScope.launch {
            val session = c.settings.session() ?: return@launch
            val results = targets.map { n -> async { runCatching { c.api.resolve(session, n.id) } } }.awaitAll()
            for (r in results) r.getOrNull()?.let { c.processor.onLocal(it) }
            val failed = results.firstOrNull { it.isFailure }?.exceptionOrNull()
            _state.update {
                it.copy(
                    resolving = it.resolving - ids,
                    toast = if (failed != null) "Couldn't resolve: ${failed.message}" else if (targets.size > 1) "Resolved ${targets.size}" else "Resolved",
                )
            }
        }
    }

    /** Answers an open ask right from the list ("Needs you"). The first answer from any device wins. */
    fun answer(n: Notification, option: String) {
        if (_state.value.respondingId != null) return
        _state.update { it.copy(respondingId = n.id) }
        viewModelScope.launch {
            val session = c.settings.session() ?: return@launch
            try {
                c.processor.onLocal(c.api.respond(session, n.id, option = option))
                _state.update { it.copy(respondingId = null, toast = "Answered: $option") }
            } catch (e: Exception) {
                _state.update { it.copy(respondingId = null, toast = e.message ?: "Couldn't send") }
                // 409: answered elsewhere, expired or withdrawn meanwhile; show it as it is now.
                if (e is OyeeApiException && e.isConflict) runCatching { c.api.get(session, n.id) }.onSuccess { c.processor.onLocal(it) }
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
