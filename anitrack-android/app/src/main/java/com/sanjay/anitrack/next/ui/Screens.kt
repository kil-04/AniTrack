package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Accent = Color(0xFFE50914)

// ── Shared card ───────────────────────────────────────────────────────────────

@Composable
fun AnimeCard(anime: Anime, onClick: (Anime) -> Unit, width: Int = 126) {
    Column(Modifier.width(width.dp).clickable { onClick(anime) }) {
        AsyncImage(
            model = anime.cover,
            contentDescription = anime.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .width(width.dp)
                .height((width * 1.42).dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Color.White.copy(alpha = 0.06f)),
        )
        Spacer(Modifier.height(6.dp))
        Text(
            anime.title,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            color = Color.White.copy(alpha = 0.85f),
        )
        val meta = listOfNotNull(anime.year?.toString(), anime.episodes?.let { "$it eps" }).joinToString(" · ")
        if (meta.isNotEmpty()) {
            Text(meta, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
        }
    }
}

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
                Modifier.align(Alignment.TopStart).padding(6.dp).clip(RoundedCornerShape(6.dp)).background(Accent).padding(horizontal = 7.dp, vertical = 2.dp),
            ) { Text("EP $episode", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
        }
        Spacer(Modifier.height(6.dp))
        Text(anime.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
    }
}

// Ranked Top-10 list row.
@Composable
private fun Top10Row(rank: Int, anime: Anime, onOpen: (Anime) -> Unit) {
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
                        .background(if (i == pager.currentPage) Accent else Color.White.copy(alpha = 0.4f)),
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
            Box(Modifier.width(4.dp).height(18.dp).clip(RoundedCornerShape(2.dp)).background(Accent))
            Spacer(Modifier.width(8.dp))
            Text("Top 10", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            listOf("day" to "Day", "week" to "Week", "month" to "Month").forEach { (k, label) ->
                Text(
                    label,
                    modifier = Modifier.clickable { tab = k }.padding(horizontal = 8.dp, vertical = 4.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (tab == k) Accent else Color.White.copy(alpha = 0.5f),
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
            Text("TRENDING NOW", style = MaterialTheme.typography.labelSmall, color = Accent, fontWeight = FontWeight.Bold)
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
    com.sanjay.anitrack.next.data.PlaySession.localFile = null   // online resume, not a download
    // Same detection as the desktop: pahe sessions are UUIDs, anikoto slugs
    // aren't. (Also strip the legacy "pahe:" prefix older Next builds wrote.)
    val key = row.slug?.removePrefix("pahe:")
    val isPahe = key != null && com.sanjay.anitrack.next.data.PlaySession.PAHE_UUID.matches(key)
    val meta = com.sanjay.anitrack.next.data.AniList.byId(row.animeId)

    // 1. Anikoto slug stored → use it directly.
    if (key != null && !isPahe) {
        val eps = runCatching { com.sanjay.anitrack.next.data.Anikoto.episodes(key).episodes }.getOrNull()
        if (!eps.isNullOrEmpty()) {
            com.sanjay.anitrack.next.data.PlaySession.apply {
                provider = "anikoto"; animeId = row.animeId; animeTitle = row.title; animeCover = row.cover
                anime = meta; paheEps = emptyList(); slug = key; anikotoEps = eps
                index = eps.indexOfFirst { it.number == row.episode }.takeIf { it >= 0 } ?: 0
            }
            return true
        }
    }
    // 2. AnimePahe session stored → use it.
    if (key != null && isPahe) {
        val eps = runCatching { com.sanjay.anitrack.next.data.Pahe.episodesAll(key) }.getOrNull()
        if (!eps.isNullOrEmpty()) {
            com.sanjay.anitrack.next.data.PlaySession.apply {
                provider = "animepahe"; animeId = row.animeId; animeTitle = row.title; animeCover = row.cover
                anime = meta; anikotoEps = emptyList(); paheSession = key; paheEps = eps
                index = eps.indexOfFirst { it.number == row.episode }.takeIf { it >= 0 } ?: 0
            }
            return true
        }
    }
    // 3. No usable slug → re-match from metadata (Anikoto first, then AnimePahe).
    if (meta != null) {
        runCatching { com.sanjay.anitrack.next.data.Anikoto.matchFor(meta) }.getOrNull()?.let { m ->
            com.sanjay.anitrack.next.data.PlaySession.apply {
                provider = "anikoto"; animeId = row.animeId; animeTitle = row.title; animeCover = row.cover
                anime = meta; paheEps = emptyList(); slug = m.source.slug; anikotoEps = m.list.episodes
                index = m.list.episodes.indexOfFirst { it.number == row.episode }.takeIf { it >= 0 } ?: 0
            }
            return true
        }
        runCatching { com.sanjay.anitrack.next.data.Pahe.matchFor(meta) }.getOrNull()?.let { m ->
            com.sanjay.anitrack.next.data.PlaySession.apply {
                provider = "animepahe"; animeId = row.animeId; animeTitle = row.title; animeCover = row.cover
                anime = meta; anikotoEps = emptyList(); paheSession = m.source.session; paheEps = m.episodes
                index = m.episodes.indexOfFirst { it.number == row.episode }.takeIf { it >= 0 } ?: 0
            }
            return true
        }
    }
    return false
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
                .clip(RoundedCornerShape(4.dp)).background(Accent)
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
                CircularProgressIndicator(color = Accent, modifier = Modifier.size(34.dp))
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
            Box(Modifier.fillMaxWidth(fraction = (row.percent / 100f).coerceIn(0f, 1f)).fillMaxHeight().background(Accent))
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
                color = Accent,
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
        Box(Modifier.width(4.dp).height(18.dp).clip(RoundedCornerShape(2.dp)).background(Accent))
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

// ── Search ────────────────────────────────────────────────────────────────────

private val GENRES = listOf("Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller")
private val FORMATS = mapOf("Any type" to null, "TV" to "TV", "TV Short" to "TV_SHORT", "Movie" to "MOVIE", "OVA" to "OVA", "ONA" to "ONA", "Special" to "SPECIAL", "Music" to "MUSIC")
private val STATUSES_F = mapOf("Any status" to null, "Airing" to "RELEASING", "Finished" to "FINISHED", "Upcoming" to "NOT_YET_RELEASED", "Cancelled" to "CANCELLED", "Hiatus" to "HIATUS")
private val SEASONS = mapOf("Any season" to null, "Winter" to "WINTER", "Spring" to "SPRING", "Summer" to "SUMMER", "Fall" to "FALL")
private val SORTS = mapOf("Default sort" to "TRENDING_DESC", "Popularity" to "POPULARITY_DESC", "Score" to "SCORE_DESC", "Newest" to "START_DATE_DESC", "Title" to "TITLE_ROMAJI")
private val SOURCES = mapOf("Select source" to null, "Original" to "ORIGINAL", "Manga" to "MANGA", "Light Novel" to "LIGHT_NOVEL", "Visual Novel" to "VISUAL_NOVEL", "Video Game" to "VIDEO_GAME")
private val EP_RANGES = mapOf("Episode range" to null, "1–12" to (1 to 12), "13–26" to (13 to 26), "27–52" to (27 to 52), "53+" to (53 to null))

@Composable
fun SearchScreen(onOpen: (Anime) -> Unit) {
    var query by remember { mutableStateOf("") }
    var genre by remember { mutableStateOf<String?>(null) }
    var year by remember { mutableStateOf<Int?>(null) }
    var season by remember { mutableStateOf<String?>(null) }
    var format by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var sort by remember { mutableStateOf("TRENDING_DESC") }
    var source by remember { mutableStateOf<String?>(null) }
    var epRange by remember { mutableStateOf<Pair<Int, Int?>?>(null) }
    var page by remember { mutableStateOf(1) }
    var hasNext by remember { mutableStateOf(false) }

    var results by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var topRated by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }

    LaunchedEffect(Unit) { runCatching { topRated = AniList.topRated() } }
    LaunchedEffect(reload, page) {
        searching = true
        runCatching {
            val (r, hn) = AniList.advancedSearch(
                query, genre, year, season, format, status, sort, page,
                source = source, epMin = epRange?.first, epMax = epRange?.second,
            )
            results = r; hasNext = hn
        }
        searching = false
    }

    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820

    Row(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).padding(horizontal = 24.dp, vertical = 16.dp)) {
            Text("Filter", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
            // Desktop filter panel: dark rounded box holding search + dropdowns.
            val apply: () -> Unit = { page = 1; reload++ }
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
                    .background(Color.White.copy(alpha = 0.04f)).padding(16.dp),
            ) {
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    // Search box
                    Row(
                        Modifier.width(240.dp).height(46.dp)
                            .clip(RoundedCornerShape(10.dp)).background(Color(0xFF101014))
                            .border(1.dp, Color.White.copy(alpha = 0.1f), RoundedCornerShape(10.dp))
                            .padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Search, null, tint = Color.White.copy(alpha = 0.4f), modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(8.dp))
                        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                            androidx.compose.foundation.text.BasicTextField(
                                value = query, onValueChange = { query = it },
                                singleLine = true,
                                textStyle = MaterialTheme.typography.bodyMedium.copy(color = Color.White),
                                cursorBrush = androidx.compose.ui.graphics.SolidColor(Accent),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            if (query.isEmpty()) Text("Search...", color = Color.White.copy(alpha = 0.35f), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    FilterDropdown("Select genre", genre, listOf("Select genre" to null) + GENRES.map { it to it }) { genre = it; apply() }
                    FilterDropdown("Select season", SEASONS.entries.firstOrNull { it.value == season }?.key?.takeIf { season != null }, SEASONS.map { it.key to it.value }) { season = it; apply() }
                    FilterDropdown("Select year", year?.toString(), listOf("Select year" to null) + (2026 downTo 1960).map { it.toString() to it }) { year = it; apply() }
                    FilterDropdown("Select type", FORMATS.entries.firstOrNull { it.value == format }?.key?.takeIf { format != null }, FORMATS.map { it.key to it.value }) { format = it; apply() }
                    FilterDropdown("Select status", STATUSES_F.entries.firstOrNull { it.value == status }?.key?.takeIf { status != null }, STATUSES_F.map { it.key to it.value }) { status = it; apply() }
                    FilterDropdown("Select source", SOURCES.entries.firstOrNull { it.value == source }?.key?.takeIf { source != null }, SOURCES.map { it.key to it.value }) { source = it; apply() }
                    FilterDropdown("Episode range", EP_RANGES.entries.firstOrNull { it.value == epRange }?.key?.takeIf { epRange != null }, EP_RANGES.map { it.key to it.value }) { epRange = it; apply() }
                    FilterDropdown("Default sort", SORTS.entries.firstOrNull { it.value == sort }?.key?.takeIf { sort != "TRENDING_DESC" }, SORTS.map { it.key to it.value }) { sort = it ?: "TRENDING_DESC"; apply() }
                    // Red Filter button
                    Row(
                        Modifier.height(46.dp).clip(RoundedCornerShape(10.dp)).background(Accent)
                            .clickable { apply() }.padding(horizontal = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Filter", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            if (searching && results.isEmpty()) {
                LinearProgressIndicator(Modifier.fillMaxWidth(), color = Accent)
            } else if (!searching && results.isEmpty()) {
                Text("No results — try different filters.", color = Color.White.copy(alpha = 0.4f))
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(120.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.weight(1f),
            ) {
                items(results, key = { it.id }) { a -> AnimeCard(a, onOpen) }
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center) {
                        if (page > 1) TextButton(onClick = { page-- }) { Text("‹ Prev") }
                        Text("Page $page", Modifier.align(Alignment.CenterVertically), color = Color.White.copy(alpha = 0.6f))
                        if (hasNext) TextButton(onClick = { page++ }) { Text("Next ›") }
                    }
                }
            }
        }
        if (wide && topRated.isNotEmpty()) {
            Column(Modifier.width(300.dp).fillMaxHeight().padding(16.dp)) {
                Text("Top rated", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(12.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(topRated.size) { i -> Top10Row(i + 1, topRated[i], onOpen) }
                }
            }
        }
    }
}

// Desktop-style "Select …" dropdown box (dark, bordered, chevron).
@Composable
private fun <T> FilterDropdown(placeholder: String, current: String?, options: List<Pair<String, T>>, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.height(46.dp)
                .clip(RoundedCornerShape(10.dp)).background(Color(0xFF101014))
                .border(1.dp, Color.White.copy(alpha = 0.1f), RoundedCornerShape(10.dp))
                .clickable { open = true }
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                current ?: placeholder,
                style = MaterialTheme.typography.bodySmall,
                color = if (current != null) Color.White else Color.White.copy(alpha = 0.6f),
            )
            Spacer(Modifier.width(6.dp))
            Icon(Icons.Filled.KeyboardArrowDown, null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(16.dp))
        }
        DropdownMenu(
            expanded = open, onDismissRequest = { open = false },
            shape = RoundedCornerShape(10.dp), containerColor = Color(0xFF16161C),
            modifier = Modifier.heightIn(max = 420.dp),
        ) {
            options.forEach { (name, value) ->
                DropdownMenuItem(text = { Text(name) }, onClick = { onPick(value); open = false })
            }
        }
    }
}

// ── Detail ────────────────────────────────────────────────────────────────────

@Composable
fun DetailScreen(animeId: Int, onPlay: () -> Unit, onOpenAnime: (Int) -> Unit = {}) {
    var anime by remember { mutableStateOf<Anime?>(null) }
    LaunchedEffect(animeId) { anime = AniList.byId(animeId) }

    val a = anime ?: run {
        Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
            CircularProgressIndicator(color = Accent)
        }
        return
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        // Banner
        Box(Modifier.fillMaxWidth().height(180.dp)) {
            AsyncImage(
                model = a.banner ?: a.cover,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier.fillMaxSize().background(
                    androidx.compose.ui.graphics.Brush.verticalGradient(
                        listOf(Color.Transparent, Color.Black),
                    ),
                ),
            )
        }
        Row(Modifier.padding(16.dp)) {
            AsyncImage(
                model = a.cover,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.width(110.dp).height(156.dp).clip(RoundedCornerShape(10.dp)),
            )
            Spacer(Modifier.width(16.dp))
            Column {
                Text(a.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                if (a.titleRomaji != null && a.titleRomaji != a.title) {
                    Text(a.titleRomaji, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.5f))
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    a.year?.let { Chip("$it") }
                    a.episodes?.let { Chip("$it eps") }
                    a.score?.let { Chip("★ ${it / 10.0}") }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    a.genres.take(3).forEach { Chip(it, subtle = true) }
                }
                Spacer(Modifier.height(10.dp))
                ListStatusButton(a)
            }
        }
        if (a.synopsis != null) {
            Text(
                a.synopsis,
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.7f),
                maxLines = 6,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        Spacer(Modifier.height(20.dp))
        WatchOrderSection(a, onOpenAnime)
        RelatedSection(a, onOpenAnime)
        EpisodesSection(a, onPlay)
        Spacer(Modifier.height(32.dp))
    }
}

// ── Related (side stories / specials — non-chain relations, like desktop) ─────

private val relationLabels = mapOf(
    "SIDE_STORY" to "Side Story", "SPIN_OFF" to "Spin Off", "ALTERNATIVE" to "Alternative",
    "SPECIAL" to "Special", "SUMMARY" to "Summary", "PARENT" to "Parent",
    "CHARACTER" to "Character", "OTHER" to "Other",
)

@Composable
private fun RelatedSection(anime: Anime, onOpenAnime: (Int) -> Unit) {
    var rels by remember(anime.id) { mutableStateOf<List<AniList.Relation>>(emptyList()) }
    LaunchedEffect(anime.id) { runCatching { rels = AniList.relations(anime.id) } }
    val related = rels.filter { it.type != "PREQUEL" && it.type != "SEQUEL" }
    if (related.isEmpty()) return

    Column(Modifier.padding(bottom = 20.dp)) {
        Text("Related", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp))
        Spacer(Modifier.height(10.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(related.size) { i ->
                val r = related[i]
                Column(Modifier.width(120.dp).clickable { onOpenAnime(r.anime.id) }) {
                    Box(
                        Modifier.width(120.dp).height(170.dp).clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.06f)),
                    ) {
                        AsyncImage(model = r.anime.cover, contentDescription = r.anime.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        // Relation label strip (desktop's "Side Story" tag).
                        Box(
                            Modifier.align(Alignment.BottomStart).fillMaxWidth()
                                .background(
                                    androidx.compose.ui.graphics.Brush.verticalGradient(
                                        listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f)),
                                    ),
                                )
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                        ) {
                            Text(
                                relationLabels[r.type] ?: r.type.lowercase().replaceFirstChar { c -> c.uppercase() },
                                style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.85f),
                            )
                        }
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(r.anime.title, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
                }
            }
        }
    }
}

// ── Watch Order (franchise chain: PREQUEL hops back, SEQUEL forward) ──────────

private val watchOrderCache = HashMap<Int, List<Anime>>()

@Composable
private fun WatchOrderSection(anime: Anime, onOpenAnime: (Int) -> Unit) {
    var chain by remember(anime.id) { mutableStateOf(watchOrderCache[anime.id] ?: emptyList()) }

    LaunchedEffect(anime.id) {
        if (chain.isNotEmpty()) return@LaunchedEffect
        runCatching {
            fun pick(edges: List<AniList.Relation>, type: String): Anime? {
                val cands = edges.filter { it.type == type && it.anime.id > 0 }
                return (cands.firstOrNull { it.anime.format == "TV" } ?: cands.firstOrNull())?.anime
            }
            val before = ArrayDeque<Anime>()
            var cur = anime
            var guard = 0
            while (guard++ < 10) {
                val prev = pick(AniList.relations(cur.id), "PREQUEL") ?: break
                if (before.any { it.id == prev.id } || prev.id == anime.id) break
                before.addFirst(prev); cur = prev
            }
            val after = mutableListOf<Anime>()
            cur = anime; guard = 0
            while (guard++ < 10) {
                val next = pick(AniList.relations(cur.id), "SEQUEL") ?: break
                if (after.any { it.id == next.id } || next.id == anime.id) break
                after.add(next); cur = next
            }
            val full = before.toList() + anime + after
            if (full.size > 1) {
                if (watchOrderCache.size > 200) watchOrderCache.clear()
                full.forEach { watchOrderCache[it.id] = full }
                chain = full
            }
        }
    }

    if (chain.size < 2) return
    Column(Modifier.padding(bottom = 20.dp)) {
        Text("Watch Order", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp))
        Spacer(Modifier.height(10.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(chain.size) { i ->
                val m = chain[i]
                val isHere = m.id == anime.id
                Column(Modifier.width(120.dp).clickable(enabled = !isHere) { onOpenAnime(m.id) }) {
                    Box(
                        Modifier.width(120.dp).height(170.dp).clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.06f))
                            .then(if (isHere) Modifier.border(2.dp, Accent, RoundedCornerShape(10.dp)) else Modifier),
                    ) {
                        AsyncImage(model = m.cover, contentDescription = m.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        // Number badge
                        Box(
                            Modifier.align(Alignment.TopStart).padding(6.dp)
                                .size(24.dp).clip(RoundedCornerShape(50)).background(Accent),
                            contentAlignment = Alignment.Center,
                        ) { Text("${i + 1}", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
                        if (isHere) {
                            Box(
                                Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Accent).padding(vertical = 3.dp),
                                contentAlignment = Alignment.Center,
                            ) { Text("YOU ARE HERE", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = androidx.compose.ui.unit.TextUnit(1f, androidx.compose.ui.unit.TextUnitType.Sp)) }
                        }
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(m.title, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
                    m.year?.let { Text("$it", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f)) }
                }
            }
        }
    }
}

// ── Episodes (Anikoto + AnimePahe servers) ────────────────────────────────────

private data class EpUi(
    val number: Float,
    val play: () -> Unit,
    val resolveForDownload: suspend () -> Triple<String, String, String>,
)

private const val DESKTOP_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
private fun EpisodesSection(anime: com.sanjay.anitrack.next.data.Anime, onPlay: () -> Unit) {
    val runtime = com.sanjay.anitrack.next.data.RemoteConfig.current()
    val enabledServers = runtime.providerOrder.filter { id ->
        if (id == "anikoto") runtime.anikoto.enabled && runtime.features.anikotoStreaming
        else runtime.animepahe.enabled && runtime.features.animepaheStreaming
    }
    var server by remember(anime.id) { mutableStateOf(enabledServers.firstOrNull() ?: "anikoto") }
    var anikotoMatch by remember { mutableStateOf<com.sanjay.anitrack.next.data.Anikoto.Matched?>(null) }
    var paheMatch by remember { mutableStateOf<com.sanjay.anitrack.next.data.Pahe.Matched?>(null) }
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var failureMessage by remember { mutableStateOf<String?>(null) }
    var rangeStart by remember { mutableStateOf(0) }
    var watched by remember { mutableStateOf<Map<Float, Int>>(emptyMap()) }

    LaunchedEffect(anime.id) {
        runCatching { watched = com.sanjay.anitrack.next.data.Db.positionsFor(anime.id) }
    }
    // Load the selected server on demand.
    LaunchedEffect(anime.id, server) {
        rangeStart = 0; failed = false; failureMessage = null
        if (server == "anikoto" && anikotoMatch == null) {
            loading = true
            runCatching { anikotoMatch = com.sanjay.anitrack.next.data.Anikoto.matchFor(anime) }
                .onFailure { failed = true; failureMessage = it.message }
            if (anikotoMatch == null) failed = true
            loading = false
        } else if (server == "animepahe" && paheMatch == null) {
            loading = true
            runCatching { paheMatch = com.sanjay.anitrack.next.data.Pahe.matchFor(anime) }
                .onFailure { failed = true; failureMessage = it.message }
            if (paheMatch == null) failed = true
            loading = false
        }
    }

    // Build the unified episode list + click actions for the active server.
    val epUi: List<EpUi> = remember(server, anikotoMatch, paheMatch) {
        when (server) {
            "animepahe" -> paheMatch?.let { m ->
                m.episodes.map { ep ->
                    EpUi(
                        ep.number,
                        play = {
                            com.sanjay.anitrack.next.data.PlaySession.apply {
                                provider = "animepahe"; animeId = anime.id
                                animeTitle = anime.title; animeCover = anime.cover
                                this.anime = anime; localFile = null
                                paheSession = m.source.session; paheEps = m.episodes
                                anikotoEps = emptyList()
                                index = m.episodes.indexOf(ep).coerceAtLeast(0)
                            }
                            onPlay()
                        },
                        resolveForDownload = {
                            val links = com.sanjay.anitrack.next.data.Pahe.links(m.source.session, ep.session)
                            // Highest resolution, and among equal resolutions the
                            // sub (non-eng-dub) track — same choice as playback,
                            // so we grab exactly ONE highest-quality file.
                            val best = links.maxByOrNull {
                                (it.quality.filter { c -> c.isDigit() }.toIntOrNull() ?: 0) * 10 +
                                    (if (!it.audio.lowercase().contains("eng")) 1 else 0)
                            } ?: throw Exception("no link")
                            val s = com.sanjay.anitrack.next.data.Pahe.resolveKwik(best.kwik)
                            Triple(s.url, s.referer, com.sanjay.anitrack.next.data.Pahe.MOBILE_UA)
                        },
                    )
                }
            }.orEmpty()
            else -> anikotoMatch?.let { m ->
                m.list.episodes.map { ep ->
                    EpUi(
                        ep.number,
                        play = {
                            com.sanjay.anitrack.next.data.PlaySession.apply {
                                provider = "anikoto"; animeId = anime.id
                                animeTitle = anime.title; animeCover = anime.cover
                                this.anime = anime; localFile = null
                                slug = m.source.slug; anikotoEps = m.list.episodes
                                paheEps = emptyList()
                                index = m.list.episodes.indexOf(ep).coerceAtLeast(0)
                            }
                            onPlay()
                        },
                        resolveForDownload = {
                            val s = com.sanjay.anitrack.next.data.Anikoto.resolve(m.source.slug, ep)
                            Triple(s.url, s.referer, DESKTOP_UA)
                        },
                    )
                }
            }.orEmpty()
        }
    }

    Column(Modifier.padding(horizontal = 16.dp)) {
        // Header with SUB/DUB badges.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Episodes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            val src = anikotoMatch?.source
            if (src?.subCount != null) {
                Spacer(Modifier.width(10.dp))
                Box(Modifier.clip(RoundedCornerShape(6.dp)).background(Color(0xFF3BA55D).copy(alpha = 0.25f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
                    Text("SUB ${src.subCount}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF7CD07C), fontWeight = FontWeight.Bold)
                }
            }
            if (src?.dubCount != null && src.dubCount > 0) {
                Spacer(Modifier.width(6.dp))
                Box(Modifier.clip(RoundedCornerShape(6.dp)).background(Color(0xFF5865F2).copy(alpha = 0.25f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
                    Text("DUB ${src.dubCount}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF9AA5FF), fontWeight = FontWeight.Bold)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        // Server toggle
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if ("anikoto" in enabledServers) {
                FilterChip(selected = server == "anikoto", onClick = { server = "anikoto" }, label = { Text("Anikoto") })
            }
            if ("animepahe" in enabledServers) {
                FilterChip(selected = server == "animepahe", onClick = { server = "animepahe" }, label = { Text("AnimePahe") })
            }
            if (loading) {
                Spacer(Modifier.width(4.dp))
                CircularProgressIndicator(Modifier.size(16.dp).align(Alignment.CenterVertically), strokeWidth = 2.dp, color = Accent)
            }
        }
        Spacer(Modifier.height(4.dp))
        if (server == "anikoto" && anikotoMatch != null) {
            Text(
                if (anikotoMatch!!.verified) "verified ✓" else "best match",
                style = MaterialTheme.typography.labelSmall,
                color = if (anikotoMatch!!.verified) Color(0xFF4CAF50) else Color.White.copy(alpha = 0.5f),
            )
        }
        if (!loading && failed && epUi.isEmpty()) {
            Text(
                failureMessage?.let { "No source: ${it.take(160)}" } ?: "No source on this server.",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.55f),
            )
        }
        Spacer(Modifier.height(10.dp))

        if (epUi.isNotEmpty()) {
            val ranges = epUi.chunked(100)
            val current = ranges.getOrElse(rangeStart) { emptyList() }

            // Action buttons (Open Player · Download N · Range), desktop style.
            var rangeDialog by remember { mutableStateOf(false) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { (epUi.firstOrNull { (watched[it.number] ?: 0) < 85 } ?: epUi.first()).play() },
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black),
                    contentPadding = PaddingValues(horizontal = 18.dp, vertical = 8.dp),
                ) {
                    Icon(Icons.Filled.PlayArrow, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp)); Text("Open Player", fontWeight = FontWeight.Bold)
                }
                Row(
                    Modifier.height(42.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.08f))
                        .clickable {
                            current.forEach { ep -> com.sanjay.anitrack.next.data.Downloads.enqueue(anime.id, ep.number, anime.title, anime.cover, ep.resolveForDownload) }
                        }
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.FileDownload, null, tint = Color.White, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(7.dp)); Text("Download ${current.size}", color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
                }
                Row(
                    Modifier.height(42.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.08f))
                        .clickable { rangeDialog = true }
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.FileDownload, null, tint = Color.White, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(7.dp)); Text("Range", color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
                }
            }
            // Range download dialog (desktop's custom episode range).
            if (rangeDialog) {
                var fromTxt by remember { mutableStateOf("") }
                var toTxt by remember { mutableStateOf("") }
                AlertDialog(
                    onDismissRequest = { rangeDialog = false },
                    title = { Text("Download a range") },
                    text = {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = fromTxt, onValueChange = { fromTxt = it.filter { c -> c.isDigit() }.take(4) },
                                label = { Text("From") }, singleLine = true, modifier = Modifier.weight(1f),
                                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
                            )
                            OutlinedTextField(
                                value = toTxt, onValueChange = { toTxt = it.filter { c -> c.isDigit() }.take(4) },
                                label = { Text("To") }, singleLine = true, modifier = Modifier.weight(1f),
                                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
                            )
                        }
                    },
                    confirmButton = {
                        TextButton(onClick = {
                            val from = fromTxt.toIntOrNull() ?: 1
                            val to = toTxt.toIntOrNull() ?: from
                            epUi.filter { it.number >= from && it.number <= to }.forEach { ep ->
                                com.sanjay.anitrack.next.data.Downloads.enqueue(anime.id, ep.number, anime.title, anime.cover, ep.resolveForDownload)
                            }
                            rangeDialog = false
                        }) { Text("Download", color = Accent) }
                    },
                    dismissButton = { TextButton(onClick = { rangeDialog = false }) { Text("Cancel") } },
                )
            }
            Spacer(Modifier.height(12.dp))

            if (ranges.size > 1) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(ranges.size) { i ->
                        FilterChip(
                            selected = rangeStart == i,
                            onClick = { rangeStart = i },
                            label = { Text("${ranges[i].first().number.toInt()}–${ranges[i].last().number.toInt()}") },
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
            }

            // Vertical episode list — each row a boxed card (desktop layout).
            val dls = com.sanjay.anitrack.next.data.Downloads.items
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (ep in current) {
                    val pct = watched[ep.number] ?: 0
                    val dl = dls.firstOrNull { it.id == com.sanjay.anitrack.next.data.Downloads.idOf(anime.id, ep.number) }
                    Row(
                        Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.05f))
                            .clickable { ep.play() }
                            .padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Thumbnail box (anime cover, 16:9).
                        AsyncImage(
                            model = anime.banner ?: anime.cover,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.width(72.dp).height(44.dp).clip(RoundedCornerShape(6.dp)).background(Color.White.copy(alpha = 0.08f)),
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    "Episode ${if (ep.number % 1f == 0f) ep.number.toInt() else ep.number}",
                                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold,
                                    color = if (pct >= 85) Color(0xFF7CD07C) else Color.White,
                                )
                                if (pct >= 85) {
                                    Spacer(Modifier.width(4.dp))
                                    Icon(Icons.Filled.Check, null, tint = Color(0xFF7CD07C), modifier = Modifier.size(14.dp))
                                }
                            }
                            Text(
                                when { pct >= 85 -> "Watched"; pct > 0 -> "$pct% watched"; else -> "Not watched" },
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.White.copy(alpha = 0.4f),
                            )
                        }
                        // Download control — boxed like the desktop.
                        when (dl?.status) {
                            com.sanjay.anitrack.next.data.Downloads.Status.DONE ->
                                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 8.dp)) {
                                    Icon(Icons.Filled.Check, null, tint = Color(0xFF7CD07C), modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp)); Text("Saved", color = Color(0xFF7CD07C), style = MaterialTheme.typography.labelMedium)
                                }
                            com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING ->
                                Text("${dl.progress}%", color = Accent, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(end = 12.dp))
                            com.sanjay.anitrack.next.data.Downloads.Status.QUEUED ->
                                Text("queued…", color = Color.White.copy(alpha = 0.5f), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(end = 12.dp))
                            else -> Row(
                                // Desktop style: filled dark box, no border.
                                Modifier.clip(RoundedCornerShape(8.dp))
                                    .background(Color.White.copy(alpha = 0.1f))
                                    .clickable { com.sanjay.anitrack.next.data.Downloads.enqueue(anime.id, ep.number, anime.title, anime.cover, ep.resolveForDownload) }
                                    .padding(horizontal = 14.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Filled.Download, null, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(7.dp)); Text("Download", color = Color.White.copy(alpha = 0.9f), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── List status control (detail page "Add to list" / status dropdown) ─────────

@Composable
private fun ListStatusButton(anime: Anime) {
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

// ── Settings ──────────────────────────────────────────────────────────────────

@Composable
fun SettingsScreen() {
    var token by remember { mutableStateOf(com.sanjay.anitrack.next.data.GistSync.token) }
    var statusMsg by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(24.dp))

        AutomationCard()
        Spacer(Modifier.height(28.dp))

        MalCard()
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
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                onClick = {
                    com.sanjay.anitrack.next.data.GistSync.token = token.trim()
                    statusMsg = if (token.isBlank()) "Sync disabled." else "Token saved."
                },
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) { Text("Save") }
            OutlinedButton(
                enabled = com.sanjay.anitrack.next.data.GistSync.configured() && !busy,
                onClick = {
                    busy = true; statusMsg = "Syncing…"
                    scope.launch {
                        val changed = runCatching { com.sanjay.anitrack.next.data.GistSync.pullAndMerge() }
                        statusMsg = if (changed.isSuccess) "Synced ✓" else "Sync failed — check the token."
                        busy = false
                    }
                },
            ) { Text("Sync now") }
        }
        statusMsg?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, style = MaterialTheme.typography.labelMedium, color = Accent)
        }
    }
}

@Composable
private fun Chip(text: String, subtle: Boolean = false) {
    Box(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(if (subtle) Color.White.copy(alpha = 0.08f) else Accent.copy(alpha = 0.18f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.85f))
    }
}
