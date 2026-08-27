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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardDoubleArrowLeft
import androidx.compose.material.icons.filled.KeyboardDoubleArrowRight
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.ui.layout.ContentScale as CS
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Db
import kotlinx.coroutines.launch

private val Accent = Color(0xFFE50914)

// ── Continue Watching (full page) ─────────────────────────────────────────────

@Composable
fun ContinueWatchingScreen(onPlay: () -> Unit) {
    var allRows by remember { mutableStateOf<List<Db.CwRow>>(emptyList()) }
    var page by remember { mutableStateOf(0) }
    var resumingId by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { runCatching { allRows = Db.continueWatching(1000) } }

    val pageSize = 24
    val pageCount = ((allRows.size + pageSize - 1) / pageSize).coerceAtLeast(1)
    val rows = allRows.drop(page * pageSize).take(pageSize)

    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 16.dp)) {
        // Desktop header: clock icon + title + count chip.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Schedule, null, tint = Color.White, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("Continue Watching", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (allRows.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                Box(Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
                    Text("${allRows.size}", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f))
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        if (allRows.isEmpty()) {
            Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) {
                Text("Nothing here yet — start watching something!", color = Color.White.copy(alpha = 0.3f), style = MaterialTheme.typography.bodySmall)
            }
        }
        // Desktop grid: portrait 2:3 cards, EP badge, timestamp, red progress strip.
        LazyVerticalGrid(columns = GridCells.Adaptive(120.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.weight(1f)) {
            items(rows.size) { i ->
                val row = rows[i]
                Column {
                    Box(
                        Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                            .clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.05f))
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
                        AsyncImage(
                            model = row.cover, contentDescription = row.title, contentScale = CS.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                        Box(
                            Modifier.fillMaxSize().background(
                                androidx.compose.ui.graphics.Brush.verticalGradient(
                                    0f to Color.Transparent, 0.5f to Color.Black.copy(alpha = 0.2f), 1f to Color.Black.copy(alpha = 0.9f),
                                ),
                            ),
                        )
                        // EP badge (red, top-left)
                        Box(
                            Modifier.align(Alignment.TopStart).padding(6.dp)
                                .clip(RoundedCornerShape(4.dp)).background(Accent).padding(horizontal = 6.dp, vertical = 2.dp),
                        ) { Text("EP ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode}", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
                        // ✕ dismiss (top-right)
                        Box(
                            Modifier.align(Alignment.TopEnd).padding(6.dp)
                                .size(22.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.7f))
                                .clickable {
                                    scope.launch {
                                        Db.dismiss(row.animeId)
                                        com.sanjay.anitrack.next.data.GistSync.deleteAnime(row.animeId)
                                        runCatching { allRows = Db.continueWatching(1000) }
                                    }
                                },
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Filled.Close, "Dismiss", tint = Color.White, modifier = Modifier.size(12.dp)) }
                        if (resumingId == row.animeId) {
                            Box(Modifier.matchParentSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Accent, modifier = Modifier.size(28.dp)) }
                        }
                        // Timestamp just above the progress strip (desktop)
                        Text(
                            "${com.sanjay.anitrack.next.ui.fmtSecs(row.positionSec)} / ${com.sanjay.anitrack.next.ui.fmtSecs(row.durationSec)}",
                            color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.align(Alignment.BottomStart).padding(start = 8.dp, bottom = 10.dp),
                        )
                        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp).background(Color.White.copy(alpha = 0.2f))) {
                            Box(Modifier.fillMaxWidth(fraction = (row.percent / 100f).coerceIn(0f, 1f)).fillMaxHeight().background(Accent))
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(row.title, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.8f))
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
                Modifier.size(32.dp).clip(RoundedCornerShape(6.dp))
                    .clickable(enabled = enabled) { onPage(target) },
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, tint = Color.White.copy(alpha = if (enabled) 0.5f else 0.2f), modifier = Modifier.size(16.dp)) }
        }
        navBtn(Icons.Filled.KeyboardDoubleArrowLeft, page > 0, 0)
        navBtn(Icons.Filled.ChevronLeft, page > 0, page - 1)
        val pages = (0 until pageCount).filter { kotlin.math.abs(it - page) <= 2 || it == 0 || it == pageCount - 1 }
        var prev = -1
        for (p in pages) {
            if (prev >= 0 && p - prev > 1) Text("…", color = Color.White.copy(alpha = 0.3f), modifier = Modifier.padding(horizontal = 4.dp))
            prev = p
            Box(
                Modifier.padding(horizontal = 2.dp).sizeIn(minWidth = 32.dp, minHeight = 32.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (p == page) Color.White else Color.Transparent)
                    .clickable { onPage(p) }
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) { Text("${p + 1}", color = if (p == page) Color.Black else Color.White.copy(alpha = 0.6f), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
        }
        navBtn(Icons.Filled.ChevronRight, page + 1 < pageCount, page + 1)
        navBtn(Icons.Filled.KeyboardDoubleArrowRight, page + 1 < pageCount, pageCount - 1)
    }
}
