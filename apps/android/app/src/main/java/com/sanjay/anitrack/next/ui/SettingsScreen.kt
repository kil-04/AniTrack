package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.GistSync
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(onMalProfileChanged: (connected: Boolean, username: String?) -> Unit = { _, _ -> }) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 880.dp).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            ScreenHeader("Settings", subtitle = "Accounts, sync and app updates.", icon = Icons.Rounded.Settings)
            Spacer(Modifier.height(4.dp))
            MalCard(onProfileChanged = onMalProfileChanged)
            SyncCard()
            AutomationCard()
            AboutCard()
        }
    }
}

/** Card with an icon-tile header, used for every Settings section. */
@Composable
internal fun SettingsSection(
    icon: ImageVector,
    title: String,
    description: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    AniCard(padding = PaddingValues(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(icon, size = 40.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(description, style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary)
            }
        }
        Spacer(Modifier.height(16.dp))
        content()
    }
}

/** A status line with a leading icon (success / problem / neutral). */
@Composable
internal fun StatusLine(text: String, ok: Boolean? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        val color = when (ok) {
            true -> AniColors.Success
            false -> AniColors.Danger
            null -> AniColors.TextSecondary
        }
        Icon(
            when (ok) {
                true -> Icons.Rounded.CheckCircle
                false -> Icons.Rounded.ErrorOutline
                null -> Icons.Rounded.Info
            },
            null, tint = color, modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = color)
    }
}

@Composable
private fun SyncCard() {
    var token by remember { mutableStateOf(GistSync.token) }
    var statusMessage by remember { mutableStateOf<Pair<String, Boolean?>?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    SettingsSection(
        Icons.Rounded.CloudSync,
        "Cross-device sync",
        "Shares Continue Watching with the desktop app through a private GitHub gist. Use the same token (gist scope) as on desktop.",
    ) {
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("GitHub token (gist scope)") },
            singleLine = true,
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = AniColors.Accent,
                unfocusedBorderColor = AniColors.Border,
                cursorColor = AniColors.Accent,
                focusedLabelColor = AniColors.Accent,
            ),
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            PillButton(
                "Save",
                onClick = {
                    GistSync.token = token.trim()
                    statusMessage = (if (token.isBlank()) "Sync turned off." else "Token saved.") to true
                },
                icon = Icons.Rounded.Save,
                style = PillStyle.Primary,
            )
            PillButton(
                "Sync now",
                onClick = {
                    busy = true
                    statusMessage = "Syncing…" to null
                    scope.launch {
                        val result = runCatching { GistSync.pullAndMerge() }
                        statusMessage = if (result.isSuccess) "Synced" to true else "Sync failed. Check the token." to false
                        busy = false
                    }
                },
                icon = Icons.Rounded.Sync,
                enabled = GistSync.configured(),
                loading = busy,
            )
        }
        statusMessage?.let { (text, ok) ->
            Spacer(Modifier.height(10.dp))
            StatusLine(text, ok)
        }
    }
}

@Composable
private fun AboutCard() {
    AniCard(padding = PaddingValues(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AniLogo(size = 44.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                AniWordmarkText()
                Text("Version ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium, color = AniColors.TextSecondary)
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(
            "A personal anime and manga tracker with MyAnimeList two-way sync, streaming, offline downloads and native playback.",
            style = MaterialTheme.typography.bodySmall,
            color = AniColors.TextSecondary,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            "AniTrack is not affiliated with MyAnimeList, AniList or any streaming service.",
            style = MaterialTheme.typography.bodySmall,
            color = AniColors.TextTertiary,
        )
    }
}

@Composable
private fun AniWordmarkText() {
    Text(
        androidx.compose.ui.text.buildAnnotatedString {
            pushStyle(androidx.compose.ui.text.SpanStyle(color = AniColors.Text))
            append("Ani")
            pop()
            pushStyle(androidx.compose.ui.text.SpanStyle(color = AniColors.Accent))
            append("Track")
            pop()
        },
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.ExtraBold,
    )
}
