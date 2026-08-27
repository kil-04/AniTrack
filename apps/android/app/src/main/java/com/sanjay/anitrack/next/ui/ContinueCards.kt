package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.RemoteConfig
import com.sanjay.anitrack.next.data.providers.Providers

private val HomeAccent = Color(0xFFE50914)

internal fun fmtSecs(sec: Double): String {
    val t = sec.toLong()
    val h = t / 3600; val m = (t % 3600) / 60; val s = t % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

// Landscape Continue-Watching card (the desktop app's wide format).
/**
 * Prepare PlaySession to resume a Continue-Watching row. Uses the stored slug
 * when present; otherwise (row synced from desktop with a pahe UUID, or no
 * slug) re-matches the show against a provider via its AniList id. Returns
 * false only if no source could be found at all.
 */
internal suspend fun prepareResume(row: com.sanjay.anitrack.next.data.Db.CwRow): Boolean {
    PlaySession.localFile = null // Online resume, never a downloaded file.
    val runtime = RemoteConfig.current()
    val registry = Providers.registry
    // Keep the database/gist format unchanged. Only old Android builds wrote
    // the temporary "pahe:" prefix, so remove it at this compatibility edge.
    val key = row.slug?.removePrefix("pahe:")?.takeIf(String::isNotBlank)

    // Let each enabled connector recognize and restore its own persisted key.
    // This keeps resume working when more provider key formats are introduced.
    val resumed = key?.let {
        row.providerId?.let { providerId -> registry.resume(providerId, it, runtime) }
            ?: registry.resumeFirst(it, runtime)
    }

    // Metadata is still loaded for player server switching and is the fallback
    // when a stored source disappeared or the row came from an older client.
    val meta = runCatching { AniList.byId(row.animeId) }.getOrNull()
    val series = resumed ?: meta?.let { registry.matchFirst(it, runtime) } ?: return false
    PlaySession.startSeries(
        series = series,
        selectedIndex = series.episodeIndex(row.episode),
        animeId = row.animeId,
        animeTitle = row.title,
        animeCover = row.cover,
        anime = meta,
    )
    return true
}

@Composable
internal fun ContinueCardWide(
    row: com.sanjay.anitrack.next.data.Db.CwRow,
    total: Int?,
    resuming: Boolean,
    onResume: () -> Unit,
    onDismiss: () -> Unit,
) {
    val ep = if (row.episode % 1f == 0f) "${row.episode.toInt()}" else "${row.episode}"
    // Desktop card: 16:9 cover, gradient, EP badge, EP-total badge, title +
    // timestamp inside the card, red progress strip at the bottom.
    Box(
        Modifier.width(280.dp).height(158.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFF1B1B1B))
            .clickable { onResume() },
    ) {
        AsyncImage(
            model = row.cover, contentDescription = row.title, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            Modifier.fillMaxSize().background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    0f to Color.Transparent, 0.5f to Color.Black.copy(alpha = 0.2f), 1f to Color.Black.copy(alpha = 0.9f),
                ),
            ),
        )
        // EP badge (top-left, red)
        Box(
            Modifier.align(Alignment.TopStart).padding(8.dp)
                .clip(RoundedCornerShape(4.dp)).background(HomeAccent)
                .padding(horizontal = 8.dp, vertical = 4.dp),
        ) { Text("EP $ep", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = androidx.compose.ui.unit.TextUnit(1.5f, androidx.compose.ui.unit.TextUnitType.Sp)) }
        // ✕ + EP-total badge (top-right): green "▲" when new episodes exist.
        Row(Modifier.align(Alignment.TopEnd).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(24.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.7f))
                    .clickable { onDismiss() },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Close, "Dismiss", tint = Color.White, modifier = Modifier.size(13.dp)) }
            if (total != null) {
                val hasNew = total > row.episode
                Box(
                    Modifier.clip(RoundedCornerShape(4.dp))
                        .background(if (hasNew) Color(0xFF22C55E) else Color.Black.copy(alpha = 0.6f))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                ) {
                    Text(
                        if (hasNew) "EP $total ▲" else "EP $total ✓",
                        color = if (hasNew) Color.White else Color.White.copy(alpha = 0.5f),
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
        // Resolving spinner
        if (resuming) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = HomeAccent, modifier = Modifier.size(34.dp))
            }
        }
        // Title + timestamp (inside the card, desktop style)
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
            Text(
                row.title, color = Color.White, style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                "${fmtSecs(row.positionSec)} / ${fmtSecs(row.durationSec)}",
                color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelSmall,
            )
        }
        // Progress strip
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(5.dp).background(Color.White.copy(alpha = 0.2f))) {
            Box(Modifier.fillMaxWidth(fraction = (row.percent / 100f).coerceIn(0f, 1f)).fillMaxHeight().background(HomeAccent))
        }
    }
}

@Composable
internal fun ContinueCard(
    row: com.sanjay.anitrack.next.data.Db.CwRow,
    onResume: () -> Unit,
    onDismiss: () -> Unit,
) {
    Column(Modifier.width(126.dp)) {
        Box {
            AsyncImage(
                model = row.cover,
                contentDescription = row.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .width(126.dp).height(179.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color.White.copy(alpha = 0.06f))
                    .clickable { onResume() },
            )
            // Dismiss ✕
            Box(
                Modifier.align(Alignment.TopEnd).padding(6.dp)
                    .clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.6f))
                    .clickable { onDismiss() }.padding(horizontal = 7.dp, vertical = 2.dp),
            ) { Text("✕", color = Color.White, style = MaterialTheme.typography.labelSmall) }
            // Progress bar
            LinearProgressIndicator(
                progress = { (row.percent / 100f).coerceIn(0f, 1f) },
                color = HomeAccent,
                trackColor = Color.White.copy(alpha = 0.25f),
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(row.title, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
        Text(
            "Ep ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode} · ${row.percent}%",
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.4f),
        )
    }
}
