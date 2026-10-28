package app.oyee.android.ui.inbox

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
import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus
import app.oyee.android.model.Severity
import app.oyee.android.transport.SocketClient
import app.oyee.android.ui.components.FilterPill
import app.oyee.android.update.AppUpdater
import app.oyee.android.update.UpdateBanner
import app.oyee.android.ui.components.InkProgress
import app.oyee.android.ui.components.SourceAvatar
import app.oyee.android.ui.theme.Oyee
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import app.oyee.android.util.Formatting
import app.oyee.android.util.Markdown

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InboxScreen(vm: InboxViewModel, onOpen: (String) -> Unit, onSettings: () -> Unit, updater: AppUpdater? = null) {
    val state by vm.state.collectAsStateWithLifecycle()
    val c = Oyee.colors
    val listState = rememberLazyListState()
    val nearEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= listState.layoutInfo.totalItemsCount - 5
        }
    }
    LaunchedEffect(nearEnd, state.nextCursor) { if (nearEnd && state.nextCursor != null) vm.loadMore() }
    val unread = state.items.count { !it.isRead && !it.isResolved }

    Scaffold(containerColor = c.background) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            // Gluon's mobile header: large bold title, live state, and a round button that opens Settings.
            Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 12.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("Inbox", style = MaterialTheme.typography.headlineLarge, color = c.foreground)
                        if (unread > 0) {
                            Spacer(Modifier.width(8.dp))
                            Text("$unread unread", style = MaterialTheme.typography.labelMedium, color = c.brand, modifier = Modifier.padding(bottom = 6.dp))
                        }
                    }
                    ConnectionLabel(state.connection)
                }
                IconButton(onClick = vm::markAllRead, enabled = unread > 0) {
                    Icon(Icons.Filled.Done, contentDescription = "Mark all read", tint = if (unread > 0) c.secondaryLabel else c.faint)
                }
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(c.secondary).clickable(onClick = onSettings),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = c.secondaryLabel, modifier = Modifier.size(20.dp)) }
            }
            updater?.let { UpdateBanner(it) }
            FilterBar(state, vm::setFilters)
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
                when {
                    state.loading && state.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = c.brand)
                    }
                    state.items.isEmpty() -> EmptyState(state)
                    else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 6.dp, vertical = 4.dp)) {
                        state.error?.let { err -> item { ErrorRow(err, vm::refresh) } }
                        items(state.items, key = { it.id }) { n -> InboxRow(n, onClick = { onOpen(n.id) }) }
                        if (state.loadingMore) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(Modifier.size(24.dp), color = c.brand)
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
        SocketClient.State.CONNECTING -> "Connecting…" to Oyee.colors.muted
        SocketClient.State.BACKING_OFF -> "Reconnecting…" to Color(0xFFD97706)
        SocketClient.State.WAITING_FOR_NETWORK -> "Offline" to Color(0xFFDC2626)
        SocketClient.State.IDLE -> "Push only" to Oyee.colors.muted
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).background(color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = color)
    }
}

@Composable
private fun FilterBar(state: InboxUiState, onChange: (InboxFilters) -> Unit) {
    val f = state.filters
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        FilterPill("All", selected = !f.isActive) { onChange(InboxFilters()) }
        FilterPill("Active", selected = f.status == NotificationStatus.ACTIVE) {
            onChange(f.copy(status = if (f.status == NotificationStatus.ACTIVE) null else NotificationStatus.ACTIVE))
        }
        FilterPill("Resolved", selected = f.status == NotificationStatus.RESOLVED) {
            onChange(f.copy(status = if (f.status == NotificationStatus.RESOLVED) null else NotificationStatus.RESOLVED))
        }
        state.sources.forEach { s ->
            FilterPill(s.source, selected = f.source == s.source) { onChange(f.copy(source = if (f.source == s.source) null else s.source)) }
        }
    }
}

/** Gluon's list row: tinted source avatar with a severity dot, title, time (orange while unread), preview. */
@Composable
private fun InboxRow(n: Notification, onClick: () -> Unit) {
    val c = Oyee.colors
    val unread = !n.isRead && !n.isResolved
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SourceAvatar(n.source, size = 46.dp, severity = n.severity)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    n.title,
                    style = MaterialTheme.typography.titleMedium,
                    color = if (n.isResolved && n.isRead) c.muted else c.foreground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    Formatting.relative(n.createdAt),
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (unread) c.brand else c.muted,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val preview = n.body?.takeIf { it.isNotBlank() }?.let { Markdown.toPlainText(it).replace('\n', ' ') }
                Text(
                    if (preview != null) "${n.source} · $preview" else n.source,
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (unread) c.secondaryLabel else c.muted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (n.responses.isNotEmpty()) {
                    Spacer(Modifier.width(6.dp))
                    Text("↩ ${n.responses.size}", style = MaterialTheme.typography.labelSmall, color = c.muted)
                }
                if (n.isResolved) {
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Filled.Done, contentDescription = "Resolved", tint = Color(0xFF16A34A), modifier = Modifier.size(15.dp))
                }
                if (unread) {
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.size(9.dp).background(c.brand, CircleShape))
                }
            }
            n.progress?.takeIf { !n.isResolved }?.let { p ->
                Spacer(Modifier.height(8.dp))
                InkProgress(p, height = 4.dp)
            }
        }
    }
}

@Composable
private fun ErrorRow(error: String, onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp).clip(RoundedCornerShape(16.dp))
            .background(Color(0x1FDC2626)).padding(horizontal = 14.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(error, color = Color(0xFFB91C1C), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = onRetry) { Text("Retry", color = Oyee.colors.foreground) }
    }
}

@Composable
private fun EmptyState(state: InboxUiState) {
    val c = Oyee.colors
    // Inside PullToRefreshBox the content must be scrollable for the gesture to work.
    LazyColumn(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        item {
            Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(Modifier.height(72.dp))
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(c.chip), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Done, contentDescription = null, tint = c.chipForeground)
                }
                Spacer(Modifier.height(14.dp))
                Text(
                    when {
                        state.error != null -> "Couldn't load notifications"
                        state.filters.isActive -> "Nothing matches these filters"
                        else -> "No notifications yet"
                    },
                    style = MaterialTheme.typography.titleLarge,
                    color = c.foreground,
                )
                Spacer(Modifier.height(6.dp))
                Text(
                    state.error ?: "Send one with a webhook or an MCP tool and it shows up here instantly.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.muted,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
