package com.sanjay.anitrack.next.ui

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.ActivityInfo
import android.net.Uri
import android.util.Rational
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
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
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import com.sanjay.anitrack.next.data.Anikoto
import com.sanjay.anitrack.next.data.PlaySession
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

private val Accent = Color(0xFFE50914)
private const val UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val activity = context as? Activity
    var index by remember { mutableStateOf(PlaySession.index) }
    var retry by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf("Resolving stream…") }
    var error by remember { mutableStateOf<String?>(null) }
    var stream by remember { mutableStateOf<Anikoto.Stream?>(null) }
    var controllerVisible by remember { mutableStateOf(true) }
    var playerViewRef by remember { mutableStateOf<PlayerView?>(null) }
    var landscapeLocked by remember { mutableStateOf(false) }

    // Gesture feedback overlays
    var seekFeedback by remember { mutableStateOf<Pair<Boolean, Int>?>(null) } // (isForward, totalSecs)
    var speedActive by remember { mutableStateOf(false) }
    var volumeFeedback by remember { mutableStateOf<Float?>(null) }

    // Skip intro/outro
    var showSkipIntro by remember { mutableStateOf(false) }
    var showSkipOutro by remember { mutableStateOf(false) }

    // PiP heuristic: the PiP window is tiny — hide all chrome in it.
    val inPipLikely = LocalConfiguration.current.screenWidthDp < 400

    val player = remember { ExoPlayer.Builder(context).build().apply { playWhenReady = true } }

    DisposableEffect(Unit) {
        PlaySession.playerActive = true
        onDispose {
            PlaySession.playerActive = false
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && index + 1 < PlaySession.episodes.size) index += 1
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener); player.release() }
    }

    LaunchedEffect(index, retry) {
        val ep = PlaySession.episodes.getOrNull(index) ?: return@LaunchedEffect
        error = null
        status = "Resolving Episode ${ep.number.toInt()}…"
        player.stop()
        try {
            val s = Anikoto.resolve(PlaySession.slug, ep)
            stream = s
            val httpFactory = DefaultHttpDataSource.Factory()
                .setUserAgent(UA)
                .setDefaultRequestProperties(mapOf("Referer" to s.referer + "/"))
                .setAllowCrossProtocolRedirects(true)
            val subtitleConfigs = s.subtitles.mapIndexed { i, sub ->
                MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub.url))
                    .setMimeType(MimeTypes.TEXT_VTT)
                    .setLanguage("en")
                    .setLabel(sub.label)
                    .setSelectionFlags(if (i == 0) C.SELECTION_FLAG_DEFAULT else 0)
                    .build()
            }
            val item = MediaItem.Builder().setUri(s.url).setSubtitleConfigurations(subtitleConfigs).build()
            player.setMediaSource(DefaultMediaSourceFactory(httpFactory).createMediaSource(item))
            player.prepare()
            status = ""
        } catch (e: Exception) {
            error = e.message ?: "Failed to resolve stream"
        }
    }

    // Poll position for the skip-intro/outro windows (cheap, 500ms).
    LaunchedEffect(stream) {
        while (isActive) {
            val s = stream
            val pos = player.currentPosition / 1000
            val si = s?.introEnd != null && pos >= (s.introStart ?: 0) && pos < s.introEnd!!
            val so = s?.outroEnd != null && pos >= (s.outroStart ?: 0) && pos < s.outroEnd!!
            if (si != showSkipIntro) showSkipIntro = si
            if (so != showSkipOutro) showSkipOutro = so
            delay(500)
        }
    }

    // Double-tap seek chaining (10s steps stack like the old player).
    var chainSecs by remember { mutableStateOf(0) }
    var chainForward by remember { mutableStateOf(true) }
    LaunchedEffect(seekFeedback) { if (seekFeedback != null) { delay(700); seekFeedback = null; chainSecs = 0 } }

    Column(Modifier.fillMaxSize().background(Color.Black)) {
        if (!inPipLikely) {
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
                IconButton(onClick = {
                    landscapeLocked = !landscapeLocked
                    activity?.requestedOrientation =
                        if (landscapeLocked) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                        else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                }) { Icon(Icons.Filled.ScreenRotation, "Lock landscape", tint = if (landscapeLocked) Accent else Color.White) }
                IconButton(onClick = {
                    try {
                        activity?.enterPictureInPictureMode(
                            PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build(),
                        )
                    } catch (e: Exception) { /* device without PiP */ }
                }) { Icon(Icons.Filled.PictureInPictureAlt, "Picture in picture", tint = Color.White) }
                IconButton(onClick = { if (index > 0) index -= 1 }, enabled = index > 0) {
                    Icon(Icons.Filled.SkipPrevious, "Previous episode", tint = Color.White)
                }
                IconButton(
                    onClick = { if (index + 1 < PlaySession.episodes.size) index += 1 },
                    enabled = index + 1 < PlaySession.episodes.size,
                ) { Icon(Icons.Filled.SkipNext, "Next episode", tint = Color.White) }
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
                        controllerShowTimeoutMs = 3000
                        setControllerVisibilityListener(
                            PlayerView.ControllerVisibilityListener { v -> controllerVisible = v == android.view.View.VISIBLE },
                        )
                        // Subtitle look ported from the old app: white on 25% black.
                        subtitleView?.setStyle(
                            CaptionStyleCompat(
                                android.graphics.Color.WHITE,
                                0x40000000,
                                android.graphics.Color.TRANSPARENT,
                                CaptionStyleCompat.EDGE_TYPE_OUTLINE,
                                android.graphics.Color.BLACK,
                                null,
                            ),
                        )
                        subtitleView?.setFractionalTextSize(0.055f)
                        playerViewRef = this
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )

            // Gesture layer — only when the controller is hidden, so the
            // controller's own buttons stay tappable when visible.
            if (!controllerVisible && !inPipLikely && error == null) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            detectTapGestures(
                                onTap = { playerViewRef?.showController() },
                                onDoubleTap = { offset ->
                                    val w = size.width
                                    when {
                                        offset.x < w * 0.35f -> {
                                            if (!chainForward || chainSecs == 0) chainSecs = 0
                                            chainForward = false
                                            chainSecs += 10
                                            player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0))
                                            seekFeedback = false to chainSecs
                                        }
                                        offset.x > w * 0.65f -> {
                                            if (chainForward.not() || chainSecs == 0) chainSecs = 0
                                            chainForward = true
                                            chainSecs += 10
                                            player.seekTo(player.currentPosition + 10_000)
                                            seekFeedback = true to chainSecs
                                        }
                                        else -> if (player.isPlaying) player.pause() else player.play()
                                    }
                                },
                                onLongPress = {
                                    speedActive = true
                                    player.setPlaybackSpeed(2f)
                                },
                                onPress = {
                                    tryAwaitRelease()
                                    if (speedActive) {
                                        speedActive = false
                                        player.setPlaybackSpeed(1f)
                                    }
                                },
                            )
                        }
                        .pointerInput(Unit) {
                            // Vertical drag on the right half = volume.
                            detectDragGestures(
                                onDragEnd = { volumeFeedback = null },
                                onDrag = { change, drag ->
                                    if (change.position.x > size.width / 2) {
                                        val delta = -drag.y / size.height * 1.4f
                                        player.volume = (player.volume + delta).coerceIn(0f, 1f)
                                        volumeFeedback = player.volume
                                    }
                                },
                            )
                        },
                )
            }

            // Feedback overlays
            seekFeedback?.let { (fwd, secs) ->
                Box(
                    Modifier
                        .align(if (fwd) Alignment.CenterEnd else Alignment.CenterStart)
                        .padding(horizontal = 48.dp)
                        .clip(RoundedCornerShape(24.dp))
                        .background(Color.Black.copy(alpha = 0.6f))
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                ) { Text(if (fwd) "+${secs}s" else "−${secs}s", color = Color.White, style = MaterialTheme.typography.titleMedium) }
            }
            if (speedActive) {
                Box(
                    Modifier.align(Alignment.TopCenter).padding(top = 24.dp)
                        .clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.6f))
                        .padding(horizontal = 16.dp, vertical = 6.dp),
                ) { Text("2× ▶▶", color = Color.White, style = MaterialTheme.typography.labelLarge) }
            }
            volumeFeedback?.let { v ->
                Box(
                    Modifier.align(Alignment.Center)
                        .clip(RoundedCornerShape(16.dp)).background(Color.Black.copy(alpha = 0.6f))
                        .padding(horizontal = 18.dp, vertical = 10.dp),
                ) { Text("Vol ${(v * 100).toInt()}%", color = Color.White, style = MaterialTheme.typography.labelLarge) }
            }

            // Skip intro / outro
            if (showSkipIntro || showSkipOutro) {
                Button(
                    onClick = {
                        val s = stream ?: return@Button
                        val end = (if (showSkipIntro) s.introEnd else s.outroEnd) ?: return@Button
                        player.seekTo(end * 1000)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color.Black.copy(alpha = 0.75f)),
                    modifier = Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 96.dp),
                ) { Text(if (showSkipIntro) "Skip Intro ⏭" else "Skip Outro ⏭", color = Color.White) }
            }

            when {
                error != null -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error!!, color = Color(0xFFFF6B6B), style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { retry += 1 }, colors = ButtonDefaults.buttonColors(containerColor = Accent)) { Text("Retry") }
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
