package app.oyee.android.util

/** Pairing codes: 8 chars from [ALPHABET], shown as `XXXX-XXXX`; dash optional and case-insensitive on input. */
object PairingCode {
    const val ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    const val LENGTH = 8

    /** Uppercases and strips whitespace / dashes. Returns null unless the result is a valid 8-char code. */
    fun normalize(input: String): String? {
        val cleaned = input.filterNot { it.isWhitespace() || it == '-' || it == '–' }.uppercase()
        if (cleaned.length != LENGTH) return null
        return cleaned.takeIf { s -> s.all { it in ALPHABET } }
    }

    /** For display while typing: uppercase, drop invalid chars, insert the dash after 4 chars. */
    fun formatForDisplay(input: String): String {
        val chars = input.uppercase().filter { it in ALPHABET }.take(LENGTH)
        return if (chars.length > 4) chars.substring(0, 4) + "-" + chars.substring(4) else chars
    }
}
