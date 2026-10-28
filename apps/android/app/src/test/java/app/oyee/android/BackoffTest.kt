package app.oyee.android

import app.oyee.android.util.Backoff
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class BackoffTest {
    @Test
    fun `grows exponentially from 1s to a 60s cap with jitter`() {
        val b = Backoff(random = Random(42))
        val caps = listOf(1_000L, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000)
        caps.forEach { cap ->
            val d = b.nextDelayMs()
            assertTrue("$d not in [${cap / 2}, $cap]", d in cap / 2..cap)
        }
        b.reset()
        assertEquals(0, b.attempt)
        assertTrue(b.nextDelayMs() <= 1_000)
    }
}
