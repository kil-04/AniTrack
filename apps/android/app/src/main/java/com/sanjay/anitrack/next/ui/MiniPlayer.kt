package com.sanjay.anitrack.next.ui

import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.PlayerHolder
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Phones (under 600 dp wide) dock the mini player under the page, above the bottom tabs: the
 * floating 300 dp one covered the bottom of every page there. Wider screens float it.
 */
internal fun miniPlayerDocked(widthDp: Int): Boolean = widthDp < 600

/** How far into the episode [positionMs] is, from 0 to 1 (0 until the player knows the duration). */
internal fun miniPlayerProgress(positionMs: Long, durationMs: Long): Float =
    if (durationMs <= 0) 0f else (positionMs.toFloat() / durationMs).coerceIn(0f, 1f)

/**
 * Floating mini player — the desktop app's bottom-right persistent player.
 * Shown by AppShell whenever PlayerHolder.miniActive and the full player
 * screen isn't open. Expand returns to the player; ✕ stops playback.
 * [docked] is the phone's slim bar, which AppShell puts between the page
 * and the bottom tabs instead of over the page.
 */
@OptIn(UnstableApi::class)
@Composable
fun MiniPlayer(onExpand: () -> Unit, onClose: () -> Unit, docked: Boolean = false) {
    val context = LocalContext.current
    val player = PlayerHolder.peek() ?: return
    val scope = rememberCoroutineScope()
    var playing by remember { mutableStateOf(player.isPlaying) }
    var controls by remember { mutableStateOf(true) }
    // The stream failed after the full player was left (e.g. the server refused it).
    var failed by remember { mutableStateOf(player.playerError != null) }
    // The docked bar's progress line.
    var progress by remember { mutableFloatStateOf(miniPlayerProgress(player.currentPosition, player.duration)) }

    LaunchedEffect(Unit) {
        var ticks = 0
        while (isActive) {
            playing = player.isPlaying
            failed = player.playerError != null
            progress = miniPlayerProgress(player.currentPosition, player.duration)
            // Keep Continue Watching fresh while playing in the mini (every ~10s).
            if (playing && ++ticks % 25 == 0) {
                runCatching { saveProgress(player, PlaySession.index) }
            }
            delay(400)
        }
    }
    LaunchedEffect(controls, playing) {
        if (controls && playing) { delay(3000); controls = false }
    }

    fun jump(delta: Int) {
        val ni = PlaySession.index + delta
        if (ni < 0 || ni >= PlaySession.count) return
        scope.launch {
            runCatching {
                PlaySession.index = ni
                val s = PlaySession.resolve(ni)
                PlayerHolder.setMedia(context, s)
                PlayerHolder.loadedKey = PlayerHolder.keyFor(ni)
                PlayerHolder.lastResolved = s
            }
        }
    }

    // Persist the position before tearing the player down.
    val close: () -> Unit = {
        scope.launch {
            runCatching { saveProgress(player, PlaySession.index) }
            onClose()
        }
    }

    if (docked) {
        MiniPlayerBar(player, playing, failed, progress, onExpand, close)
        return
    }

    Box(
        Modifier
            .width(300.dp)
            .aspectRatio(16f / 9f)
            .clip(aniShape(12.dp))
            .background(Color.Black)
            // A failed stream opens the full player, which resolves it again.
            .clickable { if (failed) onExpand() else controls = !controls },
    ) {
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    useController = false
                    this.player = player
                }
            },
            update = { it.player = player },
            modifier = Modifier.fillMaxSize(),
        )
        if (failed) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.6f)))
            Column(
                Modifier.align(Alignment.Center).padding(horizontal = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Rounded.ErrorOutline, null, tint = Color(0xFFFF6B6B), modifier = Modifier.size(26.dp))
                Spacer(Modifier.height(6.dp))
                Text("Playback stopped · tap to open", style = MaterialTheme.typography.labelMedium, color = Color.White)
            }
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd)) {
                Icon(Icons.Filled.Close, "Close", tint = Color.White, modifier = Modifier.size(20.dp))
            }
        } else if (controls) {
            // Scrim + controls (desktop mini layout).
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.25f)))
            IconButton(onClick = onExpand, modifier = Modifier.align(Alignment.TopStart)) {
                Icon(Icons.Filled.OpenInFull, "Expand", tint = Color.White, modifier = Modifier.size(18.dp))
            }
            IconButton(onClick = close, modifier = Modifier.align(Alignment.TopEnd)) {
                Icon(Icons.Filled.Close, "Close", tint = Color.White, modifier = Modifier.size(20.dp))
            }
            Row(
                Modifier.align(Alignment.Center),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { jump(-1) }, enabled = PlaySession.index > 0) {
                    Icon(Icons.Filled.SkipPrevious, "Previous", tint = Color.White, modifier = Modifier.size(28.dp))
                }
                IconButton(onClick = { if (player.isPlaying) player.pause() else player.play() }) {
                    Icon(
                        if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        "Play/Pause", tint = Color.White, modifier = Modifier.size(38.dp),
                    )
                }
                IconButton(onClick = { jump(1) }, enabled = PlaySession.index + 1 < PlaySession.count) {
                    Icon(Icons.Filled.SkipNext, "Next", tint = Color.White, modifier = Modifier.size(28.dp))
                }
            }
            // Title strip
            Column(
                Modifier.align(Alignment.BottomStart).fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f))))
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(
                    PlaySession.animeTitle,
                    style = MaterialTheme.typography.labelLarge, color = Color.White,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    episodeLabel(),
                    style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f),
                )
            }
        }
    }
}

/**
 * The phone's mini player: one slim row (video, title, Expand, Play/Pause, Close) with the
 * episode's progress along its foot. A tap anywhere else on it opens the full player too.
 */
@OptIn(UnstableApi::class)
@Composable
private fun MiniPlayerBar(
    player: ExoPlayer,
    playing: Boolean,
    failed: Boolean,
    progress: Float,
    onExpand: () -> Unit,
    onClose: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().background(AniColors.SurfaceHigh)) {
        HorizontalDivider(color = AniColors.BorderSoft)
        Row(
            // A failed stream opens the full player as well, which resolves it again.
            Modifier.fillMaxWidth().clickable(onClickLabel = "Open player", onClick = onExpand)
                .padding(start = 10.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.height(48.dp).aspectRatio(16f / 9f, matchHeightConstraintsFirst = true)
                    .clip(aniShape(8.dp)).background(Color.Black),
            ) {
                AndroidView(
                    factory = { ctx ->
                        PlayerView(ctx).apply {
                            useController = false
                            this.player = player
                        }
                    },
                    update = { it.player = player },
                    modifier = Modifier.fillMaxSize(),
                )
                if (failed) {
                    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.ErrorOutline, null, tint = AniColors.Danger, modifier = Modifier.size(20.dp))
                    }
                }
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    PlaySession.animeTitle,
                    style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold, color = AniColors.Text,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (failed) "Playback stopped · tap to open" else episodeLabel(),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (failed) AniColors.Danger else AniColors.TextSecondary,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(onClick = onExpand, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Filled.OpenInFull, "Expand", tint = AniColors.TextSecondary, modifier = Modifier.size(18.dp))
            }
            // A failed stream can't resume here: Expand (or a tap) retries it in the full player.
            if (!failed) {
                IconButton(onClick = { if (player.isPlaying) player.pause() else player.play() }, modifier = Modifier.size(40.dp)) {
                    Icon(if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (playing) "Pause" else "Play", tint = Color.White)
                }
            }
            IconButton(onClick = onClose, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Filled.Close, "Close", tint = AniColors.TextTertiary, modifier = Modifier.size(20.dp))
            }
        }
        ProgressStrip(progress, Modifier.fillMaxWidth(), height = 2.dp, track = Color.Transparent)
    }
}

/** "Episode 5", or "Episode 5.5", for the episode the player holds. */
private fun episodeLabel(): String {
    val n = PlaySession.episodeNumber(PlaySession.index)
    return "Episode ${if (n % 1f == 0f) n.toInt() else n}"
}
