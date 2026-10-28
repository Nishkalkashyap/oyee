package app.oyee.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import app.oyee.android.model.Severity
import app.oyee.android.util.Formatting

fun severityColor(s: Severity): Color = when (s) {
    Severity.CRITICAL -> Color(0xFFDC2626)
    Severity.WARNING -> Color(0xFFD97706)
    Severity.INFO -> Color(0xFF3B82F6)
    Severity.SUCCESS -> Color(0xFF16A34A)
    Severity.DEBUG -> Color(0xFFA8A39A)
}

fun severityIcon(s: Severity): ImageVector = when (s) {
    Severity.CRITICAL, Severity.WARNING -> Icons.Filled.Warning
    Severity.INFO -> Icons.Filled.Info
    Severity.SUCCESS -> Icons.Filled.CheckCircle
    Severity.DEBUG -> Icons.Filled.Build
}

fun severityLabel(s: Severity): String = s.wire.replaceFirstChar { it.uppercase() }

/** Round badge: the notification's emoji/URL icon if set, otherwise the severity icon, tinted by severity. */
@Composable
fun SeverityBadge(severity: Severity, icon: String?, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    val color = severityColor(severity)
    Box(
        modifier = modifier.size(size).clip(CircleShape).background(color.copy(alpha = 0.15f)),
        contentAlignment = Alignment.Center,
    ) {
        when {
            icon != null && Formatting.isUrlIcon(icon) -> AsyncImage(
                model = icon,
                contentDescription = null,
                modifier = Modifier.size(size * 0.7f).clip(CircleShape),
            )
            !icon.isNullOrBlank() && icon.length <= 8 -> Text(icon, fontSize = (size.value * 0.5f).sp)
            else -> Icon(severityIcon(severity), contentDescription = severityLabel(severity), tint = color, modifier = Modifier.size(size * 0.6f))
        }
    }
}
