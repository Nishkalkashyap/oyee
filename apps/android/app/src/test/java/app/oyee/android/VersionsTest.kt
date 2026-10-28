package app.oyee.android

import app.oyee.android.update.Versions
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionsTest {
    @Test
    fun `newer versions are detected numerically`() {
        assertTrue(Versions.isNewer("0.2.1", "0.2.0"))
        assertTrue(Versions.isNewer("v0.10.0", "0.9.9"))
        assertTrue(Versions.isNewer("1.0.0", "0.99.99"))
    }

    @Test
    fun `same or older versions are not updates`() {
        assertFalse(Versions.isNewer("0.2.0", "0.2.0"))
        assertFalse(Versions.isNewer("0.1.9", "0.2.0"))
        assertFalse(Versions.isNewer("garbage", "0.2.0"))
    }
}
