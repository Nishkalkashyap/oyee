package app.oyee.android.notify

import app.oyee.android.model.Intent
import app.oyee.android.model.Notification
import app.oyee.android.model.Progress
import app.oyee.android.model.ProgressState
import app.oyee.android.ui.cards.askView
import app.oyee.android.ui.cards.informView
import app.oyee.android.ui.cards.stoppedReportingLabel
import app.oyee.android.util.Formatting
import java.time.Instant

/**
 * What the system notification for each intent offers and how it alerts (protocol §9, spec "Clients"). Pure, so it's
 * unit-tested; [NotificationRenderer] turns the plan into a NotificationCompat notification.
 */
object NotificationPlan {
    /** Android shows at most three buttons. */
    const val MAX = 3

    sealed interface Button {
        /** An ask's answer button → `POST …/respond { option }`. */
        data class Answer(val option: String) : Button

        /** An ask's inline reply (RemoteInput) → `POST …/respond { text }`. */
        data class Reply(val placeholder: String) : Button

        /** An inform's link button: opens the URL, nothing is sent back. */
        data class Link(val label: String, val url: String) : Button

        /** "✓ Resolve": dismisses the notification everywhere without opening the app. */
        data object Resolve : Button
    }

    /**
     * An open ask: its answers, and the inline reply when it takes text (the reply keeps its slot, so a third answer
     * is left to the app). No Resolve: resolving an ask would withdraw the question. A closed ask has no buttons.
     * Inform: its links, then Resolve if a slot is free. Progress: Resolve.
     */
    fun buttons(n: Notification, now: Instant = Instant.now()): List<Button> = when (n.intent) {
        Intent.ASK -> {
            val v = askView(n, now)
            if (!v.open) {
                emptyList()
            } else {
                val reply = v.replyPlaceholder?.let { Button.Reply(it) }
                val answers = v.options.take(MAX - (if (reply != null) 1 else 0)).map { Button.Answer(it.label) }
                answers + listOfNotNull(reply)
            }
        }
        Intent.INFORM -> withResolve(informView(n).links.map { Button.Link(it.label, it.url) })
        Intent.PROGRESS -> listOf(Button.Resolve)
    }

    private fun withResolve(buttons: List<Button>): List<Button> =
        if (buttons.size < MAX) buttons + Button.Resolve else buttons.take(MAX)

    /** Every severity alerts when the event says so; a running progress always updates quietly. */
    fun alerts(n: Notification, eventAlert: Boolean): Boolean =
        eventAlert && !(n.intent == Intent.PROGRESS && n.progress?.state == ProgressState.RUNNING)

    /**
     * Whether the system notification must go: read or resolved anywhere (answered, expired and withdrawn asks are
     * resolved), or an ask past its expiry before the server's broadcast arrives. A finished progress stays until read.
     */
    fun dismiss(n: Notification, now: Instant = Instant.now()): Boolean =
        n.shouldDismissSystemNotification || (n.intent == Intent.ASK && !askView(n, now).open)

    /** The progress line in the notification text, as in the browser popup: the text bar while running, then the outcome. */
    fun progressLine(p: Progress?): String? = when (p?.state) {
        null -> null
        ProgressState.RUNNING -> Formatting.progressText(p)
        ProgressState.DONE -> "Done · ${Formatting.progressLabel(p)}"
        ProgressState.FAILED -> "Failed · ${Formatting.progressLabel(p)}"
        ProgressState.STOPPED -> stoppedReportingLabel(p)
    }
}
