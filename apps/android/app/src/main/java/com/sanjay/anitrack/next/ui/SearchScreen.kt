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
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.FilterList
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SearchOff
import androidx.compose.material.icons.rounded.TravelExplore
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
        Column(Modifier.weight(1f).padding(horizontal = 24.dp, vertical = 20.dp)) {
            ScreenHeader("Browse anime", subtitle = "Filter AniList by genre, season, year and more.", icon = Icons.Rounded.TravelExplore)
            Spacer(Modifier.height(18.dp))
            // Filter panel: search plus dropdowns, applied with the Filter button.
            val apply: () -> Unit = { page = 1; reload++ }
            val filtered = query.isNotBlank() || genre != null || year != null || season != null || format != null ||
                status != null || source != null || epRange != null || sort != "TRENDING_DESC"
            AniCard(padding = PaddingValues(16.dp)) {
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FilterSearchField(query, { query = it }, "Search titles…", onSearch = apply)
                    FilterDropdown("Select genre", genre, listOf("Select genre" to null) + GENRES.map { it to it }) { genre = it; apply() }
                    FilterDropdown("Select season", SEASONS.entries.firstOrNull { it.value == season }?.key?.takeIf { season != null }, SEASONS.map { it.key to it.value }) { season = it; apply() }
                    FilterDropdown("Select year", year?.toString(), listOf("Select year" to null) + (2026 downTo 1960).map { it.toString() to it }) { year = it; apply() }
                    FilterDropdown("Select type", FORMATS.entries.firstOrNull { it.value == format }?.key?.takeIf { format != null }, FORMATS.map { it.key to it.value }) { format = it; apply() }
                    FilterDropdown("Select status", STATUSES_F.entries.firstOrNull { it.value == status }?.key?.takeIf { status != null }, STATUSES_F.map { it.key to it.value }) { status = it; apply() }
                    FilterDropdown("Select source", SOURCES.entries.firstOrNull { it.value == source }?.key?.takeIf { source != null }, SOURCES.map { it.key to it.value }) { source = it; apply() }
                    FilterDropdown("Episode range", EP_RANGES.entries.firstOrNull { it.value == epRange }?.key?.takeIf { epRange != null }, EP_RANGES.map { it.key to it.value }) { epRange = it; apply() }
                    FilterDropdown("Default sort", SORTS.entries.firstOrNull { it.value == sort }?.key?.takeIf { sort != "TRENDING_DESC" }, SORTS.map { it.key to it.value }) { sort = it ?: "TRENDING_DESC"; apply() }
                    PillButton("Filter", apply, icon = Icons.Rounded.FilterList, style = PillStyle.Primary)
                    if (filtered) {
                        PillButton("Reset", {
                            query = ""; genre = null; year = null; season = null; format = null
                            status = null; source = null; epRange = null; sort = "TRENDING_DESC"
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
                items(results, key = { it.id }) { a -> AnimeCard(a, onOpen, width = null) }
                if (results.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                    PageControls(page, hasNext, onPrevious = { page-- }, onNext = { page++ })
                }
            }
        }
        if (wide && topRated.isNotEmpty()) {
            Column(Modifier.width(320.dp).fillMaxHeight().padding(top = 20.dp, end = 20.dp, bottom = 20.dp)) {
                AniCard(Modifier.fillMaxHeight(), padding = PaddingValues(horizontal = 10.dp, vertical = 14.dp)) {
                    Text("Top rated", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp, bottom = 8.dp))
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        items(topRated.size) { i -> Top10Row(i + 1, topRated[i], onOpen) }
                    }
                }
            }
        }
    }
}

/** Previous / page / next controls under result grids. */
@Composable
internal fun PageControls(page: Int, hasNext: Boolean, onPrevious: () -> Unit, onNext: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PillButton("Previous", onPrevious, icon = Icons.AutoMirrored.Rounded.KeyboardArrowLeft, enabled = page > 1, compact = true)
        Text("Page $page", Modifier.padding(horizontal = 16.dp), color = AniColors.TextSecondary, style = MaterialTheme.typography.labelLarge)
        PillButton("Next", onNext, icon = Icons.AutoMirrored.Rounded.KeyboardArrowRight, enabled = hasNext, compact = true)
    }
}

/** Search input matching the filter dropdowns. */
@Composable
internal fun FilterSearchField(value: String, onChange: (String) -> Unit, placeholder: String, onSearch: () -> Unit) {
    Row(
        Modifier.width(260.dp).height(44.dp)
            .clip(RoundedCornerShape(12.dp)).background(AniColors.SurfaceHigh)
            .border(1.dp, AniColors.BorderSoft, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Search, null, tint = AniColors.TextTertiary, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            androidx.compose.foundation.text.BasicTextField(
                value = value, onValueChange = onChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = AniColors.Text),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(AniColors.Accent),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Search),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = { onSearch() }),
                modifier = Modifier.fillMaxWidth(),
            )
            if (value.isEmpty()) Text(placeholder, color = AniColors.TextTertiary, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
// "Select …" dropdown box; an active filter is outlined in the brand red.
@Composable
internal fun <T> FilterDropdown(placeholder: String, current: String?, options: List<Pair<String, T>>, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val active = current != null
    Box {
        Row(
            Modifier.height(44.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(if (active) AniColors.AccentSoft else AniColors.SurfaceHigh)
                .border(1.dp, if (active) AniColors.Accent.copy(alpha = 0.55f) else AniColors.BorderSoft, RoundedCornerShape(12.dp))
                .clickable { open = true }
                .padding(start = 14.dp, end = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                current ?: placeholder,
                style = MaterialTheme.typography.labelLarge,
                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                color = if (active) AniColors.Text else AniColors.TextSecondary,
            )
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Rounded.ExpandMore, null, tint = if (active) AniColors.Text else AniColors.TextTertiary, modifier = Modifier.size(20.dp))
        }
        DropdownMenu(
            expanded = open, onDismissRequest = { open = false },
            shape = RoundedCornerShape(14.dp), containerColor = AniColors.Surface,
            modifier = Modifier.heightIn(max = 420.dp),
        ) {
            options.forEach { (name, value) ->
                DropdownMenuItem(
                    text = { Text(name, fontWeight = if (name == current) FontWeight.Bold else FontWeight.Normal) },
                    onClick = { onPick(value); open = false },
                )
            }
        }
    }
}
