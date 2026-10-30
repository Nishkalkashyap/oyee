package app.oyee.android.ui.detail

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Done
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import app.oyee.android.model.Action
import app.oyee.android.model.ActionStyle
import app.oyee.android.model.Notification
import app.oyee.android.ui.components.Composer
import app.oyee.android.ui.components.InkProgress
import app.oyee.android.ui.components.MarkdownText
import app.oyee.android.ui.components.PillButton
import app.oyee.android.ui.components.PillVariant
import app.oyee.android.ui.components.SeverityPill
import app.oyee.android.ui.components.SourceAvatar
import app.oyee.android.ui.components.SystemLine
import app.oyee.android.ui.theme.Oyee
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
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
                                listOfNotNull(
                                    n.targetDeviceIds?.let { if (it.size == 1) "Sent to 1 device" else "Sent to ${it.size} devices" } ?: "All devices",
                                    n.threadId,
                                ).joinToString(" · "),
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
            n?.reply?.takeIf { !n.isResolved }?.let { reply ->
                Composer(
                    value = state.replyText,
                    onValueChange = vm::onReplyText,
                    placeholder = reply.placeholder ?: "Reply to ${n.source}…",
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

/** The agent's card as a bubble, quiet update lines, and your answers as light-blue bubbles on the right. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Conversation(n: Notification, state: DetailUiState, vm: DetailViewModel) {
    val context = LocalContext.current
    val c = Oyee.colors
    fun open(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        SystemLine(Formatting.absolute(n.createdAt))
        Column(
            Modifier.padding(end = 28.dp).fillMaxWidth()
                .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 22.dp, bottomStart = 6.dp))
                .background(c.bubble).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SeverityPill(n.severity)
                if (n.isResolved) {
                    Box(Modifier.height(24.dp).clip(CircleShape).background(c.foreground).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                        Text("✓ Resolved", color = c.background, style = MaterialTheme.typography.labelMedium)
                    }
                }
                n.tags.forEach { tag ->
                    Box(Modifier.height(24.dp).clip(CircleShape).background(c.secondary).padding(horizontal = 10.dp), contentAlignment = Alignment.Center) {
                        Text("#$tag", color = c.secondaryLabel, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
            Text(n.title, style = MaterialTheme.typography.titleLarge, color = c.foreground)
            n.body?.takeIf { it.isNotBlank() }?.let {
                MarkdownText(it, style = MaterialTheme.typography.bodyLarge.copy(color = c.secondaryLabel))
            }
            n.image?.let { img ->
                AsyncImage(
                    model = img,
                    contentDescription = null,
                    contentScale = ContentScale.FillWidth,
                    modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp).clip(RoundedCornerShape(16.dp)),
                )
            }
            if (n.fields.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    n.fields.forEach { f ->
                        Row {
                            Text(f.label, style = MaterialTheme.typography.bodyMedium, color = c.muted, modifier = Modifier.weight(0.38f))
                            Text(f.value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = c.foreground, modifier = Modifier.weight(0.62f))
                        }
                    }
                }
            }
            n.progress?.let { p ->
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    InkProgress(p)
                    Text(Formatting.progressLabel(p), style = MaterialTheme.typography.bodySmall, color = c.muted)
                }
            }
            n.url?.let { url ->
                Text(
                    "↗ ${url.toUri().host ?: url}",
                    style = MaterialTheme.typography.labelLarge,
                    color = c.foreground,
                    textDecoration = TextDecoration.Underline,
                    modifier = Modifier.clickable { open(url) },
                )
            }
            if (n.actions.isNotEmpty() && !n.isResolved) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    n.actions.forEach { a ->
                        PillButton(
                            onClick = {
                                if (a.url != null) {
                                    open(a.url)
                                    if (!n.isRead) vm.markRead()
                                } else {
                                    vm.respond(a.id, a.label)
                                }
                            },
                            variant = when (a.style) {
                                ActionStyle.PRIMARY -> PillVariant.Primary
                                ActionStyle.DESTRUCTIVE -> PillVariant.Destructive
                                ActionStyle.DEFAULT -> PillVariant.Secondary
                            },
                            enabled = !state.busy,
                        ) { Text(if (a.url != null) "${a.label} ↗" else a.label) }
                    }
                }
            }
            if (!n.isResolved) {
                // The card's own control, under a hairline so it doesn't read as one of the agent's buttons.
                HorizontalDivider(color = c.border, modifier = Modifier.padding(top = 4.dp))
                PillButton(onClick = vm::resolve, variant = PillVariant.Primary, enabled = !state.busy, height = 34.dp) {
                    Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text("Resolve")
                }
            }
        }
        if (n.version > 1 && n.updatedAt != n.createdAt) SystemLine("Updated ${Formatting.relative(n.updatedAt)} · v${n.version}")
        n.responses.forEach { r ->
            val label = r.actionId?.let { aid -> n.actions.firstOrNull { it.id == aid }?.label ?: aid }
            Column(Modifier.fillMaxWidth().padding(start = 56.dp), horizontalAlignment = Alignment.End) {
                Text(
                    listOfNotNull(label, r.text).joinToString(" · "),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (r.text == null) FontWeight.SemiBold else FontWeight.Normal,
                    color = c.foreground,
                    modifier = Modifier
                        .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 6.dp, bottomStart = 22.dp))
                        .background(c.chip).padding(horizontal = 14.dp, vertical = 10.dp),
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    listOfNotNull(r.deviceName, Formatting.relative(r.at)).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = c.muted,
                )
            }
        }
        n.resolvedAt?.let { SystemLine("✓ Resolved ${Formatting.relative(it)}") }
    }
}
