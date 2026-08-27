package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp

private val ControlsAccent = Color(0xFFE50914)

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
        BoxWithConstraints(
            Modifier
                .fillMaxWidth()
                .height(24.dp)
                .pointerInput(duration, useWeb) {
                    detectTapGestures { offset ->
                        onSeek((offset.x / size.width * duration).toLong().coerceIn(0, duration))
                    }
                }
                .pointerInput(duration, useWeb) {
                    detectHorizontalDragGestures(
                        onDragStart = { offset ->
                            onSeekingChange(true)
                            onSeekPreview((offset.x / size.width * duration).toLong().coerceIn(0, duration))
                        },
                        onHorizontalDrag = { change, _ ->
                            onSeekPreview((change.position.x / size.width * duration).toLong().coerceIn(0, duration))
                        },
                        onDragEnd = {
                            onSeek(seekPreviewMs)
                            onSeekingChange(false)
                        },
                    )
                },
        ) {
            val width = maxWidth
            Box(Modifier.align(Alignment.CenterStart).fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.25f)))
            Box(Modifier.align(Alignment.CenterStart).fillMaxWidth(buffered).height(3.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.4f)))
            Box(Modifier.align(Alignment.CenterStart).fillMaxWidth(progress).height(3.dp).clip(RoundedCornerShape(2.dp)).background(ControlsAccent))
            Box(
                Modifier.align(Alignment.CenterStart).offset(x = width * progress - 7.dp)
                    .size(14.dp).clip(RoundedCornerShape(50)).background(ControlsAccent),
            )
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
