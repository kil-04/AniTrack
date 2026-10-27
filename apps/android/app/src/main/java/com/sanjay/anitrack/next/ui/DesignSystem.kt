package com.sanjay.anitrack.next.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.sanjay.anitrack.next.R

// Shared building blocks for every screen. Keep screens on these so spacing,
// shapes and colours stay consistent across anime and manga mode.

/**
 * The AniTrack logo: the brand art (res/drawable-nodpi/brand_logo.png) in a rounded tile.
 * The launcher icon (res/mipmap-*) and the desktop icons come from the same art.
 */
@Composable
fun AniLogo(modifier: Modifier = Modifier, size: Dp = 28.dp) {
    val shape = aniShape(size * 0.28f)
    Image(
        painter = painterResource(R.drawable.brand_logo),
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier.size(size).clip(shape).border(1.dp, Color.White.copy(alpha = 0.15f), shape),
    )
}

/** Logo mark plus the two-tone "AniTrack" wordmark. */
@Composable
fun AniWordmark(modifier: Modifier = Modifier, compact: Boolean = false) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        AniLogo(size = if (compact) 26.dp else 30.dp)
        Spacer(Modifier.width(if (compact) 7.dp else 9.dp))
        if (AniColors.pixelMode.value) PixelWordmarkText(compact) else Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = AniColors.Text)) { append("Ani") }
                withStyle(SpanStyle(brush = AniColors.BrandGradient)) { append("Track") }
            },
            style = if (compact) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = (-0.4).sp,
        )
    }
}

/** A tinted rounded square holding an icon (screen headers, settings sections). */
@Composable
fun IconTile(
    icon: ImageVector,
    modifier: Modifier = Modifier,
    tint: Color = AniColors.Accent,
    background: Color = AniColors.AccentSoft,
    size: Dp = 44.dp,
) {
    val shape = aniShape(size * 0.28f)
    Box(
        modifier.size(size).clip(shape).background(background).border(1.dp, tint.copy(alpha = 0.22f), shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(size * 0.52f))
    }
}

/** Page title block: icon tile, title, subtitle and optional trailing actions. */
@Composable
fun ScreenHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: ImageVector? = null,
    /** Pixel mode's banner picture (PixelScene); [pixelBanner] false keeps the plain header there too. */
    scene: String = PixelScene.NEON_CITY,
    pixelBanner: Boolean = true,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    if (pixelBanner && AniColors.pixelMode.value) {
        Column(modifier.fillMaxWidth()) {
            PixelBanner(scene, title, subtitle, icon)
            // The actions go under the banner; with none, no gap is left.
            Row(
                Modifier.fillMaxWidth().layout { measurable, constraints ->
                    val placeable = measurable.measure(constraints)
                    if (placeable.height == 0) layout(placeable.width, 0) {}
                    else {
                        val gap = 8.dp.roundToPx()
                        layout(placeable.width, placeable.height + gap) { placeable.place(0, gap) }
                    }
                },
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
                content = trailing,
            )
        }
        return
    }
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) {
            IconTile(icon, size = 50.dp)
            Spacer(Modifier.width(16.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(
                title,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle != null) {
                Spacer(Modifier.height(2.dp))
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = AniColors.TextSecondary)
            }
        }
        trailing()
    }
}

/** Pixel mode's row marker: three accent blocks stepping down, like a sprite's stairs. */
@Composable
private fun PixelStairs() {
    Canvas(Modifier.size(width = 15.dp, height = 18.dp)) {
        val cell = 5.dp.toPx()
        drawRect(AniColors.AccentBright, Offset(0f, 0f), Size(cell, cell))
        drawRect(AniColors.Accent, Offset(cell, cell), Size(cell, cell))
        drawRect(AniColors.AccentDeep, Offset(cell * 2, cell * 2), Size(cell, cell))
        drawRect(AniColors.Accent, Offset(0f, cell), Size(cell, cell * 2.6f))
    }
}

/** Row title with the brand bar; [onClick] adds a "See all" affordance. */
@Composable
internal fun SectionHeader(
    title: String,
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    actionLabel: String = "See all",
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().padding(start = 16.dp, end = 10.dp, top = 18.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (AniColors.pixelMode.value) {
            // The row's own sprite ("Continue Watching": the TV) or the stairs.
            val context = LocalContext.current
            val sprite = remember(title) { com.sanjay.anitrack.next.data.PixelSprites.load(context).forSection(title) }
            if (sprite != null) PixelSprite(sprite, width = 26.dp) else PixelStairs()
        } else Box(
            Modifier.width(4.dp).height(22.dp)
                .shadow(6.dp, aniShape(2.dp), ambientColor = AniColors.Accent, spotColor = AniColors.Accent)
                .clip(aniShape(2.dp)).background(AniColors.BrandGradient),
        )
        Spacer(Modifier.width(10.dp))
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        trailing?.invoke(this)
        if (onClick != null) {
            Row(
                Modifier.clip(aniShape(50)).clickable(onClick = onClick)
                    .padding(start = 12.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(actionLabel, style = MaterialTheme.typography.labelLarge, color = AniColors.TextSecondary)
                Icon(Icons.Rounded.ChevronRight, null, tint = AniColors.TextSecondary, modifier = Modifier.size(20.dp))
            }
        }
    }
}

/** Friendly empty / error state: icon, title, message and an optional action. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(vertical = 48.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val tile = aniShape(24.dp)
        // Pixel mode draws a sprite for the occasion (pixelSpriteForIcon) instead of the icon.
        if (AniColors.pixelMode.value) BobbingSprite(pixelSpriteForIcon(icon.name), 72.dp)
        else Box(
            Modifier.size(76.dp).clip(tile).background(AniColors.Accent.copy(alpha = 0.13f))
                .border(1.dp, AniColors.Accent.copy(alpha = 0.25f), tile),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = AniColors.Accent, modifier = Modifier.size(34.dp))
        }
        Spacer(Modifier.height(18.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(
            message,
            style = MaterialTheme.typography.bodyMedium,
            color = AniColors.TextSecondary,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 440.dp),
        )
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(20.dp))
            PillButton(actionLabel, onAction, style = PillStyle.Primary)
        }
    }
}

enum class TagTone { Accent, Neutral, Glass, Success, SuccessSolid, Info, Outline }

/** Small uppercase-ish badge: EP/CH numbers, NEW, formats, statuses. */
@Composable
fun Tag(
    text: String,
    modifier: Modifier = Modifier,
    tone: TagTone = TagTone.Neutral,
    icon: ImageVector? = null,
) {
    val (bg, fg) = when (tone) {
        TagTone.Accent -> AniColors.Accent to Color.White
        TagTone.Neutral -> AniColors.SurfaceHighest to AniColors.Text
        TagTone.Glass -> Color.Black.copy(alpha = 0.55f) to Color.White
        TagTone.Success -> AniColors.Success.copy(alpha = 0.16f) to AniColors.Success
        TagTone.SuccessSolid -> AniColors.Success to Color(0xFF04261A)
        TagTone.Info -> AniColors.Info.copy(alpha = 0.16f) to AniColors.Info
        TagTone.Outline -> Color.Transparent to AniColors.TextSecondary
    }
    val shape = aniShape(6.dp)
    Row(
        modifier.clip(shape)
            .then(if (tone == TagTone.Accent) Modifier.background(AniColors.BrandGradient) else Modifier.background(bg))
            .then(
                when (tone) {
                    TagTone.Outline -> Modifier.border(1.dp, AniColors.Border, shape)
                    TagTone.Glass -> Modifier.border(1.dp, Color.White.copy(alpha = 0.15f), shape)
                    else -> Modifier
                },
            )
            .padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = fg, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(3.dp))
        }
        Text(text, color = fg, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

/** AniList's 0–100 average score as "8.6". */
fun aniScore(score: Int?): String? =
    score?.takeIf { it > 0 }?.let { String.format(java.util.Locale.US, "%.1f", it / 10.0) }

/** Star + score; [onImage] adds a dark backing for use over artwork. */
@Composable
fun ScoreBadge(text: String?, modifier: Modifier = Modifier, onImage: Boolean = false) {
    if (text.isNullOrBlank()) return
    Row(
        modifier.clip(aniShape(6.dp))
            .background(if (onImage) Color.Black.copy(alpha = 0.62f) else Color.Transparent)
            .padding(horizontal = if (onImage) 6.dp else 0.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Star, null, tint = AniColors.Star, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(3.dp))
        Text(
            text,
            color = if (onImage) Color.White else AniColors.Text,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

/** A sweeping highlight for content that is still loading. */
fun Modifier.shimmer(): Modifier = composed {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing)),
        label = "shimmer-progress",
    )
    drawWithContent {
        drawContent()
        val w = size.width
        val x = -w + progress * (2f * w + size.height)
        drawRect(
            Brush.linearGradient(
                listOf(Color.Transparent, Color.White.copy(alpha = 0.07f), Color.Transparent),
                start = Offset(x, 0f),
                end = Offset(x + w * 0.7f, size.height),
            ),
        )
    }
}

/** A loading placeholder block. */
@Composable
fun SkeletonBox(modifier: Modifier = Modifier, corner: Dp = 12.dp) {
    Box(modifier.clip(aniShape(corner)).background(AniColors.SurfaceHigh).shimmer())
}

/** Cover / banner art: crossfades in over a shimmering placeholder. */
@Composable
fun PosterImage(
    model: Any?,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    alignment: Alignment = Alignment.Center,
    contentScale: ContentScale = ContentScale.Crop,
    /** In Pixel mode, decode the image this coarse and scale it up crisp (the Home hero); null keeps it sharp. */
    pixelCell: Dp? = null,
) {
    val context = LocalContext.current
    var loading by remember(model) { mutableStateOf(model != null) }
    val pixel = AniColors.pixelMode.value && pixelCell != null
    BoxWithConstraints(modifier.background(AniColors.SurfaceHigh).then(if (loading) Modifier.shimmer() else Modifier)) {
    val cellPx = with(LocalDensity.current) { (pixelCell ?: 1.dp).toPx() }.coerceAtLeast(1f)
    val pixelSize = if (pixel && constraints.hasBoundedWidth && constraints.hasBoundedHeight && constraints.maxWidth > 0 && constraints.maxHeight > 0)
        coil.size.Size((constraints.maxWidth / cellPx).toInt().coerceAtLeast(8), (constraints.maxHeight / cellPx).toInt().coerceAtLeast(8)) else null
    val request = remember(model, pixelSize) {
        ImageRequest.Builder(context).data(model).crossfade(220).apply {
            if (pixelSize != null) size(pixelSize).scale(coil.size.Scale.FILL).precision(coil.size.Precision.EXACT)
        }.build()
    }
        if (model == null) {
            Icon(
                Icons.Rounded.Image, null, tint = AniColors.TextTertiary,
                modifier = Modifier.align(Alignment.Center).size(28.dp),
            )
        } else {
            AsyncImage(
                model = request,
                contentDescription = contentDescription,
                contentScale = contentScale,
                alignment = alignment,
                onSuccess = { loading = false },
                onError = { loading = false },
                filterQuality = if (pixelSize != null) FilterQuality.None else FilterQuality.Low,
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

/** Primary and Light are the main actions (accent gradient); Tonal is glass; Outline and Ghost are quiet. */
enum class PillStyle { Primary, Light, Tonal, Outline, Ghost }

/** The app's button: a pill with an optional leading icon (or a spinner while [loading]). */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    style: PillStyle = PillStyle.Tonal,
    enabled: Boolean = true,
    loading: Boolean = false,
    compact: Boolean = false,
    trailingIcon: ImageVector? = null,
) {
    val (bg, fg) = when (style) {
        PillStyle.Primary, PillStyle.Light -> AniColors.Accent to Color.White
        PillStyle.Tonal -> Color.White.copy(alpha = 0.08f) to AniColors.Text
        PillStyle.Outline -> Color.Transparent to AniColors.Text
        PillStyle.Ghost -> Color.Transparent to AniColors.TextSecondary
    }
    val alpha = if (enabled) 1f else 0.45f
    val shape = aniShape(if (compact) 12.dp else 14.dp)
    val gradient = style == PillStyle.Primary || style == PillStyle.Light
    Row(
        modifier.height(if (compact) 36.dp else 46.dp)
            .then(
                if (gradient && enabled) Modifier.shadow(12.dp, shape, ambientColor = AniColors.Accent, spotColor = AniColors.Accent)
                else Modifier,
            )
            .clip(shape)
            .then(
                if (gradient) Modifier.background(AniColors.BrandGradient, alpha = alpha)
                else Modifier.background(bg.copy(alpha = bg.alpha * alpha)),
            )
            .then(
                when (style) {
                    PillStyle.Outline -> Modifier.border(1.dp, AniColors.Border, shape)
                    PillStyle.Tonal -> Modifier.border(1.dp, Color.White.copy(alpha = 0.12f), shape)
                    else -> Modifier
                },
            )
            .clickable(enabled = enabled && !loading, onClick = onClick)
            .padding(horizontal = if (compact) 14.dp else 20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        val iconSize = if (compact) 16.dp else 19.dp
        if (loading) {
            CircularProgressIndicator(color = fg, strokeWidth = 2.dp, modifier = Modifier.size(iconSize))
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, null, tint = fg.copy(alpha = alpha), modifier = Modifier.size(iconSize))
            Spacer(Modifier.width(8.dp))
        }
        Text(
            text,
            color = fg.copy(alpha = alpha),
            style = if (compact) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
        if (trailingIcon != null) {
            Spacer(Modifier.width(6.dp))
            Icon(trailingIcon, null, tint = fg.copy(alpha = alpha), modifier = Modifier.size(iconSize))
        }
    }
}

/** Pill-shaped tabs with optional counts (My List statuses, Day/Week/Month). */
@Composable
fun PillTabs(
    options: List<Pair<String, String>>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    counts: Map<String, Int> = emptyMap(),
    compact: Boolean = false,
) {
    LazyRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(options.size) { i ->
            val (key, label) = options[i]
            val on = key == selected
            val shape = aniShape(50)
            Row(
                Modifier.height(if (compact) 32.dp else 38.dp).clip(shape)
                    .background(if (on) AniColors.AccentSoft else AniColors.SurfaceHigh)
                    .border(1.dp, if (on) AniColors.Accent.copy(alpha = 0.45f) else AniColors.BorderSoft, shape)
                    .clickable(enabled = !on) { onSelect(key) }
                    .padding(horizontal = if (compact) 12.dp else 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    label,
                    color = if (on) Color.White else AniColors.TextSecondary,
                    style = if (compact) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
                    fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                )
                counts[key]?.let { count ->
                    Spacer(Modifier.width(7.dp))
                    Text(
                        "$count",
                        color = if (on) AniColors.AccentBright else AniColors.TextTertiary,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

/** A round dark button for use over artwork (dismiss, close). */
@Composable
fun GlassIconButton(
    icon: ImageVector,
    contentDescription: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 28.dp,
) {
    Box(
        modifier.size(size).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f))
            .border(1.dp, Color.White.copy(alpha = 0.14f), CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription, tint = Color.White, modifier = Modifier.size(size * 0.55f))
    }
}

/** Thin rounded progress bar (watch / read progress). */
@Composable
fun ProgressStrip(
    fraction: Float,
    modifier: Modifier = Modifier,
    height: Dp = 4.dp,
    color: Color = AniColors.Accent,
    track: Color = Color.White.copy(alpha = 0.22f),
) {
    Box(modifier.height(height).clip(aniShape(50)).background(track)) {
        Box(
            Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).fillMaxHeight()
                .clip(aniShape(50))
                .then(
                    if (color == AniColors.Accent) Modifier.background(Brush.horizontalGradient(listOf(AniColors.AccentBright, AniColors.Accent)))
                    else Modifier.background(color),
                ),
        )
    }
}

/** Bordered surface card, lit slightly from the top like the desktop panels. */
@Composable
fun AniCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(18.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = aniShape(18.dp)
    Column(
        modifier.fillMaxWidth().clip(shape)
            .background(Brush.verticalGradient(listOf(AniColors.SurfaceHigh, AniColors.Surface)))
            .border(1.dp, Color.White.copy(alpha = 0.07f), shape)
            .padding(padding),
        content = content,
    )
}

/** Darkens the bottom of artwork so text on it stays legible. */
val BottomScrim = Brush.verticalGradient(
    0f to Color.Transparent,
    0.45f to Color.Black.copy(alpha = 0.12f),
    1f to Color.Black.copy(alpha = 0.92f),
)

/** "2026 · TV · 12 eps" style metadata line. */
fun metaLine(vararg parts: String?): String = parts.filterNotNull().filter { it.isNotBlank() }.joinToString(" · ")

/** AniList media format as shown to people ("TV_SHORT" → "TV Short"). */
fun formatLabel(format: String?): String? = when (format) {
    null, "" -> null
    "TV" -> "TV"
    "TV_SHORT" -> "TV Short"
    "MOVIE" -> "Movie"
    "OVA", "ONA" -> format
    "SPECIAL" -> "Special"
    "MUSIC" -> "Music"
    "ONE_SHOT" -> "One-shot"
    "NOVEL" -> "Novel"
    "MANGA" -> "Manga"
    else -> format.lowercase().replaceFirstChar { it.uppercase() }.replace('_', ' ')
}

/** AniList anime status as shown to people. */
fun airingLabel(status: String?): String? = when (status) {
    null, "" -> null
    "RELEASING" -> "Airing"
    "FINISHED" -> "Finished"
    "NOT_YET_RELEASED" -> "Upcoming"
    "HIATUS" -> "On hiatus"
    "CANCELLED" -> "Cancelled"
    else -> status.lowercase().replaceFirstChar { it.uppercase() }
}
