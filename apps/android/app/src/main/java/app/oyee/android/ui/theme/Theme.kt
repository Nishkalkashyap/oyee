package app.oyee.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import app.oyee.android.R

/** Oyee's design tokens: Gluon's warm paper palette (docs/design.md). */
@Immutable
data class OyeeColors(
    val ground: Color,
    val background: Color,
    val foreground: Color,
    val card: Color,
    val brand: Color,
    val brandForeground: Color,
    val chip: Color,
    val chipForeground: Color,
    val thread: Color,
    val bubble: Color,
    val secondary: Color,
    val accent: Color,
    val muted: Color,
    val faint: Color,
    val border: Color,
    val rowSelected: Color,
    val secondaryLabel: Color,
    // Severity (docs/design.md), the same in light and dark; res/values/colors.xml mirrors them for system notifications.
    val critical: Color = SeverityColors.critical,
    val warning: Color = SeverityColors.warning,
    val info: Color = SeverityColors.info,
    val success: Color = SeverityColors.success,
)

/** The severity colours of docs/design.md, for code outside composition (also `Oyee.colors.critical` etc.). */
object SeverityColors {
    val critical = Color(0xFFDC2626)
    val warning = Color(0xFFD97706)
    val info = Color(0xFF3B82F6)
    val success = Color(0xFF16A34A)
}

val LightOyee = OyeeColors(
    ground = Color(0xFFF3F2EF), background = Color(0xFFFFFFFF), foreground = Color(0xFF1C1B19),
    card = Color(0xFFF7F6F3), brand = Color(0xFF1F6FEB), brandForeground = Color(0xFFFFFFFF),
    chip = Color(0xFFDDE9FB), chipForeground = Color(0xFF1E4E9A), thread = Color(0xFFF7F4EF),
    bubble = Color(0xFFFFFFFF), secondary = Color(0xFFF3F2EF), accent = Color(0xFFE9E5DE),
    muted = Color(0xFF6B675F), faint = Color(0xFFA8A39A), border = Color(0xFFECE9E3),
    rowSelected = Color(0xFFECE9E3), secondaryLabel = Color(0xFF44403C),
)

val DarkOyee = OyeeColors(
    ground = Color(0xFF131211), background = Color(0xFF1E1C1A), foreground = Color(0xFFF1EDE6),
    card = Color(0xFF262421), brand = Color(0xFF58A6FF), brandForeground = Color(0xFF0D1B2E),
    chip = Color(0xFF16294A), chipForeground = Color(0xFFA9C9F7), thread = Color(0xFF181614),
    bubble = Color(0xFF2B2825), secondary = Color(0xFF2B2825), accent = Color(0xFF35312D),
    muted = Color(0xFFA39D92), faint = Color(0xFF6E685F), border = Color(0xFF302D29),
    rowSelected = Color(0xFF35312D), secondaryLabel = Color(0xFFD6D0C6),
)

val LocalOyeeColors = staticCompositionLocalOf { LightOyee }

/** `Oyee.colors` inside composables. */
object Oyee {
    val colors: OyeeColors
        @Composable get() = LocalOyeeColors.current
}

/** Figtree (variable font, OFL) at each weight we use. */
@OptIn(ExperimentalTextApi::class)
val Figtree = FontFamily(
    listOf(400, 500, 600, 700, 800).map { w ->
        Font(R.font.figtree, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
    },
)

private fun style(size: Int, weight: Int, line: Int, tracking: Double = 0.0) =
    TextStyle(fontFamily = Figtree, fontWeight = FontWeight(weight), fontSize = size.sp, lineHeight = line.sp, letterSpacing = tracking.sp)

private val OyeeTypography = Typography(
    displaySmall = style(30, 800, 36, -1.0),
    headlineLarge = style(30, 800, 36, -1.0),
    headlineMedium = style(26, 800, 32, -0.8),
    headlineSmall = style(22, 700, 28, -0.4),
    titleLarge = style(18, 700, 24, -0.3),
    titleMedium = style(15, 600, 21),
    titleSmall = style(14, 600, 20),
    bodyLarge = style(15, 400, 22),
    bodyMedium = style(14, 400, 20),
    bodySmall = style(12, 400, 16),
    labelLarge = style(14, 500, 20),
    labelMedium = style(12, 600, 16),
    labelSmall = style(11, 500, 14),
)

@Composable
fun OyeeTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val h = if (darkTheme) DarkOyee else LightOyee
    // Material components read these; Oyee screens use Oyee.colors directly.
    val scheme = if (darkTheme) {
        darkColorScheme(
            primary = h.brand, onPrimary = h.brandForeground, secondary = h.foreground, onSecondary = h.background,
            background = h.background, onBackground = h.foreground, surface = h.background, onSurface = h.foreground,
            surfaceVariant = h.secondary, onSurfaceVariant = h.muted, surfaceContainer = h.card,
            surfaceContainerHigh = h.card, surfaceContainerHighest = h.secondary, outline = h.border,
            outlineVariant = h.border, secondaryContainer = h.chip, onSecondaryContainer = h.chipForeground,
        )
    } else {
        lightColorScheme(
            primary = h.brand, onPrimary = h.brandForeground, secondary = h.foreground, onSecondary = h.background,
            background = h.background, onBackground = h.foreground, surface = h.background, onSurface = h.foreground,
            surfaceVariant = h.secondary, onSurfaceVariant = h.muted, surfaceContainer = h.card,
            surfaceContainerHigh = h.card, surfaceContainerHighest = h.secondary, outline = h.border,
            outlineVariant = h.border, secondaryContainer = h.chip, onSecondaryContainer = h.chipForeground,
        )
    }
    CompositionLocalProvider(LocalOyeeColors provides h) {
        MaterialTheme(colorScheme = scheme, typography = OyeeTypography, content = content)
    }
}
