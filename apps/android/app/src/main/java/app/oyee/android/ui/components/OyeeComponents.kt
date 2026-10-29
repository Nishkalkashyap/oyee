package app.oyee.android.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.oyee.android.R
import app.oyee.android.model.Progress
import app.oyee.android.model.Severity
import app.oyee.android.ui.theme.Oyee

// Pastel avatar fills with matching ink, picked by hashing the name (same palette and hash as web and macOS).
private val Tints = listOf(
    Color(0xFFE4E8EF) to Color(0xFF334155),
    Color(0xFFD5F0EC) to Color(0xFF0F5F57),
    Color(0xFFE2ECFB) to Color(0xFF1E4E9A),
    Color(0xFFE3F2E1) to Color(0xFF2F6B2A),
    Color(0xFFF9D3DE) to Color(0xFF9D174D),
    Color(0xFFEDE4F7) to Color(0xFF5B21B6),
)

fun avatarTint(name: String): Pair<Color, Color> {
    var hash = 0
    name.codePoints().forEach { hash = hash * 31 + it }
    return Tints[Math.floorMod(hash, Tints.size)]
}

/** The brand tile: the Oyee mark (an "o" speech bubble with an unread dot) in white on blue. */
@Composable
fun BrandMark(size: Dp = 28.dp) {
    Box(
        Modifier.size(size).clip(RoundedCornerShape(size * 0.3f)).background(Oyee.colors.brand),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painterResource(R.drawable.ic_oyee_mark),
            contentDescription = null,
            tint = Oyee.colors.brandForeground,
            modifier = Modifier.size(size * 0.62f),
        )
    }
}

/** Round avatar with the name's initial in its tint, plus an optional severity dot. */
@Composable
fun SourceAvatar(name: String, size: Dp = 44.dp, severity: Severity? = null, modifier: Modifier = Modifier) {
    val (fill, ink) = avatarTint(name)
    Box(modifier.size(size)) {
        Box(Modifier.size(size).clip(CircleShape).background(fill), contentAlignment = Alignment.Center) {
            Text(
                (name.firstOrNull { it.isLetterOrDigit() } ?: '?').uppercase(),
                color = ink,
                fontWeight = FontWeight.Bold,
                fontSize = (size.value * 0.4f).sp,
                style = MaterialTheme.typography.titleMedium,
            )
        }
        if (severity != null && severity != Severity.DEBUG) {
            Box(
                Modifier.align(Alignment.BottomEnd).offset(x = 1.dp, y = 1.dp).size(size * 0.3f)
                    .clip(CircleShape).background(Oyee.colors.background).padding(2.5.dp)
                    .clip(CircleShape).background(severityColor(severity)),
            )
        }
    }
}

enum class PillVariant { Primary, Brand, Secondary, Ghost, Destructive }

/** Gluon's pill buttons: ink primary, blue brand, soft secondary, quiet ghost. Gives a little when pressed. */
@Composable
fun PillButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: PillVariant = PillVariant.Secondary,
    enabled: Boolean = true,
    height: Dp = 36.dp,
    content: @Composable RowScope.() -> Unit,
) {
    val c = Oyee.colors
    val (fill, ink) = when (variant) {
        PillVariant.Primary -> c.foreground to c.background
        PillVariant.Brand -> c.brand to c.brandForeground
        PillVariant.Secondary -> c.secondary to c.foreground
        PillVariant.Ghost -> Color.Transparent to c.secondaryLabel
        PillVariant.Destructive -> Color(0x1FDC2626) to Color(0xFFDC2626)
    }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        modifier
            .scale(if (pressed) 0.96f else 1f)
            .heightIn(min = height)
            .clip(CircleShape)
            .background(if (enabled) fill else fill.copy(alpha = fill.alpha * 0.5f))
            .clickable(enabled = enabled, interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.runtime.CompositionLocalProvider(
            androidx.compose.material3.LocalContentColor provides if (enabled) ink else ink.copy(alpha = 0.5f),
            androidx.compose.material3.LocalTextStyle provides MaterialTheme.typography.labelLarge,
        ) { content() }
    }
}

/** Single-select pill filter: grey, light-blue when selected. */
@Composable
fun FilterPill(label: String, selected: Boolean, onClick: () -> Unit) {
    val c = Oyee.colors
    Box(
        Modifier.height(34.dp).clip(CircleShape).background(if (selected) c.chip else c.secondary)
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
            color = if (selected) c.chipForeground else c.secondaryLabel,
            maxLines = 1,
        )
    }
}

/** Blue unread count. */
@Composable
fun CountBadge(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    Box(
        modifier.defaultMinSize(minWidth = 20.dp, minHeight = 20.dp).clip(CircleShape).background(Oyee.colors.brand)
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else "$count", color = Oyee.colors.brandForeground, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
    }
}

/** Soft severity pill ("● Warning"). */
@Composable
fun SeverityPill(severity: Severity) {
    val color = severityColor(severity)
    Row(
        Modifier.height(24.dp).clip(CircleShape).background(color.copy(alpha = 0.13f)).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(color))
        Text(severityLabel(severity), color = color, style = MaterialTheme.typography.labelMedium)
    }
}

/** Ink progress bar; indeterminate slides. */
@Composable
fun InkProgress(p: Progress, modifier: Modifier = Modifier, height: Dp = 6.dp) {
    val c = Oyee.colors
    BoxWithConstraints(modifier.fillMaxWidth().height(height).clip(CircleShape).background(c.accent)) {
        if (p.indeterminate) {
            val t = rememberInfiniteTransition(label = "progress")
            val x by t.animateFloat(-0.35f, 1f, infiniteRepeatable(tween(1400, easing = FastOutSlowInEasing), RepeatMode.Restart), label = "x")
            Box(Modifier.offset(x = maxWidth * x).width(maxWidth * 0.35f).fillMaxHeight().clip(CircleShape).background(c.foreground))
        } else {
            val frac = if (p.max > 0) (p.value / p.max).toFloat().coerceIn(0f, 1f) else 0f
            Box(Modifier.width(maxWidth * frac).fillMaxHeight().clip(CircleShape).background(c.foreground))
        }
    }
}

/** A quiet centered line in the conversation (timestamps, updates, resolution). */
@Composable
fun SystemLine(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier.fillMaxWidth().padding(vertical = 4.dp),
        style = MaterialTheme.typography.bodySmall,
        color = Oyee.colors.muted,
        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
    )
}

/** Gluon's composer: a rounded bubble field with a blue round send button. */
@Composable
fun Composer(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    onSend: () -> Unit,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val c = Oyee.colors
    val canSend = enabled && value.isNotBlank()
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.bubble)
            .border(1.dp, c.border, RoundedCornerShape(24.dp)).padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Box(Modifier.weight(1f).padding(vertical = 9.dp)) {
            if (value.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = c.faint)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                enabled = enabled,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = c.foreground),
                cursorBrush = SolidColor(c.brand),
                maxLines = 5,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Box(
            Modifier.size(38.dp).clip(CircleShape).background(if (canSend) c.brand else c.brand.copy(alpha = 0.4f))
                .clickable(enabled = canSend, onClick = onSend),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", tint = c.brandForeground, modifier = Modifier.size(18.dp))
        }
    }
}
