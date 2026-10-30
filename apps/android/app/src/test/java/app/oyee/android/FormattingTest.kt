package app.oyee.android

import app.oyee.android.model.Field
import app.oyee.android.model.ProgressBlock
import app.oyee.android.util.Formatting
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/** Expected strings are what `progressText` in packages/schema produces for the same input. */
class FormattingTest {
    @Test
    fun `progress text with max other than 100 shows value over max`() {
        assertEquals("▓▓▓▓░░░░░░ 3/7", Formatting.progressText(ProgressBlock(value = 3.0, max = 7.0)))
        assertEquals("▓▓▓▓▓▓▓▓▓▓ 7/7", Formatting.progressText(ProgressBlock(value = 7.0, max = 7.0)))
        assertEquals("▓░░░░░░░░░ 2.5/20", Formatting.progressText(ProgressBlock(value = 2.5, max = 20.0)))
    }

    @Test
    fun `progress text with default max shows percent`() {
        assertEquals("▓▓▓▓▓░░░░░ 50%", Formatting.progressText(ProgressBlock(value = 50.0)))
        assertEquals("░░░░░░░░░░ 0%", Formatting.progressText(ProgressBlock(value = 0.0)))
        assertEquals("▓▓▓░░░░░░░ 33%", Formatting.progressText(ProgressBlock(value = 33.4)))
        assertEquals("▓▓▓▓▓▓▓▓▓▓ 100%", Formatting.progressText(ProgressBlock(value = 250.0))) // clamped
    }

    @Test
    fun `progress label overrides the suffix`() {
        assertEquals("▓▓▓▓░░░░░░ 3/7 checks", Formatting.progressText(ProgressBlock(value = 3.0, max = 7.0, label = "3/7 checks")))
    }

    @Test
    fun `progress label without bar`() {
        assertEquals("3/7", Formatting.progressLabel(ProgressBlock(value = 3.0, max = 7.0)))
        assertEquals("42%", Formatting.progressLabel(ProgressBlock(value = 42.0)))
    }

    @Test
    fun `native progress ints`() {
        assertEquals(3 to 7, Formatting.progressInts(ProgressBlock(value = 3.0, max = 7.0)))
        assertEquals(50 to 100, Formatting.progressInts(ProgressBlock(value = 50.0)))
        assertEquals(150 to 250, Formatting.progressInts(ProgressBlock(value = 1.5, max = 2.5))) // fractional max scaled
        assertEquals(7 to 7, Formatting.progressInts(ProgressBlock(value = 9.0, max = 7.0))) // clamped
    }

    @Test
    fun `field lines`() {
        assertEquals(
            listOf("Region: us-east-1", "Cluster: prod"),
            Formatting.fieldLines(listOf(Field("Region", "us-east-1"), Field("Cluster", "prod"))),
        )
        assertEquals(emptyList<String>(), Formatting.fieldLines(emptyList()))
    }

    @Test
    fun `numbers format like javascript`() {
        assertEquals("3", Formatting.number(3.0))
        assertEquals("2.5", Formatting.number(2.5))
        assertEquals("0", Formatting.number(0.0))
    }

    @Test
    fun `relative time`() {
        val now = Instant.parse("2026-10-28T12:00:00Z")
        assertEquals("now", Formatting.relative("2026-10-28T11:59:30.000Z", now))
        assertEquals("5m", Formatting.relative("2026-10-28T11:55:00.000Z", now))
        assertEquals("3h", Formatting.relative("2026-10-28T09:00:00.000Z", now))
        assertEquals("2d", Formatting.relative("2026-10-26T12:00:00.000Z", now))
        assertEquals("", Formatting.relative("garbage", now))
        assertEquals(1_793_181_600_000L, Formatting.epochMillis("2026-10-28T10:00:00.000Z"))
    }
}
