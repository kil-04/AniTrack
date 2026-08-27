package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime

// ── Shared card ───────────────────────────────────────────────────────────────

@Composable
fun AnimeCard(anime: Anime, onClick: (Anime) -> Unit, width: Int = 126) {
    Column(Modifier.width(width.dp).clickable { onClick(anime) }) {
        AsyncImage(
            model = anime.cover,
            contentDescription = anime.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .width(width.dp)
                .height((width * 1.42).dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Color.White.copy(alpha = 0.06f)),
        )
        Spacer(Modifier.height(6.dp))
        Text(
            anime.title,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            color = Color.White.copy(alpha = 0.85f),
        )
        val meta = listOfNotNull(anime.year?.toString(), anime.episodes?.let { "$it eps" }).joinToString(" · ")
        if (meta.isNotEmpty()) {
            Text(meta, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
        }
    }
}
