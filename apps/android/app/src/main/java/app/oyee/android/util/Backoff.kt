package app.oyee.android.util

import kotlin.random.Random

/** Exponential backoff 1 s → 60 s with "equal jitter" (half fixed, half random), per protocol §6. */
class Backoff(
    private val baseMs: Long = 1_000,
    private val maxMs: Long = 60_000,
    private val random: Random = Random.Default,
) {
    var attempt: Int = 0
        private set

    fun reset() {
        attempt = 0
    }

    fun nextDelayMs(): Long {
        val cap = capFor(attempt)
        attempt++
        val half = cap / 2
        return half + random.nextLong(half + 1)
    }

    fun capFor(attempt: Int): Long {
        val shift = attempt.coerceIn(0, 20)
        return (baseMs shl shift).coerceAtMost(maxMs)
    }
}
