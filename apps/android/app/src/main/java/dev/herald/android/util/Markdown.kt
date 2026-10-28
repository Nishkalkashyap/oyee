package dev.herald.android.util

/**
 * Parser for Herald's markdown subset (protocol §1.1): `**bold**`, `*italic*` (also `_italic_`), `` `code` ``,
 * `[link](url)` and line breaks. Everything else is literal text. Unclosed markers are kept as text.
 * Output is a flat list of styled runs that Compose (AnnotatedString) and notifications (Spanned) both render.
 */
object Markdown {
    data class Run(
        val text: String,
        val bold: Boolean = false,
        val italic: Boolean = false,
        val code: Boolean = false,
        val link: String? = null,
    )

    fun parse(input: String): List<Run> {
        val out = mutableListOf<Run>()
        parseInto(input.replace("\r\n", "\n"), bold = false, italic = false, link = null, out = out)
        return merge(out)
    }

    /** Plain text with markers removed (links render as their label). */
    fun toPlainText(input: String): String = parse(input).joinToString("") { it.text }

    private fun parseInto(s: String, bold: Boolean, italic: Boolean, link: String?, out: MutableList<Run>) {
        val buf = StringBuilder()
        fun flush() {
            if (buf.isNotEmpty()) {
                out += Run(buf.toString(), bold = bold, italic = italic, link = link)
                buf.clear()
            }
        }
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '\\' && i + 1 < s.length && s[i + 1] in ESCAPABLE -> {
                    buf.append(s[i + 1]); i += 2
                }
                c == '`' -> {
                    val end = s.indexOf('`', i + 1)
                    if (end > i + 1) {
                        flush()
                        out += Run(s.substring(i + 1, end), bold = bold, italic = italic, code = true, link = link)
                        i = end + 1
                    } else {
                        buf.append(c); i++
                    }
                }
                c == '*' && s.startsWith("**", i) -> {
                    var end = s.indexOf("**", i + 2)
                    // "**a *b***": the bold closer is the last two stars of the run.
                    while (end != -1 && end + 2 < s.length && s[end + 2] == '*') end++
                    if (end > i + 2) {
                        flush()
                        parseInto(s.substring(i + 2, end), bold = true, italic = italic, link = link, out = out)
                        i = end + 2
                    } else {
                        buf.append("**"); i += 2
                    }
                }
                (c == '*' || c == '_') && isItalicOpen(s, i) -> {
                    val end = findItalicClose(s, i + 1, c)
                    if (end > i + 1) {
                        flush()
                        parseInto(s.substring(i + 1, end), bold = bold, italic = true, link = link, out = out)
                        i = end + 1
                    } else {
                        buf.append(c); i++
                    }
                }
                c == '[' && link == null -> {
                    val close = findLabelClose(s, i + 1)
                    val urlEnd = if (close != -1 && close + 1 < s.length && s[close + 1] == '(') s.indexOf(')', close + 2) else -1
                    val url = if (urlEnd != -1) s.substring(close + 2, urlEnd).trim() else null
                    if (url != null && isSafeUrl(url) && close > i + 1) {
                        flush()
                        parseInto(s.substring(i + 1, close), bold = bold, italic = italic, link = url, out = out)
                        i = urlEnd + 1
                    } else {
                        buf.append(c); i++
                    }
                }
                else -> {
                    buf.append(c); i++
                }
            }
        }
        flush()
    }

    private const val ESCAPABLE = "\\`*_[]()"

    /** `*` / `_` opens italic only when followed by a non-space (so "2 * 3" stays literal). */
    private fun isItalicOpen(s: String, i: Int): Boolean {
        if (i + 1 >= s.length || s[i + 1].isWhitespace()) return false
        // Avoid snake_case: `_` inside a word is literal.
        if (s[i] == '_' && i > 0 && s[i - 1].isLetterOrDigit()) return false
        return true
    }

    private fun findItalicClose(s: String, from: Int, marker: Char): Int {
        var j = from
        while (j < s.length) {
            val ch = s[j]
            if (ch == '\n') return -1
            if (ch == marker && !s[j - 1].isWhitespace()) {
                if (marker == '*' && j + 1 < s.length && s[j + 1] == '*') { j += 2; continue }
                if (marker == '_' && j + 1 < s.length && s[j + 1].isLetterOrDigit()) { j++; continue }
                return j
            }
            j++
        }
        return -1
    }

    private fun findLabelClose(s: String, from: Int): Int {
        var depth = 0
        for (j in from until s.length) {
            when (s[j]) {
                '[' -> depth++
                ']' -> if (depth == 0) return j else depth--
                '\n' -> return -1
            }
        }
        return -1
    }

    fun isSafeUrl(url: String): Boolean {
        val u = url.lowercase()
        return u.startsWith("https://") || u.startsWith("http://") || u.startsWith("mailto:")
    }

    private fun merge(runs: List<Run>): List<Run> {
        val out = mutableListOf<Run>()
        for (r in runs) {
            if (r.text.isEmpty()) continue
            val last = out.lastOrNull()
            if (last != null && last.bold == r.bold && last.italic == r.italic && last.code == r.code && last.link == r.link) {
                out[out.size - 1] = last.copy(text = last.text + r.text)
            } else {
                out += r
            }
        }
        return out
    }
}
