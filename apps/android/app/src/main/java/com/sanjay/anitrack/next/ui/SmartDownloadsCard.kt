package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DownloadForOffline
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.SmartDownloads
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Settings: keep the next episodes and chapters downloaded automatically. */
@Composable
internal fun SmartDownloadsCard() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var on by remember { mutableStateOf(SmartDownloads.isOn(context)) }
    var ahead by remember { mutableIntStateOf(SmartDownloads.episodesAhead(context)) }
    var chapters by remember { mutableIntStateOf(SmartDownloads.chaptersAhead(context)) }
    var wifi by remember { mutableStateOf(SmartDownloads.wifiOnly(context)) }
    var tidy by remember { mutableStateOf(SmartDownloads.cleanup(context)) }
    var status by remember { mutableStateOf(SmartDownloads.lastStatus(context)) }
    var running by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }

    SettingsSection(
        Icons.Rounded.DownloadForOffline,
        "Smart downloads",
        "Keeps what you'll watch and read next saved for offline, and tidies up once you're done.",
    ) {
        SwitchRow(
            "Keep the next episodes ready",
            "Shows from Continue Watching in the last three weeks, saved from Anikoto.",
            on,
        ) {
            on = it
            SmartDownloads.setOn(context, it)
        }
        if (on) {
            ChoiceRow("Episodes ahead", SmartDownloads.EPISODE_CHOICES, ahead, { "$it" }) {
                ahead = it
                SmartDownloads.setEpisodesAhead(context, it)
            }
            ChoiceRow("Manga chapters ahead", SmartDownloads.CHAPTER_CHOICES, chapters, { if (it == 0) "Off" else "$it" }) {
                chapters = it
                SmartDownloads.setChaptersAhead(context, it)
            }
            SwitchRow("Wi-Fi only", "Never use mobile data for these downloads.", wifi) {
                wifi = it
                SmartDownloads.setWifiOnly(context, it)
            }
            SwitchRow(
                "Delete after watching",
                "Clears the episodes and chapters it saved once you've finished them. Your own downloads stay.",
                tidy,
            ) {
                tidy = it
                SmartDownloads.setCleanup(context, it)
            }
            Spacer(Modifier.height(12.dp))
            PillButton(
                "Run now",
                {
                    running = true
                    failed = false
                    scope.launch {
                        try {
                            withContext(Dispatchers.IO) { SmartDownloads.run(context, background = false) }
                        } catch (e: CancellationException) {
                            throw e
                        } catch (_: Exception) {
                            failed = true
                        }
                        status = SmartDownloads.lastStatus(context)
                        running = false
                    }
                },
                icon = Icons.Rounded.Refresh,
                loading = running,
                compact = true,
            )
            val shown = if (failed) "Couldn't check right now. It'll try again later." else status
            shown?.let {
                Spacer(Modifier.height(8.dp))
                StatusLine(it, if (failed) false else null)
            }
        }
    }
}

@Composable
private fun ChoiceRow(title: String, choices: List<Int>, selected: Int, label: (Int) -> String, onSelect: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        PillTabs(
            choices.map { it.toString() to label(it) },
            selected.toString(),
            { key -> key.toIntOrNull()?.let(onSelect) },
            compact = true,
        )
    }
}
