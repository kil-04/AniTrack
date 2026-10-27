package com.sanjay.anitrack.next.ui

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sanjay.anitrack.next.data.PixelScenes

/** Pixel mode's scene ids (data/PixelScenes.kt): the page banners' pictures. */
object PixelScene {
    const val SUNSET = "sunset"
    const val NEON_CITY = "neon-city"
    const val FUJI = "fuji"
    const val SAKURA = "sakura"
    const val SHINKANSEN = "shinkansen"
    const val STARLIGHT = "starlight"
    const val LIBRARY = "library"
    const val RAMEN_STAND = "ramen-stand"
    const val ARCADE = "arcade"
    const val BEDROOM = "bedroom"
    const val CINEMA = "cinema"
    const val TOWER = "tower"
    const val OBSERVATORY = "observatory"
    const val STATION = "station"
    const val TERMINAL = "terminal"
    const val STAGE = "stage"
    const val JUKEBOX = "jukebox"
    const val RADIO = "radio"
    const val HIFI = "hifi"
    const val NIGHT_DRIVE = "night-drive"
    const val KARAOKE = "karaoke"
    const val ROOFTOP_BAND = "rooftop-band"
    const val HOLOGRAM = "hologram"
}

private fun renderPixelScene(scene: String, width: Int, height: Int): ImageBitmap {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    val paint = android.graphics.Paint()
    val colors = HashMap<String, Int>()
    for (p in PixelScenes.scene(scene, width, height)) {
        paint.color = colors.getOrPut(p.color) { android.graphics.Color.parseColor(p.color) }
        canvas.drawRect(p.x.toFloat(), p.y.toFloat(), (p.x + p.w).toFloat(), (p.y + p.h).toFloat(), paint)
    }
    return bitmap.asImageBitmap()
}

/** A pixel-art scene filling its box: [cell]-sized art pixels, CRT scanlines over it (as on desktop). */
@Composable
fun PixelSceneArt(scene: String, modifier: Modifier = Modifier, cell: Dp = 3.dp) {
    BoxWithConstraints(modifier) {
        val px = with(LocalDensity.current) { cell.toPx() }
        val width = (constraints.maxWidth / px).toInt().coerceAtLeast(16)
        val height = (constraints.maxHeight / px).toInt().coerceAtLeast(12)
        val image = remember(scene, width, height) { renderPixelScene(scene, width, height) }
        val haze = AniColors.retroBlue
        Canvas(Modifier.fillMaxSize().graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)) {
            drawImage(image, dstSize = IntSize(size.width.toInt(), size.height.toInt()), filterQuality = FilterQuality.None)
            // Blue Pixel mode drowns the scene in a cold haze (desktop's .pixel-banner::before).
            if (haze) drawRect(BLUE_HAZE, alpha = 0.62f, blendMode = BlendMode.Color)
            val gap = 2.dp.toPx()
            var y = 0f
            while (y < size.height) { drawRect(Color.Black.copy(alpha = 0.14f), Offset(0f, y), Size(size.width, gap)); y += gap * 2 }
        }
    }
}

private val BLUE_HAZE = Brush.verticalGradient(0f to Color(0xFF0A2440), 0.7f to Color(0xFF0D5A8A), 1f to Color(0xFF00A8FF))
private val GLITCH_CYAN = Color(0xBF00F0FF)
private val GLITCH_RED = Color(0xBFFF2E63)

/**
 * Pixel mode's page banner: a scene with the page's icon, title and subtitle over a shaded left
 * side. In blue Pixel mode a bright bar rolls down it and the title splits into cyan and red,
 * jumping now and then, as on desktop.
 */
@Composable
fun PixelBanner(scene: String, title: String, subtitle: String?, icon: ImageVector?, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val narrow = maxWidth < 600.dp
        Box(
            Modifier.fillMaxWidth().height(if (narrow) 132.dp else 164.dp)
                .padding(end = 6.dp, bottom = 6.dp)
                .pixelPanel(AniColors.Bg, AniColors.Accent, AniColors.AccentDeep.copy(alpha = 0.45f), 6.dp),
        ) {
            PixelSceneArt(scene, Modifier.matchParentSize().padding(2.dp))
            val glitch = AniColors.retroBlue
            if (glitch) RollingBar(Modifier.matchParentSize().padding(2.dp))
            Box(
                Modifier.matchParentSize().padding(2.dp).background(
                    Brush.horizontalGradient(0f to AniColors.Bg.copy(alpha = 0.78f), 0.34f to AniColors.Bg.copy(alpha = 0.45f), 0.62f to Color.Transparent),
                ),
            )
            Row(
                Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(horizontal = if (narrow) 16.dp else 22.dp, vertical = if (narrow) 14.dp else 18.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                if (icon != null) {
                    Box(
                        Modifier.size(if (narrow) 40.dp else 46.dp).pixelPanel(AniColors.Accent, AniColors.Accent, AniColors.PixelShadow, 4.dp),
                        contentAlignment = Alignment.Center,
                    ) { Icon(icon, null, tint = Color.White, modifier = Modifier.size(22.dp)) }
                    Spacer(Modifier.width(14.dp))
                }
                Column(Modifier.weight(1f)) {
                    val titleStyle = MaterialTheme.typography.headlineMedium.copy(fontSize = if (narrow) 19.sp else 24.sp)
                    if (glitch) GlitchTitle(title, titleStyle)
                    else Text(
                        title,
                        style = titleStyle.copy(shadow = Shadow(AniColors.AccentDeep, Offset(3f, 3f), 0f)),
                        color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                    if (subtitle != null) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            subtitle, color = Color(0xFFF4EEFF), fontSize = 13.sp, maxLines = if (narrow) 2 else 1, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.bodyMedium.copy(shadow = Shadow(Color.Black, Offset(2f, 2f), 0f)),
                        )
                    }
                }
            }
        }
    }
}

/**
 * A bright band rolling down the banner every 6 s, like a failing monitor's: drawn once and moved
 * as a layer on Pixel mode's clock (only the layer's position changes; nothing is redrawn).
 */
@Composable
private fun RollingBar(modifier: Modifier) {
    BoxWithConstraints(modifier.clipToBounds()) {
        val band = 48.dp
        val travel = maxHeight + band * 2
        Canvas(
            Modifier.fillMaxWidth().height(band).graphicsLayer {
                translationY = -band.toPx() + travel.toPx() * (PixelTime.tick.intValue % 60) / 60f
            },
        ) {
            drawRect(Brush.verticalGradient(0f to Color.Transparent, 0.5f to Color(0x2978F0FF), 1f to Color.Transparent))
        }
    }
}

/** The title split into cyan and red copies, the whole jumping briefly once every 7 s. */
@Composable
private fun GlitchTitle(title: String, style: androidx.compose.ui.text.TextStyle) {
    Box(Modifier.graphicsLayer { translationX = glitchJump(PixelTime.tick.intValue) * density }) {
        Text(title, style = style, color = GLITCH_CYAN, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.offset(x = (-2).dp))
        Text(title, style = style, color = GLITCH_RED, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.offset(x = 2.dp))
        Text(title, style = style, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * Pixel mode's screen over art: CRT scanlines and, in the blue palette, the cold haze and the
 * rolling bar (the Home hero's pixelated trending art).
 */
@Composable
fun PixelScreen(modifier: Modifier) {
    val blue = AniColors.retroBlue
    Box(modifier) {
        Canvas(Modifier.matchParentSize().graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)) {
            if (blue) drawRect(BLUE_HAZE, alpha = 0.45f, blendMode = BlendMode.Color)
            val gap = 2.dp.toPx()
            var y = 0f
            while (y < size.height) { drawRect(Color.Black.copy(alpha = 0.16f), Offset(0f, y), Size(size.width, gap)); y += gap * 2 }
        }
        if (blue) RollingBar(Modifier.matchParentSize())
    }
}

/**
 * Pixel mode's interlude between Home's rows: a wide scene that opens another part of the app
 * (Schedule, Songs, the Time Machine, a reading list), as on desktop.
 */
@Composable
fun PixelInterlude(scene: String, title: String, subtitle: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 22.dp, bottom = 6.dp)) {
        val narrow = maxWidth < 600.dp
        Box(
            Modifier.fillMaxWidth().height(if (narrow) 100.dp else 124.dp)
                .padding(end = 5.dp, bottom = 5.dp)
                .pixelPanel(AniColors.Bg, AniColors.Accent, AniColors.AccentDeep.copy(alpha = 0.45f), 5.dp)
                .clickable(onClick = onClick),
        ) {
            PixelSceneArt(scene, Modifier.matchParentSize().padding(2.dp))
            Box(
                Modifier.matchParentSize().padding(2.dp).background(
                    Brush.horizontalGradient(0f to AniColors.Bg.copy(alpha = 0.82f), 0.4f to AniColors.Bg.copy(alpha = 0.4f), 0.7f to Color.Transparent),
                ),
            )
            Column(
                Modifier.align(Alignment.CenterStart).padding(start = if (narrow) 16.dp else 22.dp)
                    .fillMaxWidth(if (narrow) 0.68f else 0.5f),
            ) {
                Text(
                    title, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.titleLarge.copy(shadow = Shadow(AniColors.AccentDeep, Offset(2f, 2f), 0f)),
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    subtitle, color = Color(0xFFF4EEFF), maxLines = 2, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall.copy(shadow = Shadow(Color.Black, Offset(2f, 2f), 0f)),
                )
            }
            Box(
                Modifier.align(Alignment.CenterEnd).padding(end = 16.dp)
                    .pixelPanel(AniColors.Accent, AniColors.Accent, AniColors.PixelShadow, 3.dp)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
            ) { Text("GO \u25B6", fontFamily = CityPopPixelFont, fontWeight = FontWeight.Normal, color = Color.White, fontSize = 12.sp) }
        }
    }
}

/** Settings → Appearance: Pixel mode on or off, with a preview of its banners. */
@Composable
internal fun AppearanceCard() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE) }
    val pixel = AniColors.pixelMode.value
    SettingsSection(Icons.Rounded.Palette, "Appearance", "How AniTrack looks on this device.") {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(width = 150.dp, height = 64.dp).padding(end = 4.dp, bottom = 4.dp)
                    .pixelPanel(AniColors.Bg, AniColors.Accent, AniColors.AccentDeep.copy(alpha = 0.45f), 4.dp),
            ) { PixelSceneArt(PixelScene.SAKURA, Modifier.matchParentSize().padding(2.dp), cell = 2.dp) }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text("Pixel mode", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Square corners, a pixel font for headings and a pixel-art banner on every page, in neon or AniTrack blue. Saved on this device.",
                    style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary,
                )
            }
            Spacer(Modifier.width(12.dp))
            Switch(
                checked = pixel,
                onCheckedChange = { on ->
                    AniColors.pixelMode.value = on
                    prefs.edit().putBoolean(AniColors.PIXEL_MODE_PREF, on).apply()
                },
                colors = SwitchDefaults.colors(checkedTrackColor = AniColors.Accent),
            )
        }
        if (pixel) {
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Colours", style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary)
                for ((blue, label) in listOf(false to "Neon", true to "AniTrack blue")) {
                    FilterChip(
                        selected = AniColors.pixelBlue.value == blue,
                        onClick = {
                            AniColors.pixelBlue.value = blue
                            prefs.edit().putBoolean(AniColors.PIXEL_BLUE_PREF, blue).apply()
                        },
                        label = { Text(label) },
                        leadingIcon = { Box(Modifier.size(10.dp).background(if (blue) Color(0xFF3D8BFF) else Color(0xFFFF2A9D))) },
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Animated background", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Twinkling stars, a blinking skyline, a passing cat and shooting stars behind the pages. Still under the player.",
                        style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary,
                    )
                }
                Spacer(Modifier.width(12.dp))
                Switch(
                    checked = AniColors.pixelMotion.value,
                    onCheckedChange = { on ->
                        AniColors.pixelMotion.value = on
                        prefs.edit().putBoolean(AniColors.PIXEL_MOTION_PREF, on).apply()
                    },
                    colors = SwitchDefaults.colors(checkedTrackColor = AniColors.Accent),
                )
            }
        }
    }
}

/** The AniTrack wordmark in the pixel font, "TRACK" in the accent (the shell's top bar in Pixel mode). */
@Composable
internal fun PixelWordmarkText(compact: Boolean) {
    Text(
        androidx.compose.ui.text.buildAnnotatedString {
            pushStyle(androidx.compose.ui.text.SpanStyle(color = AniColors.Text)); append("ANI"); pop()
            pushStyle(androidx.compose.ui.text.SpanStyle(color = AniColors.Accent)); append("TRACK"); pop()
        },
        fontFamily = CityPopPixelFont, fontWeight = FontWeight.Normal, fontSize = if (compact) 15.sp else 17.sp, letterSpacing = 0.5.sp,
        style = MaterialTheme.typography.titleLarge.copy(shadow = Shadow(AniColors.AccentDeep, Offset(2f, 2f), 0f)),
    )
}
