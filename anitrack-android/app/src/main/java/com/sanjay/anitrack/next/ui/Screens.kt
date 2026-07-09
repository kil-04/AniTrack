package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        // Search bar at the top (the old app's header search).
        item {
            Row(
                Modifier.fillMaxWidth().padding(16.dp)
                    .clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.07f))
                    .clickable { onOpenSearch() }.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("🔍", modifier = Modifier.padding(end = 10.dp))
                Text("Search anime…", color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.bodyMedium)
            }
        }
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
    Box(Modifier.fillMaxWidth().height(260.dp).clickable { onOpen(anime) }) {
        AsyncImage(
            model = anime.banner ?: anime.cover,
            contentDescription = anime.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            Modifier.fillMaxSize().background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    0f to Color.Transparent, 0.55f to Color(0xFF0B0B0F).copy(alpha = 0.65f), 1f to Color(0xFF0B0B0F),
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

// Landscape Continue-Watching card (the desktop app's wide format).
/**
 * Prepare PlaySession to resume a Continue-Watching row. Uses the stored slug
 * when present; otherwise (row synced from desktop with a pahe UUID, or no
 * slug) re-matches the show against a provider via its AniList id. Returns
 * false only if no source could be found at all.
 */
internal suspend fun prepareResume(row: com.sanjay.anitrack.next.data.Db.CwRow): Boolean {
    val key = row.slug
    val meta = com.sanjay.anitrack.next.data.AniList.byId(row.animeId)

    // 1. Anikoto slug stored → use it directly.
    if (key != null && !key.startsWith("pahe:")) {
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
    if (key != null && key.startsWith("pahe:")) {
        val session = key.removePrefix("pahe:")
        val eps = runCatching { com.sanjay.anitrack.next.data.Pahe.episodesAll(session) }.getOrNull()
        if (!eps.isNullOrEmpty()) {
            com.sanjay.anitrack.next.data.PlaySession.apply {
                provider = "animepahe"; animeId = row.animeId; animeTitle = row.title; animeCover = row.cover
                anime = meta; anikotoEps = emptyList(); paheSession = session; paheEps = eps
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
    resuming: Boolean,
    onResume: () -> Unit,
    onDismiss: () -> Unit,
) {
    Column(Modifier.width(260.dp)) {
        Box {
            AsyncImage(
                model = row.cover,
                contentDescription = row.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .width(260.dp).height(146.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color.White.copy(alpha = 0.06f))
                    .clickable { onResume() },
            )
            // EP badge
            Box(
                Modifier.align(Alignment.TopStart).padding(8.dp)
                    .clip(RoundedCornerShape(6.dp)).background(Accent)
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            ) { Text("EP ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode}", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
            // Dismiss ✕
            Box(
                Modifier.align(Alignment.TopEnd).padding(8.dp)
                    .clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.6f))
                    .clickable { onDismiss() }.padding(horizontal = 7.dp, vertical = 2.dp),
            ) { Text("✕", color = Color.White, style = MaterialTheme.typography.labelSmall) }
            // Play scrim (spinner while the episode list resolves)
            Box(
                Modifier.fillMaxSize().clip(RoundedCornerShape(10.dp)).clickable { onResume() },
                contentAlignment = Alignment.Center,
            ) {
                if (resuming) {
                    CircularProgressIndicator(color = Accent, modifier = Modifier.size(34.dp))
                } else {
                    Box(Modifier.clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.45f)).padding(10.dp)) {
                        Text("▶", color = Color.White, style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
            LinearProgressIndicator(
                progress = { (row.percent / 100f).coerceIn(0f, 1f) },
                color = Accent,
                trackColor = Color.White.copy(alpha = 0.25f),
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(row.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.9f))
        Text("Ep ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode} · ${row.percent}%", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
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
private val SORTS = mapOf("Trending" to "TRENDING_DESC", "Popularity" to "POPULARITY_DESC", "Score" to "SCORE_DESC", "Newest" to "START_DATE_DESC", "Title" to "TITLE_ROMAJI")

@Composable
fun SearchScreen(onOpen: (Anime) -> Unit) {
    var query by remember { mutableStateOf("") }
    var genre by remember { mutableStateOf<String?>(null) }
    var year by remember { mutableStateOf<Int?>(null) }
    var season by remember { mutableStateOf<String?>(null) }
    var format by remember { mutableStateOf<String?>(null) }
    var status by remember { mutableStateOf<String?>(null) }
    var sort by remember { mutableStateOf("TRENDING_DESC") }
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
            val (r, hn) = AniList.advancedSearch(query, genre, year, season, format, status, sort, page)
            results = r; hasNext = hn
        }
        searching = false
    }

    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820

    Row(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).padding(16.dp)) {
            Text("Filter", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = query, onValueChange = { query = it },
                placeholder = { Text("Search…") }, singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
            )
            Spacer(Modifier.height(10.dp))
            // Filter dropdowns — auto-apply on any change (no need to press Filter).
            val apply: () -> Unit = { page = 1; reload++ }
            FlowRowFilters(
                genre = genre, onGenre = { genre = it; apply() },
                format = format, onFormat = { format = it; apply() },
                status = status, onStatus = { status = it; apply() },
                season = season, onSeason = { season = it; apply() },
                year = year, onYear = { year = it; apply() },
                sort = sort, onSort = { sort = it; apply() },
                onApply = apply,
            )
            Spacer(Modifier.height(12.dp))
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FlowRowFilters(
    genre: String?, onGenre: (String?) -> Unit,
    format: String?, onFormat: (String?) -> Unit,
    status: String?, onStatus: (String?) -> Unit,
    season: String?, onSeason: (String?) -> Unit,
    year: Int?, onYear: (Int?) -> Unit,
    sort: String, onSort: (String) -> Unit,
    onApply: () -> Unit,
) {
    val years = (2026 downTo 1960).toList()
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterDropdown("Genre", genre ?: "Any genre", listOf("Any genre" to null) + GENRES.map { it to it }, onGenre)
        FilterDropdown("Type", FORMATS.entries.firstOrNull { it.value == format }?.key ?: "Any type", FORMATS.map { it.key to it.value }, onFormat)
        FilterDropdown("Status", STATUSES_F.entries.firstOrNull { it.value == status }?.key ?: "Any status", STATUSES_F.map { it.key to it.value }, onStatus)
        FilterDropdown("Season", SEASONS.entries.firstOrNull { it.value == season }?.key ?: "Any season", SEASONS.map { it.key to it.value }, onSeason)
        FilterDropdown("Year", year?.toString() ?: "Any year", listOf("Any year" to null) + years.map { it.toString() to it }, onYear)
        FilterDropdown("Sort", SORTS.entries.firstOrNull { it.value == sort }?.key ?: "Trending", SORTS.map { it.key to it.value }, { onSort(it ?: "TRENDING_DESC") })
        Button(onClick = onApply, colors = ButtonDefaults.buttonColors(containerColor = Accent)) { Text("Filter") }
    }
}

@Composable
private fun <T> FilterDropdown(label: String, current: String, options: List<Pair<String, T>>, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }) { Text("$label: $current", style = MaterialTheme.typography.labelMedium) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (name, value) ->
                DropdownMenuItem(text = { Text(name) }, onClick = { onPick(value); open = false })
            }
        }
    }
}

// ── Detail ────────────────────────────────────────────────────────────────────

@Composable
fun DetailScreen(animeId: Int, onPlay: () -> Unit) {
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
                        listOf(Color.Transparent, Color(0xFF0B0B0F)),
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
        EpisodesSection(a, onPlay)
        Spacer(Modifier.height(32.dp))
    }
}

// ── Episodes (Anikoto + AnimePahe servers) ────────────────────────────────────

private data class EpUi(val number: Float, val play: () -> Unit)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EpisodesSection(anime: com.sanjay.anitrack.next.data.Anime, onPlay: () -> Unit) {
    var server by remember { mutableStateOf("anikoto") } // "anikoto" | "animepahe"
    var anikotoMatch by remember { mutableStateOf<com.sanjay.anitrack.next.data.Anikoto.Matched?>(null) }
    var paheMatch by remember { mutableStateOf<com.sanjay.anitrack.next.data.Pahe.Matched?>(null) }
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var rangeStart by remember { mutableStateOf(0) }
    var watched by remember { mutableStateOf<Map<Float, Int>>(emptyMap()) }

    LaunchedEffect(anime.id) {
        runCatching { watched = com.sanjay.anitrack.next.data.Db.positionsFor(anime.id) }
    }
    // Load the selected server on demand.
    LaunchedEffect(anime.id, server) {
        rangeStart = 0; failed = false
        if (server == "anikoto" && anikotoMatch == null) {
            loading = true
            runCatching { anikotoMatch = com.sanjay.anitrack.next.data.Anikoto.matchFor(anime) }
                .onFailure { failed = true }
            if (anikotoMatch == null) failed = true
            loading = false
        } else if (server == "animepahe" && paheMatch == null) {
            loading = true
            runCatching { paheMatch = com.sanjay.anitrack.next.data.Pahe.matchFor(anime) }
                .onFailure { failed = true }
            if (paheMatch == null) failed = true
            loading = false
        }
    }

    // Build the unified episode list + click actions for the active server.
    val epUi: List<EpUi> = remember(server, anikotoMatch, paheMatch) {
        when (server) {
            "animepahe" -> paheMatch?.let { m ->
                m.episodes.map { ep ->
                    EpUi(ep.number) {
                        com.sanjay.anitrack.next.data.PlaySession.apply {
                            provider = "animepahe"; animeId = anime.id
                            animeTitle = anime.title; animeCover = anime.cover
                            this.anime = anime
                            paheSession = m.source.session; paheEps = m.episodes
                            anikotoEps = emptyList()
                            index = m.episodes.indexOf(ep).coerceAtLeast(0)
                        }
                        onPlay()
                    }
                }
            }.orEmpty()
            else -> anikotoMatch?.let { m ->
                m.list.episodes.map { ep ->
                    EpUi(ep.number) {
                        com.sanjay.anitrack.next.data.PlaySession.apply {
                            provider = "anikoto"; animeId = anime.id
                            animeTitle = anime.title; animeCover = anime.cover
                            this.anime = anime
                            slug = m.source.slug; anikotoEps = m.list.episodes
                            paheEps = emptyList()
                            index = m.list.episodes.indexOf(ep).coerceAtLeast(0)
                        }
                        onPlay()
                    }
                }
            }.orEmpty()
        }
    }

    Column(Modifier.padding(horizontal = 16.dp)) {
        Text("Episodes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        // Server toggle
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = server == "anikoto", onClick = { server = "anikoto" }, label = { Text("Anikoto") })
            FilterChip(selected = server == "animepahe", onClick = { server = "animepahe" }, label = { Text("AnimePahe") })
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
            Text("No source on this server.", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
        }
        Spacer(Modifier.height(10.dp))

        if (epUi.isNotEmpty()) {
            val ranges = epUi.chunked(100)
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
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (ep in ranges.getOrElse(rangeStart) { emptyList() }) {
                    val pct = watched[ep.number] ?: 0
                    val bg = when {
                        pct >= 85 -> Accent.copy(alpha = 0.30f)
                        pct > 0 -> Color.White.copy(alpha = 0.16f)
                        else -> Color.White.copy(alpha = 0.07f)
                    }
                    Box(
                        Modifier.clip(RoundedCornerShape(8.dp)).background(bg)
                            .clickable { ep.play() }
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                    ) {
                        Text(
                            "${if (ep.number % 1f == 0f) ep.number.toInt() else ep.number}",
                            style = MaterialTheme.typography.labelLarge,
                            color = if (pct >= 85) Color.White else Color.White.copy(alpha = 0.9f),
                        )
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
                            com.sanjay.anitrack.next.data.Db.setListStatus(anime.id, key, anime.title, anime.cover)
                            status = key
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
                            com.sanjay.anitrack.next.data.Db.removeFromList(anime.id)
                            status = null
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
