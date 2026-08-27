package com.sanjay.anitrack.next.ui

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.ActivityInfo
import android.util.Rational
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
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
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.PlayerView
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.PipState
import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.Providers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private val Accent = Color(0xFFE50914)
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
    val providerDescriptors = Providers.enabled().map { it.descriptor }
    var subType by remember { mutableStateOf(PlaySession.subType) }
    var switching by remember { mutableStateOf(false) }
    var switchError by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableStateOf(0) }
    var pendingSwitchPositionMs by remember { mutableStateOf<Long?>(null) }
    var pendingSwitchPlayWhenReady by remember { mutableStateOf<Boolean?>(null) }
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
    // Transient native-player error recovery (Anikoto/local playback).
    var errorRetries by remember { mutableStateOf(0) }
    var lastErrorAt by remember { mutableStateOf(0L) }
    // Some connector streams need hls.js/MSE rather than Media3. The backend
    // is selected by resolved connector metadata, not by a provider name.
    val webCtl = remember { WebController() }
    var webResumeMs by remember { mutableStateOf(0L) }
    var webPlayWhenReady by remember { mutableStateOf(true) }
    val useWeb = stream?.backend == PlaybackBackend.WEB_HLS
    fun flashControls() { controlsVisible = true }


    // Skip intro/outro
    var showSkipIntro by remember { mutableStateOf(false) }
    var showSkipOutro by remember { mutableStateOf(false) }

    // PiP heuristic: the PiP window is tiny — hide all chrome in it.
    val inPipMode by PipState.active
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

    // Unified controls that dispatch to the active backend (ExoPlayer / WebView).
    fun curPos(): Long = if (useWeb) webCtl.positionMs.value else player.currentPosition
    fun doSeek(ms: Long) { positionMs = ms; if (useWeb) webCtl.seekTo(ms) else player.seekTo(ms) }
    fun doTogglePlay() {
        if (useWeb) {
            if (webCtl.paused.value) webCtl.play() else webCtl.pause()
        } else {
            player.playWhenReady = !player.playWhenReady
            isPlaying = player.playWhenReady
        }
    }

    // Poll playback state for the scrubber + time display.
    LaunchedEffect(player, useWeb) {
        // Buffering watchdog: if the player buffers >8s without loading anything
        // (kwik seek pathology), re-prepare at the same position automatically.
        var stallTicks = 0
        var stallBufferedAt = 0L
        var stallRecoveries = 0
        while (isActive) {
            // AnimePahe WebView — mirror hls.js state instead of ExoPlayer.
            if (useWeb) {
                if (!isSeeking) positionMs = webCtl.positionMs.value
                durationMs = webCtl.durationMs.value
                bufferedMs = webCtl.bufferedMs.value
                isPlaying = !webCtl.paused.value
                webCtl.error.value?.let { if (error != it) error = it }
                delay(300)
                continue
            }
            if (!isSeeking) positionMs = player.currentPosition
            durationMs = player.duration.coerceAtLeast(0L)
            bufferedMs = player.bufferedPosition
            // Reflect the play INTENT, not the momentary buffering state, so the
            // icon doesn't flip to ▶ every time a seek re-buffers.
            isPlaying = player.playWhenReady
            val st = player.playbackState
            if (st == Player.STATE_BUFFERING && player.playWhenReady) {
                if (player.bufferedPosition > stallBufferedAt + 500) {
                    stallBufferedAt = player.bufferedPosition
                    stallTicks = 0
                } else if (++stallTicks > 27 && stallRecoveries < 2) {   // ~8s frozen
                    stallRecoveries++
                    stallTicks = 0
                    com.sanjay.anitrack.next.data.PlayerHolder.lastResolved?.let { s ->
                        val t = player.currentPosition
                        android.util.Log.w("AniTrackNext", "buffer stall — re-preparing at ${t}ms (attempt $stallRecoveries)")
                        com.sanjay.anitrack.next.data.PlayerHolder.setMedia(context, s)
                        if (t > 0) player.seekTo(t)
                        player.playWhenReady = true
                    }
                }
            } else {
                stallTicks = 0
                if (st == Player.STATE_READY) {
                    stallRecoveries = 0
                    stallBufferedAt = player.bufferedPosition
                }
            }
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
            // Don't re-show system bars — the whole app runs immersive now.
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

    DisposableEffect(player, useWeb) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (!useWeb && state == Player.STATE_ENDED && autoNext && index + 1 < PlaySession.count) index += 1
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
                if (useWeb) return
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
    var lastPlayedWithWeb by remember { mutableStateOf(false) }
    // `provider`/`subType` participate so switching them re-resolves at the same index.
    LaunchedEffect(index, retry, provider, subType) {
        if (index >= PlaySession.count) return@LaunchedEffect
        PlaySession.subType = subType
        // Keep the session in sync with in-player navigation — otherwise a
        // server switch matches the episode you STARTED on, not the one
        // you're watching (the "came back to ep 58" bug).
        PlaySession.index = index
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
        lastPlayedIndex?.takeIf { it != index }?.let {
            if (lastPlayedWithWeb) saveWebProgress(it, webCtl.positionMs.value, durationMs)
            else saveProgress(player, it)
        }
        lastPlayedIndex = index
        error = null
        status = "Resolving Episode ${epNum.toInt()}…"
        if (useWeb) webCtl.pause() else player.stop()
        try {
            val s = PlaySession.resolve(index)
            stream = s
            val resolvedUsesWeb = s.backend == PlaybackBackend.WEB_HLS
            lastPlayedWithWeb = resolvedUsesWeb
            val storedResumeMs = (com.sanjay.anitrack.next.data.Db.resumeFor(PlaySession.animeId, epNum) ?: 0.0) * 1000
            // A server switch is the same episode on a different source. Keep
            // the live clock instead of jumping to an older persisted resume.
            val resumeMs = pendingSwitchPositionMs ?: storedResumeMs.toLong()
            val shouldPlay = pendingSwitchPlayWhenReady ?: autoplay
            if (resolvedUsesWeb) {
                // WebView + hls.js: the WebView is (re)mounted for this URL and
                // calls load() itself in onPageFinished (when the page JS is
                // ready). We just publish the resume position + stream here.
                player.stop()
                webResumeMs = resumeMs
                webPlayWhenReady = shouldPlay
                holder.loadedKey = null
                holder.lastResolved = null
            } else {
                // Shared loader: local file:// vs CDN (Referer/UA) data source.
                holder.setMedia(context, s)
                player.playWhenReady = shouldPlay
                holder.loadedKey = holder.keyFor(index)
                holder.lastResolved = s
                if (resumeMs > 0) player.seekTo(resumeMs)
            }
            pendingSwitchPositionMs = null
            pendingSwitchPlayWhenReady = null
            status = ""
        } catch (e: CancellationException) {
            // Changing episode/server intentionally cancels the previous
            // LaunchedEffect. It is not a playback failure and must never
            // cover the new source with an error overlay.
            throw e
        } catch (e: Exception) {
            // Tagged so `adb logcat -s AniTrackNext` captures provider failures.
            android.util.Log.e("AniTrackNext", "resolve failed provider=$provider ep=$epNum", e)
            error = e.message ?: "Failed to resolve stream"
        }
    }

    // Poll position for the skip-intro/outro windows (cheap, 500ms) and save
    // watch progress every ~10s while playing.
    LaunchedEffect(stream, useWeb) {
        var sinceSave = 0
        while (isActive) {
            val s = stream
            val pos = curPos() / 1000
            val si = s?.introEnd != null && pos >= (s.introStart ?: 0) && pos < s.introEnd!!
            val so = s?.outroEnd != null && pos >= (s.outroStart ?: 0) && pos < s.outroEnd!!
            if (si != showSkipIntro) showSkipIntro = si
            if (so != showSkipOutro) showSkipOutro = so
            sinceSave += 1
            val playing = if (useWeb) !webCtl.paused.value else player.isPlaying
            if (sinceSave >= 20 && playing) { // 20 * 500ms = 10s
                sinceSave = 0
                if (useWeb) saveWebProgress(index, curPos(), durationMs) else saveProgress(player, index)
            }
            delay(500)
        }
    }

    // Final save when the screen goes away + hand off to the mini player.
    val latestUseWeb = rememberUpdatedState(useWeb)
    val latestDurationMs = rememberUpdatedState(durationMs)
    val latestIndex = rememberUpdatedState(index)
    DisposableEffect(Unit) {
        onDispose {
            val holder = com.sanjay.anitrack.next.data.PlayerHolder
            if (player.mediaItemCount > 0 && player.playbackState != Player.STATE_IDLE) {
                holder.miniActive.value = true   // keep playing in the overlay
            } else {
                holder.release()
            }
            val webWasActive = latestUseWeb.value
            val dur = if (webWasActive) latestDurationMs.value else player.duration
            val posMs = if (webWasActive) webCtl.positionMs.value else player.currentPosition
            val savedIndex = latestIndex.value
            if (savedIndex < PlaySession.count && dur > 0) {
                val epNum = PlaySession.episodeNumber(savedIndex)
                val key = PlaySession.resumeKey()
                // Fire-and-forget on a background thread; the composable is gone.
                Thread {
                    kotlinx.coroutines.runBlocking {
                        val now = System.currentTimeMillis()
                        com.sanjay.anitrack.next.data.Db.save(
                            PlaySession.animeId, epNum, posMs / 1000.0, dur / 1000.0,
                            PlaySession.animeTitle, PlaySession.animeCover, key,
                            providerId = PlaySession.provider, updatedAt = now,
                        )
                        com.sanjay.anitrack.next.data.GistSync.pushProgress(
                            com.sanjay.anitrack.next.data.Db.CwRow(
                                PlaySession.animeId, epNum, posMs / 1000.0, dur / 1000.0,
                                PlaySession.animeTitle, PlaySession.animeCover, key, PlaySession.provider, now,
                            ),
                        )
                    }
                }.start()
            }
        }
    }


    Column(Modifier.fillMaxSize().background(Color.Black)) {
        // Immersive while PiP'd or locked to landscape (the old app's fullscreen).
        if (!inPipMode && !landscapeLocked) {
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
                val switchPositionMs = curPos().coerceAtLeast(0L)
                val switchWasPlaying = if (useWeb) !webCtl.paused.value else player.playWhenReady
                switching = true; switchError = null
                scope.launch {
                    val result = runCatching { PlaySession.switchProvider(target) }
                    val ok = result.getOrDefault(false)
                    result.exceptionOrNull()?.let { android.util.Log.e("AniTrackNext", "switch to $target failed", it) }
                    if (ok) {
                        pendingSwitchPositionMs = switchPositionMs
                        pendingSwitchPlayWhenReady = switchWasPlaying
                        provider = PlaySession.provider
                        index = PlaySession.index
                        retry++   // force a re-resolve even if index/provider look unchanged
                    } else {
                        val targetName = providerDescriptors.firstOrNull { it.id == target }?.name ?: target
                        switchError = when {
                            !PlaySession.canSwitchServer -> "Reopen from the show page to switch servers"
                            else -> "No $targetName source found"
                        }
                        android.util.Log.e("AniTrackNext", "switch to $target: ok=false canSwitch=${PlaySession.canSwitchServer}")
                    }
                    switching = false
                }
            }
        }

        val panel: @Composable (Modifier) -> Unit = { mod ->
            PlayerEpisodePanel(
                modifier = mod,
                provider = provider,
                providers = providerDescriptors,
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
            if (useWeb) {
                // The same WebView survives episode changes; hls.js tears down
                // only its old MediaSource and loads the new signed stream.
                val s = stream
                if (s != null) {
                    PaheWebVideo(
                        controller = webCtl,
                        url = s.url,
                        referer = s.referer,
                        userAgent = s.userAgent,
                        startMs = webResumeMs,
                        playWhenReady = webPlayWhenReady,
                        reloadToken = retry,
                        modifier = Modifier.fillMaxSize(),
                        onEnded = { if (autoNext && index + 1 < PlaySession.count) index += 1 },
                    )
                }
            } else AndroidView(
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

            PlayerGestureLayer(
                enabled = !inPipMode && error == null,
                useWeb = useWeb,
                durationMs = durationMs,
                muted = muted,
                speed = speed,
                currentPositionMs = { curPos() },
                onToggleControls = { controlsVisible = !controlsVisible },
                onSeek = { doSeek(it) },
                onTogglePlay = { doTogglePlay() },
                onPlaybackRate = { rate ->
                    if (useWeb) webCtl.setRate(rate) else player.setPlaybackSpeed(rate)
                },
                onVolume = { value ->
                    if (useWeb) webCtl.setVolume(value) else player.volume = value
                },
            )

            NativePlayerControls(
                visible = controlsVisible && !inPipMode && error == null && status.isEmpty(),
                durationMs = durationMs,
                positionMs = positionMs,
                bufferedMs = bufferedMs,
                isSeeking = isSeeking,
                seekPreviewMs = seekPreviewMs,
                useWeb = useWeb,
                index = index,
                episodeCount = PlaySession.count,
                isPlaying = isPlaying,
                muted = muted,
                hasSubtitles = stream?.subtitles?.isNotEmpty() == true,
                ccOn = ccOn,
                landscapeLocked = landscapeLocked,
                onSeekingChange = { isSeeking = it },
                onSeekPreview = { seekPreviewMs = it },
                onSeek = { doSeek(it); flashControls() },
                onPrevious = { index -= 1; flashControls() },
                onTogglePlay = { doTogglePlay(); flashControls() },
                onNext = { index += 1; flashControls() },
                onToggleMute = {
                    muted = !muted
                    if (useWeb) webCtl.setVolume(if (muted) 0f else 1f)
                    else player.volume = if (muted) 0f else 1f
                    flashControls()
                },
                onToggleSubtitles = {
                    ccOn = !ccOn
                    player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                        .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, !ccOn).build()
                    flashControls()
                },
                onToggleSettings = {
                    settingsMenu = if (settingsMenu == null) "main" else null
                    flashControls()
                },
                onPictureInPicture = {
                    try {
                        activity?.enterPictureInPictureMode(
                            PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build(),
                        )
                    } catch (_: Exception) { /* PiP unavailable */ }
                },
                onToggleFullscreen = {
                    landscapeLocked = !landscapeLocked
                    activity?.requestedOrientation =
                        if (landscapeLocked) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                        else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                },
            )

            // Desktop-style settings panel (anchored above the control bar).
            if (settingsMenu != null) {
                Box(Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 92.dp)) {
                    PlayerSettingsPanel(
                        menu = settingsMenu!!,
                        onMenu = { settingsMenu = it },
                        speed = speed,
                        onSpeed = { speed = it; if (useWeb) webCtl.setRate(it) else player.setPlaybackSpeed(it) },
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
                        doSeek(end * 1000)
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
            inPipMode || landscapeLocked -> videoArea(Modifier.weight(1f).fillMaxWidth())
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
