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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime
import kotlinx.coroutines.delay

private val HomeAccent = Color(0xFFE50914)

@Composable
internal fun LatestCard(anime: Anime, episode: Int, onOpen: (Anime) -> Unit) {
    Column(Modifier.width(200.dp).clickable { onOpen(anime) }) {
        Box {
            AsyncImage(
                model = anime.banner ?: anime.cover,
                contentDescription = anime.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.width(200.dp).height(112.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.06f)),
            )
            Box(
                Modifier.align(Alignment.TopStart).padding(6.dp).clip(RoundedCornerShape(6.dp)).background(HomeAccent).padding(horizontal = 7.dp, vertical = 2.dp),
            ) { Text("EP $episode", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
        }
        Spacer(Modifier.height(6.dp))
        Text(anime.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
    }
}

// Ranked Top-10 list row.
@Composable
internal fun Top10Row(rank: Int, anime: Anime, onOpen: (Anime) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable { onOpen(anime) }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("$rank", Modifier.width(34.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, color = Color.White.copy(alpha = 0.35f))
        AsyncImage(
            model = anime.cover,
            contentDescription = anime.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.width(40.dp).height(56.dp).clip(RoundedCornerShape(6.dp)).background(Color.White.copy(alpha = 0.06f)),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(anime.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            anime.score?.let { Text("★ ${it / 10.0}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF7CD07C)) }
        }
    }
}

// Swipeable hero carousel (the desktop app's trending spotlight, multiple).
@Composable
internal fun HeroCarousel(list: List<Anime>, onOpen: (Anime) -> Unit) {
    if (list.isEmpty()) return
    val pager = androidx.compose.foundation.pager.rememberPagerState(pageCount = { list.size })
    // Auto-advance every 6s.
    LaunchedEffect(pager) {
        while (true) {
            kotlinx.coroutines.delay(6000)
            val next = (pager.currentPage + 1) % list.size
            runCatching { pager.animateScrollToPage(next) }
        }
    }
    Box {
        androidx.compose.foundation.pager.HorizontalPager(state = pager) { page ->
            HeroBanner(list[page], onOpen)
        }
        // Dot indicators
        Row(
            Modifier.align(Alignment.BottomCenter).padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            for (i in list.indices) {
                Box(
                    Modifier.size(if (i == pager.currentPage) 22.dp else 7.dp, 7.dp)
                        .clip(RoundedCornerShape(50))
                        .background(if (i == pager.currentPage) HomeAccent else Color.White.copy(alpha = 0.4f)),
                )
            }
        }
    }
}

// Anikoto Top 10 with Day / Week / Month tabs (matches the desktop rail).
@Composable
internal fun AnikotoTop10(
    tabs: Map<String, List<com.sanjay.anitrack.next.data.Anikoto.TopItem>>,
    onOpenTitle: (String) -> Unit,
) {
    var tab by remember { mutableStateOf("day") }
    Column {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(4.dp).height(18.dp).clip(RoundedCornerShape(2.dp)).background(HomeAccent))
            Spacer(Modifier.width(8.dp))
            Text("Top 10", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            listOf("day" to "Day", "week" to "Week", "month" to "Month").forEach { (k, label) ->
                Text(
                    label,
                    modifier = Modifier.clickable { tab = k }.padding(horizontal = 8.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (tab == k) HomeAccent else Color.White.copy(alpha = 0.5f),
                    fontWeight = if (tab == k) FontWeight.Bold else FontWeight.Normal,
                )
            }
        }
        Column(Modifier.padding(horizontal = 16.dp)) {
            (tabs[tab] ?: emptyList()).forEachIndexed { i, item ->
                Row(
                    Modifier.fillMaxWidth().clickable { onOpenTitle(item.title) }.padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${i + 1}", Modifier.width(34.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.ExtraBold, color = Color.White.copy(alpha = 0.35f))
                    AsyncImage(
                        model = item.poster,
                        contentDescription = item.title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.width(40.dp).height(56.dp).clip(RoundedCornerShape(6.dp)).background(Color.White.copy(alpha = 0.06f)),
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(item.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

// Full-bleed hero banner (the desktop app's #1 trending spotlight).
@Composable
internal fun HeroBanner(anime: Anime, onOpen: (Anime) -> Unit) {
    Box(Modifier.fillMaxWidth().height(360.dp).clickable { onOpen(anime) }) {
        AsyncImage(
            model = anime.banner ?: anime.cover,
            contentDescription = anime.title,
            contentScale = ContentScale.Crop,
            alignment = Alignment.TopCenter,   // favour the top of the art, not the middle
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            Modifier.fillMaxSize().background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    0f to Color.Transparent, 0.55f to Color.Black.copy(alpha = 0.65f), 1f to Color.Black,
                ),
            ),
        )
        Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
            Text("TRENDING NOW", style = MaterialTheme.typography.labelSmall, color = HomeAccent, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(anime.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                anime.year?.let { Text("$it", color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.labelMedium) }
                anime.status?.let { Text(it, color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.labelMedium) }
            }
            Spacer(Modifier.height(10.dp))
            Button(onClick = { onOpen(anime) }, colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black)) {
                Text("▶  Play Now", fontWeight = FontWeight.Bold)
            }
        }
    }
}

// m:ss / h:mm:ss — the desktop's secondsToTimestamp.
