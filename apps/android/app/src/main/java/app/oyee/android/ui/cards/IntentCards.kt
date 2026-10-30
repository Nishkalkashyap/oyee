package app.oyee.android.ui.cards

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import app.oyee.android.model.AskState
import app.oyee.android.model.Notification
import app.oyee.android.model.ProgressState
import app.oyee.android.ui.components.InkProgress
import app.oyee.android.ui.components.MarkdownText
import app.oyee.android.ui.components.PillButton
import app.oyee.android.ui.components.PillVariant
import app.oyee.android.ui.components.SeverityBadge
import app.oyee.android.ui.components.SeverityPill
import app.oyee.android.ui.theme.Oyee
import app.oyee.android.util.Formatting
import coil3.compose.AsyncImage
import java.time.Instant

/*
 * One purpose-built card per intent (spec "Clients", docs/design.md), drawn as the sender's bubble in the
 * conversation view. The wording comes from the pure views in CardViews.kt; these only lay it out.
 */

private val Amber = Color(0xFFD97706)
private val Green = Color(0xFF16A34A)

/** Bar and pill colour for a progress tone: ink while running, the outcome's colour once ended, faint when stopped. */
@Composable
fun toneColor(tone: ProgressTone): Color = when (tone) {
    ProgressTone.INK -> Oyee.colors.foreground
    ProgressTone.SUCCESS -> Green
    ProgressTone.WARNING -> Amber
    ProgressTone.MUTED -> Oyee.colors.faint
}

/** The sender's bubble: white on the warm thread ground, squared bottom-left corner. */
@Composable
private fun Bubble(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.padding(end = 28.dp).fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomEnd = 22.dp, bottomStart = 6.dp))
            .background(Oyee.colors.bubble).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

/** Soft rounded state pill ("● Waiting 12m", "✓ Answered: Approve · Pixel 9"). */
@Composable
fun StatePill(text: String, fill: Color, ink: Color, leading: (@Composable () -> Unit)? = null) {
    Row(
        Modifier.height(24.dp).clip(CircleShape).background(fill).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        leading?.invoke()
        Text(text, color = ink, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Dot(color: Color) = Box(Modifier.size(6.dp).clip(CircleShape).background(color))

@Composable
private fun ResolvedPill() {
    val c = Oyee.colors
    StatePill("Resolved", fill = c.foreground, ink = c.background) {
        Icon(Icons.Filled.Check, contentDescription = null, tint = c.background, modifier = Modifier.size(12.dp))
    }
}

@Composable
private fun OpenLink(url: String, onOpenUrl: (String) -> Unit) {
    Text(
        "↗ ${url.toUri().host ?: url}",
        style = MaterialTheme.typography.labelLarge,
        color = Oyee.colors.foreground,
        textDecoration = TextDecoration.Underline,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.clickable { onOpenUrl(url) },
    )
}

@Composable
private fun Footer(footer: (@Composable () -> Unit)?) {
    if (footer == null) return
    // The card's own control, under a hairline so it doesn't read as one of the sender's buttons.
    HorizontalDivider(color = Oyee.colors.border, modifier = Modifier.padding(top = 4.dp))
    footer()
}

@Composable
private fun Title(text: String, color: Color = Oyee.colors.foreground) =
    Text(text, style = MaterialTheme.typography.titleLarge, color = color)

@Composable
private fun Body(text: String?) {
    text?.takeIf { it.isNotBlank() }?.let { MarkdownText(it, style = MaterialTheme.typography.bodyLarge.copy(color = Oyee.colors.secondaryLabel)) }
}

/** Inform: icon and severity pill, the title, the markdown body, an image, label/value rows and up to three links. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun InformCard(n: Notification, onOpenUrl: (String) -> Unit, footer: (@Composable () -> Unit)? = null) {
    val c = Oyee.colors
    val v = informView(n)
    Bubble {
        Row(verticalAlignment = Alignment.CenterVertically) {
            SeverityBadge(
                v.severity,
                icon = when (val i = v.icon) {
                    is InformIcon.Emoji -> i.text
                    is InformIcon.Image -> i.url
                    null -> null
                },
            )
            Spacer(Modifier.width(10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SeverityPill(v.severity)
                if (v.resolved) ResolvedPill()
            }
        }
        Title(n.title)
        Body(n.body)
        v.image?.let { img ->
            AsyncImage(
                model = img,
                contentDescription = null,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp).clip(RoundedCornerShape(16.dp)),
            )
        }
        if (v.rows.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card).padding(horizontal = 14.dp, vertical = 4.dp)) {
                v.rows.forEachIndexed { i, r ->
                    if (i > 0) HorizontalDivider(color = c.border)
                    Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.Top) {
                        Text(r.label, style = MaterialTheme.typography.bodyMedium, color = c.muted, modifier = Modifier.weight(0.4f))
                        Text(r.value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = c.foreground, modifier = Modifier.weight(0.6f))
                    }
                }
            }
        }
        if (v.links.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                v.links.forEachIndexed { i, l ->
                    PillButton(onClick = { onOpenUrl(l.url) }, variant = if (i == 0) PillVariant.Primary else PillVariant.Secondary) {
                        Text("${l.label} ↗")
                    }
                }
            }
        }
        n.url?.let { OpenLink(it, onOpenUrl) }
        Footer(footer)
    }
}

/**
 * Ask: a status pill that says how long it has waited (and when it expires) or who answered it, the question, and its
 * answer buttons. Once answered, expired or withdrawn nothing is pressable; a closed, unanswered ask is muted and says
 * why it can't be answered. The reply box is the conversation's composer.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AskCard(
    n: Notification,
    onAnswer: (String) -> Unit,
    onOpenUrl: (String) -> Unit,
    busy: Boolean = false,
    now: Instant = Instant.now(),
    footer: (@Composable () -> Unit)? = null,
) {
    val c = Oyee.colors
    val v = askView(n, now)
    // Closed without an answer: the question reads as history, not as something waiting on the user.
    val closed = v.state == AskState.EXPIRED || v.state == AskState.WITHDRAWN
    Bubble {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            when {
                v.open -> StatePill(v.status, fill = Amber.copy(alpha = 0.13f), ink = Amber) { Dot(Amber) }
                v.state == AskState.ANSWERED -> StatePill(v.status, fill = c.foreground, ink = c.background) {
                    Icon(Icons.Filled.Check, contentDescription = null, tint = c.background, modifier = Modifier.size(12.dp))
                }
                else -> StatePill(v.status, fill = c.secondary, ink = c.muted)
            }
            v.expiry?.let { Text("◷ $it", style = MaterialTheme.typography.labelMedium, color = c.muted) }
        }
        Title(n.title, color = if (closed) c.muted else c.foreground)
        Body(n.body)
        n.url?.let { OpenLink(it, onOpenUrl) }
        if (v.options.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                v.options.forEachIndexed { i, o ->
                    PillButton(
                        onClick = { if (v.open) onAnswer(o.label) },
                        variant = if (o.chosen || (v.open && i == 0)) PillVariant.Primary else PillVariant.Secondary,
                        // The chosen answer stays solid so the record reads clearly; everything else is inert once closed.
                        enabled = (v.open && !busy) || o.chosen,
                    ) {
                        if (o.chosen) Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                        Text(o.label)
                    }
                }
            }
        }
        v.note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.muted) }
        Footer(footer)
    }
}

/** The progress pill: a live dot while running, ✓ when done, ⚠ when it failed or stopped reporting. */
@Composable
fun ProgressStatePill(v: ProgressView) {
    val color = toneColor(v.tone)
    val (fill, ink) = when (v.tone) {
        ProgressTone.INK -> Oyee.colors.secondary to Oyee.colors.secondaryLabel
        ProgressTone.MUTED -> Oyee.colors.secondary to Oyee.colors.muted
        else -> color.copy(alpha = 0.13f) to color
    }
    StatePill(v.stateLabel, fill = fill, ink = ink) {
        when (v.state) {
            ProgressState.RUNNING -> Dot(Oyee.colors.foreground)
            ProgressState.DONE -> Icon(Icons.Filled.Check, contentDescription = null, tint = ink, modifier = Modifier.size(12.dp))
            else -> Icon(Icons.Filled.Warning, contentDescription = null, tint = ink, modifier = Modifier.size(12.dp))
        }
    }
}

/** Progress: state pill, title, a real bar with its amount, and when it last reported. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProgressCard(n: Notification, onOpenUrl: (String) -> Unit, footer: (@Composable () -> Unit)? = null) {
    val c = Oyee.colors
    val p = n.progress ?: return
    val v = progressView(p)
    val ended = v.state != ProgressState.RUNNING
    Bubble {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ProgressStatePill(v)
            if (n.isResolved) ResolvedPill()
        }
        Title(n.title)
        Body(n.body)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(v.amount, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
                Text(
                    when {
                        !ended -> "${Math.round(v.percent)}%"
                        v.state == ProgressState.STOPPED -> "Last report ${Formatting.relative(p.lastReportAt)}"
                        else -> "Ended ${Formatting.relative(p.lastReportAt)}"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = c.muted,
                )
            }
            InkProgress(p, color = toneColor(v.tone), height = 8.dp)
            if (!ended) Text("Updated ${Formatting.relative(p.lastReportAt ?: n.updatedAt)}", style = MaterialTheme.typography.bodySmall, color = c.muted)
            if (v.state == ProgressState.STOPPED) {
                Text(
                    "No report for over ${p.staleAfter ?: "a while"}. It picks up again if ${n.source} reports.",
                    style = MaterialTheme.typography.bodySmall,
                    color = c.secondaryLabel,
                )
            }
        }
        n.url?.let { OpenLink(it, onOpenUrl) }
        Footer(footer)
    }
}
