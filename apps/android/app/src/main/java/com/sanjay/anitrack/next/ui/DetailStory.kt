package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.StoryBridge
import com.sanjay.anitrack.next.data.manga.MangaChapters
import com.sanjay.anitrack.next.data.manga.MangaReading

// ── Continue the story: the anime's manga, and the manga's anime ───────────────

private val StoryGold = Color(0xFFFFD180)

private val printRelationLabels = mapOf(
    "SOURCE" to "Source", "ADAPTATION" to "Adaptation", "ALTERNATIVE" to "Retelling",
    "SPIN_OFF" to "Spin-off", "SIDE_STORY" to "Side story", "CHARACTER" to "Character",
    "SUMMARY" to "Summary", "PARENT" to "Parent", "PREQUEL" to "Prequel", "SEQUEL" to "Sequel",
    "OTHER" to "Other",
)

private fun sourceNoun(source: String?) = when (source) {
    "LIGHT_NOVEL" -> "light novel"
    "WEB_NOVEL" -> "web novel"
    else -> "novel"
}

private fun publishLabel(status: String?) = when (status) {
    "RELEASING" -> "Publishing"
    "FINISHED" -> "Complete"
    "HIATUS" -> "On hiatus"
    "NOT_YET_RELEASED" -> "Not yet published"
    "CANCELLED" -> "Cancelled"
    else -> null
}

/** The book this anime comes from (or its manga version), with where you are in it. */
@Composable
internal fun StorySection(anime: Anime, onOpenManga: (Int) -> Unit) {
    var source by remember(anime.id) { mutableStateOf<String?>(null) }
    var plan by remember(anime.id) { mutableStateOf<StoryBridge.Plan?>(null) }
    var next by remember(anime.id) { mutableStateOf<Float?>(null) }
    var finishedAnime by remember(anime.id) { mutableStateOf(false) }
    // Coming back from the reader refreshes the chapter to continue at.
    val reading by MangaReading.current
    LaunchedEffect(anime.id, reading) {
        val (type, links) = AniList.printRelations(anime.id)
        val found = StoryBridge.plan(type, links)
        next = found.readable?.let { StoryBridge.nextChapter(Db.readingFor(it.id)) }
        val total = anime.episodes
        val last = Db.lastWatchedEpisode(anime.id)
        finishedAnime = anime.status == "FINISHED" && total != null && last != null && last >= total
        source = type
        plan = found
    }
    val found = plan ?: return
    val book = found.primary ?: return
    val kind = found.kind ?: return
    val readable = found.readable
    val resume = next

    val eyebrow = when (kind) {
        StoryBridge.Kind.SourceManga -> if (finishedAnime) "You finished the anime" else "Continue the story"
        StoryBridge.Kind.SourceNovel -> "Based on the ${sourceNoun(source)}"
        StoryBridge.Kind.MangaVersion -> "Also a manga"
    }
    val message = when {
        resume != null && readable != null ->
            "You're on chapter ${MangaChapters.label(resume)} of ${readable.title}."
        kind == StoryBridge.Kind.SourceManga && finishedAnime ->
            "The story comes from this manga. Keep going in print."
        kind == StoryBridge.Kind.SourceManga ->
            if (book.status == "RELEASING") "The anime adapts this manga, which is still being published."
            else "The anime adapts this manga${book.chapters?.let { ", complete in $it chapters" } ?: ""}."
        kind == StoryBridge.Kind.SourceNovel && readable != null ->
            "Read it as a manga: ${readable.title}."
        kind == StoryBridge.Kind.SourceNovel ->
            "There's no manga version to read yet."
        else -> "The story retold as a manga${book.chapters?.let { " in $it chapters" } ?: ""}."
    }
    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820
    val shape = aniShape(18.dp)
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            .then(if (wide) Modifier.widthIn(max = 760.dp) else Modifier)
            .fillMaxWidth()
            .clip(shape)
            .background(Brush.horizontalGradient(listOf(StoryGold.copy(alpha = 0.10f), AniColors.Surface)))
            .border(1.dp, StoryGold.copy(alpha = 0.22f), shape)
            .clickable { onOpenManga((readable ?: book).id) }
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PosterImage(
            book.cover, book.title,
            Modifier.width(if (wide) 96.dp else 78.dp).aspectRatio(1f / POSTER_RATIO).clip(aniShape(10.dp)),
        )
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.AutoStories, null, tint = StoryGold, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    eyebrow.uppercase(),
                    color = StoryGold,
                    fontSize = 10.sp,
                    letterSpacing = 1.5.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                book.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                metaLine(
                    book.kind ?: formatLabel(book.format),
                    book.year?.toString(),
                    publishLabel(book.status),
                    book.chapters?.let { "$it ch" } ?: book.volumes?.let { "$it vol" },
                ),
                style = MaterialTheme.typography.labelMedium,
                color = AniColors.TextTertiary,
            )
            Spacer(Modifier.height(6.dp))
            Text(message, style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (readable != null) {
                    PillButton(
                        resume?.let { "Continue · Ch ${MangaChapters.label(it)}" } ?: "Read the manga",
                        { onOpenManga(readable.id) },
                        icon = Icons.Rounded.AutoStories,
                        style = PillStyle.Light,
                        compact = true,
                    )
                }
                if (readable?.id != book.id) {
                    PillButton(
                        "About the ${if (kind == StoryBridge.Kind.SourceNovel) sourceNoun(source) else "manga"}",
                        { onOpenManga(book.id) },
                        icon = Icons.Rounded.Info,
                        style = PillStyle.Tonal,
                        compact = true,
                    )
                }
            }
        }
    }
}

/** Other manga and novels from the franchise: spin-offs, side stories, retellings. */
@Composable
internal fun MoreInPrintSection(anime: Anime, onOpenManga: (Int) -> Unit) {
    var more by remember(anime.id) { mutableStateOf<List<StoryBridge.Link>>(emptyList()) }
    LaunchedEffect(anime.id) {
        val (type, links) = AniList.printRelations(anime.id)
        more = StoryBridge.plan(type, links).more
    }
    if (more.isEmpty()) return
    Column(Modifier.padding(bottom = 8.dp)) {
        SectionHeader("More in print")
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            items(more.size) { i ->
                val link = more[i]
                val book = link.manga
                Column(Modifier.width(118.dp).clip(aniShape(12.dp)).clickable { onOpenManga(book.id) }) {
                    Box {
                        PosterImage(
                            book.cover, book.title,
                            Modifier.fillMaxWidth().aspectRatio(1f / POSTER_RATIO).clip(aniShape(12.dp)),
                        )
                        Tag(
                            printRelationLabels[link.type] ?: link.type.lowercase().replaceFirstChar { it.uppercase() },
                            Modifier.align(Alignment.BottomStart).padding(8.dp),
                            tone = TagTone.Glass,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(book.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = AniColors.Text)
                    Text(metaLine(book.kind ?: formatLabel(book.format), book.year?.toString()), style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary)
                }
            }
        }
    }
}

/** Series first, then films and specials; music videos are left out. */
private fun formatRank(format: String?) = when (format) {
    "TV" -> 0
    "TV_SHORT" -> 1
    "ONA" -> 2
    "MOVIE" -> 3
    "OVA" -> 4
    "SPECIAL" -> 5
    else -> 6
}

/** The anime made from this manga, with how far you've watched each. */
@Composable
internal fun AdaptationsSection(manga: Manga, onOpenAnime: (Int) -> Unit) {
    var shows by remember(manga.id) { mutableStateOf<List<Anime>>(emptyList()) }
    var watched by remember(manga.id) { mutableStateOf<Map<Int, Float>>(emptyMap()) }
    LaunchedEffect(manga.id) {
        val found = AniList.animeAdaptations(manga.id)
            .map { it.anime }
            .filter { it.format != "MUSIC" }
            .distinctBy { it.id }
            .sortedWith(compareBy({ formatRank(it.format) }, { it.year ?: Int.MAX_VALUE }))
            .take(15)
        watched = found.mapNotNull { show -> Db.lastWatchedEpisode(show.id)?.let { show.id to it } }.toMap()
        shows = found
    }
    if (shows.isEmpty()) return
    Column(Modifier.padding(bottom = 8.dp)) {
        SectionHeader("Watch the anime")
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            items(shows.size) { i ->
                val show = shows[i]
                Column(Modifier.width(128.dp).clip(aniShape(12.dp)).clickable { onOpenAnime(show.id) }) {
                    Box {
                        PosterImage(
                            show.cover, show.title,
                            Modifier.fillMaxWidth().aspectRatio(1f / POSTER_RATIO).clip(aniShape(12.dp)),
                        )
                        formatLabel(show.format)?.let {
                            Tag(it, Modifier.align(Alignment.TopStart).padding(8.dp), tone = TagTone.Glass)
                        }
                        watched[show.id]?.let { episode ->
                            Tag(
                                "EP ${MangaChapters.label(episode)}",
                                Modifier.align(Alignment.BottomStart).padding(8.dp),
                                tone = TagTone.Accent,
                                icon = Icons.Rounded.PlayArrow,
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(show.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = AniColors.Text)
                    Text(
                        metaLine(show.year?.toString(), show.episodes?.let { "$it eps" }),
                        style = MaterialTheme.typography.labelSmall,
                        color = AniColors.TextTertiary,
                    )
                }
            }
        }
    }
}
