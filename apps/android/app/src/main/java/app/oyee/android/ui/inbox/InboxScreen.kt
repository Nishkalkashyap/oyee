package app.oyee.android.ui.inbox

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.oyee.android.model.ActionStyle
import app.oyee.android.model.Notification
import app.oyee.android.model.NotificationStatus
import app.oyee.android.transport.SocketClient
import app.oyee.android.ui.components.InkProgress
import app.oyee.android.ui.components.PillButton
import app.oyee.android.ui.components.PillVariant
import app.oyee.android.ui.components.SourceAvatar
import app.oyee.android.ui.theme.Oyee
import app.oyee.android.update.AppUpdater
import app.oyee.android.update.UpdateBanner
import app.oyee.android.util.Formatting
import app.oyee.android.util.Markdown
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun InboxScreen(vm: InboxViewModel, onOpen: (String) -> Unit, onSettings: () -> Unit, updater: AppUpdater? = null) {
    val state by vm.state.collectAsStateWithLifecycle()
    val c = Oyee.colors
    val listState = rememberLazyListState()
    val snackbar = remember { SnackbarHostState() }
    val nearEnd by remember {
        derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= listState.layoutInfo.totalItemsCount - 5
        }
    }
    LaunchedEffect(nearEnd, state.nextCursor) { if (nearEnd && state.nextCursor != null) vm.loadMore() }
    LaunchedEffect(state.toast) { state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() } }

    val activeView = state.filters.status == NotificationStatus.ACTIVE
    val resolvedView = state.filters.status == NotificationStatus.RESOLVED
    BackHandler(enabled = resolvedView) { vm.showResolved(false) }
    val items = state.visibleItems
    val unread = items.count { !it.isRead && !it.isResolved }
    val sections = remember(items, activeView) { if (activeView) inboxSections(items) else flatSections(items) }

    Scaffold(containerColor = c.background, snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            // Gluon's mobile header: large bold title, live state, round buttons. No filter chips: sections do the sorting.
            Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 12.dp, top = 12.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (resolvedView) {
                    RoundButton(Icons.AutoMirrored.Filled.ArrowBack, "Back to inbox") { vm.showResolved(false) }
                    Spacer(Modifier.width(10.dp))
                }
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(if (resolvedView) "Resolved" else "Inbox", style = MaterialTheme.typography.headlineLarge, color = c.foreground)
                        if (activeView && unread > 0) {
                            Spacer(Modifier.width(8.dp))
                            Text("$unread unread", style = MaterialTheme.typography.labelMedium, color = c.brand, modifier = Modifier.padding(bottom = 6.dp))
                        }
                    }
                    ConnectionLabel(state.connection)
                }
                if (activeView && unread > 0) {
                    RoundButton(Icons.Filled.Done, "Mark all read", onClick = vm::markAllRead)
                    Spacer(Modifier.width(8.dp))
                }
                RoundButton(Icons.Filled.Settings, "Settings", onClick = onSettings)
            }
            updater?.let { UpdateBanner(it) }
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
                when {
                    state.loading && state.items.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = c.brand)
                    }
                    items.isEmpty() -> EmptyState(state, onShowResolved = { vm.showResolved(true) })
                    else -> LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 6.dp, vertical = 4.dp)) {
                        state.error?.let { err -> item { ErrorRow(err, vm::refresh) } }
                        val titles = sections.size > 1
                        sections.forEach { sec ->
                            if (titles) item(key = "h:${sec.id}") { SectionTitle(sec) }
                            sec.stacks.forEach { st ->
                                val head = st.head
                                val resolve = if (head.status == NotificationStatus.ACTIVE) ({ vm.resolve(st.items) }) else null
                                item(key = "s:${st.key}") {
                                    Column(Modifier.animateItem()) {
                                        SwipeToResolve(resolve, label = if (st.items.size > 1) "Resolve all ${st.items.size}" else "Resolve") {
                                            InboxRow(
                                                head,
                                                count = st.items.size,
                                                unread = st.items.any { !it.isRead && !it.isResolved },
                                                onClick = {
                                                    if (st.items.size > 1) vm.toggleExpanded(st.key)
                                                    onOpen(head.id)
                                                },
                                            )
                                        }
                                        if (sec.id == InboxSectionId.NEEDS_YOU) {
                                            QuickAnswer(head, busy = state.respondingId == head.id, onAnswer = { vm.respond(head, it) }, onReply = { onOpen(head.id) })
                                        }
                                    }
                                }
                                if (st.key in state.expanded) {
                                    items(st.items.drop(1), key = { "c:${it.id}" }) { n ->
                                        Box(Modifier.animateItem().padding(start = 28.dp)) {
                                            SwipeToResolve(if (n.status == NotificationStatus.ACTIVE) ({ vm.resolve(listOf(n)) }) else null) {
                                                InboxRow(n, child = true, onClick = { onOpen(n.id) })
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if (state.loadingMore) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(Modifier.size(24.dp), color = c.brand)
                                }
                            }
                        }
                        if (activeView && state.nextCursor == null) item(key = "resolved") { ResolvedRow { vm.showResolved(true) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun RoundButton(icon: ImageVector, label: String, onClick: () -> Unit) {
    val c = Oyee.colors
    Box(
        Modifier.size(40.dp).clip(CircleShape).background(c.secondary).clickable(onClickLabel = label, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, contentDescription = label, tint = c.secondaryLabel, modifier = Modifier.size(20.dp)) }
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

/** Quiet sentence-case label, with the count for "Needs you". */
@Composable
private fun SectionTitle(sec: InboxSection) {
    val c = Oyee.colors
    Row(Modifier.padding(start = 14.dp, top = 14.dp, bottom = 4.dp)) {
        Text(sec.id.title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = c.muted)
        if (sec.id == InboxSectionId.NEEDS_YOU) {
            Spacer(Modifier.width(6.dp))
            Text("${sec.stacks.size}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = c.brand)
        }
    }
}

/**
 * Drag a row right past the threshold to resolve it (the Mail/Gmail gesture). Vertical scrolling is unaffected, a
 * cancelled drag only snaps back, and screen readers get a "Resolve" action instead of the gesture.
 */
@Composable
private fun SwipeToResolve(onResolve: (() -> Unit)?, label: String = "Resolve", content: @Composable () -> Unit) {
    if (onResolve == null) {
        content()
        return
    }
    val currentOnResolve by rememberUpdatedState(onResolve)
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    val threshold = with(LocalDensity.current) { 96.dp.toPx() }
    val green = Color(0xFF16A34A)
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).semantics {
            customActions = listOf(CustomAccessibilityAction(label) { currentOnResolve(); true })
        },
    ) {
        if (offset.value > 0f) {
            Row(
                Modifier.matchParentSize().background(if (offset.value >= threshold) green else green.copy(alpha = 0.6f)).padding(start = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Done, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("Resolve", color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
            }
        }
        Box(
            Modifier
                .offset { IntOffset(offset.value.roundToInt(), 0) }
                .background(Oyee.colors.background)
                .pointerInput(threshold) {
                    // Unlike draggable's onDragStopped, this tells a finished drag from a cancelled one.
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            scope.launch {
                                if (offset.value >= threshold) currentOnResolve()
                                offset.animateTo(0f)
                            }
                        },
                        onDragCancel = { scope.launch { offset.animateTo(0f) } },
                    ) { change, delta ->
                        change.consume()
                        scope.launch { offset.snapTo((offset.value + delta).coerceAtLeast(0f)) }
                    }
                },
        ) { content() }
    }
}

/**
 * A list row: the source's avatar (a red or amber mark only for critical and warning), title, time and preview.
 * Blue means unread and nothing else. `count` > 1 makes it the head of a stack of repeats.
 */
@Composable
private fun InboxRow(n: Notification, count: Int = 1, unread: Boolean = !n.isRead && !n.isResolved, child: Boolean = false, onClick: () -> Unit) {
    val c = Oyee.colors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SourceAvatar(n.source, size = if (child) 36.dp else 46.dp, severity = n.severity)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        n.title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Medium,
                        color = when {
                            unread -> c.foreground
                            n.isResolved -> c.muted
                            else -> c.secondaryLabel
                        },
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (count > 1) {
                        Spacer(Modifier.width(6.dp))
                        Box(Modifier.clip(CircleShape).background(c.secondary).padding(horizontal = 7.dp, vertical = 1.dp)) {
                            Text("$count", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = c.muted)
                        }
                    }
                }
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
                    when {
                        child -> preview ?: n.source
                        preview != null -> "${n.source} · $preview"
                        else -> n.source
                    },
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

/** A question's buttons right in the list, so answering doesn't need a detour through the conversation. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuickAnswer(n: Notification, busy: Boolean, onAnswer: (app.oyee.android.model.Action) -> Unit, onReply: () -> Unit) {
    FlowRow(
        Modifier.fillMaxWidth().padding(start = 70.dp, end = 12.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        n.actions.filter { it.url == null }.forEachIndexed { i, a ->
            PillButton(
                onClick = { onAnswer(a) },
                variant = when {
                    a.style == ActionStyle.DESTRUCTIVE -> PillVariant.Destructive
                    i == 0 -> PillVariant.Primary
                    else -> PillVariant.Secondary
                },
                enabled = !busy,
                height = 32.dp,
            ) { Text(a.label) }
        }
        if (n.reply != null) {
            PillButton(onClick = onReply, height = 32.dp) { Text("↩ Reply") }
        }
    }
}

@Composable
private fun ResolvedRow(onClick: () -> Unit) {
    val c = Oyee.colors
    Row(
        Modifier.fillMaxWidth().padding(top = 6.dp).clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Resolved", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = c.muted, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = c.muted)
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
private fun EmptyState(state: InboxUiState, onShowResolved: () -> Unit) {
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
                val error = state.error
                val caughtUp = state.filters.status == NotificationStatus.ACTIVE && state.sources.any { it.count > 0 }
                val (title, message) = when {
                    error != null -> "Couldn't load notifications" to error
                    state.filters.isNarrowed -> "Nothing matches" to "Try another filter."
                    state.filters.status == NotificationStatus.RESOLVED ->
                        "Nothing resolved yet" to "Notifications you resolve move here, out of your inbox."
                    caughtUp -> "All caught up" to "Nothing needs your attention."
                    else -> "No notifications yet" to "Send one with a webhook or an MCP tool and it shows up here instantly."
                }
                Text(title, style = MaterialTheme.typography.titleLarge, color = c.foreground)
                Spacer(Modifier.height(6.dp))
                Text(message, style = MaterialTheme.typography.bodyMedium, color = c.muted, textAlign = TextAlign.Center)
                if (caughtUp && error == null && !state.filters.isNarrowed) {
                    Spacer(Modifier.height(18.dp))
                    PillButton(onClick = onShowResolved) { Text("View resolved") }
                }
            }
        }
    }
}
