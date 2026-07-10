package com.sanjay.anitrack.next.ui

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.ActivityInfo
import android.net.Uri
import android.util.Rational
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.ClosedCaptionOff
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.FullscreenExit
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
import kotlinx.coroutines.launch

private val Accent = Color(0xFFE50914)
private const val UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

private fun fmtTime(ms: Long): String {
    if (ms <= 0) return "0:00"
    val total = ms / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

internal suspend fun saveProgress(player: ExoPlayer, index: Int) {
    if (index >= PlaySession.count) return
    val epNum = PlaySession.episodeNumber(index)
    val dur = player.duration
    if (dur <= 0) return
    val now = System.currentTimeMillis()
    val key = PlaySession.resumeKey()
    com.sanjay.anitrack.next.data.Db.save(
        PlaySession.animeId, epNum, player.currentPosition / 1000.0, dur / 1000.0,
        PlaySession.animeTitle, PlaySession.animeCover, key, updatedAt = now,
    )
    com.sanjay.anitrack.next.data.GistSync.pushProgress(
        com.sanjay.anitrack.next.data.Db.CwRow(
            PlaySession.animeId, epNum, player.currentPosition / 1000.0, dur / 1000.0,
            PlaySession.animeTitle, PlaySession.animeCover, key, now,
        ),
    )
}

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(
    onBack: () -> Unit,
    onHome: () -> Unit = onBack,
    onOpenDetail: (Int) -> Unit = {},
) {
    val context = LocalContext.current
    val activity = context as? Activity
    val scope = rememberCoroutineScope()
    var index by remember { mutableStateOf(PlaySession.index) }
    var provider by remember { mutableStateOf(PlaySession.provider) }
    var subType by remember { mutableStateOf(PlaySession.subType) }
    var switching by remember { mutableStateOf(false) }
    var switchError by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf("Resolving stream…") }
    var error by remember { mutableStateOf<String?>(null) }
    var stream by remember { mutableStateOf<PlaySession.Resolved?>(null) }
    var playerViewRef by remember { mutableStateOf<PlayerView?>(null) }
    var landscapeLocked by remember { mutableStateOf(false) }

    // Custom control-bar state (desktop-style bar, not ExoPlayer's default).
    var controlsVisible by remember { mutableStateOf(true) }
    var positionMs by remember { mutableStateOf(0L) }
    var durationMs by remember { mutableStateOf(0L) }
    var bufferedMs by remember { mutableStateOf(0L) }
    var isPlaying by remember { mutableStateOf(false) }
    var isSeeking by remember { mutableStateOf(false) }
    var seekPreviewMs by remember { mutableStateOf(0L) }
    var muted by remember { mutableStateOf(false) }
    var speed by remember { mutableStateOf(1f) }
    var ccOn by remember { mutableStateOf(true) }
    // Settings panel (desktop-style layered menu) + persisted caption style.
    val capPrefs = remember { context.getSharedPreferences("anitrack_next", android.content.Context.MODE_PRIVATE) }
    var capSize by remember { mutableStateOf(capPrefs.getFloat("cap_size", 0.055f)) }
    var capBg by remember { mutableStateOf(capPrefs.getInt("cap_bg", 0x40)) }   // alpha 0..255
    var capFont by remember { mutableStateOf(capPrefs.getString("cap_font", "Outfit") ?: "Outfit") }
    var capColor by remember { mutableStateOf(capPrefs.getInt("cap_color", android.graphics.Color.WHITE)) }
    var autoplay by remember { mutableStateOf(capPrefs.getBoolean("autoplay", true)) }
    var autoNext by remember { mutableStateOf(capPrefs.getBoolean("auto_next", true)) }
    var settingsMenu by remember { mutableStateOf<String?>(null) }  // null|main|speed|quality|subtitles
    // Manual quality: available video heights in the stream; 0 = highest.
    var videoHeights by remember { mutableStateOf<List<Int>>(emptyList()) }
    var quality by remember { mutableStateOf(0) }
    // Transient-error recovery (Cronet re-request stalls after a seek).
    var errorRetries by remember { mutableStateOf(0) }
    var lastErrorAt by remember { mutableStateOf(0L) }
    fun flashControls() { controlsVisible = true }

    // Gesture feedback overlays
    var seekFeedback by remember { mutableStateOf<Pair<Boolean, Int>?>(null) } // (isForward, totalSecs)
    var speedActive by remember { mutableStateOf(false) }
    var volumeFeedback by remember { mutableStateOf<Float?>(null) }

    // Skip intro/outro
    var showSkipIntro by remember { mutableStateOf(false) }
    var showSkipOutro by remember { mutableStateOf(false) }

    // PiP heuristic: the PiP window is tiny — hide all chrome in it.
    val inPipLikely = LocalConfiguration.current.screenWidthDp < 400
    // Old-app layout: episode panel beside the video on wide screens.
    val wide = LocalConfiguration.current.screenWidthDp >= 820
    var watchedMap by remember { mutableStateOf<Map<Float, Int>>(emptyMap()) }
    LaunchedEffect(index) {
        runCatching { watchedMap = com.sanjay.anitrack.next.data.Db.positionsFor(PlaySession.animeId) }
    }

    // Borrow the app-wide player — it survives navigation so the floating
    // mini player (AppShell overlay) can keep playing, like the desktop.
    val player = remember { com.sanjay.anitrack.next.data.PlayerHolder.get(context) }
    LaunchedEffect(Unit) { com.sanjay.anitrack.next.data.PlayerHolder.miniActive.value = false }

    // Poll playback state for the scrubber + time display.
    LaunchedEffect(player) {
        while (isActive) {
            if (!isSeeking) positionMs = player.currentPosition
            durationMs = player.duration.coerceAtLeast(0L)
            bufferedMs = player.bufferedPosition
            // Reflect the play INTENT, not the momentary buffering state, so the
            // icon doesn't flip to ▶ every time a seek re-buffers.
            isPlaying = player.playWhenReady
            delay(300)
        }
    }
    // Auto-hide the bar while playing.
    LaunchedEffect(controlsVisible, isPlaying, isSeeking) {
        if (controlsVisible && isPlaying && !isSeeking) { delay(3500); controlsVisible = false }
    }

    DisposableEffect(Unit) {
        PlaySession.playerActive = true
        // Immersive: hide the Android status + navigation bars for the whole
        // player so nothing (clock, taskbar) sits over the video or controls.
        val window = activity?.window
        val insets = window?.let { w ->
            androidx.core.view.WindowCompat.getInsetsController(w, w.decorView).apply {
                systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            }
        }
        onDispose {
            PlaySession.playerActive = false
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            insets?.show(androidx.core.view.WindowInsetsCompat.Type.systemBars())
        }
    }

    // Pin the selected (or highest) rendition — the DEFAULT is best quality,
    // not adaptive ramp-up.
    fun applyQuality(heights: List<Int> = videoHeights) {
        val target = when {
            quality > 0 && heights.contains(quality) -> quality
            heights.isNotEmpty() -> heights.max()
            else -> return
        }
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setMinVideoSize(0, target)
            .setMaxVideoSize(Int.MAX_VALUE, target)
            .build()
    }

    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && autoNext && index + 1 < PlaySession.count) index += 1
            }
            override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                // Collect the stream's video renditions for the Quality menu.
                val heights = tracks.groups
                    .filter { it.type == C.TRACK_TYPE_VIDEO }
                    .flatMap { g -> (0 until g.length).map { g.getTrackFormat(it).height } }
                    .filter { it > 0 }.distinct().sortedDescending()
                if (heights != videoHeights) {
                    videoHeights = heights
                    applyQuality(heights)
                }
            }
            override fun onPlayerError(e: androidx.media3.common.PlaybackException) {
                var cause: Throwable? = e
                var httpCode: Int? = null
                while (cause != null) {
                    if (cause is androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException) {
                        httpCode = cause.responseCode; break
                    }
                    cause = cause.cause
                }
                android.util.Log.e("AniTrackNext", "player error http=$httpCode provider=${PlaySession.provider}", e)
                // Transient network/seek stalls (Cronet re-requests after a seek)
                // are recoverable — re-prepare in place instead of dropping the
                // control bar. Only surface a fatal error after repeated retries.
                val now = System.currentTimeMillis()
                if (now - lastErrorAt > 8000) errorRetries = 0
                lastErrorAt = now
                if (errorRetries < 3) {
                    errorRetries++
                    val pos = player.currentPosition
                    player.prepare()
                    if (pos > 0) player.seekTo(pos)
                    player.playWhenReady = true
                } else {
                    error = if (httpCode != null)
                        "Stream request failed (HTTP $httpCode) — the CDN rejected playback."
                    else e.errorCodeName.removePrefix("ERROR_CODE_").replace('_', ' ').lowercase()
                        .replaceFirstChar { c -> c.uppercase() }
                }
            }
        }
        player.addListener(listener)
        // No release here — PlayerHolder owns the instance (mini player).
        onDispose { player.removeListener(listener) }
    }

    var lastPlayedIndex by remember { mutableStateOf<Int?>(null) }
    // `provider`/`subType` participate so switching them re-resolves at the same index.
    LaunchedEffect(index, retry, provider, subType) {
        if (index >= PlaySession.count) return@LaunchedEffect
        PlaySession.subType = subType
        val epNum = PlaySession.episodeNumber(index)
        // Already loaded (returning from the mini player)? Don't restart it.
        val holder = com.sanjay.anitrack.next.data.PlayerHolder
        if (holder.loadedKey == holder.keyFor(index) && player.mediaItemCount > 0) {
            stream = holder.lastResolved
            lastPlayedIndex = index
            status = ""
            return@LaunchedEffect
        }
        // Save the outgoing episode's position before switching.
        lastPlayedIndex?.takeIf { it != index }?.let { saveProgress(player, it) }
        lastPlayedIndex = index
        error = null
        status = "Resolving Episode ${epNum.toInt()}…"
        player.stop()
        try {
            val s = PlaySession.resolve(index)
            stream = s
            // Shared loader: local file:// vs CDN (Referer/UA) data source.
            holder.setMedia(context, s)
            player.playWhenReady = autoplay
            holder.loadedKey = holder.keyFor(index)
            holder.lastResolved = s
            // Resume mid-episode from the local DB (finished episodes restart).
            com.sanjay.anitrack.next.data.Db.resumeFor(PlaySession.animeId, epNum)?.let { pos ->
                player.seekTo((pos * 1000).toLong())
            }
            status = ""
        } catch (e: Exception) {
            // Tagged so `adb logcat -s AniTrackNext` captures provider failures.
            android.util.Log.e("AniTrackNext", "resolve failed provider=$provider ep=$epNum", e)
            error = e.message ?: "Failed to resolve stream"
        }
    }

    // Poll position for the skip-intro/outro windows (cheap, 500ms) and save
    // watch progress every ~10s while playing.
    LaunchedEffect(stream) {
        var sinceSave = 0
        while (isActive) {
            val s = stream
            val pos = player.currentPosition / 1000
            val si = s?.introEnd != null && pos >= (s.introStart ?: 0) && pos < s.introEnd!!
            val so = s?.outroEnd != null && pos >= (s.outroStart ?: 0) && pos < s.outroEnd!!
            if (si != showSkipIntro) showSkipIntro = si
            if (so != showSkipOutro) showSkipOutro = so
            sinceSave += 1
            if (sinceSave >= 20 && player.isPlaying) { // 20 * 500ms = 10s
                sinceSave = 0
                saveProgress(player, index)
            }
            delay(500)
        }
    }

    // Final save when the screen goes away + hand off to the mini player.
    DisposableEffect(Unit) {
        onDispose {
            val holder = com.sanjay.anitrack.next.data.PlayerHolder
            if (player.mediaItemCount > 0 && player.playbackState != Player.STATE_IDLE) {
                holder.miniActive.value = true   // keep playing in the overlay
            } else {
                holder.release()
            }
            val dur = player.duration
            val posMs = player.currentPosition
            val savedIndex = index
            if (savedIndex < PlaySession.count && dur > 0) {
                val epNum = PlaySession.episodeNumber(savedIndex)
                val key = PlaySession.resumeKey()
                // Fire-and-forget on a background thread; the composable is gone.
                Thread {
                    kotlinx.coroutines.runBlocking {
                        com.sanjay.anitrack.next.data.Db.save(
                            PlaySession.animeId, epNum, posMs / 1000.0, dur / 1000.0,
                            PlaySession.animeTitle, PlaySession.animeCover, key,
                        )
                    }
                }.start()
            }
        }
    }

    // Double-tap seek chaining (10s steps stack like the old player).
    var chainSecs by remember { mutableStateOf(0) }
    var chainForward by remember { mutableStateOf(true) }
    LaunchedEffect(seekFeedback) { if (seekFeedback != null) { delay(700); seekFeedback = null; chainSecs = 0 } }

    Column(Modifier.fillMaxSize().background(Color.Black)) {
        // Immersive while PiP'd or locked to landscape (the old app's fullscreen).
        if (!inPipLikely && !landscapeLocked) {
            // Desktop-style header: "⌂ Home | <Title> — Episode N" with the
            // title clickable → detail page.
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    Modifier.clip(RoundedCornerShape(8.dp)).clickable { onHome() }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Home, "Home", tint = Color.White.copy(alpha = 0.85f), modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Home", style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.85f))
                }
                Spacer(Modifier.width(10.dp))
                Row(
                    Modifier.weight(1f).clip(RoundedCornerShape(8.dp))
                        .clickable(enabled = PlaySession.animeId > 0) { onOpenDetail(PlaySession.animeId) }
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        PlaySession.animeTitle,
                        style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold,
                        color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (index < PlaySession.count) {
                        val n = PlaySession.episodeNumber(index)
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "— Episode ${if (n % 1f == 0f) n.toInt() else n}",
                            style = MaterialTheme.typography.labelMedium,
                            color = Color.White.copy(alpha = 0.55f),
                        )
                    }
                }
            }
        }

        // Server switch is shared by both orientations.
        val switchTo: (String) -> Unit = { target ->
            if (target != provider && !switching) {
                switching = true; switchError = null
                scope.launch {
                    val ok = runCatching { PlaySession.switchProvider(target) }.getOrDefault(false)
                    if (ok) {
                        provider = PlaySession.provider
                        index = PlaySession.index
                    } else {
                        switchError = if (!PlaySession.canSwitchServer) "Reopen from the show page to switch servers"
                        else "No source on that server"
                    }
                    switching = false
                }
            }
        }

        val panel: @Composable (Modifier) -> Unit = { mod ->
            PlayerEpisodePanel(
                modifier = mod,
                provider = provider,
                subType = subType,
                current = index,
                watched = watchedMap,
                switching = switching,
                switchError = switchError,
                canSwitch = PlaySession.canSwitchServer,
                onSelect = { index = it },
                onServer = switchTo,
                onSubType = { subType = it },
            )
        }

        // Video surface + overlays. Extracted so both orientations reuse it.
        val videoArea: @Composable (Modifier) -> Unit = { mod ->
        Box(mod, contentAlignment = Alignment.Center) {
            AndroidView(
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        this.player = player
                        useController = false          // custom Compose control bar below
                        keepScreenOn = true
                        playerViewRef = this
                    }
                },
                modifier = Modifier.fillMaxSize(),
                update = { pv ->
                    // Apply the current caption style whenever it changes.
                    val face = when (capFont) {
                        "Mono" -> android.graphics.Typeface.MONOSPACE
                        "Serif" -> android.graphics.Typeface.SERIF
                        else -> null   // Outfit/Sans → system sans
                    }
                    pv.subtitleView?.setStyle(
                        CaptionStyleCompat(
                            capColor,
                            (capBg shl 24),
                            android.graphics.Color.TRANSPARENT,
                            CaptionStyleCompat.EDGE_TYPE_OUTLINE,
                            android.graphics.Color.BLACK,
                            face,
                        ),
                    )
                    pv.subtitleView?.setFractionalTextSize(capSize)
                },
            )

            // Gesture layer — sits under the control bar. Single tap toggles
            // the bar; double-tap seeks; long-press = 2×; right-half drag = vol.
            if (!inPipLikely && error == null) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            detectTapGestures(
                                onTap = { controlsVisible = !controlsVisible },
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

            // ── Custom control bar (desktop-style) ──
            if (controlsVisible && !inPipLikely && error == null && status.isEmpty()) {
                Column(
                    Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(
                            androidx.compose.ui.graphics.Brush.verticalGradient(
                                listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f)),
                            ),
                        )
                        .padding(horizontal = 10.dp, vertical = 6.dp),
                ) {
                    // Scrubber
                    val dur = durationMs.coerceAtLeast(1L)
                    val shown = if (isSeeking) seekPreviewMs else positionMs
                    val progress = (shown.toFloat() / dur).coerceIn(0f, 1f)
                    val buffered = (bufferedMs.toFloat() / dur).coerceIn(0f, 1f)
                    BoxWithConstraints(
                        Modifier
                            .fillMaxWidth()
                            .height(24.dp)
                            .pointerInput(dur) {
                                detectTapGestures { off ->
                                    val t = (off.x / size.width * dur).toLong().coerceIn(0, dur)
                                    player.seekTo(t); positionMs = t; flashControls()
                                }
                            }
                            .pointerInput(dur) {
                                detectHorizontalDragGestures(
                                    onDragStart = { off -> isSeeking = true; seekPreviewMs = (off.x / size.width * dur).toLong().coerceIn(0, dur) },
                                    onHorizontalDrag = { change, _ -> seekPreviewMs = (change.position.x / size.width * dur).toLong().coerceIn(0, dur) },
                                    onDragEnd = { player.seekTo(seekPreviewMs); positionMs = seekPreviewMs; isSeeking = false },
                                )
                            },
                    ) {
                        val w = maxWidth
                        Box(Modifier.align(Alignment.CenterStart).fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.25f)))
                        Box(Modifier.align(Alignment.CenterStart).fillMaxWidth(buffered).height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.4f)))
                        Box(Modifier.align(Alignment.CenterStart).fillMaxWidth(progress).height(3.dp).clip(RoundedCornerShape(2.dp)).background(Accent))
                        Box(
                            Modifier
                                .align(Alignment.CenterStart)
                                .offset(x = w * progress - 7.dp)
                                .size(14.dp)
                                .clip(RoundedCornerShape(50))
                                .background(Accent),
                        )
                    }
                    // Button row
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = { if (index > 0) { index -= 1; flashControls() } }, enabled = index > 0) {
                            Icon(Icons.Filled.SkipPrevious, "Previous", tint = Color.White)
                        }
                        IconButton(onClick = {
                            // Toggle the play INTENT (works even mid-buffer, unlike isPlaying).
                            player.playWhenReady = !player.playWhenReady
                            isPlaying = player.playWhenReady
                            flashControls()
                        }) {
                            Icon(if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, "Play/Pause", tint = Color.White, modifier = Modifier.size(30.dp))
                        }
                        IconButton(onClick = { if (index + 1 < PlaySession.count) { index += 1; flashControls() } }, enabled = index + 1 < PlaySession.count) {
                            Icon(Icons.Filled.SkipNext, "Next", tint = Color.White)
                        }
                        IconButton(onClick = { muted = !muted; player.volume = if (muted) 0f else 1f; flashControls() }) {
                            Icon(if (muted) Icons.Filled.VolumeOff else Icons.Filled.VolumeUp, "Mute", tint = Color.White)
                        }
                        Text(
                            "${fmtTime(shown)} / ${fmtTime(durationMs)}",
                            style = MaterialTheme.typography.labelMedium,
                            color = Color.White.copy(alpha = 0.85f),
                        )
                        Spacer(Modifier.weight(1f))
                        // CC toggle (only when there are subtitles)
                        if (stream?.subtitles?.isNotEmpty() == true) {
                            IconButton(onClick = {
                                ccOn = !ccOn
                                player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !ccOn).build()
                                flashControls()
                            }) {
                                Icon(if (ccOn) Icons.Filled.ClosedCaption else Icons.Filled.ClosedCaptionOff, "Subtitles", tint = Color.White)
                            }
                        }
                        // Settings gear → desktop-style layered panel
                        IconButton(onClick = { settingsMenu = if (settingsMenu == null) "main" else null; flashControls() }) {
                            Icon(Icons.Filled.Settings, "Settings", tint = Color.White)
                        }
                        IconButton(onClick = {
                            try {
                                activity?.enterPictureInPictureMode(
                                    PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build(),
                                )
                            } catch (e: Exception) { /* no PiP */ }
                        }) { Icon(Icons.Filled.PictureInPictureAlt, "PiP", tint = Color.White) }
                        IconButton(onClick = {
                            landscapeLocked = !landscapeLocked
                            activity?.requestedOrientation =
                                if (landscapeLocked) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                                else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                        }) { Icon(if (landscapeLocked) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen, "Fullscreen", tint = Color.White) }
                    }
                }
            }

            // Desktop-style settings panel (anchored above the control bar).
            if (settingsMenu != null) {
                Box(Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 92.dp)) {
                    PlayerSettingsPanel(
                        menu = settingsMenu!!,
                        onMenu = { settingsMenu = it },
                        speed = speed,
                        onSpeed = { speed = it; player.setPlaybackSpeed(it) },
                        qualities = videoHeights,
                        quality = quality,
                        onQuality = { quality = it; applyQuality() },
                        hasSubs = stream?.subtitles?.isNotEmpty() == true,
                        ccOn = ccOn,
                        onCc = {
                            ccOn = it
                            player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !it).build()
                        },
                        capSize = capSize, onCapSize = { capSize = it; capPrefs.edit().putFloat("cap_size", it).apply() },
                        capFont = capFont, onCapFont = { capFont = it; capPrefs.edit().putString("cap_font", it).apply() },
                        capBg = capBg, onCapBg = { capBg = it; capPrefs.edit().putInt("cap_bg", it).apply() },
                        capColor = capColor, onCapColor = { capColor = it; capPrefs.edit().putInt("cap_color", it).apply() },
                        autoplay = autoplay, onAutoplay = { autoplay = it; capPrefs.edit().putBoolean("autoplay", it).apply() },
                        autoNext = autoNext, onAutoNext = { autoNext = it; capPrefs.edit().putBoolean("auto_next", it).apply() },
                    )
                }
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
        } // video Box
        } // videoArea lambda

        when {
            // PiP / fullscreen-landscape lock: video only, no chrome.
            inPipLikely || landscapeLocked -> videoArea(Modifier.weight(1f).fillMaxWidth())
            // Landscape / tablet: panel beside the video (desktop app layout).
            wide -> Row(Modifier.weight(1f).fillMaxWidth()) {
                panel(Modifier.width(300.dp).fillMaxHeight())
                videoArea(Modifier.weight(1f).fillMaxHeight())
            }
            // Portrait: 16:9 video on top, panel below.
            else -> Column(Modifier.weight(1f).fillMaxWidth()) {
                videoArea(Modifier.fillMaxWidth().aspectRatio(16f / 9f))
                panel(Modifier.fillMaxWidth().weight(1f))
            }
        }
    }
}

// ── Episode panel (the desktop app's SERVERS + range + find + grid) ──────────
// Rendered beside the video in landscape/tablet, below it in portrait.

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlayerEpisodePanel(
    modifier: Modifier,
    provider: String,
    subType: String,
    current: Int,
    watched: Map<Float, Int>,
    switching: Boolean,
    switchError: String?,
    canSwitch: Boolean,
    onSelect: (Int) -> Unit,
    onServer: (String) -> Unit,
    onSubType: (String) -> Unit,
) {
    val count = PlaySession.count
    val RANGE = 100
    val rangeCount = ((count + RANGE - 1) / RANGE).coerceAtLeast(1)
    // Follow the playing episode into its range.
    var range by remember(current, count) { mutableStateOf(current / RANGE) }
    var find by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // Keep the playing episode visible when it's inside the shown range.
    LaunchedEffect(current, range) {
        val start = range * RANGE
        if (current in start until minOf(start + RANGE, count)) {
            runCatching { listState.animateScrollToItem((current - start - 2).coerceAtLeast(0)) }
        }
    }

    Column(modifier.background(Color(0xFF0E0E12))) {
        // ── SERVERS (the desktop app's switcher, in-player) ──
        Text(
            "SERVERS",
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.45f),
            modifier = Modifier.padding(start = 14.dp, top = 10.dp, bottom = 6.dp),
        )
        Row(
            Modifier.padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FilterChip(
                selected = provider == "animepahe",
                enabled = canSwitch && !switching,
                onClick = { onServer("animepahe") },
                label = { Text("AnimePahe") },
            )
            FilterChip(
                selected = provider == "anikoto",
                enabled = canSwitch && !switching,
                onClick = { onServer("anikoto") },
                label = { Text("Anikoto") },
            )
            if (switching) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Accent)
        }
        switchError?.let {
            Text(
                it,
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFFFF6B6B),
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 2.dp),
            )
        }
        // SUB TYPE (Anikoto only, like the desktop app).
        if (provider == "anikoto") {
            Spacer(Modifier.height(8.dp))
            Text(
                "SUB TYPE",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.45f),
                modifier = Modifier.padding(start = 14.dp, bottom = 6.dp),
            )
            Row(Modifier.padding(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = subType == "soft", onClick = { onSubType("soft") }, label = { Text("Soft Sub") })
                FilterChip(selected = subType == "hard", onClick = { onSubType("hard") }, label = { Text("Hard Sub") })
            }
        }
        Spacer(Modifier.height(8.dp))

        // ── Range chips + find-number (old app's 001-100 selector + search) ──
        Row(
            Modifier.padding(horizontal = 14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (rangeCount > 1) {
                LazyRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(rangeCount) { i ->
                        val first = i * RANGE + 1
                        val last = minOf((i + 1) * RANGE, count)
                        FilterChip(
                            selected = range == i,
                            onClick = { range = i },
                            label = { Text("$first–$last", style = MaterialTheme.typography.labelSmall) },
                        )
                    }
                }
            } else {
                Spacer(Modifier.weight(1f))
            }
            // Slim "Find number" box, like the desktop's.
            Box(
                Modifier.width(110.dp).height(34.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(Color.White.copy(alpha = 0.05f))
                    .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 10.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                androidx.compose.foundation.text.BasicTextField(
                    value = find,
                    onValueChange = { v ->
                        find = v.filter { it.isDigit() }.take(4)
                        find.toIntOrNull()?.let { n ->
                            val idx = (0 until count).firstOrNull { PlaySession.episodeNumber(it).toInt() == n }
                            if (idx != null) range = idx / RANGE
                        }
                    },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.labelMedium.copy(color = Color.White),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(Accent),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (find.isEmpty()) {
                    Text("Find number", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.35f))
                }
            }
        }
        Spacer(Modifier.height(6.dp))

        // ── Episode list for the active range ──
        val start = range * RANGE
        val visible = minOf(start + RANGE, count) - start
        val findN = find.toIntOrNull()
        LazyColumn(state = listState, modifier = Modifier.weight(1f)) {
            items(visible) { off ->
                val i = start + off
                val n = PlaySession.episodeNumber(i)
                val pct = watched[n] ?: 0
                val isCur = i == current
                val isFound = findN != null && n.toInt() == findN
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(
                            when {
                                isCur -> Accent.copy(alpha = 0.16f)
                                isFound -> Color.White.copy(alpha = 0.10f)
                                else -> Color.Transparent
                            },
                        )
                        .clickable { onSelect(i) }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${if (n % 1f == 0f) n.toInt() else n}",
                        modifier = Modifier.width(40.dp),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = if (isCur) FontWeight.Bold else FontWeight.Normal,
                        color = when {
                            isCur -> Accent
                            pct >= 85 -> Color.White.copy(alpha = 0.35f)
                            else -> Color.White.copy(alpha = 0.85f)
                        },
                    )
                    Text(
                        PlaySession.episodeTitle(i) ?: "Episode ${if (n % 1f == 0f) n.toInt() else n}",
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        color = when {
                            isCur -> Color.White
                            pct >= 85 -> Color.White.copy(alpha = 0.35f)
                            else -> Color.White.copy(alpha = 0.7f)
                        },
                    )
                    if (pct >= 85) {
                        Text("✓", style = MaterialTheme.typography.labelSmall, color = Accent.copy(alpha = 0.8f))
                    } else if (pct > 0) {
                        Text("$pct%", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
                    }
                }
            }
        }
    }
}
