package dev.herald.android.ui.settings

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.herald.android.BuildConfig
import dev.herald.android.data.InstantDelivery
import dev.herald.android.model.Severity
import dev.herald.android.notify.Channels
import dev.herald.android.transport.SocketClient
import dev.herald.android.transport.TransportManager.FcmState
import dev.herald.android.ui.components.severityColor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: SettingsViewModel, onBack: () -> Unit) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val fcm by vm.fcm.collectAsStateWithLifecycle()
    val socket by vm.socket.collectAsStateWithLifecycle()
    val serviceRunning by vm.serviceRunning.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var confirmUnpair by remember { mutableStateOf(false) }

    // Permission / battery state can change in system settings: re-read on every resume.
    var resumeTick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        resumeTick++
        onPauseOrDispose { }
    }
    val notificationsAllowed = remember(resumeTick) { notificationsAllowed(context) }
    val batteryExempt = remember(resumeTick) { isIgnoringBatteryOptimizations(context) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { resumeTick++ }

    LaunchedEffect(message) { message?.let { snackbar.showSnackbar(it); vm.consumeMessage() } }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
    ) { padding ->
        val s = settings ?: return@Scaffold
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Section("Account")
            Info("Server", s.serverUrl)
            s.userEmail?.let { Info("Signed in as", it) }
            s.deviceName?.let { Info("Device name", it) }

            Section("Delivery")
            Info("Firebase Cloud Messaging", fcmLabel(fcm))
            Info("WebSocket", socketLabel(socket, serviceRunning))
            Text("Instant delivery (persistent connection)", style = MaterialTheme.typography.bodyLarge)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                val modes = InstantDelivery.entries
                modes.forEachIndexed { i, mode ->
                    SegmentedButton(
                        selected = s.instantDelivery == mode,
                        onClick = { vm.setInstantDelivery(mode) },
                        shape = SegmentedButtonDefaults.itemShape(i, modes.size),
                    ) { Text(mode.name.lowercase().replaceFirstChar { it.uppercase() }) }
                }
            }
            Text(
                deliveryExplanation(s.instantDelivery, fcm),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = vm::recheckTransport) { Text("Re-check") }
                OutlinedButton(onClick = vm::syncNow) { Text("Sync now") }
            }

            Section("Notifications")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Info("Permission", if (notificationsAllowed) "Allowed" else "Not allowed", Modifier.weight(1f))
                if (!notificationsAllowed) {
                    TextButton(onClick = {
                        if (Build.VERSION.SDK_INT >= 33 &&
                            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                        ) {
                            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else {
                            openAppNotificationSettings(context)
                        }
                    }) { Text("Allow") }
                }
            }
            Text("Channels (sound, vibration, Do Not Disturb per severity)", style = MaterialTheme.typography.bodyMedium)
            Severity.entries.reversed().forEach { sev ->
                Row(
                    Modifier.fillMaxWidth().clickable { openChannelSettings(context, sev.channelId) }.padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("●", color = severityColor(sev))
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(Channels.nameRes(sev)), modifier = Modifier.weight(1f))
                    Text("Configure", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Mark as read when dismissed", style = MaterialTheme.typography.bodyLarge)
                    Text("Swiping a notification away marks it read on every device.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = s.dismissMarksRead, onCheckedChange = vm::setDismissMarksRead)
            }

            Section("Battery")
            Info(
                "Battery optimization",
                if (batteryExempt) "Unrestricted" else "Optimized (the connection may be delayed or killed in the background)",
            )
            if (!batteryExempt) {
                OutlinedButton(onClick = { requestBatteryExemption(context) }) { Text("Allow running in background") }
            }

            Section("About")
            Info("Version", "${BuildConfig.VERSION_NAME} (${BuildConfig.BUILD_TYPE})")
            Info("Firebase config in this build", if (BuildConfig.HAS_GOOGLE_SERVICES) "Yes" else "No (WebSocket only)")

            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            Button(
                onClick = { confirmUnpair = true },
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Unpair this device") }
        }
    }

    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            title = { Text("Unpair this device?") },
            text = { Text("It stops receiving notifications and its token is revoked on the server.") },
            confirmButton = { TextButton(onClick = { confirmUnpair = false; vm.unpair() }) { Text("Unpair") } },
            dismissButton = { TextButton(onClick = { confirmUnpair = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 16.dp))
}

@Composable
private fun Info(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyLarge)
    }
}

private fun fcmLabel(s: FcmState): String = when (s) {
    FcmState.Unpaired -> "Not paired"
    FcmState.Checking -> "Checking…"
    FcmState.NotConfigured -> "Not available in this build (no google-services.json)"
    FcmState.ServerDisabled -> "Disabled on the server (FCM_SERVICE_ACCOUNT_JSON not set)"
    is FcmState.Failed -> "Unavailable: ${s.reason}"
    is FcmState.Registered -> "Active"
}

private fun socketLabel(s: SocketClient.State, service: Boolean): String {
    val conn = when (s) {
        SocketClient.State.CONNECTED -> "Connected"
        SocketClient.State.CONNECTING -> "Connecting…"
        SocketClient.State.BACKING_OFF -> "Reconnecting…"
        SocketClient.State.WAITING_FOR_NETWORK -> "Waiting for network"
        SocketClient.State.IDLE -> "Disconnected"
    }
    return conn + if (service) " · background service running" else " · only while the app is open"
}

private fun deliveryExplanation(mode: InstantDelivery, fcm: FcmState): String {
    val fcmOk = fcm is FcmState.Registered
    return when (mode) {
        InstantDelivery.AUTO ->
            if (fcmOk) "Auto: using FCM (battery friendly). The persistent connection turns on automatically if FCM stops working."
            else "Auto: FCM can't deliver, so the persistent connection is on (shows a silent \"Herald connected\" notification)."
        InstantDelivery.ON -> "Always keep a persistent connection, in addition to FCM when available. Fastest, uses a bit more battery."
        InstantDelivery.OFF ->
            if (fcmOk) "FCM only." else "Warning: without FCM, notifications only arrive while the app is open."
    }
}

private fun notificationsAllowed(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= 33 &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
        return false
    }
    return NotificationManagerCompat.from(context).areNotificationsEnabled()
}

private fun isIgnoringBatteryOptimizations(context: Context): Boolean =
    context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)

private fun openAppNotificationSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
    )
}

private fun openChannelSettings(context: Context, channelId: String) {
    Channels.ensure(context)
    context.startActivity(
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, channelId),
    )
}

@SuppressLint("BatteryLife") // Sideloaded app; this is exactly what the user asked for.
private fun requestBatteryExemption(context: Context) {
    val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${context.packageName}".toUri())
    try {
        context.startActivity(direct)
    } catch (_: Exception) {
        runCatching { context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
    }
}

