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
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList

private val SearchAccent = Color(0xFFE50914)

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
                                cursorBrush = androidx.compose.ui.graphics.SolidColor(SearchAccent),
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
                        Modifier.height(46.dp).clip(RoundedCornerShape(10.dp)).background(SearchAccent)
                            .clickable { apply() }.padding(horizontal = 20.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Filter", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            if (searching && results.isEmpty()) {
                LinearProgressIndicator(Modifier.fillMaxWidth(), color = SearchAccent)
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
