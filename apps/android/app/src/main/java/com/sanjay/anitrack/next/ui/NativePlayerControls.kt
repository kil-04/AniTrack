package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp

private val ControlsAccent: Color get() = AniColors.Accent

@Composable
internal fun NativePlayerControls(
    modifier: Modifier = Modifier,
    visible: Boolean,
    durationMs: Long,
    positionMs: Long,
    bufferedMs: Long,
    isSeeking: Boolean,
    seekPreviewMs: Long,
    useWeb: Boolean,
    index: Int,
    episodeCount: Int,
    isPlaying: Boolean,
    muted: Boolean,
    hasSubtitles: Boolean,
    ccOn: Boolean,
    landscapeLocked: Boolean,
    onSeekingChange: (Boolean) -> Unit,
    onSeekPreview: (Long) -> Unit,
    onSeek: (Long) -> Unit,
    onPrevious: () -> Unit,
    onTogglePlay: () -> Unit,
    onNext: () -> Unit,
    onToggleMute: () -> Unit,
    onToggleSubtitles: () -> Unit,
    onToggleSettings: () -> Unit,
    onPictureInPicture: () -> Unit,
    onToggleFullscreen: () -> Unit,
) {
    if (!visible) return

    Column(
        modifier
            .fillMaxWidth()
            .background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f)),
                ),
            )
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        val duration = durationMs.coerceAtLeast(1L)
        val shown = if (isSeeking) seekPreviewMs else positionMs
        val progress = (shown.toFloat() / duration).coerceIn(0f, 1f)
        val buffered = (bufferedMs.toFloat() / duration).coerceIn(0f, 1f)
        // The gesture handlers outlive recompositions, so they read the latest callbacks.
        val seekTo by rememberUpdatedState(onSeek)
        val preview by rememberUpdatedState(onSeekPreview)
        val seeking by rememberUpdatedState(onSeekingChange)
        BoxWithConstraints(
            Modifier
                .fillMaxWidth()
                .height(36.dp) // A finger-sized target; the bar itself stays thin.
                .pointerInput(duration, useWeb) {
                    detectTapGestures { offset ->
                        seekTo((offset.x / size.width * duration).toLong().coerceIn(0, duration))
                    }
                }
                .pointerInput(duration, useWeb) {
                    // The drag target lives here. The seekPreviewMs parameter is the value from
                    // when this handler started, so releasing used to seek back to that.
                    var target = 0L
                    fun at(x: Float) = (x / size.width * duration).toLong().coerceIn(0, duration)
                    detectHorizontalDragGestures(
                        onDragStart = { offset ->
                            target = at(offset.x)
                            seeking(true)
                            preview(target)
                        },
                        onHorizontalDrag = { change, _ ->
                            change.consume()
                            target = at(change.position.x)
                            preview(target)
                        },
                        onDragEnd = {
                            seekTo(target)
                            seeking(false)
                        },
                        onDragCancel = { seeking(false) },
                    )
                },
        ) {
            val width = maxWidth
            val bar = if (isSeeking) 5.dp else 3.dp
            Box(Modifier.align(Alignment.CenterStart).fillMaxWidth().height(bar).clip(aniShape(2.dp)).background(Color.White.copy(alpha = 0.25f)))
            Box(Modifier.align(Alignment.CenterStart).fillMaxWidth(buffered).height(bar).clip(aniShape(2.dp)).background(Color.White.copy(alpha = 0.4f)))
            Box(Modifier.align(Alignment.CenterStart).fillMaxWidth(progress).height(bar).clip(aniShape(2.dp)).background(ControlsAccent))
            val thumb = if (isSeeking) 20.dp else 14.dp
            Box(
                Modifier.align(Alignment.CenterStart).offset(x = width * progress - thumb / 2)
                    .size(thumb).clip(aniShape(50)).background(ControlsAccent),
            )
            if (isSeeking) {
                // Where the drag will land, above the thumb.
                Text(
                    formatPlayerTime(seekPreviewMs),
                    color = Color.White,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.align(Alignment.TopStart)
                        .offset(x = (width * progress - 32.dp).coerceIn(0.dp, (width - 64.dp).coerceAtLeast(0.dp)), y = (-30).dp)
                        .width(64.dp)
                        .clip(aniShape(8.dp))
                        .background(Color.Black.copy(alpha = 0.8f))
                        .padding(vertical = 4.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onPrevious, enabled = index > 0) {
                Icon(Icons.Filled.SkipPrevious, "Previous", tint = Color.White)
            }
            IconButton(onClick = onTogglePlay) {
                Icon(
                    if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    "Play/Pause",
                    tint = Color.White,
                    modifier = Modifier.size(30.dp),
                )
            }
            IconButton(onClick = onNext, enabled = index + 1 < episodeCount) {
                Icon(Icons.Filled.SkipNext, "Next", tint = Color.White)
            }
            IconButton(onClick = onToggleMute) {
                Icon(
                    if (muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp,
                    "Mute",
                    tint = Color.White,
                )
            }
            Text(
                "${formatPlayerTime(shown)} / ${formatPlayerTime(durationMs)}",
                style = MaterialTheme.typography.labelMedium,
                color = Color.White.copy(alpha = 0.85f),
            )
            Spacer(Modifier.weight(1f))
            if (hasSubtitles) {
                IconButton(onClick = onToggleSubtitles) {
                    Icon(
                        if (ccOn) Icons.Filled.ClosedCaption else Icons.Filled.ClosedCaptionOff,
                        "Subtitles",
                        tint = Color.White,
                    )
                }
            }
            IconButton(onClick = onToggleSettings) {
                Icon(Icons.Filled.Settings, "Settings", tint = Color.White)
            }
            IconButton(onClick = onPictureInPicture) {
                Icon(Icons.Filled.PictureInPictureAlt, "PiP", tint = Color.White)
            }
            IconButton(onClick = onToggleFullscreen) {
                Icon(
                    if (landscapeLocked) Icons.Filled.FullscreenExit else Icons.Filled.Fullscreen,
                    "Fullscreen",
                    tint = Color.White,
                )
            }
        }
    }
}
