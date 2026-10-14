package com.sanjay.anitrack.next.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.NotificationsActive
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.ReleaseAlerts
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** Settings: new-episode and new-chapter notifications. */
@Composable
internal fun NotificationsCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var episodes by remember { mutableStateOf(ReleaseAlerts.episodesOn(context)) }
    var chapters by remember { mutableStateOf(ReleaseAlerts.chaptersOn(context)) }
    var allowed by remember { mutableStateOf(ReleaseAlerts.canNotify(context)) }
    var checking by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<Pair<String, Boolean?>?>(null) }
    fun openSystemSettings() {
        context.startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
        )
    }
    var asked by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        allowed = ReleaseAlerts.canNotify(context)
    }
    fun askIfNeeded() {
        if (!ReleaseAlerts.canNotify(context) && Build.VERSION.SDK_INT >= 33) {
            asked = true
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    // Back from Android's settings page: pick up a changed permission.
    androidx.lifecycle.compose.LifecycleResumeEffect(Unit) {
        allowed = ReleaseAlerts.canNotify(context)
        onPauseOrDispose { }
    }

    SettingsSection(
        Icons.Rounded.NotificationsActive,
        "Notifications",
        "Get told when a new episode or chapter is out. AniTrack checks about every two hours while online.",
    ) {
        SwitchRow(
            "New episodes",
            "Shows you're watching or plan to watch, and Continue Watching.",
            episodes,
        ) {
            episodes = it
            ReleaseAlerts.setEpisodes(context, it)
            if (it) askIfNeeded()
        }
        SwitchRow(
            "New chapters",
            "Manga you're reading, on the source you read them from.",
            chapters,
        ) {
            chapters = it
            ReleaseAlerts.setChapters(context, it)
            if (it) askIfNeeded()
        }
        if ((episodes || chapters) && !allowed) {
            Spacer(Modifier.height(8.dp))
            StatusLine("Notifications are off for AniTrack, so nothing will show yet.", false)
            Spacer(Modifier.height(8.dp))
            PillButton(
                "Allow notifications",
                {
                    // Android shows its prompt a limited number of times; after that, its settings page.
                    if (Build.VERSION.SDK_INT >= 33 && !asked) askIfNeeded() else openSystemSettings()
                },
                icon = Icons.Rounded.Settings,
                compact = true,
            )
        }
        if (episodes || chapters) {
            Spacer(Modifier.height(12.dp))
            PillButton(
                "Check now",
                {
                    checking = true
                    result = null
                    scope.launch {
                        result = try {
                            val summary = ReleaseAlerts.check(context)
                            val parts = listOfNotNull(
                                summary.episodes.takeIf { it > 0 }?.let { "$it new episode${if (it == 1) "" else "s"}" },
                                summary.chapters.takeIf { it > 0 }?.let { "$it new chapter${if (it == 1) "" else "s"}" },
                            )
                            val missed = if (summary.skipped > 0) " (${summary.skipped} manga couldn't be checked — open them once to link a source.)" else ""
                            (if (parts.isEmpty()) "Nothing new right now.$missed" else parts.joinToString(" · ") + ".$missed") to true
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            "Couldn't check: ${e.message ?: "network error"}" to false
                        }
                        allowed = ReleaseAlerts.canNotify(context)
                        checking = false
                    }
                },
                icon = Icons.Rounded.Refresh,
                loading = checking,
                compact = true,
            )
            result?.let { (text, ok) ->
                Spacer(Modifier.height(8.dp))
                StatusLine(text, ok)
            }
        }
    }
}

@Composable
internal fun SwitchRow(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { onChange(!checked) }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.labelMedium, color = AniColors.TextTertiary)
        }
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, onCheckedChange = onChange, colors = SwitchDefaults.colors(checkedTrackColor = AniColors.Accent))
    }
}
