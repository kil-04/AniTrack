package com.sanjay.anitrack.next.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.RemoteConfig
import com.sanjay.anitrack.next.update.AppUpdater
import kotlinx.coroutines.launch

private val AutomationAccent = Color(0xFFE50914)

@Composable
fun AutomationCard() {
    val configStatus by RemoteConfig.status
    val updateStatus by AppUpdater.status
    val scope = rememberCoroutineScope()
    val activity = LocalContext.current as? Activity
    var configBusy by remember { mutableStateOf(false) }
    var updateBusy by remember { mutableStateOf(false) }
    var autoWifi by remember { mutableStateOf(runCatching { AppUpdater.autoDownloadWifi() }.getOrDefault(true)) }

    Column(Modifier.fillMaxWidth()) {
        Text("Automatic fixes & updates", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            "Signed provider rules update automatically. Native fixes download as a verified APK; Android asks once before installation.",
            style = MaterialTheme.typography.bodySmall,
            color = Color.White.copy(alpha = 0.55f),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            "App ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})  •  Rules r${configStatus.revision} (${configStatus.source})",
            style = MaterialTheme.typography.labelMedium,
            color = Color.White.copy(alpha = 0.75f),
        )
        configStatus.error?.let {
            Text(
                "Rule refresh failed; using the last verified copy. $it",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFFFFB74D),
            )
        }
        RemoteConfig.current().notice?.let {
            Spacer(Modifier.height(6.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = Color(0xFFFFB74D))
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            OutlinedButton(
                enabled = !configBusy,
                onClick = {
                    configBusy = true
                    scope.launch {
                        RemoteConfig.refresh()
                        configBusy = false
                    }
                },
            ) { Text(if (configBusy) "Refreshing…" else "Refresh rules") }
            OutlinedButton(
                enabled = !updateBusy && updateStatus.phase !in setOf("downloading", "verifying"),
                onClick = {
                    updateBusy = true
                    scope.launch {
                        AppUpdater.checkForUpdate()
                        updateBusy = false
                    }
                },
            ) { Text(if (updateBusy || updateStatus.phase == "checking") "Checking…" else "Check app update") }
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(
                checked = autoWifi,
                onCheckedChange = {
                    autoWifi = it
                    AppUpdater.setAutoDownloadWifi(it)
                },
            )
            Text("Auto-download verified APKs on Wi-Fi", style = MaterialTheme.typography.bodySmall)
        }

        when (updateStatus.phase) {
            "available" -> {
                Spacer(Modifier.height(10.dp))
                Text(
                    "AniTrack ${updateStatus.info?.versionName} is available.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                updateStatus.info?.notes?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.55f))
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { AppUpdater.downloadUpdate() },
                    colors = ButtonDefaults.buttonColors(containerColor = AutomationAccent),
                ) { Text("Download update") }
            }
            "downloading", "verifying" -> {
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    progress = { updateStatus.progress.coerceIn(0, 100) / 100f },
                )
                Text(
                    if (updateStatus.phase == "verifying") "Verifying APK signature…" else "Downloading update in the background…",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.6f),
                )
            }
            "ready" -> {
                Spacer(Modifier.height(10.dp))
                Text("Update downloaded and verified.", color = Color(0xFF66BB6A))
                Spacer(Modifier.height(8.dp))
                Button(
                    enabled = activity != null,
                    onClick = { activity?.let(AppUpdater::install) },
                    colors = ButtonDefaults.buttonColors(containerColor = AutomationAccent),
                ) { Text("Install update") }
            }
        }
        updateStatus.error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = Color(0xFFFF6B6B))
        }
    }
}
