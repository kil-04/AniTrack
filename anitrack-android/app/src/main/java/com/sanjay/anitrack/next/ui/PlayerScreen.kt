package com.sanjay.anitrack.next.ui

import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import com.sanjay.anitrack.next.data.Anikoto
import com.sanjay.anitrack.next.data.PlaySession

private val Accent = Color(0xFFE50914)
private const val UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    var index by remember { mutableStateOf(PlaySession.index) }
    var retry by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf("Resolving stream…") }
    var error by remember { mutableStateOf<String?>(null) }

    val player = remember {
        ExoPlayer.Builder(context).build().apply { playWhenReady = true }
    }

    // Auto-next when an episode finishes.
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && index + 1 < PlaySession.episodes.size) {
                    index += 1
                }
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }

    LaunchedEffect(index, retry) {
        val ep = PlaySession.episodes.getOrNull(index) ?: return@LaunchedEffect
        error = null
        status = "Resolving Episode ${ep.number.toInt()}…"
        player.stop()
        try {
            val stream = Anikoto.resolve(PlaySession.slug, ep)
            // Referer-checked CDN: build an HTTP factory that always sends the
            // player origin as Referer (this replaces the desktop app's
            // webRequest header injection).
            val httpFactory = DefaultHttpDataSource.Factory()
                .setUserAgent(UA)
                .setDefaultRequestProperties(mapOf("Referer" to stream.referer + "/"))
                .setAllowCrossProtocolRedirects(true)
            val mediaFactory = DefaultMediaSourceFactory(httpFactory)

            val subtitleConfigs = stream.subtitles.mapIndexed { i, s ->
                MediaItem.SubtitleConfiguration.Builder(Uri.parse(s.url))
                    .setMimeType(MimeTypes.TEXT_VTT)
                    .setLanguage("en")
                    .setLabel(s.label)
                    .setSelectionFlags(if (i == 0) C.SELECTION_FLAG_DEFAULT else 0)
                    .build()
            }
            val item = MediaItem.Builder()
                .setUri(stream.url)
                .setSubtitleConfigurations(subtitleConfigs)
                .build()

            player.setMediaSource(mediaFactory.createMediaSource(item))
            player.prepare()
            status = ""
        } catch (e: Exception) {
            error = e.message ?: "Failed to resolve stream"
        }
    }

    Column(Modifier.fillMaxSize().background(Color.Black)) {
        // Top bar: back, title, episode nav
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, "Back", tint = Color.White) }
            Column(Modifier.weight(1f)) {
                Text(PlaySession.animeTitle, style = MaterialTheme.typography.titleSmall, color = Color.White, maxLines = 1)
                val ep = PlaySession.episodes.getOrNull(index)
                if (ep != null) {
                    Text(
                        "Episode ${if (ep.number % 1f == 0f) ep.number.toInt() else ep.number}",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White.copy(alpha = 0.5f),
                    )
                }
            }
            IconButton(onClick = { if (index > 0) index -= 1 }, enabled = index > 0) {
                Icon(Icons.Filled.SkipPrevious, "Previous episode", tint = Color.White)
            }
            IconButton(
                onClick = { if (index + 1 < PlaySession.episodes.size) index += 1 },
                enabled = index + 1 < PlaySession.episodes.size,
            ) {
                Icon(Icons.Filled.SkipNext, "Next episode", tint = Color.White)
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        this.player = player
                        useController = true
                        keepScreenOn = true
                        setShowNextButton(false)
                        setShowPreviousButton(false)
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
            when {
                error != null -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error!!, color = Color(0xFFFF6B6B), style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = { retry += 1 },
                        colors = ButtonDefaults.buttonColors(containerColor = Accent),
                    ) { Text("Retry") }
                }
                status.isNotEmpty() -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Accent)
                    Spacer(Modifier.height(10.dp))
                    Text(status, color = Color.White.copy(alpha = 0.6f), style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}
