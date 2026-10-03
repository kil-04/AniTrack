package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.Bookmarks
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Db

// ── My List (local watch statuses) ────────────────────────────────────────────

private val statusLabels = mapOf(
    "watching" to "Watching",
    "completed" to "Completed",
    "on_hold" to "On hold",
    "dropped" to "Dropped",
    "plan_to_watch" to "Plan to watch",
)

@Composable
fun MyListScreen(onOpen: (Int) -> Unit, onBrowse: () -> Unit = {}) {
    var tab by remember { mutableStateOf("all") }
    var byStatus by remember { mutableStateOf<Map<String, List<Db.ListRow>>>(emptyMap()) }
    var loaded by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching {
            val m = LinkedHashMap<String, List<Db.ListRow>>()
            for (s in Db.STATUSES) m[s] = Db.listByStatus(s)
            byStatus = m
        }
        loaded = true
    }
    val rows = if (tab == "all") byStatus.values.flatten() else byStatus[tab].orEmpty()
    val total = byStatus.values.sumOf { it.size }

    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 20.dp)) {
        ScreenHeader(
            "My List",
            subtitle = if (total == 0) "Shows you track appear here." else "$total ${if (total == 1) "show" else "shows"} tracked",
            icon = Icons.Rounded.Bookmarks,
        )
        Spacer(Modifier.height(18.dp))
        PillTabs(
            listOf("all" to "All") + Db.STATUSES.map { it to (statusLabels[it] ?: it) },
            selected = tab,
            onSelect = { tab = it },
            counts = mapOf("all" to total) + Db.STATUSES.associateWith { byStatus[it]?.size ?: 0 },
        )
        Spacer(Modifier.height(18.dp))
        if (loaded && rows.isEmpty()) {
            EmptyState(
                Icons.Rounded.BookmarkBorder,
                if (tab == "all") "Your list is empty" else "Nothing in ${statusLabels[tab] ?: tab} yet",
                "Add shows with Add to list on their page, or connect MyAnimeList in Settings to import your list.",
                actionLabel = "Browse anime",
                onAction = onBrowse,
            )
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(150.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            items(rows.size) { i ->
                val r = rows[i]
                ListPosterCard(
                    cover = r.cover,
                    title = r.title,
                    status = r.status.takeIf { tab == "all" },
                    statusLabel = statusLabels[r.status],
                    score = r.score?.takeIf { it > 0 }?.toString(),
                    badge = null,
                    onClick = { onOpen(r.animeId) },
                )
            }
        }
    }
}

/** Grid card for list pages: cover, optional status / score / progress badge and the title over a scrim. */
@Composable
internal fun ListPosterCard(
    cover: String?,
    title: String,
    status: String?,
    statusLabel: String?,
    score: String?,
    badge: String?,
    onClick: () -> Unit,
) {
    Box(
        Modifier.fillMaxWidth().aspectRatio(2f / 3f)
            .clip(RoundedCornerShape(14.dp)).background(AniColors.Surface)
            .clickable(onClick = onClick),
    ) {
        PosterImage(cover, title, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(BottomScrim))
        badge?.let { Tag(it, Modifier.align(Alignment.TopStart).padding(8.dp), tone = TagTone.Accent) }
        ScoreBadge(score, Modifier.align(Alignment.TopEnd).padding(8.dp), onImage = true)
        Column(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
            if (status != null && statusLabel != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(statusIcon(status), null, tint = Color.White.copy(alpha = 0.7f), modifier = Modifier.size(13.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(statusLabel, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.7f))
                }
                Spacer(Modifier.height(2.dp))
            }
            Text(
                title,
                style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = Color.White,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
