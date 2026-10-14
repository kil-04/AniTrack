package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.AniList

// ── Detail ────────────────────────────────────────────────────────────────────

@Composable
fun DetailScreen(animeId: Int, onPlay: () -> Unit, onOpenAnime: (Int) -> Unit = {}, onOpenManga: (Int) -> Unit = {}) {
    var anime by remember(animeId) { mutableStateOf(AniList.cachedAnime(animeId)) }
    var nextUp by remember(animeId) { mutableStateOf<Pair<String, () -> Unit>?>(null) }
    LaunchedEffect(animeId) { anime = AniList.byId(animeId) }

    val a = anime ?: run {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = AniColors.Accent)
        }
        return
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        DetailHero(
            banner = a.banner,
            cover = a.cover,
            title = a.title,
            subtitle = a.titleRomaji?.takeIf { it != a.title },
            score = aniScore(a.score),
            meta = metaLine(
                a.year?.toString(),
                formatLabel(a.format),
                a.episodes?.let { "$it eps" },
                a.duration?.let { "$it min" },
                airingLabel(a.status),
            ),
            genres = a.genres,
            note = run {
                val now = System.currentTimeMillis() / 1000
                val episode = a.nextEpisode
                val at = a.nextAiringAt?.takeIf { it > now }
                if (episode != null && at != null) "Episode $episode airs ${relativeAiring(at, now)}" else null
            },
        ) {
            nextUp?.let { (label, play) ->
                PillButton(label, play, icon = Icons.Rounded.PlayArrow, style = PillStyle.Light)
            }
            ListStatusButton(a)
        }
        if (a.studios.isNotEmpty()) {
            Text(
                "Studio: " + a.studios.take(2).joinToString(", "),
                style = MaterialTheme.typography.labelMedium,
                color = AniColors.TextTertiary,
                modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 18.dp),
            )
        }
        Spacer(Modifier.height(14.dp))
        ExpandableSynopsis(a.synopsis)
        Spacer(Modifier.height(12.dp))
        StorySection(a, onOpenManga)
        WatchOrderSection(a, onOpenAnime)
        RelatedSection(a, onOpenAnime)
        MoreInPrintSection(a, onOpenManga)
        EpisodesSection(a, onPlay, onNextUp = { nextUp = it })
        ThemesSection(a)
        Spacer(Modifier.height(40.dp))
    }
}
