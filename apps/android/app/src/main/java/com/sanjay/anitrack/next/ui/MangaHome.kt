package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.border
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.LiveTv
import androidx.compose.material.icons.rounded.LocalFireDepartment
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Manga
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

enum class HomeMode { Anime, Manga }

/** Anime | Manga segmented switch shown over the top of Home. */
@Composable
internal fun HomeModeToggle(mode: HomeMode, onChange: (HomeMode) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .clip(RoundedCornerShape(50))
            .background(Color.Black.copy(alpha = 0.62f))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(50))
            .padding(4.dp),
    ) {
        HomeMode.entries.forEach { option ->
            val selected = option == mode
            Row(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(if (selected) Color.White else Color.Transparent)
                    .clickable(enabled = !selected) { onChange(option) }
                    .padding(horizontal = 14.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    if (option == HomeMode.Anime) Icons.Rounded.LiveTv else Icons.Rounded.AutoStories,
                    null,
                    tint = if (selected) Color(0xFF0A0A0B) else Color.White.copy(alpha = 0.75f),
                    modifier = Modifier.size(17.dp),
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    option.name,
                    color = if (selected) Color(0xFF0A0A0B) else Color.White.copy(alpha = 0.75f),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MangaHomeScreen(onOpen: (Manga) -> Unit, onOpenId: (Int) -> Unit, toggle: @Composable (Modifier) -> Unit) {
    var feed by remember { mutableStateOf<AniList.MangaFeed?>(null) }
    var reading by remember { mutableStateOf<List<com.sanjay.anitrack.next.data.Db.ReadRow>>(emptyList()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { reading = runCatching { com.sanjay.anitrack.next.data.Db.continueReading() }.getOrDefault(emptyList()) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        // Paint the last saved feed at once; AniList can take many seconds to answer.
        AniList.cachedMangaFeed()?.let { feed = it }
        runCatching { AniList.mangaFeed() }
            .onSuccess { feed = it }
            .onFailure { if (feed == null) failed = true }
    }
    val listState = rememberLazyListState()

    LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(bottom = 28.dp)) {
        item(key = "hero") {
            Box(Modifier.fillMaxWidth()) {
                // If AniList drops the trending row, feature another one rather than an empty hero.
                val trending = feed?.let { f -> f.trending.ifEmpty { f.publishing.ifEmpty { f.popular } } }.orEmpty()
                if (trending.isNotEmpty()) MangaHeroCarousel(trending.take(10), onOpen)
                else if (!failed) SkeletonBox(Modifier.fillMaxWidth().height(380.dp), corner = 0.dp)
                else Spacer(Modifier.height(72.dp))
                toggle(Modifier.align(Alignment.TopStart).padding(16.dp))
            }
        }
        if (reading.isNotEmpty()) {
            item(key = "continue-header") { SectionHeader("Continue Reading") }
            item(key = "continue-row") {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(count = reading.size, key = { reading[it].mangaId }) { i ->
                        val row = reading[i]
                        ContinueReadingCard(
                            row,
                            onOpen = { onOpenId(row.mangaId) },
                            onDismiss = {
                                scope.launch {
                                    com.sanjay.anitrack.next.data.Db.dismissReading(row.mangaId)
                                    reading = com.sanjay.anitrack.next.data.Db.continueReading()
                                }
                            },
                        )
                    }
                }
            }
        }
        val f = feed
        if (f == null) {
            item(key = "loading") {
                if (failed) {
                    EmptyState(
                        Icons.Rounded.CloudOff,
                        "Couldn't load manga",
                        "AniList didn't answer. Check your connection and reopen Home.",
                    )
                } else {
                    Column {
                        SectionHeader("Trending Manga")
                        RowPlaceholder()
                    }
                }
            }
        } else {
            mangaSection("Trending Manga", f.trending, onOpen)
            mangaSection("Publishing Now", f.publishing, onOpen)
            mangaSection("Popular Manhwa", f.manhwa, onOpen)
            mangaSection("Top Rated", f.topRated, onOpen)
            mangaSection("All-Time Popular", f.popular, onOpen)
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.mangaSection(
    title: String,
    list: List<Manga>,
    onOpen: (Manga) -> Unit,
) {
    if (list.isEmpty()) return
    item(key = "$title-header") { SectionHeader(title) }
    item(key = "$title-row") {
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            items(count = list.size) { i -> MangaCard(list[i], onOpen) }
        }
    }
}

@Composable
private fun ContinueReadingCard(
    row: com.sanjay.anitrack.next.data.Db.ReadRow,
    onOpen: () -> Unit,
    onDismiss: () -> Unit,
) {
    Column(Modifier.width(POSTER_WIDTH.dp).clip(RoundedCornerShape(12.dp)).clickable(onClick = onOpen)) {
        Box {
            PosterImage(
                row.cover, row.title,
                Modifier.fillMaxWidth().aspectRatio(1f / POSTER_RATIO).clip(RoundedCornerShape(12.dp)),
            )
            Box(Modifier.matchParentSize().clip(RoundedCornerShape(12.dp)).background(BottomScrim))
            Tag(
                "CH ${com.sanjay.anitrack.next.data.manga.MangaChapters.label(row.chapter)}",
                Modifier.align(Alignment.TopStart).padding(8.dp),
                tone = TagTone.Accent,
            )
            GlassIconButton(
                Icons.Rounded.Close, "Remove from Continue Reading", onDismiss,
                Modifier.align(Alignment.TopEnd).padding(6.dp), size = 26.dp,
            )
            if (row.pageCount > 0) {
                ProgressStrip(
                    (row.page + 1).toFloat() / row.pageCount,
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp),
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(row.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = AniColors.Text)
        Text("Page ${row.page + 1} of ${row.pageCount}", style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary)
    }
}

@Composable
fun MangaCard(manga: Manga, onClick: (Manga) -> Unit, width: Int? = POSTER_WIDTH) {
    val outer = if (width != null) Modifier.width(width.dp) else Modifier.fillMaxWidth()
    Column(outer.clip(RoundedCornerShape(12.dp)).clickable { onClick(manga) }) {
        Box {
            PosterImage(
                manga.cover, manga.title,
                Modifier.fillMaxWidth().aspectRatio(1f / POSTER_RATIO).clip(RoundedCornerShape(12.dp)),
            )
            manga.kind?.takeIf { it != "Manga" }?.let { kind ->
                Tag(kind, Modifier.align(Alignment.TopStart).padding(6.dp), tone = TagTone.Glass)
            }
            ScoreBadge(aniScore(manga.score), Modifier.align(Alignment.TopEnd).padding(6.dp), onImage = true)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            manga.title,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            color = AniColors.Text,
        )
        val meta = metaLine(manga.year?.toString(), manga.chapters?.let { "$it ch" })
        if (meta.isNotEmpty()) {
            Spacer(Modifier.height(2.dp))
            Text(meta, style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary)
        }
    }
}

@Composable
private fun MangaHeroCarousel(list: List<Manga>, onOpen: (Manga) -> Unit) {
    val pager = androidx.compose.foundation.pager.rememberPagerState(pageCount = { list.size })
    LaunchedEffect(pager) {
        while (true) {
            kotlinx.coroutines.delay(7000)
            runCatching { pager.animateScrollToPage((pager.currentPage + 1) % list.size) }
        }
    }
    Box {
        androidx.compose.foundation.pager.HorizontalPager(state = pager) { page ->
            MangaHeroBanner(list[page], page + 1, onOpen)
        }
        HeroDots(list.size, pager.currentPage, Modifier.align(Alignment.BottomEnd).padding(end = 24.dp, bottom = 30.dp))
    }
}

@Composable
private fun MangaHeroBanner(manga: Manga, rank: Int, onOpen: (Manga) -> Unit) {
    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820
    Box(Modifier.fillMaxWidth().height(if (wide) 440.dp else 380.dp).clickable { onOpen(manga) }) {
        PosterImage(manga.banner ?: manga.cover, manga.title, Modifier.fillMaxSize(), alignment = Alignment.TopCenter)
        HeroScrims()
        Column(
            Modifier.align(Alignment.BottomStart).padding(start = 24.dp, end = 24.dp, bottom = 34.dp)
                .widthIn(max = 640.dp),
        ) {
            Tag("#$rank TRENDING MANGA", tone = TagTone.Accent, icon = Icons.Rounded.LocalFireDepartment)
            Spacer(Modifier.height(10.dp))
            Text(
                manga.title,
                style = if (wide) MaterialTheme.typography.headlineLarge else MaterialTheme.typography.headlineMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = Color.White,
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ScoreBadge(aniScore(manga.score))
                Text(
                    metaLine(manga.kind, manga.year?.toString(), manga.chapters?.let { "$it chapters" }),
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.White.copy(alpha = 0.72f),
                )
            }
            if (wide && !manga.synopsis.isNullOrBlank()) {
                Spacer(Modifier.height(10.dp))
                Text(
                    manga.synopsis,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.White.copy(alpha = 0.75f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                PillButton("Read now", { onOpen(manga) }, icon = Icons.Rounded.AutoStories, style = PillStyle.Light)
                MangaListStatusButton(manga)
            }
        }
    }
}
