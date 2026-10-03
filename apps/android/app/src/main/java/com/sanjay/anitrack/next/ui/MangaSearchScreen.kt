package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.FilterList
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.SearchOff
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
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Manga

private val MANGA_GENRES = listOf(
    "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music",
    "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
)

/** Type → (AniList format, country of origin). */
private val MANGA_TYPES = listOf(
    "Any type" to (null to null),
    "Manga" to ("MANGA" to "JP"),
    "Manhwa" to ("MANGA" to "KR"),
    "Manhua" to ("MANGA" to "CN"),
    "One-shot" to ("ONE_SHOT" to null),
    "Light novel" to ("NOVEL" to null),
)
private val MANGA_STATUSES = mapOf(
    "Any status" to null, "Publishing" to "RELEASING", "Finished" to "FINISHED",
    "Upcoming" to "NOT_YET_RELEASED", "On hiatus" to "HIATUS", "Cancelled" to "CANCELLED",
)
private val MANGA_SORTS = mapOf(
    "Default sort" to "TRENDING_DESC", "Popularity" to "POPULARITY_DESC", "Score" to "SCORE_DESC",
    "Newest" to "START_DATE_DESC", "Most chapters" to "CHAPTERS_DESC", "Title" to "TITLE_ROMAJI",
)

/** The manga Search tab: the anime filter page's layout with manga filters. */
@Composable
fun MangaSearchScreen(initialQuery: String = "", onOpen: (Manga) -> Unit) {
    var query by remember { mutableStateOf(initialQuery) }
    var genre by remember { mutableStateOf<String?>(null) }
    var year by remember { mutableStateOf<Int?>(null) }
    var type by remember { mutableStateOf<Pair<String?, String?>>(null to null) }
    var status by remember { mutableStateOf<String?>(null) }
    var sort by remember { mutableStateOf("TRENDING_DESC") }
    var page by remember { mutableIntStateOf(1) }
    var hasNext by remember { mutableStateOf(false) }
    var results by remember { mutableStateOf<List<Manga>>(emptyList()) }
    var topRated by remember { mutableStateOf<List<Manga>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) { runCatching { topRated = AniList.mangaFeed().topRated.take(12) } }
    LaunchedEffect(reload, page) {
        searching = true
        runCatching {
            val (list, next) = AniList.advancedMangaSearch(query, genre, year, type.first, type.second, status, sort, page)
            results = list
            hasNext = next
        }
        searching = false
    }
    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820
    val apply: () -> Unit = { page = 1; reload++ }

    Row(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).padding(horizontal = 24.dp, vertical = 20.dp)) {
            ScreenHeader("Browse manga", subtitle = "Filter AniList's manga, manhwa and manhua.", icon = Icons.Rounded.MenuBook)
            Spacer(Modifier.height(18.dp))
            val filtered = query.isNotBlank() || genre != null || year != null || type != (null to null) ||
                status != null || sort != "TRENDING_DESC"
            AniCard(padding = PaddingValues(16.dp)) {
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FilterSearchField(query, { query = it }, "Search manga…", onSearch = apply)
                    FilterDropdown("Select genre", genre, listOf("Select genre" to null) + MANGA_GENRES.map { it to it }) { genre = it; apply() }
                    FilterDropdown(
                        "Select type",
                        MANGA_TYPES.firstOrNull { it.second == type }?.first?.takeIf { type != (null to null) },
                        MANGA_TYPES,
                    ) { type = it; apply() }
                    FilterDropdown("Select year", year?.toString(), listOf("Select year" to null) + (2026 downTo 1950).map { it.toString() to it }) { year = it; apply() }
                    FilterDropdown(
                        "Select status",
                        MANGA_STATUSES.entries.firstOrNull { it.value == status }?.key?.takeIf { status != null },
                        MANGA_STATUSES.map { it.key to it.value },
                    ) { status = it; apply() }
                    FilterDropdown(
                        "Default sort",
                        MANGA_SORTS.entries.firstOrNull { it.value == sort }?.key?.takeIf { sort != "TRENDING_DESC" },
                        MANGA_SORTS.map { it.key to it.value },
                    ) { sort = it ?: "TRENDING_DESC"; apply() }
                    PillButton("Filter", apply, icon = Icons.Rounded.FilterList, style = PillStyle.Primary)
                    if (filtered) {
                        PillButton("Reset", {
                            query = ""; genre = null; year = null; type = null to null; status = null; sort = "TRENDING_DESC"
                            apply()
                        }, icon = Icons.Rounded.RestartAlt, style = PillStyle.Ghost)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            if (searching && results.isEmpty()) {
                LinearProgressIndicator(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)), color = AniColors.Accent, trackColor = AniColors.SurfaceHigh)
            } else if (!searching && results.isEmpty()) {
                EmptyState(Icons.Rounded.SearchOff, "No results", "Nothing matches these filters. Try removing one or searching another title.")
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(140.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
                modifier = Modifier.weight(1f),
            ) {
                items(results, key = { it.id }) { manga -> MangaCard(manga, onOpen, width = null) }
                if (results.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                    PageControls(page, hasNext, onPrevious = { page-- }, onNext = { page++ })
                }
            }
        }
        if (wide && topRated.isNotEmpty()) {
            Column(Modifier.width(320.dp).fillMaxHeight().padding(top = 20.dp, end = 20.dp, bottom = 20.dp)) {
                AniCard(Modifier.fillMaxHeight(), padding = PaddingValues(horizontal = 10.dp, vertical = 14.dp)) {
                    Text("Top rated manga", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp, bottom = 8.dp))
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        items(topRated.size) { i ->
                            val manga = topRated[i]
                            RankRow(
                                i + 1, manga.cover, manga.title,
                                onClick = { onOpen(manga) },
                                score = aniScore(manga.score),
                                detail = metaLine(manga.kind, manga.year?.toString()),
                            )
                        }
                    }
                }
            }
        }
    }
}
