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
import androidx.compose.material.icons.rounded.Refresh
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.TimeMachineArchive
import com.sanjay.anitrack.next.data.TimeMachineCandidate
import com.sanjay.anitrack.next.data.TimeMachineYear
import kotlinx.coroutines.CancellationException
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlin.random.Random

private const val VISITED_KEY = "time_machine_visited"
private const val YEAR_KEY = "time_machine_year"
private val SEASONS = listOf("ALL" to "All year", "WINTER" to "Winter", "SPRING" to "Spring", "SUMMER" to "Summer", "FALL" to "Fall")
/** Fewer titles than this and the year gets a note that AniList's record is thin. */
private const val QUIET_YEAR = 12

private fun prefs(context: Context) = context.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)

private fun visitedYears(context: Context): Set<Int> =
    prefs(context).getString(VISITED_KEY, null)?.split(',')?.mapNotNull { it.toIntOrNull() }?.toSet().orEmpty()

private fun saveVisited(context: Context, years: Set<Int>) {
    prefs(context).edit().putString(VISITED_KEY, years.sorted().joinToString(",")).apply()
}

private fun titleCount(count: Int, singular: String) = "$count $singular${if (count == 1) "" else "s"}"

private fun membersLabel(count: Int?): String = when {
    count == null || count <= 0 -> ""
    count >= 1000 -> "${(count / 1000.0).let { kotlin.math.round(it).toInt() }}k members"
    else -> "$count members"
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TimeMachineScreen(
    onOpen: (Anime) -> Unit,
    onOpenGenome: () -> Unit = {},
    onOpenMuseum: (Anime) -> Unit = {},
) {
    val context = LocalContext.current
    val lastYear = remember { java.time.Year.now().value.coerceAtMost(2029) }
    // Reopens on the last year visited.
    val firstYear = remember { prefs(context).getInt(YEAR_KEY, 1988).takeIf { it in 1960..lastYear } ?: 1988 }
    var year by remember { mutableIntStateOf(firstYear) }
    var requestedYear by remember { mutableIntStateOf(firstYear) }
    var season by remember { mutableStateOf("ALL") }
    var titles by remember { mutableStateOf<List<TimeMachineCandidate>>(emptyList()) }
    var gemTitles by remember { mutableStateOf<List<TimeMachineCandidate>>(emptyList()) }
    var attempt by remember { mutableIntStateOf(0) }
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

    // The main lists first (what's on screen), then the gems.
    LaunchedEffect(requestedYear, attempt) {
        loading = true
        failed = false
        titles = emptyList()
        gemTitles = emptyList()
        try {
            val found = AniList.timeMachineYear(requestedYear)
            titles = found
            loading = false
            prefs(context).edit().putInt(YEAR_KEY, requestedYear).apply()
            if (requestedYear !in visited) {
                visited = visited + requestedYear
                saveVisited(context, visited)
            }
            val top = found.maxOfOrNull { it.anime.popularity ?: 0 } ?: 0
            try {
                gemTitles = AniList.timeMachineGems(requestedYear, TimeMachineArchive.gemPopularityFloor(top))
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The year just shows no gems.
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            failed = true
            loading = false
        }
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

    val candidates = remember(titles, gemTitles) { titles + gemTitles }
    val wholeYear = remember(candidates) { TimeMachineArchive.curate(candidates) }
    val view = remember(candidates, season) { if (season == "ALL") wholeYear else TimeMachineArchive.curate(candidates, season) }
    val seasonLabel = SEASONS.first { it.first == season }.second
    val period = if (season == "ALL") "$requestedYear" else "$seasonLabel $requestedYear"
    val listed = remember(history) { history.values.flatten().map { it.id }.toSet() }
    val hero = wholeYear.headliners.firstOrNull() ?: wholeYear.newShows.firstOrNull() ?: wholeYear.films.firstOrNull()
    val banner = (wholeYear.headliners + wholeYear.newShows + wholeYear.films).firstNotNullOfOrNull { it.banner }
    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820
    val yours = history[requestedYear].orEmpty()

    LazyColumn(Modifier.fillMaxSize().background(Color.Black)) {
        // ── The year ────────────────────────────────────────────────────────
        item {
            Box(Modifier.fillMaxWidth().heightIn(min = 340.dp)) {
                banner?.let {
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
                        TimeMachineArchive.yearInDecade(year).uppercase(),
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
                    if (!loading && wholeYear.headliners.isNotEmpty()) {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "The year of ${TimeMachineArchive.joinTitles(wholeYear.headliners.map { it.title })}.",
                            color = Color.White.copy(alpha = 0.85f),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.widthIn(max = 720.dp),
                        )
                    }
                    Spacer(Modifier.height(18.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { TimeMachineArchive.mysteryPick(view, listed, Random.Default)?.let(onOpen) },
                            enabled = !loading && (view.newShows.isNotEmpty() || view.films.isNotEmpty()),
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
                Text("Every year from 1960 to $lastYear", color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.labelSmall)
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
                YearPanel(season, { season = it }, view, period, loading, accent, onOpen, modifier)
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

        // ── The year's titles ───────────────────────────────────────────────
        when {
            failed -> item {
                Row(
                    Modifier.padding(horizontal = 24.dp, vertical = 20.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp))
                        .background(Color(0x22FF5252)).padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("AniList didn't answer for $requestedYear.", color = Color(0xFFFF8A80), modifier = Modifier.weight(1f))
                    PillButton("Try again", { attempt += 1 }, icon = Icons.Rounded.Refresh, compact = true)
                }
            }
            loading -> item {
                LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 24.dp), color = accent)
            }
            else -> {
                val nothingThisSeason = season != "ALL" && view.titleCount == 0
                if (nothingThisSeason) item {
                    Note("Nothing on AniList premiered in $period. Try another season, or All year.")
                } else if (view.titleCount < QUIET_YEAR) item {
                    Note("A quiet ${if (season == "ALL") "year" else "season"} in the archive: AniList lists only ${titleCount(view.titleCount, "title")} from $period.")
                }
                if (view.newShows.isNotEmpty()) item {
                    TitleRow("New in $period", "First seasons and brand-new shows, one per franchise", view.newShows, onOpen)
                }
                if (view.films.isNotEmpty()) item {
                    TitleRow("On the big screen", "Films from $period, without recap movies", view.films, onOpen)
                }
                if (view.sequels.isNotEmpty()) item {
                    TitleRow("Sequels and spin-offs", "New seasons and side stories of earlier shows", view.sequels, onOpen)
                }
                if (view.gems.size >= 3) item {
                    TitleRow("Hidden gems", "Well-rated new titles that fewer people found", view.gems, onOpen)
                }
            }
        }

        // ── From your history ───────────────────────────────────────────────
        if (yours.isNotEmpty()) item {
            Column(Modifier.padding(top = 28.dp)) {
                Text("FROM YOUR HISTORY", modifier = Modifier.padding(horizontal = 24.dp), color = accent, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Text(
                    "You've watched ${titleCount(yours.size, "title")} from $requestedYear",
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

/** A titled row of the year's titles; it scrolls through all of them. */
@Composable
private fun TitleRow(title: String, subtitle: String, items: List<Anime>, onOpen: (Anime) -> Unit) {
    Column(Modifier.padding(top = 24.dp)) {
        Text(title, modifier = Modifier.padding(horizontal = 24.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
        Text(
            "$subtitle · ${titleCount(items.size, "title")}",
            modifier = Modifier.padding(horizontal = 24.dp),
            color = Color.White.copy(alpha = 0.4f),
            style = MaterialTheme.typography.labelSmall,
        )
        Spacer(Modifier.height(12.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            items(items, key = { it.id }) { item -> AnimeCard(item, onOpen, width = 142) }
        }
    }
}

@Composable
private fun Note(text: String) {
    Text(
        text,
        modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp).fillMaxWidth().clip(RoundedCornerShape(14.dp))
            .background(Color.White.copy(alpha = 0.045f)).padding(16.dp),
        color = Color.White.copy(alpha = 0.6f),
        style = MaterialTheme.typography.bodyMedium,
    )
}

/** Seasons, how many new shows, films and sequels, and the year's standouts. */
@Composable
private fun YearPanel(
    season: String,
    onSeason: (String) -> Unit,
    view: TimeMachineYear,
    period: String,
    loading: Boolean,
    accent: Color,
    onOpen: (Anime) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        PillTabs(SEASONS, season, onSeason, compact = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("New shows" to view.newShows.size, "Films" to view.films.size, "Sequels" to view.sequels.size).forEach { (label, count) ->
                Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.045f)).padding(14.dp)) {
                    Text(if (loading) "–" else count.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
                    Text(label.uppercase(), fontSize = 9.sp, letterSpacing = 1.sp, color = Color.White.copy(alpha = 0.38f))
                }
            }
        }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.045f)).padding(14.dp)) {
            Text("${period.uppercase()} AT A GLANCE", color = accent, fontSize = 9.sp, letterSpacing = 1.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            val stats = view.stats
            when {
                loading -> Text("Reading AniList…", color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.bodyMedium)
                view.titleCount == 0 -> Text("Nothing on record for $period.", color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.bodyMedium)
                else -> {
                    stats.biggestDebut?.let { Fact("Biggest debut", it.title, membersLabel(it.popularity)) { onOpen(it) } }
                    stats.bestRated?.let { Fact("Best rated", it.title, "${it.score}%") { onOpen(it) } }
                    stats.busiestStudio?.let { (name, count) -> Fact("Busiest studio", name, titleCount(count, "title")) }
                    if (stats.topGenres.isNotEmpty()) Fact("Leading genres", stats.topGenres.joinToString(", "), "")
                }
            }
        }
        if (!loading) {
            Text(
                "Picked from ${titleCount(view.titleCount, "AniList title")} that premiered in $period, the most-followed first. Recaps and music videos are left out.",
                color = Color.White.copy(alpha = 0.4f),
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun Fact(label: String, value: String, detail: String, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.labelMedium, modifier = Modifier.width(112.dp))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        if (detail.isNotEmpty()) {
            Spacer(Modifier.width(8.dp))
            Text(detail, color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.labelMedium)
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
