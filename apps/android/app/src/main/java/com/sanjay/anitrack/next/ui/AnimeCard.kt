package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Anime

/** Default poster width (dp) and height ratio for cover cards. */
internal const val POSTER_WIDTH = 132
internal const val POSTER_RATIO = 1.45f

// ── Shared card ───────────────────────────────────────────────────────────────

/** Cover card; a null [width] fills its grid cell. */
@Composable
fun AnimeCard(anime: Anime, onClick: (Anime) -> Unit, width: Int? = POSTER_WIDTH) {
    val outer = if (width != null) Modifier.width(width.dp) else Modifier.fillMaxWidth()
    Column(outer.clip(RoundedCornerShape(12.dp)).clickable { onClick(anime) }) {
        Box {
            PosterImage(
                anime.cover, anime.title,
                Modifier.fillMaxWidth().aspectRatio(1f / POSTER_RATIO).clip(RoundedCornerShape(12.dp)),
            )
            ScoreBadge(aniScore(anime.score), Modifier.align(Alignment.TopEnd).padding(6.dp), onImage = true)
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
        val meta = metaLine(anime.year?.toString(), formatLabel(anime.format), anime.episodes?.let { "$it eps" })
        if (meta.isNotEmpty()) {
            Spacer(Modifier.height(2.dp))
            Text(meta, style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary, maxLines = 1)
        }
    }
}

@Composable
fun RecommendationCard(recommendation: AniList.Recommendation, onClick: (Anime) -> Unit) {
    Column(Modifier.width(148.dp)) {
        AnimeCard(recommendation.anime, onClick, width = 148)
        Spacer(Modifier.height(4.dp))
        Text(
            recommendation.reason,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            color = AniColors.Info.copy(alpha = 0.85f),
        )
    }
}
