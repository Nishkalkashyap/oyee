package dev.herald.android.ui.detail

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
import dev.herald.android.model.Action
import dev.herald.android.model.ActionStyle
import dev.herald.android.model.Notification
import dev.herald.android.ui.components.MarkdownText
import dev.herald.android.ui.components.SeverityBadge
import dev.herald.android.ui.components.severityColor
import dev.herald.android.ui.components.severityLabel
import dev.herald.android.util.Formatting

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailScreen(vm: DetailViewModel, onBack: () -> Unit) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var confirmDelete by remember { mutableStateOf(false) }

    LaunchedEffect(state.toast) {
        state.toast?.let { snackbar.showSnackbar(it); vm.consumeToast() }
    }
    LaunchedEffect(state.deleted) { if (state.deleted) onBack() }

    val n = state.notification
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(n?.source ?: "") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    if (n != null) {
                        if (!n.isRead) IconButton(onClick = vm::markRead, enabled = !state.busy) { Icon(Icons.Filled.Done, contentDescription = "Mark read") }
                        if (!n.isResolved) IconButton(onClick = vm::resolve, enabled = !state.busy) { Icon(Icons.Filled.Check, contentDescription = "Resolve") }
                        IconButton(onClick = { confirmDelete = true }, enabled = !state.busy) { Icon(Icons.Filled.Delete, contentDescription = "Delete") }
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize().imePadding()) {
            when {
                n != null -> Card(n, state, vm)
                state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                else -> Column(Modifier.align(Alignment.Center).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(state.error ?: "Not found", color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = vm::load) { Text("Retry") }
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete notification?") },
            text = { Text("It's removed from every device.") },
            confirmButton = { TextButton(onClick = { confirmDelete = false; vm.delete() }) { Text("Delete") } },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Card(n: Notification, state: DetailUiState, vm: DetailViewModel) {
    val context = LocalContext.current
    fun open(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
    val sevColor = severityColor(n.severity)

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Header
        Row(verticalAlignment = Alignment.CenterVertically) {
            SeverityBadge(n.severity, n.icon, size = 48.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(n.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    listOfNotNull(severityLabel(n.severity), Formatting.absolute(n.createdAt), n.threadId?.let { "thread $it" }).joinToString(" · "),
                    style = MaterialTheme.typography.labelMedium,
                    color = sevColor,
                )
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AssistChip(onClick = {}, label = { Text(if (n.isResolved) "Resolved" else "Active") })
            if (!n.isRead) AssistChip(onClick = {}, label = { Text("Unread") })
            n.tags.forEach { AssistChip(onClick = {}, label = { Text("#$it") }) }
        }

        n.image?.let { img ->
            AsyncImage(
                model = img,
                contentDescription = null,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp).clip(RoundedCornerShape(12.dp)),
            )
        }

        n.body?.takeIf { it.isNotBlank() }?.let { MarkdownText(it, style = MaterialTheme.typography.bodyLarge) }

        n.progress?.let { p ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (p.indeterminate) {
                    LinearProgressIndicator(Modifier.fillMaxWidth(), color = sevColor)
                } else {
                    LinearProgressIndicator(
                        progress = { if (p.max > 0) (p.value / p.max).toFloat().coerceIn(0f, 1f) else 0f },
                        modifier = Modifier.fillMaxWidth(),
                        color = sevColor,
                    )
                }
                Text(Formatting.progressLabel(p), style = MaterialTheme.typography.labelMedium)
            }
        }

        if (n.fields.isNotEmpty()) {
            Column {
                n.fields.forEachIndexed { i, f ->
                    if (i > 0) HorizontalDivider()
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Text(f.label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.4f))
                        Text(f.value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(0.6f))
                    }
                }
            }
        }

        n.url?.let { url -> OutlinedButton(onClick = { open(url) }) { Text("Open link") } }

        if (n.actions.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                n.actions.forEach { a -> ActionButton(a, enabled = !state.busy && (a.url != null || !n.isResolved)) {
                    if (a.url != null) {
                        open(a.url)
                        if (!n.isRead) vm.markRead()
                    } else {
                        vm.respond(a.id, a.label)
                    }
                } }
            }
        }

        n.reply?.takeIf { !n.isResolved }?.let { reply ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = state.replyText,
                    onValueChange = vm::onReplyText,
                    placeholder = { Text(reply.placeholder ?: "Reply…") },
                    modifier = Modifier.weight(1f),
                    enabled = !state.busy,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { vm.sendReply() }),
                )
                Spacer(Modifier.width(8.dp))
                if (reply.buttonLabel != null) {
                    Button(onClick = vm::sendReply, enabled = !state.busy && state.replyText.isNotBlank()) { Text(reply.buttonLabel) }
                } else {
                    IconButton(onClick = vm::sendReply, enabled = !state.busy && state.replyText.isNotBlank()) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send")
                    }
                }
            }
        }

        if (n.responses.isNotEmpty()) {
            Text("Responses", style = MaterialTheme.typography.titleSmall)
            n.responses.asReversed().forEach { r ->
                val what = buildList {
                    r.actionId?.let { aid -> add(n.actions.firstOrNull { it.id == aid }?.label ?: aid) }
                    r.text?.let { add("“$it”") }
                }.joinToString(" · ")
                Column {
                    Text(what, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        listOfNotNull(r.deviceName, Formatting.absolute(r.at)).joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        n.resolvedAt?.let {
            Text("Resolved ${Formatting.absolute(it)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ActionButton(a: Action, enabled: Boolean, onClick: () -> Unit) {
    val label = if (a.url != null) "${a.label} ↗" else a.label
    when (a.style) {
        ActionStyle.PRIMARY -> Button(onClick = onClick, enabled = enabled) { Text(label) }
        ActionStyle.DESTRUCTIVE -> Button(
            onClick = onClick,
            enabled = enabled,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
        ) { Text(label) }
        ActionStyle.DEFAULT -> FilledTonalButton(onClick = onClick, enabled = enabled) { Text(label) }
    }
}
