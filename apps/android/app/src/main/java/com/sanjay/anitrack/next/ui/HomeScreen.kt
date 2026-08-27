package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
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
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.RemoteConfig
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.Providers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val HomeAccent = Color(0xFFE50914)

// ── Home ──────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(
    onOpen: (Anime) -> Unit,
    onPlay: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenContinue: () -> Unit = {},
    onOpenLatest: () -> Unit = {},
) {
    var trending by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var latest by remember { mutableStateOf<List<com.sanjay.anitrack.next.data.AniList.Airing>>(emptyList()) }
    var topAiring by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var popular by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var anikotoTop by remember { mutableStateOf<Map<String, List<com.sanjay.anitrack.next.data.Anikoto.TopItem>>>(emptyMap()) }
    var cw by remember { mutableStateOf<List<com.sanjay.anitrack.next.data.Db.CwRow>>(emptyList()) }
    var epTotals by remember { mutableStateOf<Map<Int, Int>>(emptyMap()) }
    var loading by remember { mutableStateOf(true) }
    var resumingId by remember { mutableStateOf<Int?>(null) }
    var opening by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Resolve an Anikoto Top-10 slug/title to an AniList show, then open it.
    fun openByTitle(title: String) {
        if (opening) return
        opening = true
        scope.launch {
            val hit = runCatching { AniList.search(title).firstOrNull() }.getOrNull()
            opening = false
            if (hit != null) onOpen(hit)
        }
    }

    LaunchedEffect(Unit) {
        // Local data first — instant; network rows stream in after.
        runCatching { cw = com.sanjay.anitrack.next.data.Db.continueWatching() }
        scope.launch {
            val changed = runCatching { com.sanjay.anitrack.next.data.GistSync.pullAndMerge() }.getOrDefault(false)
            if (changed) runCatching { cw = com.sanjay.anitrack.next.data.Db.continueWatching() }
            // "EP total ▲" badges — one batched AniList query (desktop parity).
            runCatching { epTotals = AniList.episodeTotals(cw.map { it.animeId }) }
        }
        // Rows stream in as each lands (the client serializes requests anyway).
        runCatching { trending = AniList.trending() }
        loading = false
        runCatching { latest = AniList.recentEpisodes().first }
        runCatching { topAiring = AniList.topAiring() }
        runCatching { popular = AniList.mostPopular() }
        // Anikoto Top 10 (Day/Week/Month) — same source as the desktop app.
        scope.launch { runCatching { anikotoTop = com.sanjay.anitrack.next.data.Anikoto.top() } }
    }

    // The top bar (both orientations) carries the search now — no in-page bar.
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        item {
            if (trending.isNotEmpty()) HeroCarousel(trending.take(10), onOpen)
            else Spacer(Modifier.height(16.dp))
        }
        if (cw.isNotEmpty()) {
            item { SectionHeader("Continue Watching", onClick = onOpenContinue) }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(cw.size) { i ->
                        val row = cw[i]
                        ContinueCardWide(
                            row,
                            total = epTotals[row.animeId],
                            resuming = resumingId == row.animeId,
                            onResume = {
                                if (resumingId != null) return@ContinueCardWide
                                resumingId = row.animeId
                                scope.launch {
                                    val ok = prepareResume(row)
                                    resumingId = null
                                    if (ok) onPlay()
                                }
                            },
                            onDismiss = {
                                scope.launch {
                                    com.sanjay.anitrack.next.data.Db.dismiss(row.animeId)
                                    // Tombstone → the dismissal propagates to desktop too.
                                    com.sanjay.anitrack.next.data.GistSync.deleteAnime(row.animeId)
                                    cw = com.sanjay.anitrack.next.data.Db.continueWatching()
                                }
                            },
                        )
                    }
                }
            }
        }
        if (latest.isNotEmpty()) {
            item { SectionHeader("Latest Episodes", onClick = onOpenLatest) }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(latest.size) { i ->
                        val a = latest[i]
                        LatestCard(a.anime, a.episode, onOpen)
                    }
                }
            }
        }
        item { SectionHeader("Trending Now") }
        item {
            if (loading && trending.isEmpty()) RowPlaceholder()
            else AnimeRow(trending, onOpen)
        }
        if (anikotoTop.values.any { it.isNotEmpty() }) {
            item { AnikotoTop10(anikotoTop, onOpenTitle = { openByTitle(it) }) }
        }
        if (topAiring.isNotEmpty()) {
            item { SectionHeader("Top Airing") }
            item { AnimeRow(topAiring, onOpen) }
        }
        if (popular.isNotEmpty()) {
            item { SectionHeader("Most Popular") }
            item { AnimeRow(popular, onOpen) }
        }
    }
}
// Landscape "Latest Episodes" card with an EP badge.
@Composable
private fun LatestCard(anime: Anime, episode: Int, onOpen: (Anime) -> Unit) {
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
private fun HeroCarousel(list: List<Anime>, onOpen: (Anime) -> Unit) {
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
private fun AnikotoTop10(
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
private fun HeroBanner(anime: Anime, onOpen: (Anime) -> Unit) {
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
internal fun fmtSecs(sec: Double): String {
    val t = sec.toLong()
    val h = t / 3600; val m = (t % 3600) / 60; val s = t % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

// Landscape Continue-Watching card (the desktop app's wide format).
/**
 * Prepare PlaySession to resume a Continue-Watching row. Uses the stored slug
 * when present; otherwise (row synced from desktop with a pahe UUID, or no
 * slug) re-matches the show against a provider via its AniList id. Returns
 * false only if no source could be found at all.
 */
internal suspend fun prepareResume(row: com.sanjay.anitrack.next.data.Db.CwRow): Boolean {
    PlaySession.localFile = null // Online resume, never a downloaded file.
    val runtime = RemoteConfig.current()
    val registry = Providers.registry
    // Keep the database/gist format unchanged. Only old Android builds wrote
    // the temporary "pahe:" prefix, so remove it at this compatibility edge.
    val key = row.slug?.removePrefix("pahe:")?.takeIf(String::isNotBlank)

    // Let each enabled connector recognize and restore its own persisted key.
    // This keeps resume working when more provider key formats are introduced.
    val resumed = key?.let {
        row.providerId?.let { providerId -> registry.resume(providerId, it, runtime) }
            ?: registry.resumeFirst(it, runtime)
    }

    // Metadata is still loaded for player server switching and is the fallback
    // when a stored source disappeared or the row came from an older client.
    val meta = runCatching { AniList.byId(row.animeId) }.getOrNull()
    val series = resumed ?: meta?.let { registry.matchFirst(it, runtime) } ?: return false
    PlaySession.startSeries(
        series = series,
        selectedIndex = series.episodeIndex(row.episode),
        animeId = row.animeId,
        animeTitle = row.title,
        animeCover = row.cover,
        anime = meta,
    )
    return true
}

@Composable
private fun ContinueCardWide(
    row: com.sanjay.anitrack.next.data.Db.CwRow,
    total: Int?,
    resuming: Boolean,
    onResume: () -> Unit,
    onDismiss: () -> Unit,
) {
    val ep = if (row.episode % 1f == 0f) "${row.episode.toInt()}" else "${row.episode}"
    // Desktop card: 16:9 cover, gradient, EP badge, EP-total badge, title +
    // timestamp inside the card, red progress strip at the bottom.
    Box(
        Modifier.width(280.dp).height(158.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFF1B1B1B))
            .clickable { onResume() },
    ) {
        AsyncImage(
            model = row.cover, contentDescription = row.title, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            Modifier.fillMaxSize().background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    0f to Color.Transparent, 0.5f to Color.Black.copy(alpha = 0.2f), 1f to Color.Black.copy(alpha = 0.9f),
                ),
            ),
        )
        // EP badge (top-left, red)
        Box(
            Modifier.align(Alignment.TopStart).padding(8.dp)
                .clip(RoundedCornerShape(4.dp)).background(HomeAccent)
                .padding(horizontal = 8.dp, vertical = 4.dp),
        ) { Text("EP $ep", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = androidx.compose.ui.unit.TextUnit(1.5f, androidx.compose.ui.unit.TextUnitType.Sp)) }
        // ✕ + EP-total badge (top-right): green "▲" when new episodes exist.
        Row(Modifier.align(Alignment.TopEnd).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(24.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.7f))
                    .clickable { onDismiss() },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Close, "Dismiss", tint = Color.White, modifier = Modifier.size(13.dp)) }
            if (total != null) {
                val hasNew = total > row.episode
                Box(
                    Modifier.clip(RoundedCornerShape(4.dp))
                        .background(if (hasNew) Color(0xFF22C55E) else Color.Black.copy(alpha = 0.6f))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        if (hasNew) "EP $total ▲" else "EP $total ✓",
                        color = if (hasNew) Color.White else Color.White.copy(alpha = 0.5f),
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
        // Resolving spinner
        if (resuming) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = HomeAccent, modifier = Modifier.size(34.dp))
            }
        }
        // Title + timestamp (inside the card, desktop style)
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
            Text(
                row.title, color = Color.White, style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "${fmtSecs(row.positionSec)} / ${fmtSecs(row.durationSec)}",
                color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelSmall,
            )
        }
        // Progress strip
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(5.dp).background(Color.White.copy(alpha = 0.2f))) {
            Box(Modifier.fillMaxWidth(fraction = (row.percent / 100f).coerceIn(0f, 1f)).fillMaxHeight().background(HomeAccent))
        }
    }
}

@Composable
private fun ContinueCard(
    row: com.sanjay.anitrack.next.data.Db.CwRow,
    onResume: () -> Unit,
    onDismiss: () -> Unit,
) {
    Column(Modifier.width(126.dp)) {
        Box {
            AsyncImage(
                model = row.cover,
                contentDescription = row.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .width(126.dp).height(179.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color.White.copy(alpha = 0.06f))
                    .clickable { onResume() },
            )
            // Dismiss ✕
            Box(
                Modifier.align(Alignment.TopEnd).padding(6.dp)
                    .clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.6f))
                    .clickable { onDismiss() }.padding(horizontal = 7.dp, vertical = 2.dp),
            ) { Text("✕", color = Color.White, style = MaterialTheme.typography.labelSmall) }
            // Progress bar
            LinearProgressIndicator(
                progress = { (row.percent / 100f).coerceIn(0f, 1f) },
                color = HomeAccent,
                trackColor = Color.White.copy(alpha = 0.25f),
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(row.title, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
        Text(
            "Ep ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode} · ${row.percent}%",
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.4f),
        )
    }
}

@Composable
private fun SectionHeader(title: String, onClick: (() -> Unit)? = null) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).height(18.dp).clip(RoundedCornerShape(2.dp)).background(HomeAccent))
        Spacer(Modifier.width(8.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (onClick != null) {
            Spacer(Modifier.width(6.dp))
            Text("›", style = MaterialTheme.typography.titleMedium, color = Color.White.copy(alpha = 0.5f))
        }
    }
}

@Composable
private fun AnimeRow(list: List<Anime>, onOpen: (Anime) -> Unit) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(list.size) { i -> AnimeCard(list[i], onOpen) }
    }
}

@Composable
private fun RowPlaceholder() {
    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(5) {
            Box(
                Modifier.width(126.dp).height(180.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color.White.copy(alpha = 0.05f)),
            )
        }
    }
}
