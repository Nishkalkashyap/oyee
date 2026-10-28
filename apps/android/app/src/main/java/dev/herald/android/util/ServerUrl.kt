package dev.herald.android.util

import java.net.URI

/** Server URL normalisation + validation. */
object ServerUrl {
    sealed interface Result {
        data class Ok(val url: String) : Result
        data class Invalid(val reason: String) : Result
    }

    /**
     * Trims, adds `https://` when no scheme is given, strips trailing slashes and a trailing `/api`.
     * `http://` is only accepted when [allowCleartextLocal] (debug builds) and the host is local.
     */
    fun normalize(input: String, allowCleartextLocal: Boolean): Result {
        var s = input.trim()
        if (s.isEmpty()) return Result.Invalid("Enter the server URL")
        if (!s.contains("://")) s = "https://$s"
        val uri = try {
            URI(s)
        } catch (_: Exception) {
            return Result.Invalid("Not a valid URL")
        }
        val scheme = uri.scheme?.lowercase()
        val host = uri.host?.lowercase() ?: return Result.Invalid("Not a valid URL")
        when (scheme) {
            "https" -> Unit
            "http" -> {
                if (!allowCleartextLocal) return Result.Invalid("Only https:// servers are allowed in this build")
                if (!isLocalHost(host)) {
                    return Result.Invalid("http:// is only allowed for localhost, 10.0.2.2 and LAN addresses")
                }
            }
            else -> return Result.Invalid("Use an https:// URL")
        }
        var path = (uri.rawPath ?: "").trimEnd('/')
        if (path.endsWith("/api")) path = path.removeSuffix("/api")
        val port = if (uri.port != -1) ":${uri.port}" else ""
        val hostPart = if (host.contains(':')) "[$host]" else host
        return Result.Ok("$scheme://$hostPart$port$path")
    }

    /** Loopback, emulator host alias, RFC 1918 / link-local IPv4, IPv6 ULA/link-local, or mDNS `.local`. */
    fun isLocalHost(host: String): Boolean {
        val h = host.trim('[', ']').lowercase()
        if (h == "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true
        if (h == "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return h.contains(':')
        val parts = h.split('.')
        if (parts.size != 4) return false
        val o = parts.map { it.toIntOrNull() ?: return false }
        if (o.any { it !in 0..255 }) return false
        return o[0] == 127 ||
            o[0] == 10 ||
            (o[0] == 172 && o[1] in 16..31) ||
            (o[0] == 192 && o[1] == 168) ||
            (o[0] == 169 && o[1] == 254)
    }
}
