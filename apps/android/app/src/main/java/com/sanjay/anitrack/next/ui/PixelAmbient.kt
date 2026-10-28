package com.sanjay.anitrack.next.ui

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.sanjay.anitrack.next.data.CityPopScene
import com.sanjay.anitrack.next.data.PixelScenes
import com.sanjay.anitrack.next.data.PixelSprites
import kotlinx.coroutines.delay
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Android's "Remove animations" (animator duration scale 0) keeps the night still. */
private fun animatorsOn(context: Context): Boolean =
    runCatching { android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) }
        .getOrDefault(1f) != 0f

/** Whether Pixel mode may move: its Animated background setting, and Android's animations on. */
@Composable
internal fun pixelMotion(): Boolean {
    val context = LocalContext.current
    return AniColors.pixelMotion.value && remember { animatorsOn(context) }
}

/**
 * Pixel mode's one clock, in tenths of a second, advanced by [PixelAmbient] while Pixel mode may
 * move and the app is in view. Every animation reads it while drawing or placing a layer (never
 * while composing), so a tick redraws only what moved, and everything moves in the same frame. It
 * ticks every 150 ms while something is moving (rain and rolling bars in the blue palette, the cat
 * crossing, a shooting star) and every 700 ms otherwise, so a quiet screen costs little.
 */
object PixelTime {
    val tick = mutableIntStateOf(0)
    /** The cat crosses in [CAT_WALK] tenths of a second, once every [CAT_PERIOD]. */
    const val CAT_PERIOD = 1350
    const val CAT_WALK = 450
    /** A shooting star every [STAR_PERIOD] tenths of a second, [STAR_TICKS] long. */
    const val STAR_PERIOD = 130
    const val STAR_TICKS = 9

    /** Scenes with moving parts now on screen (PixelSceneArt): while any are, the clock ticks fast. */
    var movers = 0

    internal fun busy(t: Int, blue: Boolean): Boolean =
        movers > 0 || blue || t % CAT_PERIOD <= CAT_WALK || t % STAR_PERIOD <= STAR_TICKS || t % STAR_PERIOD >= STAR_PERIOD - 2
}

/** The blue palette's title glitch: a quick jump, in dp, once every 7 s. */
internal fun glitchJump(t: Int): Float = when (t % 70) { 64 -> -3f; 65 -> 4f; 66 -> -2f; else -> 0f }

/**
 * Pixel mode's night behind the pages (desktop: components/PixelAmbient.tsx): stars that twinkle,
 * a skyline whose windows and rooftop beacons blink, a cat walking the street, a shooting star now
 * and then and, in the blue palette, rain. [animate] false (the player or a reader in front, the
 * setting off, or Android's animations off) stops the clock and leaves everything still.
 */
@Composable
fun PixelAmbient(modifier: Modifier, animate: Boolean) {
    val motion = animate && pixelMotion()
    val blue = AniColors.retroBlue
    if (motion) {
        val lifecycle = LocalLifecycleOwner.current.lifecycle
        LaunchedEffect(lifecycle, blue) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    val now = (android.os.SystemClock.uptimeMillis() / 100).toInt()
                    PixelTime.tick.intValue = now
                    delay(if (PixelTime.busy(now, blue)) 150 else 700)
                }
            }
        }
    }
    // Each part draws on a layer of its own, so a tick redraws only that part, never the page.
    BoxWithConstraints(modifier.clipToBounds()) {
        val narrow = maxWidth < 600.dp
        AmbientStars(Modifier.matchParentSize().graphicsLayer(), blue)
        if (blue && motion) AmbientRain(Modifier.matchParentSize())
        val skyline = if (narrow) 60.dp else 84.dp
        AmbientSkyline(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(skyline).graphicsLayer())
        if (motion) {
            WalkingCat(Modifier.align(Alignment.BottomStart).fillMaxWidth(), cell = if (narrow) 2.dp else 3.dp)
            ShootingStar(Modifier.matchParentSize().graphicsLayer())
        }
    }
}

private class Star(val x: Int, val y: Int, val color: Color, val big: Boolean)

/** Seeded 3 dp stars, drawn once into a small bitmap; on each slow tick one in five glints, in turn. */
@Composable
private fun AmbientStars(modifier: Modifier, blue: Boolean) {
    BoxWithConstraints(modifier) {
        val cell = with(LocalDensity.current) { 3.dp.toPx() }
        val cols = (constraints.maxWidth / cell).toInt().coerceAtLeast(1)
        val rows = (constraints.maxHeight / cell).toInt().coerceAtLeast(1)
        val stars = remember(cols, rows, blue) {
            val colors = if (blue) listOf(Color(0xFFDDEBFA), Color(0xFF00F0FF), Color(0xFFFF2E63)) else listOf(Color(0xFFFFF3FB), Color(0xFFFFB3E1), Color(0xFFBFF8FF))
            val random = java.util.Random(11)
            List(cols * rows / 260) { Star(random.nextInt(cols), random.nextInt(rows), colors[random.nextInt(colors.size)], random.nextInt(7) == 0) }
        }
        val field = remember(stars) {
            val bitmap = Bitmap.createBitmap(cols, rows, Bitmap.Config.ARGB_8888)
            for (s in stars) bitmap.setPixel(s.x, s.y, s.color.copy(alpha = if (s.big) 0.5f else 0.26f).toArgb())
            bitmap.asImageBitmap()
        }
        Canvas(Modifier.fillMaxSize()) {
            drawImage(field, dstSize = IntSize((cols * cell).toInt(), (rows * cell).toInt()), filterQuality = FilterQuality.None)
            val t = PixelTime.tick.intValue / 7
            stars.forEachIndexed { i, s ->
                if ((t + i * 3) % 5 != 0) return@forEachIndexed
                val x = s.x * cell; val y = s.y * cell
                drawRect(s.color.copy(alpha = 0.75f), Offset(x, y), Size(cell, cell))
                // A glinting big star flashes a small cross.
                if (s.big) {
                    drawRect(s.color.copy(alpha = 0.45f), Offset(x - cell, y), Size(cell * 3, cell))
                    drawRect(s.color.copy(alpha = 0.45f), Offset(x, y - cell), Size(cell, cell * 3))
                }
            }
        }
    }
}

private fun renderPixels(width: Int, height: Int, pixels: List<com.sanjay.anitrack.next.data.CityPopPixel>): ImageBitmap {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    val paint = android.graphics.Paint()
    val colors = HashMap<String, Int>()
    for (p in pixels) {
        paint.color = colors.getOrPut(p.color) { android.graphics.Color.parseColor(p.color) }
        canvas.drawRect(p.x.toFloat(), p.y.toFloat(), (p.x + p.w).toFloat(), (p.y + p.h).toFloat(), paint)
    }
    return bitmap.asImageBitmap()
}

/** The skyline strip (shared PixelScenes.skyline): its two twinkle frames drawn once, swapped every 1.4 s. */
@Composable
private fun AmbientSkyline(modifier: Modifier) {
    BoxWithConstraints(modifier) {
        val cell = with(LocalDensity.current) { 3.dp.toPx() }
        val w = (constraints.maxWidth / cell).toInt().coerceAtLeast(16)
        val h = (constraints.maxHeight / cell).toInt().coerceAtLeast(8)
        val frames = remember(w, h) { List(2) { renderPixels(w, h, PixelScenes.skyline(w, h, it)) } }
        Canvas(Modifier.fillMaxSize()) {
            drawImage(
                frames[(PixelTime.tick.intValue / 14) % 2], dstSize = IntSize((w * cell).toInt(), (h * cell).toInt()),
                dstOffset = IntOffset(0, (size.height - h * cell).toInt()), filterQuality = FilterQuality.None, alpha = 0.8f,
            )
        }
    }
}

private val RAIN_PERIOD = 120.dp
private const val RAIN_STEPS = 10

/**
 * Rain falling in pixel steps (blue Pixel mode's uncertain future): one tile of seeded streaks,
 * drawn once into a small bitmap and repeated down a sheet a tile taller than the page, which
 * slides as a layer on the clock (only the layer moves; nothing is redrawn).
 */
@Composable
private fun AmbientRain(modifier: Modifier) {
    BoxWithConstraints(modifier.clipToBounds()) {
        val density = LocalDensity.current
        val cell = with(density) { 3.dp.toPx() }
        val cols = (constraints.maxWidth / cell).toInt().coerceAtLeast(1)
        val rows = (with(density) { RAIN_PERIOD.toPx() } / cell).toInt().coerceAtLeast(4)
        val tile = remember(cols, rows) {
            val bitmap = Bitmap.createBitmap(cols, rows, Bitmap.Config.ARGB_8888)
            val color = 0x389FD8FF
            for (i in 0 until (cols * rows / 220).coerceAtMost(260)) {
                val x = (CityPopScene.hash(90000 + i) % cols).toInt()
                val y = (CityPopScene.hash(91000 + i) % rows).toInt()
                for (k in 0 until 2 + i % 2) bitmap.setPixel(x, (y + k) % rows, color.toInt())
            }
            bitmap.asImageBitmap()
        }
        val tileHeight = rows * cell
        Canvas(
            Modifier.fillMaxWidth().requiredHeight(maxHeight + RAIN_PERIOD).align(Alignment.TopStart).graphicsLayer {
                translationY = -tileHeight + tileHeight * (PixelTime.tick.intValue % RAIN_STEPS) / RAIN_STEPS
            },
        ) {
            val dst = IntSize((cols * cell).toInt(), tileHeight.toInt())
            var top = 0f
            while (top < size.height) {
                drawImage(tile, dstOffset = IntOffset(0, top.toInt()), dstSize = dst, filterQuality = FilterQuality.None)
                top += tileHeight
            }
        }
    }
}

/** A sprite from the shared sheet, crisp: whole device pixels per art pixel, centred in [modifier]'s box. */
@Composable
fun PixelSprite(id: String, modifier: Modifier = Modifier, width: Dp = 32.dp) {
    val context = LocalContext.current
    val sheet = remember { PixelSprites.load(context) }
    val w = sheet.width(id).coerceAtLeast(1)
    val h = sheet.height(id).coerceAtLeast(1)
    val rects = remember(id) { sheet.rects(id) }
    val colors = remember(id) { rects.map { Color(android.graphics.Color.parseColor(it.color)) } }
    Canvas(modifier.size(width, width * h / w)) {
        val cell = max(1f, floor(min(size.width / w, size.height / h)))
        val ox = floor((size.width - cell * w) / 2)
        val oy = floor((size.height - cell * h) / 2)
        rects.forEachIndexed { i, p -> drawRect(colors[i], Offset(ox + p.x * cell, oy + p.y * cell), Size(p.w * cell, p.h * cell)) }
    }
}

/**
 * A cat walking left to right along the street, two frames, in art-pixel steps: it crosses in 45 s
 * every 2¼ minutes. The clock is read only while drawing the cat's own small layer.
 */
@Composable
private fun WalkingCat(modifier: Modifier, cell: Dp, period: Int = PixelTime.CAT_PERIOD, walk: Int = PixelTime.CAT_WALK) {
    val context = LocalContext.current
    val sheet = remember { PixelSprites.load(context) }
    val frames = remember {
        listOf("cat-walk-1", "cat-walk-2").map { id -> sheet.rects(id).map { it to Color(android.graphics.Color.parseColor(it.color)) } }
    }
    val rows = sheet.height("cat-walk-1").coerceAtLeast(1)
    BoxWithConstraints(modifier) {
        val width = constraints.maxWidth.toFloat()
        Canvas(Modifier.fillMaxWidth().height(cell * rows).graphicsLayer()) {
            val phase = PixelTime.tick.intValue % period
            if (phase >= walk) return@Canvas
            val px = floor(cell.toPx()).coerceAtLeast(1f)
            val sprite = 16 * px
            val left = floor((-sprite + (width + sprite * 2) * phase / walk) / px) * px
            for ((p, color) in frames[(phase / 3) % 2]) drawRect(color, Offset(left + p.x * px, p.y * px), Size(p.w * px, p.h * px))
        }
    }
}

/**
 * A cat wandering across the gap between two of Home's rows: 20 s across, once a minute (desktop's
 * .pixel-walker). Gone with motion off; while it's on screen the clock ticks fast.
 */
@Composable
internal fun RowWalker(modifier: Modifier = Modifier) {
    if (!pixelMotion()) return
    DisposableEffect(Unit) {
        PixelTime.movers++
        onDispose { PixelTime.movers-- }
    }
    WalkingCat(modifier.fillMaxWidth(), 2.dp, period = 600, walk = 200)
}

/** Pixel mode's dog, sitting by the Top 10 tabs and wagging its tail on the clock (desktop's .pixel-dog). */
@Composable
internal fun PixelDog(modifier: Modifier = Modifier, width: Dp = 32.dp) {
    val context = LocalContext.current
    val sheet = remember { PixelSprites.load(context) }
    val frames = remember {
        listOf("dog-sit-1", "dog-sit-2").map { id -> sheet.rects(id).map { it to Color(android.graphics.Color.parseColor(it.color)) } }
    }
    val rows = sheet.height("dog-sit-1").coerceAtLeast(1)
    val motion = pixelMotion()
    Canvas(modifier.size(width, width * rows / 16).graphicsLayer()) {
        val frame = if (motion) (PixelTime.tick.intValue / 8) % 2 else 0
        val cell = max(1f, floor(size.width / 16))
        for ((p, color) in frames[frame]) drawRect(color, Offset(p.x * cell, p.y * cell), Size(p.w * cell, p.h * cell))
    }
}

/** Now and then a short pixel streak crosses the upper sky, on the clock. */
@Composable
private fun ShootingStar(modifier: Modifier) {
    Canvas(modifier) {
        val t = PixelTime.tick.intValue
        val phase = t % PixelTime.STAR_PERIOD
        if (phase >= PixelTime.STAR_TICKS) return@Canvas
        val seed = t / PixelTime.STAR_PERIOD
        val p = (phase + 1) / (PixelTime.STAR_TICKS + 1f)
        val cell = 3.dp.toPx()
        val startX = size.width * (0.35f + (CityPopScene.hash(seed + 71000) % 50) / 100f)
        val startY = size.height * (0.05f + (CityPopScene.hash(seed + 72000) % 25) / 100f)
        val travel = min(size.width, size.height) * 0.45f
        // Snapped to the pixel grid, the head moves down-left with a fading tail behind it.
        val headX = floor((startX - travel * p) / cell) * cell
        val headY = floor((startY + travel * 0.45f * p) / cell) * cell
        val fade = if (p > 0.8f) (1f - p) / 0.2f else 1f
        for (k in 0 until 7) {
            drawRect(Color.White.copy(alpha = (1f - k / 7f) * fade), Offset(headX + k * cell * 2, headY - k * cell), Size(cell, cell))
        }
    }
}

/** The end of Home in Pixel mode: a little scene of sprites, bobbing in turn, and a save-point line. */
@Composable
fun PixelFooter(sprites: List<String>, line: String, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(top = 28.dp, bottom = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.Bottom) {
            sprites.forEachIndexed { i, id ->
                PixelSprite(id, Modifier.graphicsLayer { translationY = if ((PixelTime.tick.intValue / 6 + i) % 2 == 0) 0f else -3.dp.toPx() }, width = 48.dp)
            }
        }
        Spacer(Modifier.height(12.dp))
        androidx.compose.material3.Text(
            line, fontFamily = CityPopPixelFont, fontSize = androidx.compose.ui.unit.TextUnit(11f, androidx.compose.ui.unit.TextUnitType.Sp),
            color = AniColors.TextTertiary, letterSpacing = androidx.compose.ui.unit.TextUnit(1f, androidx.compose.ui.unit.TextUnitType.Sp),
        )
    }
}

/** Empty states' sprites in Pixel mode, by the icon the screen chose (Material names, e.g. "Rounded.CloudOff"). */
internal fun pixelSpriteForIcon(name: String): String = when (name.substringAfterLast('.')) {
    "History" -> "tv"
    "DownloadForOffline" -> "floppy"
    "CloudOff" -> "ghost"
    "SearchOff", "Search" -> "ufo"
    "NewReleases" -> "star"
    "EventBusy" -> "moon"
    "MenuBook", "AutoStories" -> "book"
    else -> "cat"
}

/** An empty state's sprite, bobbing gently on the clock. */
@Composable
internal fun BobbingSprite(id: String, width: Dp) {
    PixelSprite(id, Modifier.graphicsLayer { translationY = if ((PixelTime.tick.intValue / 6) % 2 == 0) 0f else -4.dp.toPx() }, width = width)
}
