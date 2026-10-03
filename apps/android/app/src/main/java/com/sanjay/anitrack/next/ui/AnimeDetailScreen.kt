package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.AniList

// ── Detail ────────────────────────────────────────────────────────────────────

@Composable
fun DetailScreen(animeId: Int, onPlay: () -> Unit, onOpenAnime: (Int) -> Unit = {}) {
    var anime by remember(animeId) { mutableStateOf(AniList.cachedAnime(animeId)) }
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
        ) {
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
        WatchOrderSection(a, onOpenAnime)
        RelatedSection(a, onOpenAnime)
        EpisodesSection(a, onPlay)
        Spacer(Modifier.height(40.dp))
    }
}
