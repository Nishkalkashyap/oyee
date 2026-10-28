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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import dev.herald.android.ui.components.FilterPill
import dev.herald.android.ui.components.PillButton
import dev.herald.android.ui.components.PillVariant
import dev.herald.android.ui.components.SourceAvatar
import dev.herald.android.ui.components.severityColor
import dev.herald.android.ui.theme.Herald
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.SwitchDefaults
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow

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
    val c = Herald.colors

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

    Scaffold(containerColor = c.background, snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        val s = settings ?: return@Scaffold
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 32.dp)) {
            // Gluon's settings header: back, large bold title, muted description.
            IconButton(onClick = onBack, modifier = Modifier.padding(top = 4.dp).offset(x = (-12).dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = c.secondaryLabel)
            }
            Text("Settings", style = MaterialTheme.typography.headlineLarge, color = c.foreground)
            Text("This phone and how Herald reaches it.", style = MaterialTheme.typography.bodyMedium, color = c.muted, modifier = Modifier.padding(top = 2.dp))

            // Account card
            Row(
                Modifier.padding(top = 20.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(c.card).padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SourceAvatar(s.userEmail ?: s.deviceName ?: "Herald", size = 46.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(s.userEmail ?: "Not signed in", style = MaterialTheme.typography.titleMedium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(s.serverUrl.removePrefix("https://"), style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1)
                    s.deviceName?.let { Text("This device: $it", style = MaterialTheme.typography.bodySmall, color = c.muted, maxLines = 1) }
                }
            }

            SettingsHeading("Delivery")
            SettingRow("Push (Firebase)", fcmLabel(fcm), trailing = { StatusDot(fcm is FcmState.Registered) })
            SettingRow("Live connection", socketLabel(socket, serviceRunning), trailing = { StatusDot(socket == SocketClient.State.CONNECTED) })
            Column(Modifier.padding(vertical = 14.dp)) {
                Text("Instant delivery", style = MaterialTheme.typography.titleMedium, color = c.foreground)
                Text(deliveryExplanation(s.instantDelivery, fcm), style = MaterialTheme.typography.bodySmall, color = c.muted, modifier = Modifier.padding(top = 2.dp, bottom = 10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    InstantDelivery.entries.forEach { mode ->
                        FilterPill(mode.name.lowercase().replaceFirstChar { it.uppercase() }, selected = s.instantDelivery == mode) { vm.setInstantDelivery(mode) }
                    }
                }
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PillButton(onClick = vm::recheckTransport, height = 34.dp) { Text("Re-check") }
                    PillButton(onClick = vm::syncNow, height = 34.dp) { Text("Sync now") }
                }
            }

            SettingsHeading("Notifications")
            SettingRow(
                "Permission",
                if (notificationsAllowed) "Herald can show notifications." else "Notifications are blocked for Herald.",
                trailing = {
                    if (notificationsAllowed) {
                        StatusDot(true)
                    } else {
                        PillButton(
                            onClick = {
                                if (Build.VERSION.SDK_INT >= 33 &&
                                    ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                                ) {
                                    permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                                } else {
                                    openAppNotificationSettings(context)
                                }
                            },
                            variant = PillVariant.Brand,
                            height = 32.dp,
                        ) { Text("Allow") }
                    }
                },
            )
            SettingRow(
                "Mark as read when dismissed",
                "Swiping a notification away marks it read on every device.",
                trailing = { HeraldSwitch(s.dismissMarksRead, vm::setDismissMarksRead) },
            )
            Text(
                "Sound and vibration per severity",
                style = MaterialTheme.typography.labelMedium,
                color = c.muted,
                modifier = Modifier.padding(top = 14.dp, bottom = 4.dp),
            )
            Severity.entries.reversed().forEach { sev ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { openChannelSettings(context, sev.channelId) }
                        .padding(vertical = 11.dp, horizontal = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(9.dp).clip(CircleShape).background(severityColor(sev)))
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(Channels.nameRes(sev)), style = MaterialTheme.typography.bodyLarge, color = c.foreground, modifier = Modifier.weight(1f))
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Configure", tint = c.faint)
                }
            }

            SettingsHeading("Battery")
            SettingRow(
                "Background activity",
                if (batteryExempt) "Unrestricted: the live connection stays up." else "Optimized: the live connection may be delayed or stopped in the background.",
                trailing = {
                    if (batteryExempt) StatusDot(true)
                    else PillButton(onClick = { requestBatteryExemption(context) }, height = 32.dp) { Text("Allow") }
                },
            )

            SettingsHeading("About")
            SettingRow("Version", "${BuildConfig.VERSION_NAME} (${BuildConfig.BUILD_TYPE})")
            SettingRow("Firebase in this build", if (BuildConfig.HAS_GOOGLE_SERVICES) "Included" else "Not included (live connection only)", last = true)

            PillButton(
                onClick = { confirmUnpair = true },
                variant = PillVariant.Destructive,
                height = 46.dp,
                modifier = Modifier.padding(top = 24.dp).fillMaxWidth(),
            ) { Text("Unpair this device", fontWeight = FontWeight.SemiBold) }
        }
    }

    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            title = { Text("Unpair this device?") },
            text = { Text("It stops receiving notifications and its token is revoked on the server.") },
            confirmButton = { TextButton(onClick = { confirmUnpair = false; vm.unpair() }) { Text("Unpair", color = Color(0xFFDC2626)) } },
            dismissButton = { TextButton(onClick = { confirmUnpair = false }) { Text("Cancel", color = c.foreground) } },
            containerColor = c.background,
        )
    }
}

/** Gluon's settings section heading: bold, with space above. */
@Composable
private fun SettingsHeading(title: String) {
    Text(title, style = MaterialTheme.typography.titleLarge, color = Herald.colors.foreground, modifier = Modifier.padding(top = 28.dp, bottom = 2.dp))
}

/** Gluon's setting row: title, muted description, control on the right, hairline below. */
@Composable
private fun SettingRow(title: String, description: String? = null, last: Boolean = false, trailing: (@Composable () -> Unit)? = null) {
    val c = Herald.colors
    Column {
        Row(Modifier.fillMaxWidth().padding(vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = c.foreground)
                description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = c.muted, modifier = Modifier.padding(top = 2.dp)) }
            }
            if (trailing != null) {
                Spacer(Modifier.width(14.dp))
                trailing()
            }
        }
        if (!last) HorizontalDivider(color = c.border)
    }
}

@Composable
private fun StatusDot(ok: Boolean) {
    Box(Modifier.size(9.dp).clip(CircleShape).background(if (ok) Color(0xFF16A34A) else Herald.colors.faint))
}

/** Gluon's switch: grey track, green when on, white thumb. */
@Composable
private fun HeraldSwitch(checked: Boolean, onChange: (Boolean) -> Unit) {
    val c = Herald.colors
    Switch(
        checked = checked,
        onCheckedChange = onChange,
        colors = SwitchDefaults.colors(
            checkedThumbColor = Color.White,
            checkedTrackColor = Color(0xFF16A34A),
            checkedBorderColor = Color.Transparent,
            uncheckedThumbColor = Color.White,
            uncheckedTrackColor = if (c == dev.herald.android.ui.theme.DarkHerald) Color(0xFF3D3934) else Color(0xFFE0DCD4),
            uncheckedBorderColor = Color.Transparent,
        ),
    )
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

