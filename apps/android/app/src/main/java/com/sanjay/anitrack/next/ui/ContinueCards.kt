package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.PlayArrow
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
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.RemoteConfig
import com.sanjay.anitrack.next.data.providers.Providers

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

    // This function is entered by a Continue-Watching tap, never a background prefetch.
    val requested = row.providerId?.let { registry.enabled(it, runtime) }
        ?: key?.let { saved -> registry.enabled(runtime).firstOrNull { it.acceptsResumeKey(saved) } }
    requested?.access?.let { access ->
        if (!access.state.value.ready) {
            val connected = try { access.connect() }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { false }
            if (!connected) return false
        }
    }

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

/** Continue-Watching card: 16:9 art, episode badges, resume button and a progress bar. */
@Composable
internal fun ContinueCardWide(
    row: com.sanjay.anitrack.next.data.Db.CwRow,
    total: Int?,
    resuming: Boolean,
    onResume: () -> Unit,
    onDismiss: () -> Unit,
) {
    val ep = if (row.episode % 1f == 0f) "${row.episode.toInt()}" else "${row.episode}"
    Box(
        Modifier.width(300.dp).aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(14.dp))
            .background(AniColors.Surface)
            .clickable { onResume() },
    ) {
        PosterImage(row.cover, row.title, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(BottomScrim))
        Tag("EP $ep", Modifier.align(Alignment.TopStart).padding(10.dp), tone = TagTone.Accent)
        Row(
            Modifier.align(Alignment.TopEnd).padding(8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (total != null) {
                // Green when newer episodes are out than the one you're on.
                if (total > row.episode) Tag("EP $total", tone = TagTone.SuccessSolid, icon = Icons.Rounded.ArrowUpward)
                else Tag("EP $total", tone = TagTone.Glass, icon = Icons.Rounded.Check)
            }
            GlassIconButton(Icons.Rounded.Close, "Remove from Continue Watching", onDismiss)
        }
        if (resuming) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(34.dp))
            }
        }
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        row.title, color = Color.White, style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        "${fmtSecs(row.positionSec)} / ${fmtSecs(row.durationSec)}",
                        color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.labelSmall,
                    )
                }
                Spacer(Modifier.width(10.dp))
                Box(
                    Modifier.size(38.dp).clip(CircleShape).background(Color.White),
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Rounded.PlayArrow, "Resume", tint = Color(0xFF0A0A0B), modifier = Modifier.size(24.dp)) }
            }
            Spacer(Modifier.height(10.dp))
            ProgressStrip(row.percent / 100f, Modifier.fillMaxWidth())
        }
    }
}
