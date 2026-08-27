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
import androidx.compose.ui.layout.ContentScale as CS
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList

private val Accent = Color(0xFFE50914)

// ── Latest Episodes (full page) ───────────────────────────────────────────────

@Composable
fun LatestScreen(onOpen: (Anime) -> Unit) {
    var list by remember { mutableStateOf<List<AniList.Airing>>(emptyList()) }
    var page by remember { mutableStateOf(1) }
    var hasNext by remember { mutableStateOf(false) }
    LaunchedEffect(page) {
        runCatching {
            val (l, hn) = AniList.recentEpisodes(page)
            list = l; hasNext = hn
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Latest Episodes", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        LazyVerticalGrid(columns = GridCells.Adaptive(180.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.weight(1f)) {
            items(list.size) { i ->
                val a = list[i]
                Column(Modifier.clickable { onOpen(a.anime) }) {
                    Box {
                        AsyncImage(
                            model = a.anime.banner ?: a.anime.cover, contentDescription = a.anime.title, contentScale = CS.Crop,
                            modifier = Modifier.fillMaxWidth().height(100.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.06f)),
                        )
                        Box(Modifier.align(Alignment.TopStart).padding(6.dp).clip(RoundedCornerShape(6.dp)).background(Accent).padding(horizontal = 7.dp, vertical = 2.dp)) {
                            Text("EP ${a.episode}", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(a.anime.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { if (page > 1) page-- }, enabled = page > 1) { Text("‹ Prev") }
            Text("Page $page", color = Color.White.copy(alpha = 0.7f))
            TextButton(onClick = { if (hasNext) page++ }, enabled = hasNext) { Text("Next ›") }
        }
    }
}
