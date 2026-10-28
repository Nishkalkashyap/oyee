package dev.herald.android

import dev.herald.android.util.PairingCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingCodeTest {
    @Test
    fun `normalizes dash, case and whitespace`() {
        assertEquals("K7Q29XMA", PairingCode.normalize("K7Q2-9XMA"))
        assertEquals("K7Q29XMA", PairingCode.normalize("k7q2-9xma"))
        assertEquals("K7Q29XMA", PairingCode.normalize("k7q29xma"))
        assertEquals("K7Q29XMA", PairingCode.normalize("  K7Q2 9XMA \n"))
        assertEquals("K7Q29XMA", PairingCode.normalize("K7Q2–9XMA")) // en dash from autocorrect
    }

    @Test
    fun `rejects wrong length or characters outside the alphabet`() {
        assertNull(PairingCode.normalize("K7Q2-9XM"))
        assertNull(PairingCode.normalize("K7Q2-9XMAB"))
        assertNull(PairingCode.normalize("K7Q2-9XM0")) // 0 is not in the alphabet
        assertNull(PairingCode.normalize("K7Q2-9XMI")) // I is not in the alphabet
        assertNull(PairingCode.normalize("K7Q2-9XM1"))
        assertNull(PairingCode.normalize(""))
    }

    @Test
    fun `formats for display while typing`() {
        assertEquals("K7Q", PairingCode.formatForDisplay("k7q"))
        assertEquals("K7Q2", PairingCode.formatForDisplay("k7q2"))
        assertEquals("K7Q2-9", PairingCode.formatForDisplay("k7q29"))
        assertEquals("K7Q2-9XMA", PairingCode.formatForDisplay("k7q2-9xma-extra"))
    }
}
