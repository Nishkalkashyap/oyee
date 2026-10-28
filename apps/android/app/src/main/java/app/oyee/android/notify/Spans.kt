package app.oyee.android.notify

import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.text.style.UnderlineSpan
import app.oyee.android.util.Markdown

/** Markdown subset → Spanned for notification text (links can't be tapped in notifications, so they're underlined). */
object Spans {
    fun fromMarkdown(md: String): CharSequence {
        val sb = SpannableStringBuilder()
        for (run in Markdown.parse(md)) {
            val start = sb.length
            sb.append(run.text)
            val end = sb.length
            if (run.bold && run.italic) {
                sb.setSpan(StyleSpan(Typeface.BOLD_ITALIC), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            } else if (run.bold) {
                sb.setSpan(StyleSpan(Typeface.BOLD), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            } else if (run.italic) {
                sb.setSpan(StyleSpan(Typeface.ITALIC), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            if (run.code) sb.setSpan(TypefaceSpan("monospace"), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (run.link != null) sb.setSpan(UnderlineSpan(), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return sb
    }

    fun bold(text: String): CharSequence = SpannableStringBuilder(text).apply {
        setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
}
