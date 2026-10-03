package com.sanjay.anitrack.next.ui

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.InstallMobile
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.Update
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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

@Composable
fun AutomationCard() {
    val configStatus by RemoteConfig.status
    val updateStatus by AppUpdater.status
    val scope = rememberCoroutineScope()
    val activity = LocalContext.current as? Activity
    var configBusy by remember { mutableStateOf(false) }
    var updateBusy by remember { mutableStateOf(false) }
    var autoWifi by remember { mutableStateOf(runCatching { AppUpdater.autoDownloadWifi() }.getOrDefault(true)) }

    SettingsSection(
        Icons.Rounded.SystemUpdate,
        "Automatic fixes & updates",
        "Signed provider rules update automatically. App fixes download as a verified APK; Android asks once before installing.",
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tag("App ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            Tag("Rules r${configStatus.revision} · ${configStatus.source}")
        }
        configStatus.error?.let {
            Spacer(Modifier.height(10.dp))
            Text(
                "Rule refresh failed; using the last verified copy. $it",
                style = MaterialTheme.typography.bodySmall,
                color = AniColors.Warning,
            )
        }
        RemoteConfig.current().notice?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, style = MaterialTheme.typography.bodySmall, color = AniColors.Warning)
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PillButton(
                if (configBusy) "Refreshing…" else "Refresh rules",
                onClick = {
                    configBusy = true
                    scope.launch {
                        RemoteConfig.refresh()
                        configBusy = false
                    }
                },
                icon = Icons.Rounded.Refresh,
                loading = configBusy,
            )
            PillButton(
                if (updateBusy || updateStatus.phase == "checking") "Checking…" else "Check for update",
                onClick = {
                    updateBusy = true
                    scope.launch {
                        AppUpdater.checkForUpdate()
                        updateBusy = false
                    }
                },
                icon = Icons.Rounded.Update,
                enabled = updateStatus.phase !in setOf("downloading", "verifying"),
                loading = updateBusy || updateStatus.phase == "checking",
            )
        }
        Spacer(Modifier.height(14.dp))
        HorizontalDivider(color = AniColors.BorderSoft)
        Row(
            Modifier.fillMaxWidth().padding(vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text("Auto-download updates on Wi-Fi", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                Text("Verified APKs download in the background; you still confirm the install.", style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary)
            }
            Spacer(Modifier.width(12.dp))
            Switch(
                checked = autoWifi,
                onCheckedChange = {
                    autoWifi = it
                    AppUpdater.setAutoDownloadWifi(it)
                },
            )
        }

        when (updateStatus.phase) {
            "available" -> {
                Spacer(Modifier.height(6.dp))
                StatusLine("AniTrack ${updateStatus.info?.versionName} is available.", true)
                updateStatus.info?.notes?.takeIf { it.isNotBlank() }?.let {
                    Spacer(Modifier.height(4.dp))
                    Text(it, style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary)
                }
                Spacer(Modifier.height(10.dp))
                PillButton("Download update", { AppUpdater.downloadUpdate() }, icon = Icons.Rounded.Download, style = PillStyle.Primary)
            }
            "downloading", "verifying" -> {
                Spacer(Modifier.height(6.dp))
                ProgressStrip(updateStatus.progress.coerceIn(0, 100) / 100f, Modifier.fillMaxWidth(), height = 6.dp, track = AniColors.SurfaceHighest)
                Spacer(Modifier.height(6.dp))
                Text(
                    if (updateStatus.phase == "verifying") "Verifying APK signature…" else "Downloading update in the background…",
                    style = MaterialTheme.typography.bodySmall,
                    color = AniColors.TextSecondary,
                )
            }
            "ready" -> {
                Spacer(Modifier.height(6.dp))
                StatusLine("Update downloaded and verified.", true)
                Spacer(Modifier.height(10.dp))
                PillButton(
                    "Install update",
                    { activity?.let(AppUpdater::install) },
                    icon = Icons.Rounded.InstallMobile,
                    style = PillStyle.Primary,
                    enabled = activity != null,
                )
            }
        }
        updateStatus.error?.let {
            Spacer(Modifier.height(8.dp))
            StatusLine(it, false)
        }
    }
}
