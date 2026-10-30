package app.oyee.android.ui.detail

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.oyee.android.model.Intent as NotificationIntent
import app.oyee.android.model.Notification
import app.oyee.android.ui.cards.AskCard
import app.oyee.android.ui.cards.InformCard
import app.oyee.android.ui.cards.ProgressCard
import app.oyee.android.ui.cards.askView
import app.oyee.android.ui.components.Composer
import app.oyee.android.ui.components.PillButton
import app.oyee.android.ui.components.PillVariant
import app.oyee.android.ui.components.SourceAvatar
import app.oyee.android.ui.components.SystemLine
import app.oyee.android.ui.theme.Oyee
import app.oyee.android.util.Formatting

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(vm: DetailViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var confirmDelete by remember { mutableStateOf(false) }
    val c = Oyee.colors

    LaunchedEffect(state.toast) {
        state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() }
    }
    LaunchedEffect(state.deleted) { if (state.deleted) onBack() }
    // Resolving from the conversation goes back to the list, where the next thing is waiting.
    LaunchedEffect(state.resolvedHere) { if (state.resolvedHere) onBack() }

    val n = state.notification
    Scaffold(
        containerColor = c.thread,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            // Header: back, who sent it and where it went, delete. Resolve sits on the card, next to what you just read.
            Column(Modifier.background(c.background).statusBarsPadding()) {
                Row(Modifier.fillMaxWidth().height(62.dp).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = c.secondaryLabel) }
                    if (n != null) {
                        SourceAvatar(n.source, size = 34.dp)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(n.source, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = c.foreground, maxLines = 1)
                            Text(
                                n.targetDeviceIds?.let { if (it.size == 1) "Sent to 1 device" else "Sent to ${it.size} devices" } ?: "All devices",
                                style = MaterialTheme.typography.bodySmall,
                                color = c.muted,
                                maxLines = 1,
                            )
                        }
                        IconButton(onClick = { confirmDelete = true }, enabled = !state.busy) {
                            Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = c.secondaryLabel)
                        }
                    } else {
                        Spacer(Modifier.weight(1f))
                    }
                }
                HorizontalDivider(color = c.border)
            }
        },
        bottomBar = {
            // An open ask that takes text: the reply box is the conversation's composer.
            n?.takeIf { it.intent == NotificationIntent.ASK }?.let { askView(it).replyPlaceholder }?.let { placeholder ->
                Composer(
                    value = state.replyText,
                    onValueChange = vm::onReplyText,
                    placeholder = placeholder,
                    onSend = vm::sendReply,
                    enabled = !state.busy,
                    modifier = Modifier.navigationBarsPadding().imePadding().padding(horizontal = 12.dp, vertical = 10.dp),
                )
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                n != null -> Conversation(n, state, vm)
                state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center), color = c.brand)
                else -> Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(state.error ?: "Not found", color = Color(0xFFDC2626))
                    TextButton(onClick = vm::load) { Text("Retry", color = c.foreground) }
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete notification?") },
            text = { Text("It's removed from every device.") },
            confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete() }) { Text("Delete", color = Color(0xFFDC2626)) } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel", color = c.foreground) } },
            containerColor = c.background,
        )
    }
}

/** The sender's card for its intent as a bubble, quiet update lines, and an ask's answer as a light-blue bubble. */
@Composable
private fun Conversation(n: Notification, state: DetailUiState, vm: DetailViewModel) {
    val context = LocalContext.current
    val c = Oyee.colors
    fun open(url: String) {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
        if (!n.isRead) vm.markRead()
    }
    val footer: (@Composable () -> Unit)? = if (n.isResolved) {
        null
    } else {
        {
            PillButton(onClick = vm::resolve, variant = PillVariant.Primary, enabled = !state.busy, height = 34.dp) {
                Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                Text("Resolve")
            }
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SystemLine(Formatting.absolute(n.createdAt))
        when (n.intent) {
            NotificationIntent.INFORM -> InformCard(n, onOpenUrl = ::open, footer = footer)
            NotificationIntent.ASK -> AskCard(n, onAnswer = vm::answer, onOpenUrl = ::open, busy = state.busy, footer = footer)
            NotificationIntent.PROGRESS -> ProgressCard(n, onOpenUrl = ::open, footer = footer)
        }
        if (n.version > 1 && n.updatedAt != n.createdAt) SystemLine("Updated ${Formatting.relative(n.updatedAt)} · v${n.version}")
        n.ask?.answer?.takeIf { n.intent == NotificationIntent.ASK }?.let { a ->
            Column(Modifier.fillMaxWidth().padding(start = 56.dp), horizontalAlignment = Alignment.End) {
                Text(
                    listOfNotNull(a.option, a.text).joinToString(" · "),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (a.text == null) FontWeight.SemiBold else FontWeight.Normal,
                    color = c.foreground,
                    modifier = Modifier
                        .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 6.dp, bottomStart = 22.dp))
                        .background(c.chip).padding(horizontal = 14.dp, vertical = 10.dp),
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    listOfNotNull(a.deviceName, Formatting.relative(a.at)).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = c.muted,
                )
            }
        }
        n.resolvedAt?.let { SystemLine("✓ Resolved ${Formatting.relative(it)}") }
    }
}
