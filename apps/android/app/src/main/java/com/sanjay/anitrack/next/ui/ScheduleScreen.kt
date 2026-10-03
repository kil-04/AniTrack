package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bookmark
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.EventBusy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Db
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// ── Schedule (the next 7 days of airing, one day at a time) ───────────────────

@Composable
fun ScheduleScreen(onOpen: (Int) -> Unit) {
    val zone = remember { ZoneId.systemDefault() }
    val today = remember { LocalDate.now(zone) }
    val days = remember(today) { (0L..6L).map { today.plusDays(it) } }
    // Each day loads when first selected (AniList pages hold 50 episodes, under two days).
    val byDay = remember { mutableStateMapOf<LocalDate, List<AniList.Airing>>() }
    var day by remember { mutableStateOf(today) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    var onList by remember { mutableStateOf<Set<Int>>(emptySet()) }
    var onlyMine by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }

    LaunchedEffect(day, attempt) {
        if (day in byDay) { loading = false; return@LaunchedEffect }
        loading = true
        failed = false
        val from = day.atStartOfDay(zone).toEpochSecond()
        val to = day.plusDays(1).atStartOfDay(zone).toEpochSecond()
        runCatching { AniList.airingBetween(from, to) }
            .onSuccess { byDay[day] = it }
            .onFailure { failed = true }
        loading = false
    }
    LaunchedEffect(Unit) {
        onList = runCatching { Db.STATUSES.flatMap { Db.listByStatus(it) }.map { it.animeId }.toSet() }.getOrDefault(emptySet())
    }

    val timeFmt = remember { DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault()) }
    val dayFmt = remember { DateTimeFormatter.ofPattern("EEE d", Locale.getDefault()) }
    fun label(date: LocalDate) = when (date) {
        today -> "Today"
        today.plusDays(1) -> "Tomorrow"
        else -> date.format(dayFmt)
    }

    val shown = byDay[day].orEmpty().filter { !onlyMine || it.anime.id in onList }
    val now = System.currentTimeMillis() / 1000

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            ScreenHeader(
                "Schedule",
                subtitle = "Episodes airing over the next 7 days, in your time zone.",
                icon = Icons.Rounded.CalendarMonth,
            )
            Spacer(Modifier.height(16.dp))
            PillTabs(
                days.map { it.toString() to label(it) },
                selected = day.toString(),
                onSelect = { key -> days.firstOrNull { it.toString() == key }?.let { day = it } },
                counts = byDay.mapKeys { it.key.toString() }.mapValues { (_, list) -> list.size },
            )
            if (onList.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                FilterChip(
                    selected = onlyMine,
                    onClick = { onlyMine = !onlyMine },
                    label = { Text("Only my list") },
                    leadingIcon = { Icon(Icons.Rounded.Bookmark, null, modifier = Modifier.size(16.dp)) },
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = AniColors.AccentSoft,
                        selectedLabelColor = AniColors.Text,
                        selectedLeadingIconColor = AniColors.Accent,
                    ),
                )
            }
            Spacer(Modifier.height(6.dp))
        }
        if (loading) {
            items(6) { SkeletonBox(Modifier.fillMaxWidth().height(84.dp), corner = 14.dp) }
        } else if (shown.isEmpty()) {
            item {
                EmptyState(
                    Icons.Rounded.EventBusy,
                    if (failed) "Couldn't load the schedule" else "Nothing airing",
                    when {
                        failed -> "AniList didn't answer. Check your connection and try again."
                        onlyMine -> "None of the shows on your list air this day."
                        else -> "AniList has no episodes listed for this day yet."
                    },
                    actionLabel = if (failed) "Retry" else null,
                    onAction = { attempt++ },
                )
            }
        }
        items(shown.size) { i ->
            val a = shown[i]
            val mine = a.anime.id in onList
            val shape = RoundedCornerShape(14.dp)
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(shape)
                    .background(if (mine) AniColors.AccentSoft.copy(alpha = 0.12f) else AniColors.Surface)
                    .border(1.dp, if (mine) AniColors.Accent.copy(alpha = 0.35f) else AniColors.BorderSoft, shape)
                    .clickable { onOpen(a.anime.id) }
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Time block: the local airing time and how far away it is.
                Column(Modifier.width(76.dp)) {
                    Text(
                        Instant.ofEpochSecond(a.airingAt).atZone(zone).format(timeFmt),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        relativeAiring(a.airingAt, now),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (a.airingAt <= now) AniColors.Success else AniColors.TextTertiary,
                    )
                }
                PosterImage(a.anime.cover, a.anime.title, Modifier.width(44.dp).height(62.dp).clip(RoundedCornerShape(8.dp)))
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(a.anime.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(2.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            metaLine("Episode ${a.episode}", formatLabel(a.anime.format)),
                            style = MaterialTheme.typography.labelMedium,
                            color = AniColors.TextSecondary,
                        )
                        if (mine) Tag("ON MY LIST", tone = TagTone.Accent, icon = Icons.Rounded.Bookmark)
                    }
                }
                Icon(Icons.Rounded.ChevronRight, null, tint = AniColors.TextTertiary)
            }
        }
    }
}

/** "in 3h 20m", "in 12m" or "Aired". */
private fun relativeAiring(airingAt: Long, now: Long): String {
    val secs = airingAt - now
    if (secs <= 0) return "Aired"
    val minutes = secs / 60
    val hours = minutes / 60
    return when {
        hours >= 24 -> "in ${hours / 24}d ${hours % 24}h"
        hours > 0 -> "in ${hours}h ${minutes % 60}m"
        else -> "in ${minutes.coerceAtLeast(1)}m"
    }
}
