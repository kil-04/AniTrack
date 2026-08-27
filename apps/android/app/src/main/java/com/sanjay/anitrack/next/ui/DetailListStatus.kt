package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Anime
import kotlinx.coroutines.launch

private val Accent = Color(0xFFE50914)

// ── List status control (detail page "Add to list" / status dropdown) ─────────

@Composable
internal fun ListStatusButton(anime: Anime) {
    var status by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val labels = mapOf(
        "watching" to "Watching", "completed" to "Completed", "on_hold" to "On hold",
        "dropped" to "Dropped", "plan_to_watch" to "Plan to watch",
    )

    LaunchedEffect(anime.id) {
        runCatching { status = com.sanjay.anitrack.next.data.Db.listStatusOf(anime.id) }
    }

    Box {
        OutlinedButton(onClick = { open = true }) {
            Text(status?.let { labels[it] } ?: "+ Add to list")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((key, label) in labels) {
                DropdownMenuItem(
                    text = { Text(label) },
                    onClick = {
                        open = false
                        scope.launch {
                            val connected = com.sanjay.anitrack.next.data.Mal.isConnected
                            com.sanjay.anitrack.next.data.Db.setListStatus(
                                anime.id, key, anime.title, anime.cover,
                                malId = anime.malId,
                                queueForMal = connected,
                            )
                            status = key
                            if (connected) com.sanjay.anitrack.next.data.Mal.requestFlush()
                        }
                    },
                )
            }
            if (status != null) {
                DropdownMenuItem(
                    text = { Text("Remove from list", color = Color(0xFFFF6B6B)) },
                    onClick = {
                        open = false
                        scope.launch {
                            val connected = com.sanjay.anitrack.next.data.Mal.isConnected
                            com.sanjay.anitrack.next.data.Db.removeFromList(
                                anime.id,
                                malId = anime.malId,
                                queueForMal = connected,
                            )
                            status = null
                            if (connected) com.sanjay.anitrack.next.data.Mal.requestFlush()
                        }
                    },
                )
            }
        }
    }
}

@Composable
internal fun Chip(text: String, subtle: Boolean = false) {
    Box(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(if (subtle) Color.White.copy(alpha = 0.08f) else Accent.copy(alpha = 0.18f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.85f))
    }
}
