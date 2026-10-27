package com.sanjay.anitrack.next.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.BackgroundMusic
import com.sanjay.anitrack.next.data.CityPopArchiveTrack
import com.sanjay.anitrack.next.data.PlayerHolder
import com.sanjay.anitrack.next.data.ThemePlayer
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** 225000 → "3:45". */
private fun clock(ms: Long): String = (ms.coerceAtLeast(0) / 1000).let { "${it / 60}:${(it % 60).toString().padStart(2, '0')}" }

/**
 * An album from [start], as on desktop's player window: the record with the album's cover turns
 * while a song plays, with its time and Previous / Play / Next; a video shows the picture and its
 * own controls. Files saved offline arrive as file:// [uris].
 */
@Composable
internal fun CityPopArchivePlayer(tracks: List<CityPopArchiveTrack>, uris: List<String>, start: Int, cover: String?, onClose: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var index by remember { mutableIntStateOf(start) }
    var problem by remember { mutableStateOf<String?>(null) }
    var finished by remember { mutableStateOf(false) }
    val player = remember(tracks, uris, start) {
        ThemePlayer.pause()
        PlayerHolder.peek()?.pause()
        BackgroundMusic.setHold(BackgroundMusic.Hold.VIDEO, true)
        ExoPlayer.Builder(context).setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true).build().apply {
                setMediaItems(tracks.mapIndexed { i, track -> MediaItem.Builder().setUri(uris[i]).setMediaMetadata(MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist).build()).build() }, start, 0L)
                prepare(); playWhenReady = true
            }
    }
    var playing by remember { mutableStateOf(false) }
    var position by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var seeking by remember { mutableStateOf<Float?>(null) }
    DisposableEffect(player, lifecycle) {
        val listener = object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) { index = player.currentMediaItemIndex; problem = null; finished = false }
            override fun onPlayerError(error: PlaybackException) { problem = "This file could not play. Try Next or open it on Internet Archive." }
            override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) finished = true }
            override fun onIsPlayingChanged(isPlaying: Boolean) { playing = isPlaying; if (isPlaying) finished = false }
        }
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) player.pause() }
        player.addListener(listener); lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); player.removeListener(listener); player.release(); BackgroundMusic.setHold(BackgroundMusic.Hold.VIDEO, false) }
    }
    LaunchedEffect(player) {
        while (isActive) {
            position = player.currentPosition
            duration = player.duration.takeIf { it > 0 } ?: 0L
            delay(250)
        }
    }
    val track = tracks.getOrNull(index) ?: tracks.first()
    val video = track.mediaType == "video"
    val offline = uris.getOrNull(index)?.startsWith("file:") == true
    val configuration = LocalConfiguration.current
    // No taller than a 16:9 video at the dialog's width, so a phone held upright keeps the controls in view.
    val videoWidth = (configuration.screenWidthDp * 0.94f).coerceAtMost(1050f) - 36f
    val videoHeight = minOf(configuration.screenHeightDp * 0.55f, videoWidth * 9f / 16f).dp.coerceIn(160.dp, 520.dp)
    fun step(by: Int) {
        val at = index + by
        if (at !in tracks.indices) return
        player.seekTo(at, 0L); player.prepare(); player.play()
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.widthIn(max = if (video) 1050.dp else 560.dp).fillMaxWidth(0.94f)
                .heightIn(max = (configuration.screenHeightDp - 32).coerceAtLeast(240).dp)
                .pixelPanel(CityPopColors.Panel, CityPopColors.Pink, Color(0xFF3D0A2C), 6.dp)
                .verticalScroll(rememberScrollState()).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    PixelText("City Pop · ${if (video) "Watch" else "Listen"}", CityPopColors.Pink, 10.sp, maxLines = 1)
                    Text(track.title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                    Text(track.artist.ifBlank { "Internet Archive" }, color = Color.White.copy(alpha = 0.6f), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Close player", tint = Color.White) }
            }
            if (video) {
                AndroidView(
                    factory = { ctx -> PlayerView(ctx).apply { this.player = player; useController = true; controllerShowTimeoutMs = 5000 } },
                    modifier = Modifier.fillMaxWidth().height(videoHeight),
                    update = { it.player = player }, onRelease = { it.player = null },
                )
            } else {
                CityPopSpinningRecord(cover, playing, 190.dp, Modifier.align(Alignment.CenterHorizontally).padding(vertical = 6.dp))
                Column {
                    val fraction = if (duration > 0) (position.toFloat() / duration).coerceIn(0f, 1f) else 0f
                    Slider(
                        value = seeking ?: fraction,
                        onValueChange = { seeking = it },
                        onValueChangeFinished = { seeking?.let { player.seekTo((it * duration).toLong()) }; seeking = null },
                        enabled = duration > 0,
                        colors = SliderDefaults.colors(thumbColor = CityPopColors.Pink, activeTrackColor = CityPopColors.Pink, inactiveTrackColor = CityPopColors.Line),
                    )
                    Row {
                        PixelText(clock(seeking?.let { (it * duration).toLong() } ?: position), CityPopColors.Teal, 10.sp)
                        Spacer(Modifier.weight(1f))
                        PixelText(if (duration > 0) clock(duration) else "–:––", CityPopColors.Teal, 10.sp)
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                if (tracks.size > 1) CityPopButton("Previous", { step(-1) }, icon = Icons.Rounded.SkipPrevious, style = CityPopButtonStyle.Ghost, enabled = index > 0)
                if (!video) Box(
                    Modifier.size(54.dp).pixelPanel(CityPopColors.Pink, CityPopColors.PinkPale, CityPopColors.PinkShadow)
                        .clickable {
                            if (player.isPlaying) player.pause()
                            else { if (player.playbackState == Player.STATE_ENDED) player.seekTo(0L); player.play() }
                        },
                    contentAlignment = Alignment.Center,
                ) { Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Pause" else "Play", tint = CityPopColors.Ink, modifier = Modifier.size(28.dp)) }
                if (tracks.size > 1) CityPopButton("Next", { step(1) }, icon = Icons.Rounded.SkipNext, style = CityPopButtonStyle.Ghost, enabled = index + 1 < tracks.size)
            }
            if (tracks.size > 1) PixelText("${index + 1} / ${tracks.size}", CityPopColors.Yellow, 11.sp, Modifier.fillMaxWidth(), align = TextAlign.Center)
            problem?.let { Text(it, color = Color(0xFFFFB3B3), fontSize = 13.sp) }
            if (finished && problem == null) Text(if (index + 1 >= tracks.size && tracks.size > 1) "Album finished." else "Finished.", color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp)
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(if (offline) "Saved on this device · Available offline." else "Full media from Internet Archive.", color = Color.White.copy(alpha = 0.55f), fontSize = 12.sp, modifier = Modifier.padding(vertical = 10.dp))
                TextButton(onClick = {
                    player.pause()
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://archive.org/details/${Uri.encode(track.itemId)}"))) }
                }) { Text("Open on Internet Archive", color = Color(0xFF7FE1DB)) }
            }
        }
    }
}

/** The pack's record with the album's cover for a label, turning while it plays (as on the Songs page). */
@Composable
private fun CityPopSpinningRecord(cover: String?, spinning: Boolean, size: Dp, modifier: Modifier = Modifier) {
    val angle = remember { Animatable(0f) }
    LaunchedEffect(spinning) {
        while (spinning && isActive) angle.animateTo(angle.value + 360f, tween(6000, easing = LinearEasing))
    }
    Box(modifier.size(size).rotate(angle.value % 360f), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            drawCircle(Color(0xFF17161E))
            var r = this.size.minDimension / 2 - 18.dp.toPx()
            while (r > this.size.minDimension * 0.24f) { drawCircle(Color(0xFF35303F), radius = r, style = Stroke(1.dp.toPx())); r -= 4.dp.toPx() }
        }
        Box(Modifier.size(size * 0.44f).clip(CircleShape).background(CityPopColors.Peach), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.MusicNote, null, tint = CityPopColors.LabelInk, modifier = Modifier.size(28.dp))
            if (cover != null) AsyncImage(cover, null, Modifier.matchParentSize(), contentScale = ContentScale.Crop)
        }
        Box(Modifier.size(8.dp).clip(CircleShape).background(Color(0xFF17161E)))
    }
}
