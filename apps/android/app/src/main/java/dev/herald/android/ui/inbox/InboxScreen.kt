package dev.herald.android.ui.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.herald.android.model.Notification
import dev.herald.android.model.NotificationStatus
import dev.herald.android.model.Severity
import dev.herald.android.transport.SocketClient
import dev.herald.android.ui.components.SeverityBadge
import dev.herald.android.ui.components.severityColor
import dev.herald.android.ui.components.severityLabel
import dev.herald.android.util.Formatting
import dev.herald.android.util.Markdown

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(vm: InboxViewModel, onOpen: (String) -> Unit, onSettings: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val nearEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= listState.layoutInfo.totalItemsCount - 5
        }
    }
    LaunchedEffect(nearEnd, state.nextCursor) { if (nearEnd && state.nextCursor != null) vm.loadMore() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Inbox")
                        ConnectionLabel(state.connection)
                    }
                },
                actions = {
                    IconButton(onClick = vm::markAllRead) { Icon(Icons.Filled.Done, contentDescription = "Mark all read") }
                    IconButton(onClick = onSettings) { Icon(Icons.Filled.Settings, contentDescription = "Settings") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            FilterBar(state, vm::setFilters)
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
                when {
                    state.loading && state.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                    state.items.isEmpty() -> EmptyState(state)
                    else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize()) {
                        state.error?.let { err -> item { ErrorRow(err, vm::refresh) } }
                        items(state.items, key = { it.id }) { n ->
                            InboxRow(n, onClick = { onOpen(n.id) })
                            HorizontalDivider()
                        }
                        if (state.loadingMore) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(Modifier.size(24.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ConnectionLabel(s: SocketClient.State) {
    val (text, color) = when (s) {
        SocketClient.State.CONNECTED -> "Live" to Color(0xFF16A34A)
        SocketClient.State.CONNECTING -> "Connecting…" to MaterialTheme.colorScheme.onSurfaceVariant
        SocketClient.State.BACKING_OFF -> "Reconnecting…" to Color(0xFFF59E0B)
        SocketClient.State.WAITING_FOR_NETWORK -> "Offline" to MaterialTheme.colorScheme.error
        SocketClient.State.IDLE -> "Not connected" to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).background(color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun FilterBar(state: InboxUiState, onChange: (InboxFilters) -> Unit) {
    val f = state.filters
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        DropdownChip(
            label = when (f.status) { null -> "All"; NotificationStatus.ACTIVE -> "Active"; NotificationStatus.RESOLVED -> "Resolved" },
            selected = f.status != null,
            options = listOf("All" to null, "Active" to NotificationStatus.ACTIVE, "Resolved" to NotificationStatus.RESOLVED),
            onSelect = { onChange(f.copy(status = it)) },
        )
        DropdownChip(
            label = f.severity?.let(::severityLabel) ?: "Severity",
            selected = f.severity != null,
            options = listOf<Pair<String, Severity?>>("Any severity" to null) + Severity.entries.reversed().map { severityLabel(it) to it },
            onSelect = { onChange(f.copy(severity = it)) },
        )
        DropdownChip(
            label = f.source ?: "Source",
            selected = f.source != null,
            options = listOf<Pair<String, String?>>("Any source" to null) +
                state.sources.map { s -> (if (s.unread > 0) "${s.source} (${s.unread})" else s.source) to s.source },
            onSelect = { onChange(f.copy(source = it)) },
        )
    }
}

@Composable
private fun <T> DropdownChip(label: String, selected: Boolean, options: List<Pair<String, T>>, onSelect: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        FilterChip(
            selected = selected,
            onClick = { open = true },
            label = { Text(label, maxLines = 1) },
            trailingIcon = { Icon(Icons.Filled.ArrowDropDown, contentDescription = null) },
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (text, value) ->
                DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onSelect(value) })
            }
        }
    }
}

@Composable
private fun InboxRow(n: Notification, onClick: () -> Unit) {
    val unread = !n.isRead && !n.isResolved
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .background(if (unread) MaterialTheme.colorScheme.primary.copy(alpha = 0.05f) else Color.Transparent)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .alpha(if (n.isResolved) 0.6f else 1f),
        verticalAlignment = Alignment.Top,
    ) {
        SeverityBadge(n.severity, n.icon)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    n.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Text(Formatting.relative(n.createdAt), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (unread) {
                    Spacer(Modifier.width(6.dp))
                    Box(Modifier.size(8.dp).background(severityColor(n.severity), CircleShape))
                }
            }
            n.body?.takeIf { it.isNotBlank() }?.let {
                Text(
                    Markdown.toPlainText(it),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            n.progress?.let { p ->
                Spacer(Modifier.height(6.dp))
                if (p.indeterminate) {
                    LinearProgressIndicator(Modifier.fillMaxWidth(), color = severityColor(n.severity))
                } else {
                    LinearProgressIndicator(
                        progress = { if (p.max > 0) (p.value / p.max).toFloat().coerceIn(0f, 1f) else 0f },
                        modifier = Modifier.fillMaxWidth(),
                        color = severityColor(n.severity),
                    )
                }
                Text(Formatting.progressLabel(p), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(2.dp))
            val meta = buildList {
                if (n.source.isNotBlank()) add(n.source)
                if (n.isResolved) add("resolved")
                if (n.actions.isNotEmpty() || n.reply != null) if (n.responses.isEmpty() && !n.isResolved) add("awaiting response")
            }.joinToString(" · ")
            Text(meta, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ErrorRow(error: String, onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.errorContainer).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(error, color = MaterialTheme.colorScheme.onErrorContainer, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = onRetry) { Text("Retry") }
    }
}

@Composable
private fun EmptyState(state: InboxUiState) {
    // Inside PullToRefreshBox the content must be scrollable for the gesture to work.
    LazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item {
            Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(Modifier.height(64.dp))
                Text(
                    when {
                        state.error != null -> "Couldn't load notifications"
                        state.filters.isActive -> "Nothing matches these filters"
                        else -> "No notifications yet"
                    },
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    state.error ?: "Send one with a webhook or an MCP tool and it shows up here instantly.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
