package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.GistSync
import kotlinx.coroutines.launch

private val SettingsAccent = Color(0xFFE50914)

@Composable
fun SettingsScreen(onMalProfileChanged: (connected: Boolean, username: String?) -> Unit = { _, _ -> }) {
    var token by remember { mutableStateOf(GistSync.token) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(24.dp))

        AutomationCard()
        Spacer(Modifier.height(28.dp))

        MalCard(onProfileChanged = onMalProfileChanged)
        Spacer(Modifier.height(28.dp))

        Text("Cross-device Sync", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            "Shares Continue Watching with the desktop app via a private GitHub gist. " +
                "Paste the same token (gist scope) you use there.",
            style = MaterialTheme.typography.bodySmall,
            color = Color.White.copy(alpha = 0.5f),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("GitHub Token (gist scope)") },
            singleLine = true,
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = SettingsAccent,
                cursorColor = SettingsAccent,
            ),
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                onClick = {
                    GistSync.token = token.trim()
                    statusMessage = if (token.isBlank()) "Sync disabled." else "Token saved."
                },
                colors = ButtonDefaults.buttonColors(containerColor = SettingsAccent),
            ) { Text("Save") }
            OutlinedButton(
                enabled = GistSync.configured() && !busy,
                onClick = {
                    busy = true
                    statusMessage = "Syncing…"
                    scope.launch {
                        val result = runCatching { GistSync.pullAndMerge() }
                        statusMessage = if (result.isSuccess) "Synced ✓" else "Sync failed — check the token."
                        busy = false
                    }
                },
            ) { Text("Sync now") }
        }
        statusMessage?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, style = MaterialTheme.typography.labelMedium, color = SettingsAccent)
        }

        Spacer(Modifier.height(28.dp))
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
                .background(Color.White.copy(alpha = 0.04f)).padding(16.dp),
        ) {
            Text("About", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(
                "AniTrack is a personal anime tracker with MyAnimeList two-way sync, streaming, downloads, and native Android playback.",
                style = MaterialTheme.typography.bodySmall,
                color = Color.White.copy(alpha = 0.55f),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                "AniTrack is not affiliated with MyAnimeList or any streaming service.",
                style = MaterialTheme.typography.bodySmall,
                color = Color.White.copy(alpha = 0.55f),
            )
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier.clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = 0.06f))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Version", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.5f))
                Spacer(Modifier.width(10.dp))
                Text(
                    BuildConfig.VERSION_NAME,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}
