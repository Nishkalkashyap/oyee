package app.oyee.android.notify

/**
 * How a notification's at most 3 system buttons are shared out. The sender's own actions come first (they're the
 * question being asked), then the reply box, then a "✓ Resolve" button if a slot is still free.
 */
object NotificationButtons {
    const val MAX = 3

    data class Plan(val actions: Int, val resolve: Boolean)

    fun plan(actionCount: Int, hasReply: Boolean): Plan {
        val forActions = MAX - (if (hasReply) 1 else 0)
        val actions = actionCount.coerceIn(0, forActions)
        val used = actions + (if (hasReply) 1 else 0)
        return Plan(actions = actions, resolve = used < MAX)
    }
}
