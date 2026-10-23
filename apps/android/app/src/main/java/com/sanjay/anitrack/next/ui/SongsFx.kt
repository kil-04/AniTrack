package com.sanjay.anitrack.next.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.roundToInt

/*
 * The Songs page's moving parts, as on desktop (components/SongsFx.tsx): a record you spin
 * with a finger, cards that tilt under your thumb, highlights that slide between options,
 * titles that flip in letter by letter, and a roulette for Surprise me.
 */

// ── Record ──────────────────────────────────────────────────────────────────

/**
 * Turns while music plays. Drag it round to spin it by hand ([onScratch] fires as it
 * scratches); let go and it coasts back to its playing speed. A tap plays it.
 */
@Composable
internal fun SpinVinyl(cover: String?, spinning: Boolean, enabled: Boolean, onClick: () -> Unit, onScratch: () -> Unit) {
    var angle by remember { mutableFloatStateOf(0f) }
    var speed by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    val playing by rememberUpdatedState(spinning)
    val tap by rememberUpdatedState(onClick)
    val scratch by rememberUpdatedState(onScratch)
    LaunchedEffect(Unit) {
        var last = 0L
        while (isActive) {
            // Resting: no frames, so a still record costs nothing.
            if (!playing && !dragging && abs(speed) < 0.5f) { speed = 0f; last = 0L; delay(120); continue }
            withFrameMillis { now ->
                if (last != 0L && !dragging) {
                    val dt = ((now - last) / 1000f).coerceAtMost(0.05f)
                    // Coast toward 72°/s (a turn every 5 s) while playing, else to a stop.
                    speed += ((if (playing) 72f else 0f) - speed) * (dt * 1.6f).coerceAtMost(1f)
                    angle = (angle + speed * dt) % 360f
                }
                last = now
            }
        }
    }
    val arm by animateFloatAsState(if (spinning) 24f else -6f, spring(dampingRatio = 0.45f, stiffness = 120f), label = "tonearm")
    Box(Modifier.size(190.dp)) {
        Box(
            Modifier.size(170.dp).align(Alignment.BottomStart).clip(CircleShape)
                .pointerInput(enabled) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        val centre = Offset(size.width / 2f, size.height / 2f)
                        fun angleOf(p: Offset) = Math.toDegrees(atan2((p.y - centre.y).toDouble(), (p.x - centre.x).toDouble())).toFloat()
                        var lastAngle = angleOf(down.position)
                        var lastTime = down.uptimeMillis
                        var moved = 0f
                        var scratched = 0L
                        dragging = true
                        while (true) {
                            val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                            if (!change.pressed) break
                            val a = angleOf(change.position)
                            var d = a - lastAngle
                            if (d > 180) d -= 360
                            if (d < -180) d += 360
                            val dt = ((change.uptimeMillis - lastTime) / 1000f).coerceAtLeast(0.008f)
                            angle += d
                            speed = speed * 0.6f + (d / dt) * 0.4f
                            lastAngle = a
                            lastTime = change.uptimeMillis
                            moved += abs(d)
                            if (abs(d) > 3 && change.uptimeMillis - scratched > 70) { scratched = change.uptimeMillis; scratch() }
                            change.consume()
                        }
                        dragging = false
                        if (moved < 6 && enabled) tap()
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.matchParentSize().graphicsLayer { rotationZ = angle }) {
                drawCircle(Color(0xFF111111))
                var r = size.minDimension / 2 - 2f
                while (r > size.minDimension * 0.18f) { drawCircle(Color(0xFF1E1E1E), radius = r, style = Stroke(1.2f)); r -= 5f }
            }
            // The light stays put while the grooves turn under it.
            Canvas(Modifier.matchParentSize()) {
                drawArc(Color.White.copy(alpha = 0.08f), -30f, 50f, true)
                drawArc(Color.White.copy(alpha = 0.06f), 150f, 50f, true)
            }
            Box(Modifier.size(64.dp).graphicsLayer { rotationZ = angle }.clip(CircleShape).background(AniColors.Accent).border(3.dp, Color.Black.copy(alpha = 0.6f), CircleShape)) {
                cover?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
            }
            Box(Modifier.size(8.dp).clip(CircleShape).background(Color.Black))
        }
        // Tonearm: swings onto the record while it plays.
        Canvas(
            Modifier.align(Alignment.TopEnd).padding(end = 6.dp).size(width = 30.dp, height = 140.dp)
                .graphicsLayer { rotationZ = arm; transformOrigin = TransformOrigin(0.5f, 0.08f) },
        ) {
            val x = size.width / 2
            drawLine(Color(0xFFB8B8B8), Offset(x, 10f), Offset(x, size.height - 18f), strokeWidth = 7f)
            drawRoundRect(Color(0xFFE4E4E4), topLeft = Offset(x - 9f, size.height - 26f), size = androidx.compose.ui.geometry.Size(18f, 26f))
            drawCircle(Color(0xFF3F3F46), radius = 16f, center = Offset(x, 10f))
            drawCircle(Color.White.copy(alpha = 0.4f), radius = 16f, center = Offset(x, 10f), style = Stroke(3f))
        }
    }
}

/** A soft glow that pulses while music plays (behind the record). */
@Composable
internal fun BeatGlow(modifier: Modifier) {
    val beat = rememberInfiniteTransition(label = "beat")
    val level by beat.animateFloat(0f, 1f, infiniteRepeatable(tween(550), RepeatMode.Reverse), label = "level")
    Box(
        modifier.graphicsLayer { alpha = 0.25f + level * 0.4f; scaleX = 0.96f + level * 0.09f; scaleY = 0.96f + level * 0.09f }
            .blur(60.dp).clip(CircleShape).background(AniColors.Accent.copy(alpha = 0.5f)),
    )
}

// ── Tilt ────────────────────────────────────────────────────────────────────

/** Leans toward the finger while pressed, without taking the tap away from the card. */
internal fun Modifier.pressTilt(max: Float = 9f): Modifier = composed {
    var rx by remember { mutableFloatStateOf(0f) }
    var ry by remember { mutableFloatStateOf(0f) }
    val ax by animateFloatAsState(rx, spring(dampingRatio = 0.6f, stiffness = 400f), label = "tilt-x")
    val ay by animateFloatAsState(ry, spring(dampingRatio = 0.6f, stiffness = 400f), label = "tilt-y")
    pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            fun lean(p: Offset) {
                rx = (0.5f - p.y / size.height) * max * 2
                ry = (p.x / size.width - 0.5f) * max * 2
            }
            lean(down.position)
            while (true) {
                val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id } ?: break
                if (!change.pressed) break
                lean(change.position)
            }
            rx = 0f
            ry = 0f
        }
    }.graphicsLayer { rotationX = ax; rotationY = ay; cameraDistance = 14 * density }
}

// ── Sliding highlight ───────────────────────────────────────────────────────

/** A row of options whose highlight springs across to the chosen one. */
@Composable
internal fun <T> SlidingRow(
    options: List<T>, selected: T, onSelect: (T) -> Unit, pill: Color, modifier: Modifier = Modifier,
    content: @Composable (option: T, chosen: Boolean) -> Unit,
) {
    val bounds = remember { mutableStateMapOf<T, Pair<Float, Float>>() }
    val target = bounds[selected]
    val x by animateFloatAsState(target?.first ?: 0f, spring(dampingRatio = 0.68f, stiffness = 420f), label = "pill-x")
    val w by animateFloatAsState(target?.second ?: 0f, spring(dampingRatio = 0.68f, stiffness = 420f), label = "pill-w")
    val density = LocalDensity.current
    Box(modifier) {
        if (target != null) {
            Box(Modifier.matchParentSize()) {
                Box(Modifier.offset { IntOffset(x.roundToInt(), 0) }.width(with(density) { w.toDp() }).fillMaxHeight().clip(CircleShape).background(pill))
            }
        }
        Row {
            options.forEach { option ->
                Box(
                    Modifier.onGloballyPositioned { bounds[option] = it.positionInParent().x to it.size.width.toFloat() }
                        .clip(CircleShape).clickable { onSelect(option) },
                ) { content(option, option == selected) }
            }
        }
    }
}

// ── Flip title ──────────────────────────────────────────────────────────────

/** Each letter flips in, one after another, whenever the text changes. */
@Composable
internal fun FlipTitle(text: String, style: TextStyle) {
    Row {
        text.forEachIndexed { i, ch ->
            key(text, i) {
                val turn = remember { Animatable(-90f) }
                LaunchedEffect(Unit) {
                    delay(i * 40L)
                    turn.animateTo(0f, spring(dampingRatio = 0.55f, stiffness = 300f))
                }
                Text(
                    ch.toString(), style = style,
                    modifier = Modifier.graphicsLayer {
                        rotationX = turn.value
                        alpha = (1f - abs(turn.value) / 90f).coerceIn(0f, 1f)
                        cameraDistance = 10 * density
                    },
                )
            }
        }
    }
}

// ── Roulette ────────────────────────────────────────────────────────────────

/**
 * Surprise me: covers whirl past, slow down and stop on the chosen song ([onTick] as each
 * passes the marker); then [onDone] plays it. Tap outside to cancel.
 */
@Composable
internal fun RouletteDialog(items: List<Pair<String?, String>>, target: Int, onTick: () -> Unit, onDone: () -> Unit, onClose: () -> Unit) {
    val reel = remember { List(34) { items.random() } + items[target] + List(5) { items.random() } }
    val stop = 34
    val cardWidth = 150.dp
    val gap = 14.dp
    val step = with(LocalDensity.current) { (cardWidth + gap).toPx() }
    val cardPx = with(LocalDensity.current) { cardWidth.toPx() }
    val offset = remember { Animatable(0f) }
    var landed by remember { mutableStateOf(false) }
    val pop by animateFloatAsState(if (landed) 1.12f else 1f, spring(dampingRatio = 0.4f, stiffness = 300f), label = "winner")
    val tick by rememberUpdatedState(onTick)
    val done by rememberUpdatedState(onDone)
    LaunchedEffect(Unit) {
        launch {
            var last = -1
            snapshotFlow { (offset.value / step).toInt() }.collect { if (it != last) { last = it; tick() } }
        }
        offset.animateTo(stop * step, tween(3200, easing = CubicBezierEasing(0.12f, 0.72f, 0.12f, 1f)))
        landed = true
        delay(750)
        done()
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.88f)).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
            val width = constraints.maxWidth
            val centre = width / 2f
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("SPINNING THE JUKEBOX…", color = AniColors.Accent, fontWeight = FontWeight.Black, fontSize = 12.sp, letterSpacing = 3.sp)
                Spacer(Modifier.height(20.dp))
                Box(Modifier.fillMaxWidth().height(240.dp).clipToBounds()) {
                    reel.forEachIndexed { i, (cover, title) ->
                        val x = centre - cardPx / 2 + i * step - offset.value
                        if (x < -cardPx || x > width) return@forEachIndexed
                        Box(
                            Modifier.offset { IntOffset(x.roundToInt(), 10) }.size(cardWidth, 216.dp)
                                .graphicsLayer { if (i == stop) { scaleX = pop; scaleY = pop } }
                                .clip(RoundedCornerShape(18.dp)).background(AniColors.SurfaceHigh),
                        ) {
                            if (cover != null) AsyncImage(cover, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
                            else Icon(Icons.Rounded.Album, null, tint = AniColors.TextTertiary, modifier = Modifier.align(Alignment.Center).size(48.dp))
                            Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Transparent, Color.Black))))
                            Text(title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.align(Alignment.BottomStart).padding(10.dp))
                        }
                    }
                    // Marker
                    Box(Modifier.align(Alignment.Center).width(4.dp).fillMaxHeight().clip(CircleShape).background(Color(0xFFFCD34D)))
                }
                Spacer(Modifier.height(20.dp))
                Text(reel[stop].second, color = Color.White.copy(alpha = if (landed) 1f else 0f), fontWeight = FontWeight.Black, fontSize = 22.sp)
            }
        }
    }
}
