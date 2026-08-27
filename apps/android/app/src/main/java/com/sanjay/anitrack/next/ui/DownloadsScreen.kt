package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.border
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.ui.layout.ContentScale as CS
import coil.compose.AsyncImage

private val Accent = Color(0xFFE50914)

// ── Downloads (offline HLS library) ───────────────────────────────────────────

@Composable
fun DownloadsScreen(onPlay: () -> Unit, onOpenAnime: (Int) -> Unit = {}) {
    val items = com.sanjay.anitrack.next.data.Downloads.items
    // Group by anime (title), sorted; each group collapsible with a total size.
    val groups = items.groupBy { it.animeId }.values.toList()
    val expanded = remember { mutableStateMapOf<Int, Boolean>() }

    fun playLocal(d: com.sanjay.anitrack.next.data.Downloads.Item) {
        val f = com.sanjay.anitrack.next.data.Downloads.localPlaylist(d.id) ?: return
        com.sanjay.anitrack.next.data.PlaySession.apply {
            provider = "anikoto"; animeId = d.animeId; animeTitle = d.title; animeCover = d.cover
            anime = null; localFile = f.absolutePath
            slug = ""; anikotoEps = listOf(com.sanjay.anitrack.next.data.Anikoto.Episode(d.episode, "Episode ${d.episode.toInt()}", "", ""))
            paheEps = emptyList(); index = 0
        }
        onPlay()
    }

    // Desktop layout: centered, max-width column; bordered group cards.
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.FileDownload, null, tint = Accent, modifier = Modifier.size(24.dp))
                Spacer(Modifier.width(8.dp))
                Text("Downloads", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(2.dp))
            Text("Watch downloaded episodes offline, in the app.", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.4f))
            Spacer(Modifier.height(20.dp))

            if (items.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .androidxBorder()
                        .background(Color.White.copy(alpha = 0.05f))
                        .padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "No downloads yet. Tap Download on an episode (or \"Download 100\") on a series page.",
                        style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.4f),
                    )
                }
            }

            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(groups.size) { gi ->
                    val group = groups[gi].sortedBy { it.episode }
                    val head = group.first()
                    val open = expanded[head.animeId] ?: false   // collapsed by default, like desktop
                    val done = group.filter { it.status == com.sanjay.anitrack.next.data.Downloads.Status.DONE }
                    val active = group.count {
                        it.status == com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING ||
                            it.status == com.sanjay.anitrack.next.data.Downloads.Status.QUEUED
                    }
                    val totalSize = done.sumOf { it.sizeBytes }
                    val summary = buildString {
                        append("${done.size} episode${if (done.size == 1) "" else "s"}")
                        if (totalSize > 0) append(" · ${com.sanjay.anitrack.next.data.Downloads.humanSize(totalSize)}")
                        if (active > 0) append(" · $active downloading")
                    }
                    Column(
                        Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .androidxBorder()
                            .background(Color.White.copy(alpha = 0.03f)),
                    ) {
                        // Header row: tap → expand/collapse; cover/title → series page.
                        Row(
                            Modifier.fillMaxWidth().clickable { expanded[head.animeId] = !open }
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            AsyncImage(
                                model = head.cover, contentDescription = head.title, contentScale = CS.Crop,
                                modifier = Modifier.width(36.dp).height(48.dp).clip(RoundedCornerShape(4.dp)).background(Color.White.copy(alpha = 0.05f))
                                    .clickable(enabled = head.animeId > 0) { onOpenAnime(head.animeId) },
                            )
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    head.title,
                                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                                    textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.clickable(enabled = head.animeId > 0) { onOpenAnime(head.animeId) },
                                )
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    if (active > 0) CircularProgressIndicator(Modifier.size(11.dp), strokeWidth = 1.5.dp, color = Color.White.copy(alpha = 0.4f))
                                    Text(summary, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
                                }
                            }
                            Icon(
                                if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                                null, tint = Color.White.copy(alpha = 0.4f),
                            )
                        }
                        if (open) {
                            HorizontalDivider(color = Color.White.copy(alpha = 0.1f))
                            group.forEachIndexed { i, d ->
                                if (i > 0) HorizontalDivider(color = Color.White.copy(alpha = 0.05f))
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text("Episode ${if (d.episode % 1f == 0f) d.episode.toInt() else d.episode}", style = MaterialTheme.typography.bodyMedium, color = Color.White)
                                        val sub = when (d.status) {
                                            com.sanjay.anitrack.next.data.Downloads.Status.QUEUED -> "Queued"
                                            com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING -> "Downloading… ${d.progress}%"
                                            com.sanjay.anitrack.next.data.Downloads.Status.DONE -> com.sanjay.anitrack.next.data.Downloads.humanSize(d.sizeBytes)
                                            com.sanjay.anitrack.next.data.Downloads.Status.FAILED -> d.error ?: "Failed"
                                        }
                                        Text(sub, style = MaterialTheme.typography.labelSmall, color = if (d.status == com.sanjay.anitrack.next.data.Downloads.Status.FAILED) Color(0xFFFF6B6B) else Color.White.copy(alpha = 0.45f))
                                    }
                                    when (d.status) {
                                        com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White.copy(alpha = 0.6f))
                                            Text("${d.progress}%", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
                                        }
                                        com.sanjay.anitrack.next.data.Downloads.Status.QUEUED ->
                                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White.copy(alpha = 0.4f))
                                        com.sanjay.anitrack.next.data.Downloads.Status.DONE -> Row(
                                            Modifier.height(32.dp).clip(RoundedCornerShape(6.dp)).background(Accent)
                                                .clickable { playLocal(d) }.padding(horizontal = 12.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(14.dp))
                                            Spacer(Modifier.width(5.dp))
                                            Text("Play", color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                                        }
                                        else -> {}
                                    }
                                    Box(
                                        Modifier.size(32.dp).clip(RoundedCornerShape(6.dp))
                                            .clickable { com.sanjay.anitrack.next.data.Downloads.remove(d.id) },
                                        contentAlignment = Alignment.Center,
                                    ) { Icon(Icons.Filled.Delete, "Delete", tint = Color.White.copy(alpha = 0.4f), modifier = Modifier.size(16.dp)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// 1dp white/10 border, matching the desktop's border-white/10 cards.
private fun Modifier.androidxBorder(): Modifier =
    this.then(Modifier.border(1.dp, Color.White.copy(alpha = 0.1f), RoundedCornerShape(10.dp)))
