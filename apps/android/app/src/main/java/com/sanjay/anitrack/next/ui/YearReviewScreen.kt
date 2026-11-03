package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Celebration
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.NightsStay
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.*
import com.sanjay.anitrack.next.data.novel.NovelSourceId
import java.util.Calendar

private val Muted = Color.White.copy(alpha = 0.45f)
private val CardBg = Color.White.copy(alpha = 0.045f)

/** Year in Review: one year's watching and reading on this device, recapped. */
@Composable
fun YearReviewScreen(
    onOpenAnime: (Int) -> Unit,
    onOpenManga: (Int) -> Unit,
    onOpenNovel: (NovelSourceId, String) -> Unit,
) {
    val accent = AniColors.Accent
    var activity by remember { mutableStateOf<Pair<List<RecapWatch>, List<RecapRead>>?>(null) }
    val thisYear = remember { Calendar.getInstance().get(Calendar.YEAR) }
    var year by remember { mutableIntStateOf(thisYear) }

    LaunchedEffect(Unit) {
        activity = runCatching { Db.recapActivity() }.getOrDefault(emptyList<RecapWatch>() to emptyList())
    }

    val years = remember(activity) {
        val found = activity?.let { YearReview.years(it.first, it.second) }.orEmpty()
        if (thisYear in found) found else listOf(thisYear) + found
    }
    val recap = remember(activity, year) { activity?.let { YearReview.build(year, it.first, it.second) } }

    val openAnimeKey = { key: String -> key.toIntOrNull()?.takeIf { it in 1 until 1_000_000_000 }?.let(onOpenAnime) }
    val openNovelKey = { key: String ->
        val split = key.indexOf(':')
        if (split > 0) NovelSourceId.of(key.substring(0, split))?.let { onOpenNovel(it, key.substring(split + 1)) }
    }

    LazyColumn(Modifier.fillMaxSize().background(Color.Black)) {
        item {
            Box(
                Modifier.fillMaxWidth()
                    .background(Brush.radialGradient(listOf(accent.copy(alpha = 0.22f), Color.Black), radius = 900f))
                    .padding(horizontal = 24.dp, vertical = 34.dp),
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Celebration, null, tint = accent, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("YOUR $year IN REVIEW", color = accent, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                    }
                    Spacer(Modifier.height(14.dp))
                    Text(recap?.persona?.title ?: " ", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Black)
                    Spacer(Modifier.height(10.dp))
                    Text(recap?.persona?.line.orEmpty(), color = Color.White.copy(alpha = 0.58f), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.widthIn(max = 680.dp))
                    Spacer(Modifier.height(18.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(years, key = { it }) { y ->
                            FilterChip(
                                selected = y == year,
                                onClick = { year = y },
                                label = { Text(y.toString(), fontWeight = FontWeight.Bold) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = Color.White, selectedLabelColor = Color.Black,
                                    containerColor = CardBg, labelColor = Color.White.copy(alpha = 0.7f),
                                ),
                            )
                        }
                    }
                }
            }
        }

        val r = recap
        if (r == null) {
            item { LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp), color = accent) }
            return@LazyColumn
        }

        item {
            val time = YearReview.formatWatchTime(r.minutes)
            val chapters = r.mangaChapters + r.novelChapters
            Column(Modifier.padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RecapStat(Icons.Rounded.Schedule, time.first, time.second, "WATCHED", Modifier.weight(1f))
                    RecapStat(Icons.Rounded.Tv, "%,d".format(r.episodes), null, if (r.episodes == 1) "EPISODE" else "EPISODES", Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RecapStat(Icons.Rounded.AutoAwesome, r.shows.toString(), null, if (r.shows == 1) "SHOW" else "SHOWS", Modifier.weight(1f))
                    RecapStat(Icons.Rounded.MenuBook, "%,d".format(chapters), null, if (chapters == 1) "CHAPTER READ" else "CHAPTERS READ", Modifier.weight(1f))
                }
            }
        }

        if (!r.hasActivity) {
            item {
                Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("Nothing recorded for ${r.year}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "The recap is built from episodes played and chapters read in AniTrack on this device. Watch or read something and it starts filling in.",
                        color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center,
                    )
                }
            }
            return@LazyColumn
        }

        if (r.topShows.isNotEmpty()) item {
            Column(Modifier.padding(vertical = 12.dp)) {
                SectionLabel("YOUR TOP SHOWS", accent)
                LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    itemsIndexed(r.topShows, key = { _, s -> s.key }) { i, show ->
                        Column(Modifier.width(126.dp).clickable { openAnimeKey(show.key) }) {
                            Box {
                                AsyncImage(show.cover, show.title, Modifier.width(126.dp).height(180.dp).clip(aniShape(10.dp)).background(CardBg), contentScale = ContentScale.Crop)
                                Box(
                                    Modifier.padding(6.dp).size(26.dp).clip(aniShape(50)).background(Color.White),
                                    contentAlignment = Alignment.Center,
                                ) { Text("${i + 1}", color = Color.Black, fontWeight = FontWeight.Black, fontSize = 13.sp) }
                            }
                            Spacer(Modifier.height(6.dp))
                            Text(show.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                            Text("${show.count} ${if (show.count == 1) "episode" else "episodes"}", color = Muted, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }

        item {
            MonthBars("WATCHING BY MONTH", r.monthMinutes, accent) { v -> YearReview.formatWatchTime(v).let { "${it.first} ${it.second}" } }
        }
        if (r.mangaChapters + r.novelChapters > 0) item {
            MonthBars("READING BY MONTH", r.monthChapters, accent) { v -> "$v ${if (v == 1) "chapter" else "chapters"}" }
        }

        item {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                r.busiestMonth?.let { m ->
                    val t = YearReview.formatWatchTime(r.monthMinutes[m])
                    val read = r.monthChapters[m].takeIf { it > 0 }?.let { ", $it chapters read" }.orEmpty()
                    Highlight(Icons.Rounded.CalendarMonth, "BUSIEST MONTH", YearReview.MONTH_NAMES[m], "${t.first} ${t.second} watched$read", accent)
                }
                r.biggestDay?.let { d ->
                    Highlight(Icons.Rounded.LocalFireDepartment, "BIGGEST DAY", "${YearReview.MONTH_NAMES[d.month]} ${d.day}", "${d.count} ${if (d.count == 1) "episode" else "episodes"} in one day", accent)
                }
                Highlight(
                    Icons.Rounded.AutoAwesome, "LONGEST STREAK", "${r.longestStreak} ${if (r.longestStreak == 1) "day" else "days"}",
                    "${r.activeDays} active ${if (r.activeDays == 1) "day" else "days"} in all", accent,
                )
                r.timeOfDay?.let { t ->
                    Highlight(Icons.Rounded.NightsStay, "FAVOURITE TIME", t.label.replaceFirstChar { it.uppercase() }, "${r.timeOfDayShare}% of your sessions", accent)
                }
            }
        }

        item {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                r.firstShow?.let { s ->
                    TitleCardRow("YOUR ${r.year} BEGAN WITH", s, "${s.count} ${if (s.count == 1) "episode" else "episodes"} this year") { openAnimeKey(s.key) }
                }
                r.topManga?.let { m ->
                    TitleCardRow("MOST-READ MANGA", m, "${m.count} ${if (m.count == 1) "chapter" else "chapters"}") { m.key.toIntOrNull()?.let(onOpenManga) }
                }
                r.topNovel?.let { n ->
                    TitleCardRow("MOST-READ NOVEL", n, "${n.count} ${if (n.count == 1) "chapter" else "chapters"}") { openNovelKey(n.key) }
                }
            }
        }

        if (r.topGenres.isNotEmpty()) item {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 14.dp)) {
                Text("TOP GENRES", color = accent, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Spacer(Modifier.height(12.dp))
                val max = r.topGenres.first().count.coerceAtLeast(1)
                r.topGenres.forEach { g ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(g.label, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                        Text(g.count.toString(), color = Color.White.copy(alpha = 0.35f), style = MaterialTheme.typography.labelSmall)
                    }
                    Spacer(Modifier.height(5.dp))
                    LinearProgressIndicator(
                        progress = { g.count.toFloat() / max },
                        color = accent,
                        trackColor = Color.White.copy(alpha = 0.06f),
                        modifier = Modifier.fillMaxWidth().height(5.dp).clip(aniShape(50)),
                    )
                    Spacer(Modifier.height(13.dp))
                }
            }
        }

        item {
            Text(
                "Built from what you played and read in AniTrack on this device, including progress synced from your other devices. Episodes count once you've watched 85% of them; shows you removed from Continue Watching aren't included.",
                color = Color.White.copy(alpha = 0.3f), style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 40.dp),
            )
        }
    }
}

@Composable
private fun SectionLabel(text: String, color: Color) {
    Text(text, modifier = Modifier.padding(horizontal = 24.dp), color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
    Spacer(Modifier.height(12.dp))
}

@Composable
private fun RecapStat(icon: ImageVector, value: String, unit: String?, label: String, modifier: Modifier) {
    Column(modifier.clip(aniShape(12.dp)).background(CardBg).padding(14.dp)) {
        Icon(icon, null, tint = AniColors.Accent, modifier = Modifier.size(16.dp))
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
            if (unit != null) {
                Spacer(Modifier.width(5.dp))
                Text(unit, color = Muted, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 3.dp))
            }
        }
        Text(label, fontSize = 9.sp, letterSpacing = 0.8.sp, color = Color.White.copy(alpha = 0.4f), maxLines = 1)
    }
}

/** One series by month; tap a month for its exact value. */
@Composable
private fun MonthBars(title: String, values: List<Int>, color: Color, format: (Int) -> String) {
    val max = (values.maxOrNull() ?: 0).coerceAtLeast(1)
    var selected by remember(values) { mutableStateOf<Int?>(null) }
    Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp).clip(aniShape(12.dp)).background(CardBg).padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(title, color = Color.White.copy(alpha = 0.5f), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
            Text(selected?.let { "${YearReview.MONTH_NAMES[it]}: ${format(values[it])}" }.orEmpty(), color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.labelSmall)
        }
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth().height(120.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
            values.forEachIndexed { i, v ->
                Box(
                    Modifier.weight(1f).fillMaxHeight()
                        .clickable { selected = if (selected == i) null else i }
                        .semantics { contentDescription = "${YearReview.MONTH_NAMES[i]}: ${format(v)}" },
                    contentAlignment = Alignment.BottomCenter,
                ) {
                    if (v > 0) {
                        Box(
                            Modifier.fillMaxWidth()
                                .fillMaxHeight((v.toFloat() / max).coerceAtLeast(0.02f))
                                .clip(androidx.compose.foundation.shape.RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp))
                                .background(if (selected == null || selected == i) color else color.copy(alpha = 0.4f)),
                        )
                    }
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.1f)))
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            YearReview.MONTH_NAMES.forEach { m ->
                Text(m.take(1), modifier = Modifier.weight(1f), textAlign = TextAlign.Center, color = Color.White.copy(alpha = 0.35f), fontSize = 10.sp)
            }
        }
    }
}

@Composable
private fun Highlight(icon: ImageVector, label: String, value: String, detail: String, accent: Color) {
    Column(Modifier.fillMaxWidth().clip(aniShape(12.dp)).background(CardBg).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = accent, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(6.dp))
            Text(label, color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
        }
        Spacer(Modifier.height(8.dp))
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
        Text(detail, color = Muted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun TitleCardRow(label: String, item: RecapTitle, detail: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(aniShape(12.dp)).background(CardBg).clickable(onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(item.cover, item.title, Modifier.width(56.dp).height(80.dp).clip(aniShape(8.dp)).background(CardBg), contentScale = ContentScale.Crop)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(label, color = Muted, fontSize = 10.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.4.sp)
            Spacer(Modifier.height(3.dp))
            Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black)
            Text(detail, color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}
