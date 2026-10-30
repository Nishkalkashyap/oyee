package app.oyee.android.ui.pair

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.oyee.android.ui.components.BrandMark
import app.oyee.android.ui.components.PillButton
import app.oyee.android.ui.components.PillVariant
import app.oyee.android.ui.theme.Oyee
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

@Composable
fun PairScreen(vm: PairViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val c = Oyee.colors
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedContainerColor = c.secondary,
        unfocusedContainerColor = c.secondary,
        disabledContainerColor = c.secondary,
        focusedBorderColor = c.brand,
        unfocusedBorderColor = Color.Transparent,
        cursorColor = c.brand,
        focusedLabelColor = c.brand,
    )
    Scaffold(containerColor = c.background) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 22.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Spacer(Modifier.height(20.dp))
            BrandMark(size = 56.dp)
            Text("Pair this phone", style = MaterialTheme.typography.headlineLarge, color = c.foreground, modifier = Modifier.padding(top = 8.dp))
            Text(
                "On the web, open Home → Connect a device and enter the code shown there, or scan its QR code with your camera.",
                style = MaterialTheme.typography.bodyLarge,
                color = c.muted,
            )
            if (state.fromLink) {
                Text(
                    "Opened from a pairing link. Check the server below before pairing.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.chipForeground,
                    modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(c.chip).padding(horizontal = 14.dp, vertical = 10.dp),
                )
            }
            OutlinedTextField(
                value = state.serverUrl,
                onValueChange = vm::onServerUrl,
                label = { Text("Server URL") },
                singleLine = true,
                enabled = !state.busy,
                shape = RoundedCornerShape(16.dp),
                colors = fieldColors,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = state.code,
                onValueChange = vm::onCode,
                label = { Text("Pairing code") },
                placeholder = { Text("XXXX-XXXX") },
                singleLine = true,
                enabled = !state.busy,
                shape = RoundedCornerShape(16.dp),
                colors = fieldColors,
                textStyle = MaterialTheme.typography.titleLarge.copy(fontFamily = FontFamily.Monospace, letterSpacing = 3.sp),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Done,
                    autoCorrectEnabled = false,
                ),
                keyboardActions = KeyboardActions(onDone = { vm.pair() }),
                modifier = Modifier.fillMaxWidth(),
            )
            state.error?.let { Text(it, color = Color(0xFFDC2626), style = MaterialTheme.typography.bodyMedium) }
            Spacer(Modifier.height(4.dp))
            PillButton(onClick = vm::pair, variant = PillVariant.Brand, enabled = !state.busy, height = 50.dp, modifier = Modifier.fillMaxWidth()) {
                if (state.busy) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = c.brandForeground)
                } else {
                    Text("Pair this device", fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}
