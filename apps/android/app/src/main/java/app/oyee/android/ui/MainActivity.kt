package app.oyee.android.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.oyee.android.AppContainer
import app.oyee.android.OyeeApp
import app.oyee.android.ui.detail.DetailScreen
import app.oyee.android.ui.detail.DetailViewModel
import app.oyee.android.ui.inbox.InboxScreen
import app.oyee.android.ui.inbox.InboxViewModel
import app.oyee.android.ui.pair.PairScreen
import app.oyee.android.ui.pair.PairViewModel
import app.oyee.android.ui.settings.SettingsScreen
import app.oyee.android.ui.settings.SettingsViewModel
import app.oyee.android.ui.theme.OyeeTheme
import android.widget.Toast
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import kotlinx.coroutines.launch

/** oyee://pair?server=…&code=… */
data class PairLink(val server: String?, val code: String?)

sealed interface Screen {
    data object Inbox : Screen
    data class Detail(val id: String) : Screen
    data object Settings : Screen
}

class MainActivity : ComponentActivity() {
    private var pairLink by mutableStateOf<PairLink?>(null)
    private var openNotification by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handleIntent(intent)
        val container = (application as OyeeApp).container
        setContent {
            OyeeTheme {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    OyeeRoot(
                        container = container,
                        pairLink = pairLink,
                        onPairLinkConsumed = { pairLink = null },
                        openNotification = openNotification,
                        onOpenConsumed = { openNotification = null },
                    )
                }
            }
        }
        lifecycleScope.launch {
            container.messages.collect { Toast.makeText(this@MainActivity, it, Toast.LENGTH_LONG).show() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        val data = intent.data
        if (intent.action == Intent.ACTION_VIEW && data?.scheme == "oyee" && data.host == "pair") {
            pairLink = PairLink(server = data.getQueryParameter("server"), code = data.getQueryParameter("code"))
        }
        intent.getStringExtra(EXTRA_OPEN_NOTIFICATION)?.let { openNotification = it }
    }

    companion object {
        const val EXTRA_OPEN_NOTIFICATION = "app.oyee.android.OPEN_NOTIFICATION"
    }
}

/** Back stack <-> strings so it survives configuration changes and process death. */
private fun Screen.encode(): String = when (this) {
    Screen.Inbox -> "inbox"
    Screen.Settings -> "settings"
    is Screen.Detail -> "detail:$id"
}

private fun decodeScreen(s: String): Screen = when {
    s == "settings" -> Screen.Settings
    s.startsWith("detail:") -> Screen.Detail(s.removePrefix("detail:"))
    else -> Screen.Inbox
}

private val BackStackSaver = listSaver<SnapshotStateList<Screen>, String>(
    save = { stack -> stack.map { it.encode() } },
    restore = { saved -> mutableStateListOf<Screen>().apply { addAll(saved.map(::decodeScreen)) } },
)

/** ViewModel scope for one back-stack entry, cleared when the entry leaves composition. */
@Composable
private fun rememberEntryStoreOwner(key: String): ViewModelStoreOwner {
    val owner = remember(key) {
        object : ViewModelStoreOwner {
            override val viewModelStore = ViewModelStore()
        }
    }
    DisposableEffect(owner) { onDispose { owner.viewModelStore.clear() } }
    return owner
}

@Composable
private fun OyeeRoot(
    container: AppContainer,
    pairLink: PairLink?,
    onPairLinkConsumed: () -> Unit,
    openNotification: String?,
    onOpenConsumed: () -> Unit,
) {
    val settings by container.settings.settings.collectAsStateWithLifecycle(initialValue = null)
    val current = settings ?: run {
        Box(Modifier.fillMaxSize())
        return
    }
    val scope = rememberCoroutineScope()

    if (!current.paired) {
        val vm: PairViewModel = viewModel { PairViewModel(container) }
        LaunchedEffect(pairLink) {
            pairLink?.let { vm.prefill(it.server, it.code); onPairLinkConsumed() }
        }
        PairScreen(vm)
        return
    }

    // Paired: ask for the notification permission once (Android 13+).
    NotificationPermissionRequest()

    if (pairLink != null) {
        AlertDialog(
            onDismissRequest = onPairLinkConsumed,
            title = { Text("Already paired") },
            text = { Text("This device is paired with ${current.serverUrl}. Unpair it and pair with the new code?") },
            confirmButton = {
                TextButton(onClick = {
                    // Keep the link so the pairing screen is prefilled after unpairing.
                    scope.launch { container.unpair(remote = true) }
                }) { Text("Unpair & continue") }
            },
            dismissButton = { TextButton(onClick = onPairLinkConsumed) { Text("Cancel") } },
        )
    }

    val backStack = rememberSaveable(saver = BackStackSaver) { mutableStateListOf<Screen>(Screen.Inbox) }
    LaunchedEffect(openNotification) {
        openNotification?.let { id ->
            while (backStack.size > 1) backStack.removeAt(backStack.lastIndex)
            backStack.add(Screen.Detail(id))
            onOpenConsumed()
        }
    }
    BackHandler(enabled = backStack.size > 1) { backStack.removeAt(backStack.lastIndex) }
    val pop: () -> Unit = { if (backStack.size > 1) backStack.removeAt(backStack.lastIndex) }

    when (val screen = backStack.last()) {
        Screen.Inbox -> {
            // Keyed by device so a re-pair (possibly another account/server) starts with a fresh inbox.
            val vm: InboxViewModel = viewModel(key = "inbox:${current.deviceId}") { InboxViewModel(container) }
            InboxScreen(vm, onOpen = { backStack.add(Screen.Detail(it)) }, onSettings = { backStack.add(Screen.Settings) })
        }
        is Screen.Detail -> {
            CompositionLocalProvider(LocalViewModelStoreOwner provides rememberEntryStoreOwner(screen.encode())) {
                val vm: DetailViewModel = viewModel { DetailViewModel(container, screen.id) }
                DetailScreen(vm, onBack = pop)
            }
        }
        Screen.Settings -> {
            val vm: SettingsViewModel = viewModel { SettingsViewModel(container) }
            SettingsScreen(vm, onBack = pop)
        }
    }
}

@Composable
private fun NotificationPermissionRequest() {
    if (Build.VERSION.SDK_INT < 33) return
    val context = androidx.compose.ui.platform.LocalContext.current
    var asked by rememberSaveable { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        if (!asked && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            asked = true
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
