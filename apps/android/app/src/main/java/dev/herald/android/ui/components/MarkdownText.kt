package dev.herald.android.ui.components

import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.graphics.Color
import dev.herald.android.util.Markdown

fun markdownAnnotated(md: String, linkColor: Color, codeBackground: Color): AnnotatedString = buildAnnotatedString {
    for (run in Markdown.parse(md)) {
        val style = SpanStyle(
            fontWeight = if (run.bold) FontWeight.Bold else null,
            fontStyle = if (run.italic) FontStyle.Italic else null,
            fontFamily = if (run.code) FontFamily.Monospace else null,
            background = if (run.code) codeBackground else Color.Unspecified,
        )
        val link = run.link
        if (link != null) {
            withLink(
                LinkAnnotation.Url(
                    link,
                    TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)),
                ),
            ) { withStyle(style) { append(run.text) } }
        } else {
            withStyle(style) { append(run.text) }
        }
    }
}

/** Renders Herald's markdown subset; links are tappable and open in the browser. */
@Composable
fun MarkdownText(
    markdown: String,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    maxLines: Int = Int.MAX_VALUE,
) {
    val linkColor = MaterialTheme.colorScheme.primary
    val codeBg = MaterialTheme.colorScheme.surfaceVariant
    val text = remember(markdown, linkColor, codeBg) { markdownAnnotated(markdown, linkColor, codeBg) }
    Text(text, modifier = modifier, style = style, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}
