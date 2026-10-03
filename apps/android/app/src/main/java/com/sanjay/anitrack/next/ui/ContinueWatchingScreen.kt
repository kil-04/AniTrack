package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.KeyboardDoubleArrowLeft
import androidx.compose.material.icons.rounded.KeyboardDoubleArrowRight
import com.sanjay.anitrack.next.data.Db
import kotlinx.coroutines.launch

// ── Continue Watching (full page) ─────────────────────────────────────────────

@Composable
fun ContinueWatchingScreen(onPlay: () -> Unit) {
    var allRows by remember { mutableStateOf<List<Db.CwRow>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    var page by remember { mutableStateOf(0) }
    var resumingId by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        runCatching { allRows = Db.continueWatching(1000) }
        loaded = true
    }

    val pageSize = 24
    val pageCount = ((allRows.size + pageSize - 1) / pageSize).coerceAtLeast(1)
    val rows = allRows.drop(page * pageSize).take(pageSize)

    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 20.dp)) {
        ScreenHeader(
            "Continue Watching",
            subtitle = if (allRows.isEmpty()) "Pick up where you left off." else "${allRows.size} in progress",
            icon = Icons.Rounded.History,
        )
        Spacer(Modifier.height(18.dp))
        if (loaded && allRows.isEmpty()) {
            EmptyState(Icons.Rounded.History, "Nothing in progress", "Episodes you start watching show up here so you can resume them.")
        }
        // Portrait 2:3 cards: EP badge, timestamp, progress bar.
        LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp), modifier = Modifier.weight(1f)) {
            items(rows.size) { i ->
                val row = rows[i]
                Column {
                    Box(
                        Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                            .clip(RoundedCornerShape(14.dp)).background(AniColors.Surface)
                            .clickable {
                                if (resumingId != null) return@clickable
                                resumingId = row.animeId
                                scope.launch {
                                    val ok = prepareResume(row)
                                    resumingId = null
                                    if (ok) onPlay()
                                }
                            },
                    ) {
                        PosterImage(row.cover, row.title, Modifier.fillMaxSize())
                        Box(Modifier.fillMaxSize().background(BottomScrim))
                        Tag(
                            "EP ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode}",
                            Modifier.align(Alignment.TopStart).padding(8.dp),
                            tone = TagTone.Accent,
                        )
                        GlassIconButton(
                            Icons.Rounded.Close, "Remove from Continue Watching",
                            onClick = {
                                scope.launch {
                                    Db.dismiss(row.animeId)
                                    com.sanjay.anitrack.next.data.GistSync.deleteAnime(row.animeId)
                                    runCatching { allRows = Db.continueWatching(1000) }
                                }
                            },
                            modifier = Modifier.align(Alignment.TopEnd).padding(6.dp),
                            size = 26.dp,
                        )
                        if (resumingId == row.animeId) {
                            Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(30.dp))
                            }
                        }
                        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(10.dp)) {
                            Text(
                                "${fmtSecs(row.positionSec)} / ${fmtSecs(row.durationSec)}",
                                color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelSmall,
                            )
                            Spacer(Modifier.height(6.dp))
                            ProgressStrip(row.percent / 100f, Modifier.fillMaxWidth())
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(row.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = AniColors.Text)
                }
            }
        }
        if (pageCount > 1) NumberedPager(page, pageCount) { page = it }
    }
}

// Desktop-style pagination: « ‹ [1] [2] … [N] › » with the active page white.
@Composable
internal fun NumberedPager(page: Int, pageCount: Int, onPage: (Int) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        @Composable
        fun navBtn(icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, target: Int) {
            Box(
                Modifier.size(36.dp).clip(CircleShape)
                    .clickable(enabled = enabled) { onPage(target) },
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, tint = if (enabled) AniColors.TextSecondary else AniColors.TextTertiary.copy(alpha = 0.4f), modifier = Modifier.size(20.dp)) }
        }
        navBtn(Icons.Rounded.KeyboardDoubleArrowLeft, page > 0, 0)
        navBtn(Icons.Rounded.ChevronLeft, page > 0, page - 1)
        val pages = (0 until pageCount).filter { kotlin.math.abs(it - page) <= 2 || it == 0 || it == pageCount - 1 }
        var prev = -1
        for (p in pages) {
            if (prev >= 0 && p - prev > 1) Text("…", color = AniColors.TextTertiary, modifier = Modifier.padding(horizontal = 4.dp))
            prev = p
            Box(
                Modifier.padding(horizontal = 2.dp).sizeIn(minWidth = 36.dp, minHeight = 36.dp)
                    .clip(CircleShape)
                    .background(if (p == page) Color.White else Color.Transparent)
                    .clickable { onPage(p) }
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) { Text("${p + 1}", color = if (p == page) Color(0xFF0A0A0B) else AniColors.TextSecondary, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold) }
        }
        navBtn(Icons.Rounded.ChevronRight, page + 1 < pageCount, page + 1)
        navBtn(Icons.Rounded.KeyboardDoubleArrowRight, page + 1 < pageCount, pageCount - 1)
    }
}
