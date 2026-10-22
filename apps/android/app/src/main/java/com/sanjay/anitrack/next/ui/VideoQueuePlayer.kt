package com.sanjay.anitrack.next.ui

import android.content.Context
import android.view.SoundEffectConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.FullscreenExit
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.positionChange
import kotlin.math.abs
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.AcUnit
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Casino
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Eco
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.LocalFlorist
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.OndemandVideo
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.AniSong
import com.sanjay.anitrack.next.data.AniSongs
import com.sanjay.anitrack.next.data.BackgroundMusic
import com.sanjay.anitrack.next.data.PlayerHolder
import com.sanjay.anitrack.next.data.SongCharts
import com.sanjay.anitrack.next.data.ThemePlayer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/*
 * The video player shared by the Songs page and title pages' theme songs: one ExoPlayer for a
 * queue of videos, docked beside the page (SongSidePlayer) or full screen (SongFullPlayer).
 * Swipe the video sideways for the next or previous one.
 */

/** One video in the queue. */
internal data class VideoItem(
    val key: String,
    val title: String,
    /** "Artist · Show · OP1 · 1998" */
    val byline: String,
    val cover: String?,
    val url: String,
)

internal data class VideoQueue(val items: List<VideoItem>, val index: Int, val label: String)

// ── Player ────────────────────────────────────────────────────────────────

/** A queue of songs' videos on one ExoPlayer, shared by the side panel and full screen. */
internal class SongVideo(val queue: VideoQueue, val exo: ExoPlayer) {
    var index by mutableIntStateOf(queue.index)
    /** 1 when the last change went forward, -1 back: which side the new title slides in from. */
    var direction by mutableIntStateOf(1)
    val item get() = queue.items[index]
    val size get() = queue.items.size

    fun jump(to: Int, step: Int = 1) {
        direction = step
        if (exo.playerError != null) exo.prepare()
        exo.seekTo(Math.floorMod(to, size), 0L)
        exo.play()
    }
    fun go(step: Int) = jump(index + step, step)
    fun upNext(count: Int) = (1..minOf(count, size - 1)).map { Math.floorMod(index + it, size) }
}

@Composable
internal fun rememberSongVideo(queue: VideoQueue): SongVideo {
    val context = LocalContext.current
    val video = remember(queue) {
        val exo = ExoPlayer.Builder(context).build().apply {
            setMediaItems(queue.items.map { MediaItem.fromUri(it.url) }, queue.index, 0L)
            repeatMode = Player.REPEAT_MODE_ALL
            prepare()
            playWhenReady = true
        }
        SongVideo(queue, exo)
    }
    DisposableEffect(video) {
        val exo = video.exo
        ThemePlayer.pause()
        PlayerHolder.peek()?.pause()
        BackgroundMusic.setHold(BackgroundMusic.Hold.VIDEO, true)
        var failures = 0
        val listener = object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_SEEK) video.direction = 1
                video.index = exo.currentMediaItemIndex
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { if (isPlaying) failures = 0 }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                // A missing clip shouldn't stop the channel (unless none of them play).
                if (++failures < video.size) video.go(1)
            }
        }
        exo.addListener(listener)
        onDispose {
            exo.removeListener(listener)
            exo.release()
            BackgroundMusic.setHold(BackgroundMusic.Hold.VIDEO, false)
        }
    }
    return video
}

/**
 * Sideways drags over the video: [onDrag] follows the finger and a long enough one calls
 * [onSwipe] with 1 (next, dragged left) or -1. Watches the Initial pass so it sees the touch
 * before the PlayerView does, and only takes it once the drag is clearly sideways. The bottom
 * strip is left to the seek bar.
 */
private fun Modifier.songSwipe(onDrag: (Float) -> Unit, onSwipe: (Int) -> Unit) = pointerInput(Unit) {
    val threshold = 110.dp.toPx()
    val controls = 72.dp.toPx()
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        if (down.position.y > size.height - controls) return@awaitEachGesture
        var dx = 0f
        var dy = 0f
        var dragging = false
        while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val change = event.changes.firstOrNull { it.id == down.id } ?: break
            if (!change.pressed) break
            val delta = change.positionChange()
            dx += delta.x
            dy += delta.y
            if (!dragging && abs(dx) > viewConfiguration.touchSlop && abs(dx) > abs(dy) * 1.5f) dragging = true
            if (dragging) { change.consume(); onDrag(dx) }
        }
        if (dragging) {
            if (abs(dx) > threshold) onSwipe(if (dx < 0) 1 else -1)
            onDrag(0f)
        }
    }
}

/** The video with swipe, follow-the-finger motion and Next/Previous hints. */
@Composable
private fun SongVideoSurface(video: SongVideo, modifier: Modifier, onSwipe: (Int) -> Unit) {
    var drag by remember { mutableFloatStateOf(0f) }
    val shown by animateFloatAsState(drag, if (drag == 0f) spring(stiffness = Spring.StiffnessMediumLow) else snap(), label = "drag")
    Box(modifier.background(Color.Black).songSwipe(onDrag = { drag = it }, onSwipe = onSwipe)) {
        AndroidView(
            factory = { PlayerView(it).apply { player = video.exo; useController = true; setShowShuffleButton(false) } },
            update = { if (it.player !== video.exo) it.player = video.exo },
            onRelease = { it.player = null },
            modifier = Modifier.fillMaxSize().graphicsLayer {
                translationX = shown * 0.6f
                rotationZ = shown * 0.004f
                alpha = (1f - abs(shown) / 900f).coerceIn(0.4f, 1f)
            },
        )
        if (abs(drag) > 60f) {
            Text(
                if (drag < 0) "Next ›" else "‹ Previous",
                color = Color.White, fontWeight = FontWeight.Black, fontSize = 13.sp,
                modifier = Modifier.align(if (drag < 0) Alignment.CenterEnd else Alignment.CenterStart).padding(16.dp)
                    .clip(CircleShape).background(AniColors.Accent).padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
    }
}

/** What's playing, sliding in from the side the new song came from. */
@Composable
private fun NowPlaying(video: SongVideo, big: Boolean, modifier: Modifier = Modifier) {
    AnimatedContent(
        targetState = video.index,
        transitionSpec = {
            val from = if (video.direction > 0) 1 else -1
            (slideInHorizontally(tween(320)) { it / 4 * from } + fadeIn(tween(320)))
                .togetherWith(slideOutHorizontally(tween(220)) { -it / 4 * from } + fadeOut(tween(200)))
        },
        modifier = modifier,
        label = "now-playing",
    ) { at ->
        val song = video.queue.items[at]
        Column {
            Text("${video.queue.label} · ${at + 1} of ${video.size}", color = AniColors.AccentBright, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(song.title, color = Color.White, fontSize = if (big) 22.sp else 18.sp, fontWeight = FontWeight.Black, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                song.byline,
                color = Color.White.copy(alpha = 0.65f), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Docked at the right of the page: the video, its controls and what's up next. */
@Composable
internal fun SongSidePlayer(video: SongVideo, onFull: () -> Unit, onClose: () -> Unit, onStep: (Int) -> Unit, onJump: (Int) -> Unit) {
    Column(
        // Starts below the app's floating Music button.
        Modifier.width(400.dp).fillMaxHeight().padding(end = 16.dp, top = 64.dp, bottom = 16.dp)
            .clip(RoundedCornerShape(22.dp)).border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(22.dp)).background(AniColors.Surface),
    ) {
        Row(Modifier.padding(start = 16.dp, end = 10.dp, top = 14.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
            NowPlaying(video, big = false, modifier = Modifier.weight(1f))
            IconButton(onClick = onFull) { Icon(Icons.Rounded.Fullscreen, "Full screen", tint = Color.White) }
            IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Close", tint = Color.White) }
        }
        SongVideoSurface(video, Modifier.fillMaxWidth().aspectRatio(16f / 9f), onSwipe = onStep)
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            FilledTonalButton(onClick = { onStep(-1) }, modifier = Modifier.weight(1f)) { Icon(Icons.Rounded.SkipPrevious, null); Spacer(Modifier.width(4.dp)); Text("Previous") }
            Button(onClick = { onStep(1) }, modifier = Modifier.weight(1f)) { Text("Next"); Spacer(Modifier.width(4.dp)); Icon(Icons.Rounded.SkipNext, null) }
        }
        Text("UP NEXT", color = AniColors.TextTertiary, fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 1.5.sp, modifier = Modifier.padding(start = 16.dp, top = 6.dp, bottom = 4.dp))
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(start = 8.dp, end = 8.dp, bottom = 8.dp)) {
            items(video.upNext(20), key = { video.queue.items[it].key }) { at ->
                val next = video.queue.items[at]
                Row(
                    Modifier.animateItem().fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { onJump(at) }.padding(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(46.dp).clip(RoundedCornerShape(10.dp)).background(AniColors.SurfaceHighest), contentAlignment = Alignment.Center) {
                        if (next.cover != null) AsyncImage(next.cover, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
                        else Icon(Icons.Rounded.Album, null, tint = AniColors.TextTertiary)
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(next.title, color = AniColors.Text, fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(next.byline, color = AniColors.TextSecondary, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        Text("Swipe the video sideways for the next song", color = AniColors.TextTertiary, fontSize = 10.sp, modifier = Modifier.padding(start = 16.dp, bottom = 10.dp))
    }
}

/** Full screen. [onDock] is null where there's no room for the side panel (phones). */
@Composable
internal fun SongFullPlayer(video: SongVideo, onDock: (() -> Unit)?, onClose: () -> Unit, onStep: (Int) -> Unit, onJump: (Int) -> Unit) {
    Dialog(onDismissRequest = onDock ?: onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            SongVideoSurface(video, Modifier.fillMaxSize(), onSwipe = onStep)
            NowPlaying(video, big = true, modifier = Modifier.align(Alignment.TopStart).padding(20.dp).fillMaxWidth(0.6f))
            Column(Modifier.align(Alignment.TopEnd).padding(16.dp), horizontalAlignment = Alignment.End) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    GlassIconButton(Icons.Rounded.SkipPrevious, "Previous", { onStep(-1) }, size = 40.dp)
                    GlassIconButton(Icons.Rounded.SkipNext, "Next", { onStep(1) }, size = 40.dp)
                    if (onDock != null) GlassIconButton(Icons.Rounded.FullscreenExit, "Side player", onDock, size = 40.dp)
                    GlassIconButton(Icons.Rounded.Close, "Close", onClose, size = 40.dp)
                }
                // Up next, one tap away.
                video.upNext(1).firstOrNull()?.let { at ->
                    val next = video.queue.items[at]
                    AnimatedContent(next, label = "up-next", transitionSpec = { (fadeIn() + slideInVertically { -it / 2 }).togetherWith(fadeOut()) }) { song ->
                        Row(
                            Modifier.padding(top = 12.dp).widthIn(max = 320.dp).clip(RoundedCornerShape(14.dp)).background(Color.Black.copy(alpha = 0.55f))
                                .clickable { onJump(at) }.padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (song.cover != null) AsyncImage(song.cover, null, contentScale = ContentScale.Crop, modifier = Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)))
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f, fill = false)) {
                                Text("UP NEXT", color = AniColors.AccentBright, fontSize = 10.sp, fontWeight = FontWeight.Black, letterSpacing = 1.sp)
                                Text(song.title, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
}
