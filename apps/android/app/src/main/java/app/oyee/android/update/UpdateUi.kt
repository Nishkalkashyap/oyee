package app.oyee.android.update

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.oyee.android.ui.components.PillButton
import app.oyee.android.ui.components.PillVariant
import app.oyee.android.ui.theme.Oyee
import kotlinx.coroutines.launch

/** Light-blue banner at the top of the inbox while an update is available, downloading or ready to install. */
@Composable
fun UpdateBanner(updater: AppUpdater, modifier: Modifier = Modifier) {
    val state by updater.state.collectAsStateWithLifecycle()
    val c = Oyee.colors
    val (title, action) = when (val s = state) {
        is AppUpdater.State.Available -> "Oyee ${s.release.version} is available" to "Update"
        is AppUpdater.State.Downloading -> "Downloading Oyee ${s.release.version}${percent(s.progress)}" to null
        is AppUpdater.State.Downloaded -> "Oyee ${s.release.version} downloaded" to "Install"
        else -> return
    }
    Row(
        modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(16.dp))
            .background(c.chip).padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.labelLarge, color = c.chipForeground, modifier = Modifier.weight(1f))
        if (action != null) {
            Spacer(Modifier.width(8.dp))
            PillButton(onClick = updater::update, variant = PillVariant.Brand, height = 32.dp) { Text(action) }
        }
    }
}

/** The "Updates" rows in Settings: current version, status, and a check / update button. */
@Composable
fun UpdateStatus(updater: AppUpdater): Pair<String, @Composable () -> Unit> {
    val state by updater.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val description = if (!updater.enabled) "Debug build: updates are installed by rebuilding." else when (val s = state) {
        AppUpdater.State.Checking -> "Checking GitHub Releases…"
        AppUpdater.State.UpToDate -> "Up to date."
        is AppUpdater.State.Available -> "Version ${s.release.version} is available."
        is AppUpdater.State.Downloading -> "Downloading ${s.release.version}${percent(s.progress)}"
        is AppUpdater.State.Downloaded ->
            "${s.release.version} is downloaded: tap Install, then the Oyee APK in Downloads. Allow installs from that app if Android asks."
        is AppUpdater.State.Failed -> s.message
        AppUpdater.State.Idle -> "Checked automatically every 12 hours."
    }
    val trailing: @Composable () -> Unit = {
        when (state) {
            is AppUpdater.State.Available ->
                PillButton(onClick = updater::update, variant = PillVariant.Brand, height = 32.dp) { Text("Update") }
            is AppUpdater.State.Downloaded ->
                PillButton(onClick = updater::update, variant = PillVariant.Brand, height = 32.dp) { Text("Install") }
            AppUpdater.State.Checking, is AppUpdater.State.Downloading -> Unit
            else -> if (updater.enabled) {
                PillButton(onClick = { scope.launch { updater.check(notify = false) } }, height = 32.dp) { Text("Check") }
            }
        }
    }
    return "Version ${updater.currentVersion} · $description" to trailing
}

private fun percent(progress: Float?): String = progress?.let { " · ${(it * 100).toInt()}%" } ?: "…"
