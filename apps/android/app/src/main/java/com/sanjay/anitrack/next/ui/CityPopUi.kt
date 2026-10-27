package com.sanjay.anitrack.next.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material.icons.rounded.WbTwilight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.R
import com.sanjay.anitrack.next.data.CityPopArchiveItem
import com.sanjay.anitrack.next.data.CityPopScene
import com.sanjay.anitrack.next.data.CityPopStation
import com.sanjay.anitrack.next.data.CityPopTrack

/*
 * City Pop's retrowave pixel look, as on desktop (pages/CityPop.css): the pixel font
 * (scripts/build-city-pop-font.py) for titles, labels and buttons; square panels with hard shadows;
 * neon pink, cyan and purple on night; and the shared pixel-art sunset (data/CityPopScene.kt).
 */

internal val CityPopPixelFont = FontFamily(Font(R.font.city_pop_pixel))

internal object CityPopColors {
    val Pink = Color(0xFFFF2A9D)
    val PinkLight = Color(0xFFFF7AC6)
    val PinkPale = Color(0xFFFFD1EC)
    val Teal = Color(0xFF2EE6FF)
    val CyanPale = Color(0xFFBFF8FF)
    val Yellow = Color(0xFFFFD319)
    val Lilac = Color(0xFFC9A8FF)
    val Night = Color(0xFF0D0221)
    /** Text on a pink button, and the darkest panels. */
    val Ink = Color(0xFF12021F)
    val Panel = Color(0xFF140A2B)
    val Line = Color(0xFF3B1D63)
    val Shadow = Color(0xFF050010)
    val PinkShadow = Color(0xFF6B0F4A)
    val CyanShadow = Color(0xFF0B4A55)
    /** The record's label behind an album cover. */
    val Peach = PinkLight
    val LabelInk = Ink
    val Muted = Lilac
}

/** A station's colour, backdrop and pixel icon, as on desktop. */
internal data class CityPopStationLook(val tint: Color, val backdrop: List<Color>, val sprite: List<String>)

internal fun cityPopStationLook(id: String) = when (id) {
    "sunset" -> CityPopStationLook(CityPopColors.Yellow, listOf(Color(0xFF3A1030), Color(0xFF160A24)), CityPopScene.ICONS.getValue("sunset"))
    "after-hours" -> CityPopStationLook(CityPopColors.Teal, listOf(Color(0xFF0C2A3A), Color(0xFF0A1224)), CityPopScene.ICONS.getValue("after-hours"))
    else -> CityPopStationLook(Color(0xFF9F8CFF), listOf(Color(0xFF1A1240), Color(0xFF0F0A24)), CityPopScene.ICONS.getValue("night-drive"))
}

/** How many cards fit across: albums are small squares, tracks and videos wide cards. */
internal data class CityPopLayout(val narrow: Boolean, val albumColumns: Int, val cardColumns: Int) {
    val padding: Dp get() = if (narrow) 16.dp else 24.dp
}

internal fun cityPopLayout(width: Dp) = CityPopLayout(
    narrow = width < 600.dp,
    albumColumns = (width.value / 175f).toInt().coerceIn(2, 5),
    cardColumns = (width.value / 360f).toInt().coerceIn(1, 3),
)

/** Cards in rows of [columns], each the same width (a short last row keeps the gaps). */
internal fun <T> LazyListScope.cityPopGrid(
    items: List<T>,
    columns: Int,
    key: (T) -> Any,
    spacing: Dp = 14.dp,
    card: @Composable (T, Modifier) -> Unit,
) {
    items.chunked(columns).forEach { row ->
        item(key = "row-${key(row.first())}") {
            Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
                row.forEach { card(it, Modifier.weight(1f)) }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

// ── Pixel parts ───────────────────────────────────────────────────────────────

/**
 * A square panel: [fill], a 2 dp [border] and a hard [shadow] [depth] down and to the right
 * (drawn past the bounds, as on desktop's box-shadow: lists leave room for it).
 */
internal fun Modifier.pixelPanel(fill: Color, border: Color, shadow: Color = CityPopColors.Shadow, depth: Dp = 4.dp, dashed: Boolean = false): Modifier = drawBehind {
    val d = depth.toPx()
    val line = 2.dp.toPx()
    if (d > 0f) drawRect(shadow, topLeft = Offset(d, d), size = size)
    drawRect(fill)
    drawRect(
        border, topLeft = Offset(line / 2, line / 2), size = Size(size.width - line, size.height - line),
        style = Stroke(line, pathEffect = if (dashed) PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())) else null),
    )
}

/** Text in the pixel font (its small letters are capitals); [shadow] is a hard 2 dp drop. */
@Composable
internal fun PixelText(
    text: String, color: Color, size: TextUnit, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE,
    shadow: Color? = null, align: TextAlign? = null, lineHeight: TextUnit = TextUnit.Unspecified,
) {
    val drop = with(LocalDensity.current) { 2.dp.toPx() }
    Text(
        text, color = color, fontFamily = CityPopPixelFont, fontWeight = FontWeight.Normal, fontSize = size, letterSpacing = 0.sp,
        lineHeight = if (lineHeight == TextUnit.Unspecified) size * 1.3f else lineHeight, maxLines = maxLines, overflow = TextOverflow.Ellipsis,
        textAlign = align, modifier = modifier, style = TextStyle(shadow = shadow?.let { Shadow(it, Offset(drop, drop), 0f) }),
    )
}

/** A 9 × 9 sprite ('#' lit) drawn as crisp squares. */
@Composable
internal fun CityPopPixelSprite(sprite: List<String>, color: Color, size: Dp, modifier: Modifier = Modifier) {
    Canvas(modifier.size(size)) {
        val cell = this.size.width / sprite.first().length
        sprite.forEachIndexed { y, row ->
            row.forEachIndexed { x, c -> if (c == '#') drawRect(color, Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f)) }
        }
    }
}

// ── Buttons, tabs and fields ──────────────────────────────────────────────────

internal enum class CityPopButtonStyle { Primary, Outline, Teal, Ghost, Quiet }

/** The pack's button: square, pixel-lettered, pressing down into its shadow. */
@Composable
internal fun CityPopButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    style: CityPopButtonStyle = CityPopButtonStyle.Outline,
    enabled: Boolean = true,
    loading: Boolean = false,
    trailing: String? = null,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    data class Look(val fill: Color, val border: Color, val content: Color, val shadow: Color?)
    val look = when (style) {
        CityPopButtonStyle.Primary -> Look(CityPopColors.Pink, CityPopColors.PinkPale, CityPopColors.Ink, CityPopColors.PinkShadow)
        CityPopButtonStyle.Outline, CityPopButtonStyle.Teal -> Look(CityPopColors.Ink, CityPopColors.Teal, CityPopColors.Teal, CityPopColors.CyanShadow)
        CityPopButtonStyle.Ghost -> Look(CityPopColors.Ink, CityPopColors.Line, Color.White, CityPopColors.Shadow)
        CityPopButtonStyle.Quiet -> Look(Color.Transparent, Color.Transparent, CityPopColors.Lilac, null)
    }
    val depth = if (look.shadow == null) 0.dp else if (pressed) 1.dp else 4.dp
    Row(
        modifier.heightIn(min = 42.dp).alpha(if (enabled) 1f else 0.5f)
            .offset { if (pressed && look.shadow != null) IntOffset(2.dp.roundToPx(), 2.dp.roundToPx()) else IntOffset.Zero }
            .pixelPanel(look.fill, look.border, look.shadow ?: Color.Transparent, depth)
            .clickable(interactionSource = interaction, indication = null, enabled = enabled && !loading, onClick = onClick)
            .padding(horizontal = if (style == CityPopButtonStyle.Quiet) 8.dp else 13.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(15.dp), color = look.content, strokeWidth = 2.dp)
        else if (icon != null) Icon(icon, null, tint = look.content, modifier = Modifier.size(16.dp))
        if (loading || icon != null) Spacer(Modifier.width(8.dp))
        PixelText(text, look.content, 12.sp, maxLines = 1)
        if (trailing != null) {
            Spacer(Modifier.width(8.dp))
            PixelText(trailing, look.content, 9.sp, Modifier.background(Color.Black.copy(alpha = 0.15f)).padding(horizontal = 5.dp, vertical = 2.dp), maxLines = 1)
        }
    }
}

/** The pack's two collections, under the banner: the open one lit cyan. */
@Composable
internal fun CityPopPackTabs(selected: String, onSelect: (String) -> Unit, trailing: @Composable () -> Unit = {}) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CityPopPackTab("Music & Videos", Icons.Rounded.Album, selected == "archive") { onSelect("archive") }
                CityPopPackTab("YouTube Classics", Icons.Rounded.Tv, selected == "classics") { onSelect("classics") }
            }
            trailing()
        }
        Canvas(Modifier.fillMaxWidth().padding(top = 18.dp).height(2.dp)) {
            drawLine(Color(0xFF2A1450), Offset(0f, size.height / 2), Offset(size.width, size.height / 2), size.height, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())))
        }
    }
}

@Composable
private fun CityPopPackTab(text: String, icon: ImageVector, active: Boolean, onClick: () -> Unit) {
    val tint = if (active) CityPopColors.Night else CityPopColors.Lilac
    Row(
        Modifier.height(42.dp)
            .pixelPanel(if (active) CityPopColors.Teal else CityPopColors.Ink, if (active) CityPopColors.CyanPale else CityPopColors.Line, if (active) CityPopColors.CyanShadow else CityPopColors.Shadow)
            .clickable(enabled = !active, onClick = onClick).padding(horizontal = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        PixelText(text, tint, 12.sp, maxLines = 1)
    }
}

/** Smaller tabs in one framed group, so they read as part of a collection (Browse · Videos · Downloads). */
@Composable
internal fun CityPopSubTabs(options: List<Triple<String, String, ImageVector>>, selected: String, onSelect: (String) -> Unit, counts: Map<String, Int> = emptyMap()) {
    Row(Modifier.pixelPanel(CityPopColors.Night, CityPopColors.Line).padding(5.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        options.forEach { (key, label, icon) ->
            val active = key == selected
            val tint = if (active) CityPopColors.Ink else CityPopColors.Lilac
            Row(
                Modifier.height(36.dp).pixelPanel(if (active) CityPopColors.Pink else Color.Transparent, if (active) CityPopColors.PinkPale else Color.Transparent, depth = 0.dp)
                    .clickable(enabled = !active) { onSelect(key) }.padding(horizontal = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(icon, null, tint = tint, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                PixelText(label, tint, 10.sp, maxLines = 1)
                counts[key]?.takeIf { it > 0 }?.let {
                    Spacer(Modifier.width(5.dp))
                    PixelText("$it", tint.copy(alpha = 0.65f), 10.sp, maxLines = 1)
                }
            }
        }
    }
}

/** A filter toggle (Collection, Favorites, a station): lit pink while on. */
@Composable
internal fun CityPopFilter(text: String, selected: Boolean, onClick: () -> Unit, icon: ImageVector? = null, count: Int? = null, trailingIcon: ImageVector? = null) {
    val tint = if (selected) CityPopColors.Ink else CityPopColors.Lilac
    Row(
        Modifier.height(38.dp).pixelPanel(if (selected) CityPopColors.Pink else CityPopColors.Ink, if (selected) CityPopColors.PinkPale else CityPopColors.Line, depth = 3.dp)
            .clickable(onClick = onClick).padding(horizontal = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) { Icon(icon, null, tint = tint, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(6.dp)) }
        PixelText(text, tint, 10.sp, maxLines = 1)
        if (count != null) { Spacer(Modifier.width(6.dp)); PixelText("$count", tint.copy(alpha = 0.6f), 10.sp, maxLines = 1) }
        if (trailingIcon != null) { Spacer(Modifier.width(5.dp)); Icon(trailingIcon, null, tint = tint, modifier = Modifier.size(13.dp)) }
    }
}

/** The pack's search box: a sunken pixel field that lights cyan while typing; Search runs [onSearch]. */
@Composable
internal fun CityPopSearchField(value: String, onValueChange: (String) -> Unit, placeholder: String, onSearch: () -> Unit, modifier: Modifier = Modifier) {
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    BasicTextField(
        value = value,
        onValueChange = { onValueChange(it.take(200)) },
        modifier = modifier.heightIn(min = 46.dp),
        singleLine = true,
        textStyle = TextStyle(color = Color.White, fontSize = 12.sp, fontFamily = CityPopPixelFont),
        cursorBrush = SolidColor(CityPopColors.Teal),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSearch() }),
        interactionSource = interaction,
        decorationBox = { field ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 46.dp).pixelPanel(CityPopColors.Night, if (focused) CityPopColors.Teal else CityPopColors.Line, depth = 0.dp)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Search, null, tint = Color(0xFF8F74C9), modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(9.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) PixelText(placeholder, Color(0xFF6E55A3), 11.sp, maxLines = 1)
                    field()
                }
                if (value.isNotEmpty()) {
                    Icon(Icons.Rounded.Close, "Clear search", tint = CityPopColors.Lilac,
                        modifier = Modifier.size(30.dp).clickable { onValueChange("") }.padding(7.dp))
                }
            }
        },
    )
}

// ── Text blocks ───────────────────────────────────────────────────────────────

@Composable
internal fun CityPopSectionTitle(title: String, subtitle: String?, modifier: Modifier = Modifier) {
    Column(modifier) {
        PixelText(title, Color.White, 16.sp, shadow = Color(0xFF3D0A63))
        if (subtitle != null) Text(subtitle, color = Color.White.copy(alpha = 0.55f), fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 6.dp))
    }
}

/** A quiet line with a cyan icon (what streams, what downloads). */
@Composable
internal fun CityPopNote(icon: ImageVector, text: String) {
    Row(Modifier.padding(horizontal = 2.dp)) {
        Icon(icon, null, tint = CityPopColors.Teal.copy(alpha = 0.8f), modifier = Modifier.padding(top = 2.dp).size(15.dp))
        Spacer(Modifier.width(9.dp))
        Text(text, color = Color.White.copy(alpha = 0.5f), fontSize = 12.sp, lineHeight = 18.sp)
    }
}

/** An empty, loading or failed list: a dashed pixel frame with a pink icon, words and maybe an action. */
@Composable
internal fun CityPopEmpty(icon: ImageVector?, title: String, message: String? = null, loading: Boolean = false, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().heightIn(min = 170.dp).pixelPanel(CityPopColors.Night, CityPopColors.Line, depth = 0.dp, dashed = true)
            .padding(horizontal = 20.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(24.dp), color = CityPopColors.Pink, strokeWidth = 3.dp)
        else if (icon != null) Icon(icon, null, tint = CityPopColors.Pink.copy(alpha = 0.75f), modifier = Modifier.size(26.dp))
        Text(title, color = Color(0xFFE6D9FF), fontSize = 14.sp, textAlign = TextAlign.Center)
        if (message != null) Text(message, color = Color.White.copy(alpha = 0.5f), fontSize = 12.sp, lineHeight = 18.sp, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 420.dp))
        action?.invoke()
    }
}

/** A problem from the network, in a rose-tinted frame. */
@Composable
internal fun CityPopProblem(text: String, onRetry: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().pixelPanel(Color(0xFF2A0620), Color(0xFFFF5C8A), depth = 0.dp).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, color = Color(0xFFFFE4E6), fontSize = 12.sp, modifier = Modifier.weight(1f))
        if (onRetry != null) CityPopButton("Try again", onRetry, style = CityPopButtonStyle.Quiet)
    }
}

/** A done-and-good message (downloads added, player opened). */
@Composable
internal fun CityPopNotice(text: String) {
    Text(
        text, color = CityPopColors.CyanPale, fontSize = 12.sp,
        modifier = Modifier.fillMaxWidth().pixelPanel(Color(0xFF071F2A), CityPopColors.Teal, depth = 0.dp).padding(horizontal = 14.dp, vertical = 10.dp),
    )
}

@Composable
internal fun CityPopFooter(enabled: Boolean) {
    Column(Modifier.padding(top = 18.dp)) {
        Canvas(Modifier.fillMaxWidth().height(2.dp)) {
            drawLine(Color(0xFF2A1450), Offset(0f, size.height / 2), Offset(size.width, size.height / 2), size.height, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())))
        }
        FlowRow(Modifier.fillMaxWidth().padding(top = 14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            PixelText("City Pop · Part of AniTrack Songs", Color(0xFF8F74C9), 9.sp)
            PixelText(if (enabled) "Pack enabled · Favorites stay on this device" else "Enable whenever you're in the mood", Color(0xFF8F74C9), 9.sp)
        }
    }
}

// ── The banner ────────────────────────────────────────────────────────────────

/** The shared scene drawn into a bitmap at one cell per art pixel, scaled up without smoothing. */
private fun renderScene(width: Int, height: Int, horizon: Int, sunX: Int, sun: Int): ImageBitmap {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bitmap)
    val paint = android.graphics.Paint()
    val colors = HashMap<String, Int>()
    for (p in CityPopScene.scene(width, height, horizon, sunX, sun)) {
        paint.color = colors.getOrPut(p.color) { android.graphics.Color.parseColor(p.color) }
        canvas.drawRect(p.x.toFloat(), p.y.toFloat(), (p.x + p.w).toFloat(), (p.y + p.h).toFloat(), paint)
    }
    return bitmap.asImageBitmap()
}

/**
 * The pixel-art sunset filling its box: 3 dp art pixels, CRT scanlines over it. [ground] puts the
 * horizon that far above the bottom (a phone keeps the scene under its words).
 */
@Composable
private fun CityPopSceneArt(modifier: Modifier, horizon: Int, sunX: Int, sun: Int, ground: Dp? = null) {
    BoxWithConstraints(modifier) {
        val density = LocalDensity.current
        val cell = with(density) { 3.dp.toPx() }
        val width = (constraints.maxWidth / cell).toInt().coerceAtLeast(16)
        val height = (constraints.maxHeight / cell).toInt().coerceAtLeast(12)
        val line = ground?.let { 1000 - (with(density) { it.toPx() } * 1000 / constraints.maxHeight.coerceAtLeast(1)).toInt() } ?: horizon
        val image = remember(width, height, line, sunX, sun) { renderScene(width, height, line.coerceIn(200, 960), sunX, sun) }
        Canvas(Modifier.fillMaxSize()) {
            drawImage(image, dstSize = IntSize(size.width.toInt(), size.height.toInt()), filterQuality = FilterQuality.None)
            val gap = 2.dp.toPx()
            var y = 0f
            while (y < size.height) { drawRect(Color.Black.copy(alpha = 0.14f), Offset(0f, y), Size(size.width, gap)); y += gap * 2 }
        }
    }
}

/** Night sky with seeded 3 dp pixel stars, some twice as large. */
@Composable
private fun CityPopStars(modifier: Modifier) {
    Canvas(modifier) {
        val cell = 3.dp.toPx()
        val random = java.util.Random(7)
        val colors = listOf(Color(0xFFFFF3FB), Color(0xFFFFB3E1), Color(0xFFBFF8FF))
        repeat((size.width * size.height / (cell * cell * 90)).toInt()) {
            val x = (random.nextInt((size.width / cell).toInt().coerceAtLeast(1))) * cell
            val y = (random.nextInt((size.height / cell).toInt().coerceAtLeast(1))) * cell
            val big = random.nextInt(9) == 0
            drawRect(colors[random.nextInt(colors.size)].copy(alpha = if (big) 0.9f else 0.55f), Offset(x, y), Size(if (big) cell * 2 else cell, if (big) cell * 2 else cell))
        }
    }
}

/**
 * The sunset banner, as on desktop. Off, it invites with the full banner and Enable; on, a short
 * banner leaves the music in view. A phone keeps the words over the night sky and the scene under them.
 */
@Composable
internal fun CityPopHero(enabled: Boolean, narrow: Boolean, onEnable: () -> Unit) {
    val compact = enabled
    Box(Modifier.fillMaxWidth().pixelPanel(CityPopColors.Night, CityPopColors.Pink, Color(0xFF3D0A2C), 6.dp)) {
        if (narrow && !compact) {
            // A tall phone banner: the scene (whose palm grows with its height) fills the bottom,
            // under starry night sky in its top colour.
            Column(Modifier.matchParentSize().padding(2.dp)) {
                CityPopStars(Modifier.weight(1f).fillMaxWidth().background(Color(0xFF0B0420)))
                CityPopSceneArt(Modifier.fillMaxWidth().height(300.dp), horizon = 720, sunX = 640, sun = 360, ground = 64.dp)
            }
        } else CityPopSceneArt(
            Modifier.matchParentSize().padding(2.dp),
            horizon = if (compact) 620 else 720,
            // A short phone banner keeps the sun right of the words.
            sunX = if (narrow) 810 else if (compact) 760 else 720,
            sun = if (narrow) 240 else 170,
        )
        // The words stay readable over the scene.
        Box(Modifier.matchParentSize().background(Brush.horizontalGradient(0f to Color(0xD6080114), 0.45f to Color(0x66080114), 0.7f to Color.Transparent)))
        Column(
            Modifier.fillMaxWidth(if (narrow) 1f else 0.62f)
                .padding(start = if (narrow) 20.dp else 32.dp, end = 20.dp, top = if (compact) 20.dp else 30.dp, bottom = if (compact) 22.dp else if (narrow) 250.dp else 74.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(26.dp).height(2.dp).background(CityPopColors.PinkLight))
                Spacer(Modifier.width(9.dp))
                PixelText(if (narrow && compact) "AniTrack presents" else "AniTrack presents · Vol. 01",CityPopColors.PinkLight, 10.sp, maxLines = 1)
            }
            if (!compact) Text("シティ・ポップ", color = Color(0xFFFFB3E1), fontSize = 13.sp, letterSpacing = 4.sp, modifier = Modifier.padding(top = 14.dp))
            PixelText("City Pop", Color(0xFFFFF3FB), if (compact) 28.sp else if (narrow) 40.sp else 52.sp, Modifier.padding(top = if (compact) 12.dp else 8.dp), shadow = CityPopColors.Pink, lineHeight = if (compact) 30.sp else 56.sp)
            PixelText("After the sunset.", CityPopColors.Teal, if (compact) 11.sp else 14.sp, Modifier.padding(top = if (compact) 8.dp else 14.dp), shadow = Color(0xFF0B2A55))
            if (!compact) {
                Text(
                    "Warm grooves, neon nights, and the sound of the Japanese coast. A little getaway inside AniTrack.",
                    color = Color.White.copy(alpha = 0.82f), fontSize = 14.sp, lineHeight = 22.sp, modifier = Modifier.padding(top = 18.dp).widthIn(max = 430.dp),
                )
                CityPopButton("Enable City Pop", onEnable, Modifier.padding(top = 22.dp), icon = Icons.Rounded.WbTwilight, style = CityPopButtonStyle.Primary, trailing = "Free pack")
                Text("Browse Internet Archive, save tracks offline, or explore YouTube classics. No account needed.", color = Color.White.copy(alpha = 0.65f), fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 12.dp))
            }
        }
        if (!compact) {
            Row(
                Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(2.dp).background(Color(0xCC0D0221)).padding(horizontal = if (narrow) 20.dp else 34.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                PixelText("Japanese city pop collection", Color(0xFFFFB3E1), if (narrow) 7.sp else 9.sp, maxLines = 1)
                PixelText("33 1/3 RPM ✦ Stereo", Color(0xFFFFB3E1), if (narrow) 7.sp else 9.sp, maxLines = 1)
            }
        }
    }
}

// ── Cards ─────────────────────────────────────────────────────────────────────

/** A station: its colour, pixel icon, number, mood line, track count (shows the station) and Play station. */
@Composable
internal fun CityPopStationCard(
    station: CityPopStation, number: Int, tracks: Int, enabled: Boolean, selected: Boolean,
    onBrowse: () -> Unit, onPlay: () -> Unit, modifier: Modifier = Modifier,
) {
    val look = cityPopStationLook(station.id)
    Box(modifier.pixelPanel(look.backdrop.last(), if (selected) look.tint else CityPopColors.Line).padding(2.dp)) {
        Box(Modifier.matchParentSize().background(Brush.linearGradient(look.backdrop)))
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                CityPopPixelSprite(look.sprite, look.tint, 27.dp)
                Spacer(Modifier.weight(1f))
                PixelText("0$number", look.tint.copy(alpha = 0.5f), 20.sp)
            }
            PixelText(station.title, Color.White, 14.sp, Modifier.padding(top = 12.dp), shadow = Color.Black)
            Text(station.description, color = Color.White.copy(alpha = 0.6f), fontSize = 12.sp, lineHeight = 18.sp, minLines = 2, modifier = Modifier.padding(top = 6.dp, bottom = 12.dp))
            if (enabled) Row(verticalAlignment = Alignment.CenterVertically) {
                CityPopButton("$tracks tracks", onBrowse, icon = Icons.Rounded.MusicNote, style = CityPopButtonStyle.Quiet)
                Spacer(Modifier.weight(1f))
                Row(
                    Modifier.height(38.dp).pixelPanel(CityPopColors.Ink, look.tint, depth = 3.dp).clickable(onClick = onPlay).padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) { PixelText("▶ Play", look.tint, 10.sp, maxLines = 1) }
            } else PixelText("Included with the pack", Color.White.copy(alpha = 0.45f), 9.sp)
        }
    }
}

/**
 * A YouTube track: its video frame under scanlines with the year and a heart, then the artist,
 * title, note and channel, and Listen / Watch. [watchOnly] (search results) shows the title and Watch.
 */
@Composable
internal fun CityPopTrackCard(
    track: CityPopTrack, favorite: Boolean, onFavorite: () -> Unit, onWatch: () -> Unit,
    modifier: Modifier = Modifier, onListen: (() -> Unit)? = null, watchOnly: Boolean = false,
) {
    Column(modifier.pixelPanel(CityPopColors.Panel, CityPopColors.Line).padding(2.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Brush.linearGradient(listOf(Color(0xFF2A0E54), CityPopColors.Night))).clickable(onClick = onWatch)) {
            AsyncImage("https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg", null, Modifier.matchParentSize().alpha(0.88f), contentScale = ContentScale.Crop)
            CityPopScanlines(Modifier.matchParentSize())
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xD90D0221)), startY = 80f)))
            PixelText(track.year?.toString() ?: if (watchOnly) "YouTube" else "City Pop", CityPopColors.Yellow, 10.sp, Modifier.align(Alignment.BottomStart).padding(start = 12.dp, bottom = 9.dp), maxLines = 1, shadow = Color.Black)
            Box(
                Modifier.align(Alignment.TopEnd).padding(9.dp).size(34.dp)
                    .pixelPanel(if (favorite) Color(0xFF2A0620) else Color(0xCC0D0221), if (favorite) CityPopColors.Pink else Color.White.copy(alpha = 0.35f), depth = 0.dp)
                    .clickable(onClick = onFavorite),
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder, if (favorite) "Remove ${track.title} from favorites" else "Save ${track.title} to favorites",
                    tint = if (favorite) CityPopColors.Pink else Color.White, modifier = Modifier.size(17.dp))
            }
        }
        Column(Modifier.padding(14.dp)) {
            if (!watchOnly) PixelText(track.artist, CityPopColors.Teal, 10.sp, maxLines = 1)
            Text(track.title, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = if (watchOnly) 2 else 1, minLines = if (watchOnly) 2 else 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
            if (!watchOnly) Text(track.note, color = Color.White.copy(alpha = 0.5f), fontSize = 12.sp, lineHeight = 18.sp, minLines = 2, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
            Text("YouTube · ${track.channel}", color = Color.White.copy(alpha = if (watchOnly) 0.5f else 0.35f), fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp, bottom = 12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (onListen != null && !watchOnly) CityPopButton("Listen", onListen, Modifier.weight(1f), icon = Icons.Rounded.Headphones, style = CityPopButtonStyle.Primary)
                CityPopButton("Watch", onWatch, Modifier.weight(1f), icon = Icons.Rounded.Tv, style = if (watchOnly) CityPopButtonStyle.Primary else CityPopButtonStyle.Outline)
            }
        }
    }
}

/** Faint CRT lines over a picture. */
@Composable
internal fun CityPopScanlines(modifier: Modifier) {
    Canvas(modifier) {
        val gap = 1.5.dp.toPx()
        var y = 0f
        while (y < size.height) { drawRect(Color(0x4A0A001E), Offset(0f, y), Size(size.width, gap)); y += gap * 2.5f }
    }
}

/** An Archive album or video collection: its cover under scanlines with an Audio/Video badge, title and creator. */
@Composable
internal fun CityPopAlbumCard(item: CityPopArchiveItem, video: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.pixelPanel(CityPopColors.Panel, CityPopColors.Line).clickable(onClick = onClick).padding(2.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(if (video) 16f / 9f else 1f).background(Brush.linearGradient(listOf(Color(0xFF2A0E54), CityPopColors.Night))), contentAlignment = Alignment.Center) {
            Icon(if (item.mediaType == "video") Icons.Rounded.Tv else Icons.Rounded.Album, null, tint = CityPopColors.Pink.copy(alpha = 0.35f), modifier = Modifier.size(40.dp))
            AsyncImage(item.coverUrl, null, Modifier.matchParentSize(), contentScale = ContentScale.Crop)
            CityPopScanlines(Modifier.matchParentSize())
            Row(
                Modifier.align(Alignment.BottomStart).padding(8.dp).pixelPanel(Color(0xDD0D0221), Color.White.copy(alpha = 0.25f), depth = 0.dp).padding(horizontal = 7.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (item.mediaType == "video") Icons.Rounded.Tv else Icons.Rounded.Headphones, null, tint = Color.White, modifier = Modifier.size(12.dp))
                Spacer(Modifier.width(5.dp))
                PixelText(if (item.mediaType == "video") "Video" else "Audio", Color.White, 9.sp, maxLines = 1)
            }
        }
        Column(Modifier.padding(12.dp)) {
            Text(item.title, color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, lineHeight = 18.sp, minLines = 2, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(item.creator.ifBlank { "Internet Archive" }, item.year?.toString()).joinToString(" · "), color = Color.White.copy(alpha = 0.45f), fontSize = 10.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

/** "1.9 MB", as on desktop. */
internal fun cityPopSize(bytes: Long?): String = when {
    bytes == null || bytes < 0 -> ""
    bytes >= 1L shl 30 -> String.format(java.util.Locale.US, "%.1f GB", bytes / (1L shl 30).toDouble())
    bytes >= 1L shl 20 -> String.format(java.util.Locale.US, "%.1f MB", bytes / (1L shl 20).toDouble())
    else -> "${Math.round(bytes / 1024.0)} KB"
}
