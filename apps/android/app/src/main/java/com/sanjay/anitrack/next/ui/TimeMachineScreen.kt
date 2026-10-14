package com.sanjay.anitrack.next.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Casino
import androidx.compose.material.icons.rounded.Insights
import androidx.compose.material.icons.rounded.Museum
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.TimeMachineArchive
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlin.random.Random

private const val VISITED_KEY = "time_machine_visited"
private val SEASONS = listOf("ALL" to "All year", "WINTER" to "Winter", "SPRING" to "Spring", "SUMMER" to "Summer", "FALL" to "Fall")
private val SORTS = listOf("SCORE_DESC" to "Top rated", "POPULARITY_DESC" to "Most popular")

private fun visitedYears(context: Context): Set<Int> =
    context.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE).getString(VISITED_KEY, null)
        ?.split(',')?.mapNotNull { it.toIntOrNull() }?.toSet().orEmpty()

private fun saveVisited(context: Context, years: Set<Int>) {
    context.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE).edit()
        .putString(VISITED_KEY, years.sorted().joinToString(",")).apply()
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TimeMachineScreen(
    onOpen: (Anime) -> Unit,
    onOpenGenome: () -> Unit = {},
    onOpenMuseum: (Anime) -> Unit = {},
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lastYear = remember { java.time.Year.now().value.coerceAtMost(2029) }
    var year by remember { mutableIntStateOf(1988) }
    var requestedYear by remember { mutableIntStateOf(1988) }
    var season by remember { mutableStateOf("ALL") }
    var sort by remember { mutableStateOf("SCORE_DESC") }
    var anime by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var page by remember { mutableIntStateOf(1) }
    var hasMore by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var selectedGenre by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    var visited by remember { mutableStateOf(visitedYears(context)) }
    // Titles you've watched or listed, by the year they aired (for "From your history").
    var history by remember { mutableStateOf<Map<Int, List<Anime>>>(emptyMap()) }
    val today = remember { LocalDate.now() }
    var onThisDay by remember { mutableStateOf<List<Pair<Anime, Int>>>(emptyList()) }
    val era = TimeMachineArchive.eraFor(year)
    val accent = Color(era.accent)

    fun travel(to: Int) {
        year = to.coerceIn(1960, lastYear)
        requestedYear = year
    }

    suspend fun fetch(target: Int, pageNumber: Int): Pair<List<Anime>, Boolean> =
        if (season == "ALL") AniList.advancedSearch(null, null, null, null, null, null, sort, pageNumber, startYear = target)
        else AniList.advancedSearch(null, null, target, season, null, null, sort, pageNumber)

    LaunchedEffect(requestedYear, season, sort) {
        loading = true
        failed = false
        selectedGenre = null
        page = 1
        try {
            val (list, more) = fetch(requestedYear, 1)
            anime = list
            hasMore = more
            if (requestedYear !in visited) {
                visited = visited + requestedYear
                saveVisited(context, visited)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            failed = true
        }
        loading = false
    }
    LaunchedEffect(Unit) {
        runCatching {
            val ids = buildList {
                Db.STATUSES.forEach { status -> Db.listByStatus(status).forEach { add(it.animeId) } }
                Db.continueWatching(60).forEach { add(it.animeId) }
            }.distinct()
            history = AniList.byIds(ids).filter { it.year != null }.groupBy { it.year!! }
        }
    }
    LaunchedEffect(Unit) {
        runCatching { onThisDay = AniList.premieredOn(today.monthValue, today.dayOfMonth) }
    }

    val formats = remember(anime) {
        listOf(
            "TV signals" to anime.count { it.format == "TV" || it.format == "TV_SHORT" },
            "Films" to anime.count { it.format == "MOVIE" },
            "OVA artifacts" to anime.count { it.format == "OVA" || it.format == "ONA" },
        )
    }
    val genres = remember(anime) {
        anime.flatMap { it.genres }.groupingBy { it }.eachCount().entries
            .sortedByDescending { it.value }.take(6)
    }
    // The studios behind most of this year's list.
    val topStudios = remember(anime) {
        anime.flatMap { it.studios.take(1) }.groupingBy { it }.eachCount().entries
            .sortedByDescending { it.value }.take(3).map { it.key to it.value }
    }
    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820
    val hero = anime.firstOrNull()
    val visibleAnime = remember(anime, selectedGenre) {
        selectedGenre?.let { selected -> anime.filter { selected in it.genres } } ?: anime
    }
    val yours = history[requestedYear].orEmpty()

    LazyColumn(Modifier.fillMaxSize().background(Color.Black)) {
        // ── The year ────────────────────────────────────────────────────────
        item {
            Box(Modifier.fillMaxWidth().heightIn(min = 340.dp)) {
                hero?.banner?.let {
                    AsyncImage(
                        model = it,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.matchParentSize(),
                        alpha = 0.42f,
                    )
                }
                Box(Modifier.matchParentSize().background(Brush.horizontalGradient(listOf(Color.Black, Color.Black.copy(alpha = 0.82f), Color.Transparent))))
                Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black))))
                Column(Modifier.align(Alignment.BottomStart).padding(24.dp)) {
                    Text(
                        TimeMachineArchive.transmission(year).uppercase(),
                        color = accent,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 2.sp,
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        YearStep(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "Previous year", enabled = year > 1960) { travel(year - 1) }
                        Text(year.toString(), fontSize = 82.sp, lineHeight = 82.sp, fontWeight = FontWeight.Black, modifier = Modifier.padding(horizontal = 6.dp))
                        YearStep(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "Next year", enabled = year < lastYear) { travel(year + 1) }
                    }
                    Text(era.headline, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.height(6.dp))
                    Text(era.atmosphere, color = Color.White.copy(alpha = 0.62f), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.widthIn(max = 620.dp))
                    Spacer(Modifier.height(18.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { visibleAnime.take(15).takeIf { it.isNotEmpty() }?.let { onOpen(it[Random.nextInt(it.size)]) } },
                            enabled = visibleAnime.isNotEmpty(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black),
                        ) {
                            Icon(Icons.Rounded.AutoAwesome, null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Mystery screening", fontWeight = FontWeight.Bold)
                        }
                        OutlinedButton(
                            onClick = { travel(Random.nextInt(1960, lastYear + 1)) },
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                        ) {
                            Icon(Icons.Rounded.Casino, null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Random year", fontWeight = FontWeight.Bold)
                        }
                    }
                    Row {
                        TextButton(onClick = onOpenGenome) {
                            Icon(Icons.Rounded.Insights, null, tint = Color(0xFFFFB3FF), modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("View Taste Genome", color = Color(0xFFFFB3FF), fontWeight = FontWeight.Bold)
                        }
                        TextButton(onClick = { hero?.let(onOpenMuseum) }, enabled = hero != null) {
                            Icon(Icons.Rounded.Museum, null, tint = Color(0xFFFFD180), modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text("Enter Living Museum", color = Color(0xFFFFD180), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }

        // ── The dial: every decade, then the year slider ────────────────────
        item {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 16.dp)) {
                Text("Set the dial", fontWeight = FontWeight.Bold)
                Text("Travel through the AniList archive", color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.labelSmall)
                Spacer(Modifier.height(10.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(TimeMachineArchive.eras.filter { it.start <= lastYear }) { decade ->
                        val selected = era.start == decade.start
                        val decadeAccent = Color(decade.accent)
                        Box(
                            Modifier.clip(RoundedCornerShape(50))
                                .background(if (selected) decadeAccent else Color.White.copy(alpha = 0.07f))
                                .clickable { travel(decade.start + 5) }
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                        ) {
                            Text(
                                decade.label,
                                color = if (selected) Color.Black else Color.White.copy(alpha = 0.7f),
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
                Slider(
                    value = year.toFloat(),
                    onValueChange = { year = it.toInt() },
                    onValueChangeFinished = { requestedYear = year },
                    valueRange = 1960f..lastYear.toFloat(),
                    steps = lastYear - 1961,
                    colors = SliderDefaults.colors(thumbColor = accent, activeTrackColor = accent),
                )
            }
        }

        // ── Your passport and the year at a glance (side by side when wide) ──
        item {
            val passport = @Composable { modifier: Modifier ->
                Passport(visited, history.keys, current = requestedYear, lastYear = lastYear, onTravel = ::travel, modifier = modifier)
            }
            val panel = @Composable { modifier: Modifier ->
                YearPanel(season, { season = it }, sort, { sort = it }, formats, topStudios, accent, modifier)
            }
            if (wide) {
                Row(Modifier.padding(horizontal = 24.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    passport(Modifier.width(520.dp))
                    panel(Modifier.weight(1f))
                }
            } else {
                Column(Modifier.padding(horizontal = 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    passport(Modifier.fillMaxWidth())
                    panel(Modifier.fillMaxWidth())
                }
            }
        }

        if (genres.isNotEmpty()) item {
            Column(Modifier.padding(top = 16.dp)) {
                Text("GENRE SIGNAL", modifier = Modifier.padding(horizontal = 24.dp), color = accent, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Text("Tap a signal to view its titles", modifier = Modifier.padding(horizontal = 24.dp), color = Color.White.copy(alpha = 0.38f), style = MaterialTheme.typography.labelSmall)
                Spacer(Modifier.height(10.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item(key = "all") { SignalChip("All · ${anime.size}", selectedGenre == null, accent) { selectedGenre = null } }
                    items(genres.toList()) { genre ->
                        val selected = selectedGenre == genre.key
                        SignalChip("${genre.key} · ${genre.value}", selected, accent) { selectedGenre = if (selected) null else genre.key }
                    }
                }
            }
        }

        // ── The year's titles ───────────────────────────────────────────────
        item {
            Column(Modifier.padding(top = 24.dp)) {
                val label = SEASONS.first { it.first == season }.second
                Text(
                    "RECOVERED FROM ${if (season == "ALL") "" else label.uppercase() + " "}$requestedYear",
                    modifier = Modifier.padding(horizontal = 24.dp), color = accent,
                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp,
                )
                Text(
                    selectedGenre?.let { "$it transmission" } ?: if (sort == "SCORE_DESC") "The essential transmission" else "What everyone was watching",
                    modifier = Modifier.padding(horizontal = 24.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black,
                )
                selectedGenre?.let {
                    Text("${visibleAnime.size} titles in this signal", modifier = Modifier.padding(horizontal = 24.dp), color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.labelSmall)
                }
                Spacer(Modifier.height(14.dp))
                when {
                    loading -> LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp), color = accent)
                    failed -> Text("The archive did not answer. Move the dial and try again.", modifier = Modifier.padding(horizontal = 24.dp), color = Color(0xFFFF8A80))
                    visibleAnime.isEmpty() -> Text(
                        "Nothing recorded for this ${if (season == "ALL") "year" else "season"}. Try another season or year.",
                        modifier = Modifier.padding(horizontal = 24.dp), color = Color.White.copy(alpha = 0.5f),
                    )
                    else -> LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        items(visibleAnime, key = { it.id }) { item -> AnimeCard(item, onOpen, width = 142) }
                        if (hasMore && selectedGenre == null) item(key = "more") {
                            Box(Modifier.width(142.dp).aspectRatio(1f / POSTER_RATIO), contentAlignment = Alignment.Center) {
                                PillButton(
                                    "More from $requestedYear",
                                    {
                                        loadingMore = true
                                        scope.launch {
                                            runCatching { fetch(requestedYear, page + 1) }.onSuccess { (list, more) ->
                                                page += 1
                                                anime = (anime + list).distinctBy { it.id }
                                                hasMore = more
                                            }
                                            loadingMore = false
                                        }
                                    },
                                    loading = loadingMore,
                                    compact = true,
                                )
                            }
                        }
                    }
                }
            }
        }

        // ── From your history ───────────────────────────────────────────────
        if (yours.isNotEmpty()) item {
            Column(Modifier.padding(top = 28.dp)) {
                Text("FROM YOUR HISTORY", modifier = Modifier.padding(horizontal = 24.dp), color = accent, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Text(
                    "You've watched ${yours.size} title${if (yours.size == 1) "" else "s"} from $requestedYear",
                    modifier = Modifier.padding(horizontal = 24.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black,
                )
                Spacer(Modifier.height(12.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(yours, key = { it.id }) { item -> AnimeCard(item, onOpen, width = 142) }
                }
            }
        }

        // ── On this day ─────────────────────────────────────────────────────
        if (onThisDay.isNotEmpty()) item {
            val date = "${today.month.getDisplayName(TextStyle.FULL, Locale.getDefault())} ${today.dayOfMonth}"
            Column(Modifier.padding(top = 28.dp, bottom = 40.dp)) {
                Text("ON THIS DAY", modifier = Modifier.padding(horizontal = 24.dp), color = Color(0xFFFFD180), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Text("Premiered on $date", modifier = Modifier.padding(horizontal = 24.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
                Text("Tap a year to travel there.", modifier = Modifier.padding(horizontal = 24.dp), color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.labelSmall)
                Spacer(Modifier.height(12.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(onThisDay, key = { it.first.id }) { (item, premiered) ->
                        Box {
                            AnimeCard(item, onOpen, width = 142)
                            val yearAccent = Color(TimeMachineArchive.eraFor(premiered).accent)
                            Text(
                                premiered.toString(),
                                color = Color.Black,
                                style = MaterialTheme.typography.labelLarge,
                                fontWeight = FontWeight.Black,
                                modifier = Modifier.align(Alignment.TopStart).padding(8.dp)
                                    .clip(RoundedCornerShape(50)).background(yearAccent)
                                    .clickable { travel(premiered) }.padding(horizontal = 10.dp, vertical = 3.dp),
                            )
                        }
                    }
                }
            }
        } else item { Spacer(Modifier.height(40.dp)) }
    }
}

/** Seasons, order, the year's formats and its busiest studios. */
@Composable
private fun YearPanel(
    season: String,
    onSeason: (String) -> Unit,
    sort: String,
    onSort: (String) -> Unit,
    formats: List<Pair<String, Int>>,
    studios: List<Pair<String, Int>>,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        PillTabs(SEASONS, season, onSeason, compact = true)
        PillTabs(SORTS, sort, onSort, compact = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            formats.forEach { (label, count) ->
                Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.045f)).padding(14.dp)) {
                    Text(count.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
                    Text(label.uppercase(), fontSize = 9.sp, letterSpacing = 1.sp, color = Color.White.copy(alpha = 0.38f))
                }
            }
        }
        if (studios.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.045f)).padding(14.dp)) {
                Text("STUDIOS AT WORK", color = accent, fontSize = 9.sp, letterSpacing = 1.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(6.dp))
                studios.forEach { (name, count) ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
                        Text(name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Text("$count title${if (count == 1) "" else "s"}", color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
    }
}

@Composable
private fun YearStep(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape)
            .background(Color.White.copy(alpha = if (enabled) 0.1f else 0.03f))
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, tint = Color.White.copy(alpha = if (enabled) 0.9f else 0.25f), modifier = Modifier.size(28.dp)) }
}

@Composable
private fun SignalChip(text: String, selected: Boolean, accent: Color, onClick: () -> Unit) {
    Text(
        text,
        Modifier.clip(RoundedCornerShape(50))
            .background(if (selected) accent else Color.White.copy(alpha = 0.07f))
            .clickable(onClick = onClick)
            .padding(horizontal = 13.dp, vertical = 8.dp),
        color = if (selected) Color.Black else Color.White.copy(alpha = 0.65f),
        style = MaterialTheme.typography.labelMedium,
        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
    )
}

/**
 * Every year in the archive as a stamp, one row per decade: filled once visited,
 * ringed for the year on the dial, dotted where your own history has a title.
 */
@Composable
private fun Passport(
    visited: Set<Int>,
    historyYears: Set<Int>,
    current: Int,
    lastYear: Int,
    onTravel: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val total = lastYear - 1960 + 1
    val explored = visited.count { it in 1960..lastYear }
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.035f)).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("YOUR PASSPORT", color = Color(0xFFFFD180), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Text("$explored of $total years explored", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            ProgressStrip(explored / total.toFloat(), Modifier.width(120.dp))
        }
        Spacer(Modifier.height(12.dp))
        TimeMachineArchive.eras.filter { it.start <= lastYear }.forEach { decade ->
            val tint = Color(decade.accent)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
                Text(decade.label, color = tint, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, modifier = Modifier.width(48.dp))
                (decade.start..minOf(decade.end, lastYear)).forEach { y ->
                    val seen = y in visited
                    Box(
                        Modifier.padding(end = 4.dp).size(28.dp).clip(RoundedCornerShape(7.dp))
                            .background(if (seen) tint.copy(alpha = 0.85f) else Color.White.copy(alpha = 0.06f))
                            .then(if (y == current) Modifier.border(2.dp, Color.White, RoundedCornerShape(7.dp)) else Modifier)
                            .clickable { onTravel(y) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            (y % 100).toString().padStart(2, '0'),
                            color = if (seen) Color.Black else Color.White.copy(alpha = 0.45f),
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                        )
                        if (y in historyYears) {
                            Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 2.dp).size(4.dp).clip(CircleShape).background(if (seen) Color.Black else Color.White))
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text("Dots mark years you've watched something from. Tap any stamp to travel.", color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.labelSmall)
    }
}
