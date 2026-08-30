package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList
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
    var recommendations by remember { mutableStateOf<List<AniList.Recommendation>>(emptyList()) }
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

    fun applyHomeFeed(feed: AniList.HomeFeed) {
        trending = feed.trending
        latest = feed.latest
        topAiring = feed.topAiring
        popular = feed.popular
    }

    LaunchedEffect(Unit) {
        // Paint local data immediately, then refresh it independently.
        val initialCw = runCatching {
            com.sanjay.anitrack.next.data.Db.continueWatching()
        }.getOrDefault(emptyList())
        cw = initialCw
        scope.launch {
            val changed = runCatching { com.sanjay.anitrack.next.data.GistSync.pullAndMerge() }.getOrDefault(false)
            if (changed) {
                val refreshed = runCatching {
                    com.sanjay.anitrack.next.data.Db.continueWatching()
                }.getOrDefault(cw)
                cw = refreshed
                runCatching { epTotals = AniList.episodeTotals(refreshed.map { it.animeId }) }
            }
        }
        // Anikoto uses its own host and does not compete for AniList's queue.
        scope.launch { runCatching { anikotoTop = com.sanjay.anitrack.next.data.Anikoto.top() } }

        // Paint the last complete feed from disk first. If it is older than the
        // five-minute network TTL, homeFeed refreshes it behind that content.
        AniList.cachedHomeFeed()?.let {
            applyHomeFeed(it)
            loading = false
        }
        runCatching { AniList.homeFeed() }
            .onSuccess(::applyHomeFeed)
            .onFailure {
                // A compact fallback still leaves Home useful on a first launch
                // if AniList rejects the larger combined query temporarily.
                if (trending.isEmpty()) runCatching { trending = AniList.trending() }
            }
        loading = false

        // Core Home wins AniList's serial queue. Secondary badges and
        // personalization start only after its complete feed is visible.
        scope.launch {
            runCatching { epTotals = AniList.episodeTotals(initialCw.map { it.animeId }) }
        }

        // Personalization follows the visible core feed through AniList's
        // rate-limit queue instead of delaying the hero for an off-screen row.
        scope.launch {
            var rows = runCatching {
                com.sanjay.anitrack.next.data.Db.STATUSES.flatMap {
                    com.sanjay.anitrack.next.data.Db.listByStatus(it)
                }
            }.getOrDefault(emptyList())
            val tasteRows = rows.filter { it.status == "completed" || it.status == "watching" }
            val enrichedRows = tasteRows.count { it.score != null && it.year != null }
            if (com.sanjay.anitrack.next.data.Mal.isConnected &&
                tasteRows.isNotEmpty() && enrichedRows * 2 < tasteRows.size
            ) {
                runCatching { com.sanjay.anitrack.next.data.Mal.importList() }
                rows = com.sanjay.anitrack.next.data.Db.STATUSES.flatMap {
                    com.sanjay.anitrack.next.data.Db.listByStatus(it)
                }
            }
            val seeds = com.sanjay.anitrack.next.data.RecommendationRanking.selectSeedIds(
                rows.map {
                    com.sanjay.anitrack.next.data.RecommendationSeedCandidate(
                        id = it.animeId,
                        status = it.status,
                        score = it.score,
                        updatedAt = it.updatedAt,
                        year = it.year,
                    )
                },
            )
            recommendations = runCatching {
                AniList.recommendations(seeds, rows.map { it.animeId })
            }.getOrDefault(emptyList())
        }
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
        if (recommendations.isNotEmpty()) {
            item(key = "for-you-header") { SectionHeader("For You") }
            item(key = "for-you-row") {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(
                        count = recommendations.size,
                        key = { recommendations[it].anime.id },
                    ) { i ->
                        RecommendationCard(recommendations[i], onOpen)
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
