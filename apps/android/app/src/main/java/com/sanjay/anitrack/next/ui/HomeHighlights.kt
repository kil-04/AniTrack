package com.sanjay.anitrack.next.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Anime

/** Landscape "Latest Episodes" card with an EP badge. */
@Composable
internal fun LatestCard(anime: Anime, episode: Int, onOpen: (Anime) -> Unit, modifier: Modifier = Modifier.width(232.dp)) {
    Column(modifier.clip(RoundedCornerShape(12.dp)).clickable { onOpen(anime) }) {
        Box {
            PosterImage(
                anime.banner ?: anime.cover, anime.title,
                Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)),
            )
            Tag("EP $episode", Modifier.align(Alignment.TopStart).padding(8.dp), tone = TagTone.Accent)
            ScoreBadge(aniScore(anime.score), Modifier.align(Alignment.TopEnd).padding(8.dp), onImage = true)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            anime.title,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            color = AniColors.Text,
        )
        Text(
            metaLine(formatLabel(anime.format), "Episode $episode"),
            style = MaterialTheme.typography.labelSmall,
            color = AniColors.TextTertiary,
        )
    }
}

/** Ranked list row (Top 10, Top rated): rank, cover, title, score and a detail line. */
@Composable
internal fun RankRow(
    rank: Int,
    cover: String?,
    title: String,
    onClick: () -> Unit,
    score: String? = null,
    detail: String? = null,
) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(onClick = onClick)
            .padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            rank.toString().padStart(2, '0'),
            Modifier.width(42.dp),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.ExtraBold,
            color = if (rank <= 3) AniColors.Accent else AniColors.TextTertiary,
        )
        PosterImage(cover, title, Modifier.width(46.dp).height(64.dp).clip(RoundedCornerShape(8.dp)))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (score != null || !detail.isNullOrBlank()) {
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ScoreBadge(score)
                    if (!detail.isNullOrBlank()) {
                        Text(detail, style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary, maxLines = 1)
                    }
                }
            }
        }
    }
}

@Composable
internal fun Top10Row(rank: Int, anime: Anime, onOpen: (Anime) -> Unit) {
    RankRow(
        rank, anime.cover, anime.title,
        onClick = { onOpen(anime) },
        score = aniScore(anime.score),
        detail = metaLine(formatLabel(anime.format), anime.year?.toString()),
    )
}

// Swipeable hero carousel (the desktop app's trending spotlight, multiple).
@Composable
internal fun HeroCarousel(list: List<Anime>, onOpen: (Anime) -> Unit) {
    if (list.isEmpty()) return
    val pager = androidx.compose.foundation.pager.rememberPagerState(pageCount = { list.size })
    // Auto-advance every 7s.
    LaunchedEffect(pager) {
        while (true) {
            kotlinx.coroutines.delay(7000)
            val next = (pager.currentPage + 1) % list.size
            runCatching { pager.animateScrollToPage(next) }
        }
    }
    Box {
        androidx.compose.foundation.pager.HorizontalPager(state = pager) { page ->
            HeroBanner(list[page], page + 1, onOpen)
        }
        HeroDots(list.size, pager.currentPage, Modifier.align(Alignment.BottomEnd).padding(end = 24.dp, bottom = 30.dp))
    }
}

/** Page dots for hero carousels: the current page stretches into a red pill. */
@Composable
internal fun HeroDots(count: Int, current: Int, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        for (i in 0 until count) {
            Box(
                Modifier.animateContentSize().height(6.dp).width(if (i == current) 22.dp else 6.dp)
                    .clip(RoundedCornerShape(50))
                    .background(if (i == current) AniColors.Accent else Color.White.copy(alpha = 0.35f)),
            )
        }
    }
}

/** Scrims shared by the anime and manga heroes: a left fade behind the text and a fade into the page. */
@Composable
internal fun HeroScrims() {
    Box(
        Modifier.fillMaxSize().background(
            Brush.horizontalGradient(
                0f to AniColors.Bg.copy(alpha = 0.88f),
                0.42f to AniColors.Bg.copy(alpha = 0.45f),
                0.75f to Color.Transparent,
            ),
        ),
    )
    Box(
        Modifier.fillMaxSize().background(
            Brush.verticalGradient(
                0f to AniColors.Bg.copy(alpha = 0.55f),
                0.22f to Color.Transparent,
                0.62f to Color.Transparent,
                1f to AniColors.Bg,
            ),
        ),
    )
}

// Full-bleed hero banner (the desktop app's trending spotlight).
@Composable
internal fun HeroBanner(anime: Anime, rank: Int, onOpen: (Anime) -> Unit) {
    val wide = LocalConfiguration.current.screenWidthDp >= 820
    Box(Modifier.fillMaxWidth().height(if (wide) 440.dp else 380.dp).clickable { onOpen(anime) }) {
        PosterImage(
            anime.banner ?: anime.cover, anime.title,
            Modifier.fillMaxSize(),
            alignment = Alignment.TopCenter,   // favour the top of the art, not the middle
        )
        HeroScrims()
        Column(
            Modifier.align(Alignment.BottomStart).padding(start = 24.dp, end = 24.dp, bottom = 34.dp)
                .widthIn(max = 640.dp),
        ) {
            Tag("#$rank TRENDING", tone = TagTone.Accent, icon = Icons.Rounded.LocalFireDepartment)
            Spacer(Modifier.height(10.dp))
            Text(
                anime.title,
                style = if (wide) MaterialTheme.typography.headlineLarge else MaterialTheme.typography.headlineMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = Color.White,
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ScoreBadge(aniScore(anime.score))
                Text(
                    metaLine(anime.year?.toString(), formatLabel(anime.format), anime.episodes?.let { "$it eps" }, airingLabel(anime.status)),
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.White.copy(alpha = 0.72f),
                )
            }
            if (wide && !anime.synopsis.isNullOrBlank()) {
                Spacer(Modifier.height(10.dp))
                Text(
                    anime.synopsis,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.75f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                PillButton("Watch now", { onOpen(anime) }, icon = Icons.Rounded.PlayArrow, style = PillStyle.Light)
                ListStatusButton(anime)
            }
        }
    }
}

// Anikoto Top 10 with Day / Week / Month tabs (matches the desktop rail).
@Composable
internal fun AnikotoTop10(
    tabs: Map<String, List<com.sanjay.anitrack.next.data.Anikoto.TopItem>>,
    onOpenTitle: (String) -> Unit,
) {
    var tab by remember { mutableStateOf("day") }
    val wide = LocalConfiguration.current.screenWidthDp >= 820
    Column {
        SectionHeader("Top 10", trailing = {
            PillTabs(
                listOf("day" to "Today", "week" to "Week", "month" to "Month"),
                selected = tab,
                onSelect = { tab = it },
                compact = true,
            )
        })
        val items = tabs[tab].orEmpty().take(10)
        // Two columns on wide screens so the list doesn't run a full page tall.
        val columns = if (wide) items.chunked(((items.size + 1) / 2).coerceAtLeast(1)) else listOf(items)
        Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            var offset = 0
            columns.forEach { column ->
                val start = offset
                Column(Modifier.weight(1f)) {
                    column.forEachIndexed { i, item ->
                        RankRow(start + i + 1, item.poster, item.title, onClick = { onOpenTitle(item.title) })
                    }
                }
                offset += column.size
            }
        }
    }
}
