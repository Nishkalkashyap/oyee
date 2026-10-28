package dev.herald.android

import dev.herald.android.util.ServerUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlTest {
    private fun ok(input: String, debug: Boolean = false) =
        (ServerUrl.normalize(input, debug) as ServerUrl.Result.Ok).url

    private fun invalid(input: String, debug: Boolean = false) = ServerUrl.normalize(input, debug) is ServerUrl.Result.Invalid

    @Test
    fun `normalizes https urls`() {
        assertEquals("https://herald.example.workers.dev", ok("herald.example.workers.dev"))
        assertEquals("https://herald.example.workers.dev", ok(" https://herald.example.workers.dev/ "))
        assertEquals("https://herald.example.workers.dev", ok("https://herald.example.workers.dev/api/"))
        assertEquals("https://example.com:8443/herald", ok("https://Example.com:8443/herald/"))
    }

    @Test
    fun `cleartext only for local hosts in debug builds`() {
        assertEquals("http://10.0.2.2:8787", ok("http://10.0.2.2:8787", debug = true))
        assertEquals("http://localhost:8787", ok("http://localhost:8787/", debug = true))
        assertEquals("http://192.168.1.20:8787", ok("http://192.168.1.20:8787", debug = true))
        assertEquals("http://mac.local:8787", ok("http://mac.local:8787", debug = true))
        assertTrue(invalid("http://10.0.2.2:8787", debug = false))
        assertTrue(invalid("http://example.com", debug = true))
        assertTrue(invalid("http://8.8.8.8", debug = true))
    }

    @Test
    fun `rejects junk`() {
        assertTrue(invalid(""))
        assertTrue(invalid("ftp://example.com"))
        assertTrue(invalid("https://"))
        assertTrue(invalid("https://exa mple.com"))
    }

    @Test
    fun `local host detection`() {
        listOf("localhost", "127.0.0.1", "10.0.2.2", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.1.1", "::1", "fd12::1", "box.local")
            .forEach { assertTrue(it, ServerUrl.isLocalHost(it)) }
        listOf("172.32.0.1", "8.8.8.8", "example.com", "fcm.googleapis.com", "fdroid.org", "11.0.0.1")
            .forEach { assertFalse(it, ServerUrl.isLocalHost(it)) }
    }
}
