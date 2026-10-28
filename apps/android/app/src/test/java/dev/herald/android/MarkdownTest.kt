package dev.herald.android

import dev.herald.android.util.Markdown
import dev.herald.android.util.Markdown.Run
import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownTest {
    private fun parse(s: String) = Markdown.parse(s)

    @Test
    fun `plain text`() {
        assertEquals(listOf(Run("hello world")), parse("hello world"))
    }

    @Test
    fun `bold italic code`() {
        assertEquals(listOf(Run("CPU above "), Run("90%", bold = true), Run(" for 5m")), parse("CPU above **90%** for 5m"))
        assertEquals(listOf(Run("a "), Run("b", italic = true), Run(" c")), parse("a *b* c"))
        assertEquals(listOf(Run("a "), Run("b", italic = true)), parse("a _b_"))
        assertEquals(listOf(Run("run "), Run("npm test", code = true)), parse("run `npm test`"))
    }

    @Test
    fun `nested emphasis`() {
        assertEquals(listOf(Run("very ", bold = true), Run("much", bold = true, italic = true)), parse("**very *much***"))
    }

    @Test
    fun `code is literal`() {
        assertEquals(listOf(Run("**not bold**", code = true)), parse("`**not bold**`"))
    }

    @Test
    fun links() {
        assertEquals(
            listOf(Run("see "), Run("the docs", link = "https://example.com/docs"), Run(".")),
            parse("see [the docs](https://example.com/docs)."),
        )
        assertEquals(listOf(Run("bold link", bold = true, link = "https://x.y")), parse("[**bold link**](https://x.y)"))
    }

    @Test
    fun `unsafe link schemes stay literal`() {
        assertEquals(listOf(Run("[x](javascript:alert(1))")), parse("[x](javascript:alert(1))"))
    }

    @Test
    fun `line breaks are preserved`() {
        assertEquals("line 1\nline 2", Markdown.toPlainText("line 1\r\nline 2"))
        assertEquals(listOf(Run("a\n"), Run("b", bold = true)), parse("a\n**b**"))
    }

    @Test
    fun `unclosed markers and lone symbols stay literal`() {
        assertEquals(listOf(Run("2 * 3 = 6")), parse("2 * 3 = 6"))
        assertEquals(listOf(Run("**open")), parse("**open"))
        assertEquals(listOf(Run("`tick")), parse("`tick"))
        assertEquals(listOf(Run("snake_case_name")), parse("snake_case_name"))
        assertEquals(listOf(Run("[label] (not a link)")), parse("[label] (not a link)"))
    }

    @Test
    fun escapes() {
        assertEquals(listOf(Run("*literal*")), parse("\\*literal\\*"))
    }

    @Test
    fun `plain text strips markup`() {
        assertEquals("CPU above 90% for 5m, see docs", Markdown.toPlainText("CPU above **90%** for 5m, see [docs](https://x.y)"))
    }
}
