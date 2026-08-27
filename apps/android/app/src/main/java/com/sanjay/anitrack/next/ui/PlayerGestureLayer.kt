package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Composable
internal fun PlayerGestureLayer(
    enabled: Boolean,
    useWeb: Boolean,
    durationMs: Long,
    muted: Boolean,
    speed: Float,
    currentPositionMs: () -> Long,
    onToggleControls: () -> Unit,
    onSeek: (Long) -> Unit,
    onTogglePlay: () -> Unit,
    onPlaybackRate: (Float) -> Unit,
    onVolume: (Float) -> Unit,
) {
    var seekFeedback by remember { mutableStateOf<Pair<Boolean, Int>?>(null) }
    var speedActive by remember { mutableStateOf(false) }
    var volumeFeedback by remember { mutableStateOf<Float?>(null) }
    var chainSecs by remember { mutableStateOf(0) }
    var chainForward by remember { mutableStateOf(true) }
    var chainTargetMs by remember { mutableStateOf<Long?>(null) }

    LaunchedEffect(seekFeedback) {
        if (seekFeedback != null) {
            delay(700)
            seekFeedback = null
            chainSecs = 0
            chainTargetMs = null
        }
    }

    Box(Modifier.fillMaxSize()) {
        if (enabled) {
            Box(
                Modifier.fillMaxSize()
                    .pointerInput(useWeb) {
                        detectTapGestures(
                            onTap = { onToggleControls() },
                            onDoubleTap = { offset ->
                                when {
                                    offset.x < size.width * 0.35f -> {
                                        if (chainForward || chainSecs == 0) {
                                            chainSecs = 0
                                            chainTargetMs = currentPositionMs()
                                        }
                                        chainForward = false
                                        chainSecs += 10
                                        val target = ((chainTargetMs ?: currentPositionMs()) - 10_000).coerceAtLeast(0)
                                        chainTargetMs = target
                                        onSeek(target)
                                        seekFeedback = false to chainSecs
                                    }
                                    offset.x > size.width * 0.65f -> {
                                        if (!chainForward || chainSecs == 0) {
                                            chainSecs = 0
                                            chainTargetMs = currentPositionMs()
                                        }
                                        chainForward = true
                                        chainSecs += 10
                                        val maximum = durationMs.takeIf { it > 0 } ?: Long.MAX_VALUE
                                        val target = ((chainTargetMs ?: currentPositionMs()) + 10_000).coerceAtMost(maximum)
                                        chainTargetMs = target
                                        onSeek(target)
                                        seekFeedback = true to chainSecs
                                    }
                                    else -> onTogglePlay()
                                }
                            },
                            onLongPress = {
                                speedActive = true
                                onPlaybackRate(2f)
                            },
                            onPress = {
                                tryAwaitRelease()
                                if (speedActive) {
                                    speedActive = false
                                    onPlaybackRate(speed)
                                }
                            },
                        )
                    }
                    .pointerInput(useWeb) {
                        detectDragGestures(
                            onDragEnd = { volumeFeedback = null },
                            onDrag = { change, drag ->
                                if (change.position.x > size.width / 2) {
                                    val value = ((if (muted) 0f else 1f) + (-drag.y / size.height * 1.4f))
                                        .coerceIn(0f, 1f)
                                    onVolume(value)
                                    volumeFeedback = value
                                }
                            },
                        )
                    },
            )
        }

        seekFeedback?.let { (forward, seconds) ->
            Box(
                Modifier.align(if (forward) Alignment.CenterEnd else Alignment.CenterStart)
                    .padding(horizontal = 48.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color.Black.copy(alpha = 0.6f))
                    .padding(horizontal = 20.dp, vertical = 12.dp),
            ) {
                Text(if (forward) "+${seconds}s" else "−${seconds}s", color = Color.White, style = MaterialTheme.typography.titleMedium)
            }
        }
        if (speedActive) {
            Box(
                Modifier.align(Alignment.TopCenter).padding(top = 24.dp)
                    .clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.6f))
                    .padding(horizontal = 16.dp, vertical = 6.dp),
            ) { Text("2× ▶▶", color = Color.White, style = MaterialTheme.typography.labelLarge) }
        }
        volumeFeedback?.let { value ->
            Box(
                Modifier.align(Alignment.Center)
                    .clip(RoundedCornerShape(16.dp)).background(Color.Black.copy(alpha = 0.6f))
                    .padding(horizontal = 18.dp, vertical = 10.dp),
            ) { Text("Vol ${(value * 100).toInt()}%", color = Color.White, style = MaterialTheme.typography.labelLarge) }
        }
    }
}
