package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.BookmarkAdded
import androidx.compose.material.icons.rounded.Cancel
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.PauseCircle
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.WatchLater
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Anime
import kotlinx.coroutines.launch

// ── List status control (detail page "Add to list" / status dropdown) ─────────

/** Icon for a list status (anime or manga keys). */
internal fun statusIcon(key: String?): ImageVector = when (key) {
    "watching", "reading" -> Icons.Rounded.PlayCircle
    "completed" -> Icons.Rounded.CheckCircle
    "on_hold" -> Icons.Rounded.PauseCircle
    "dropped" -> Icons.Rounded.Cancel
    "plan_to_watch", "plan_to_read" -> Icons.Rounded.WatchLater
    else -> Icons.Rounded.BookmarkAdded
}

/**
 * Pill that shows the current list status (or "Add to list") and opens a
 * status menu; shared by anime and manga pages.
 */
@Composable
internal fun StatusMenuButton(
    status: String?,
    labels: Map<String, String>,
    onPick: (String) -> Unit,
    onRemove: () -> Unit,
    compact: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        PillButton(
            status?.let { labels[it] } ?: "Add to list",
            onClick = { open = true },
            icon = if (status == null) Icons.Rounded.Add else statusIcon(status),
            style = PillStyle.Tonal,
            compact = compact,
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((key, label) in labels) {
                DropdownMenuItem(
                    text = { Text(label) },
                    leadingIcon = { Icon(statusIcon(key), null, tint = if (key == status) AniColors.Accent else AniColors.TextSecondary) },
                    trailingIcon = if (key == status) ({ Icon(Icons.Rounded.Check, null, tint = AniColors.Text) }) else null,
                    onClick = {
                        open = false
                        onPick(key)
                    },
                )
            }
            if (status != null) {
                HorizontalDivider(color = AniColors.BorderSoft)
                DropdownMenuItem(
                    text = { Text("Remove from list", color = AniColors.Danger) },
                    leadingIcon = { Icon(Icons.Rounded.DeleteOutline, null, tint = AniColors.Danger) },
                    onClick = {
                        open = false
                        onRemove()
                    },
                )
            }
        }
    }
}

@Composable
internal fun ListStatusButton(anime: Anime, compact: Boolean = false) {
    var status by remember(anime.id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val labels = mapOf(
        "watching" to "Watching", "completed" to "Completed", "on_hold" to "On hold",
        "dropped" to "Dropped", "plan_to_watch" to "Plan to watch",
    )

    LaunchedEffect(anime.id) {
        runCatching { status = com.sanjay.anitrack.next.data.Db.listStatusOf(anime.id) }
    }

    StatusMenuButton(
        status, labels, compact = compact,
        onPick = { key ->
            scope.launch {
                val connected = com.sanjay.anitrack.next.data.Mal.isConnected
                com.sanjay.anitrack.next.data.Db.setListStatus(
                    anime.id, key, anime.title, anime.cover,
                    malId = anime.malId,
                    queueForMal = connected,
                    year = anime.year,
                    genres = anime.genres,
                    format = anime.format,
                )
                status = key
                if (connected) com.sanjay.anitrack.next.data.Mal.requestFlush()
            }
        },
        onRemove = {
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

/** Metadata chip on detail pages; [subtle] is the outlined genre style. */
@Composable
internal fun Chip(text: String, subtle: Boolean = false) {
    val shape = RoundedCornerShape(50)
    Box(
        Modifier
            .clip(shape)
            .background(if (subtle) Color.Transparent else Color.White.copy(alpha = 0.08f))
            .then(if (subtle) Modifier.border(1.dp, AniColors.Border, shape) else Modifier)
            .padding(horizontal = 12.dp, vertical = 5.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = if (subtle) AniColors.TextSecondary else AniColors.Text)
    }
}
