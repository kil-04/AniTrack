package com.sanjay.anitrack.next.ui

import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.PlayerHolder
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Floating mini player — the desktop app's bottom-right persistent player.
 * Shown by AppShell whenever PlayerHolder.miniActive and the full player
 * screen isn't open. Expand returns to the player; ✕ stops playback.
 */
@OptIn(UnstableApi::class)
@Composable
fun MiniPlayer(onExpand: () -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    val player = PlayerHolder.peek() ?: return
    val scope = rememberCoroutineScope()
    var playing by remember { mutableStateOf(player.isPlaying) }
    var controls by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        while (isActive) {
            playing = player.isPlaying
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

    Box(
        Modifier
            .width(300.dp)
            .aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(12.dp))
            .background(Color.Black)
            .clickable { controls = !controls },
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
        if (controls) {
            // Scrim + controls (desktop mini layout).
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.25f)))
            IconButton(onClick = onExpand, modifier = Modifier.align(Alignment.TopStart)) {
                Icon(Icons.Filled.OpenInFull, "Expand", tint = Color.White, modifier = Modifier.size(18.dp))
            }
            IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd)) {
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
                val n = PlaySession.episodeNumber(PlaySession.index)
                Text(
                    "Episode ${if (n % 1f == 0f) n.toInt() else n}",
                    style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f),
                )
            }
        }
    }
}
