package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontSynthesis
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * AniTrack's design tokens, matching the desktop app (apps/desktop/renderer/index.css):
 * midnight blue-black surfaces stepped up by elevation, hairline borders, and an azure
 * accent that turns a deep royal blue in manga mode. Pixel mode (Settings → Appearance,
 * desktop's `[data-skin="pixel"]`) keeps these blues or, with its neon colours, swaps in
 * City Pop's retrowave palette: night-purple surfaces and a hot pink accent (electric violet
 * in manga mode). Screens use these instead of ad-hoc colours, and [aniShape] instead of
 * RoundedCornerShape.
 */
object AniColors {
    /** Set by the app shell; reading the accent in composition recomposes on a mode change. */
    val mangaMode = mutableStateOf(false)
    /** Pixel mode, saved as [PIXEL_MODE_PREF]; reading any token recomposes when it changes. */
    val pixelMode = mutableStateOf(false)
    const val PIXEL_MODE_PREF = "pixel_mode"
    /** Pixel mode in AniTrack's blue instead of neon, saved as [PIXEL_BLUE_PREF]. */
    val pixelBlue = mutableStateOf(false)
    const val PIXEL_BLUE_PREF = "pixel_palette_blue"
    /** Pixel mode's animated background and bobbing sprites, saved as [PIXEL_MOTION_PREF]; on unless turned off. */
    val pixelMotion = mutableStateOf(true)
    const val PIXEL_MOTION_PREF = "pixel_motion"

    /** Pixel mode's neon palette. */
    val neon: Boolean get() = pixelMode.value && !pixelBlue.value
    /** Pixel mode's blue palette: AniTrack blue in an uncertain future (cold navy, cyan neon, a red glitch edge). */
    val retroBlue: Boolean get() = pixelMode.value && pixelBlue.value

    /** The token for the current look: Pixel mode's [neon] or [blue] palette, else the default. */
    private fun pick(neon: Long, blue: Long, default: Long) = Color(if (this.neon) neon else if (retroBlue) blue else default)
    private fun pickMode(neon: Long, neonManga: Long, blue: Long, blueManga: Long, default: Long, defaultManga: Long) =
        if (mangaMode.value) pick(neonManga, blueManga, defaultManga) else pick(neon, blue, default)

    val Bg: Color get() = pick(0xFF0D0221, 0xFF03070F, 0xFF05060B)
    /** Cards and panels. */
    val Surface: Color get() = pick(0xFF160A2E, 0xFF0A1424, 0xFF0C0F19)
    /** Inputs, chips and raised controls. */
    val SurfaceHigh: Color get() = pick(0xFF1F0F3E, 0xFF0F1C30, 0xFF111522)
    val SurfaceHighest: Color get() = pick(0xFF2C1654, 0xFF16263F, 0xFF191E2F)
    val Border: Color get() = pick(0xFF3B1D63, 0xFF1E3A5C, 0x1AFFFFFF)
    val BorderSoft: Color get() = pick(0x993B1D63, 0x991E3A5C, 0x0FFFFFFF)

    // Manga: a deep royal blue into navy indigo, clearly darker than anime's azure.
    val Accent: Color get() = pickMode(0xFFFF2A9D, 0xFF8B3DFF, 0xFF00A8FF, 0xFF3A6CFF, 0xFF3D8BFF, 0xFF1D4ED8)
    val AccentBright: Color get() = pickMode(0xFFFF7AC6, 0xFFB080FF, 0xFF00F0FF, 0xFF00F0FF, 0xFF6EA8FF, 0xFF3563E9)
    val AccentDeep: Color get() = pickMode(0xFFB026FF, 0xFF2E78FF, 0xFFFF2E63, 0xFFFF2E63, 0xFF635BFF, 0xFF2E2C9E)
    /** The accent at low opacity, for selected backgrounds and icon tiles. */
    val AccentSoft: Color get() = Accent.copy(alpha = 0.18f)

    val Text: Color get() = pick(0xFFF6EEFF, 0xFFDDEBFA, 0xFFECF0F8)
    val TextSecondary: Color get() = pick(0xFFCDB4FF, 0xFF8FA8C8, 0xFF9EA7BD)
    val TextTertiary: Color get() = pick(0xFF967CCD, 0xFF56708F, 0xFF656F87)

    val Success = Color(0xFF34D399)
    val Warning = Color(0xFFFBBF24)
    val Danger = Color(0xFFFF6B6B)
    val Info: Color get() = pick(0xFF2EE6FF, 0xFF00F0FF, 0xFF22D3EE)
    val Star = Color(0xFFFFC857)
    /** Pixel mode's hard drop shadow. */
    val PixelShadow: Color get() = pick(0xFF050010, 0xFF000208, 0xFF050010)

    /** Pixel mode bands the gradient into three hard steps, as on desktop. */
    val BrandGradient: Brush get() = if (pixelMode.value) Brush.linearGradient(
        0f to AccentBright, 0.3f to AccentBright, 0.3f to Accent, 0.68f to Accent, 0.68f to AccentDeep, 1f to AccentDeep,
    ) else Brush.linearGradient(listOf(AccentBright, Accent, AccentDeep))
}

/**
 * Pixel mode's corners: each one notched by a single [step] square, like a sprite's. Steps are
 * capped at a quarter of the shorter side, so small chips and dots keep their shape.
 */
class PixelCornerShape(private val step: Dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val s = with(density) { step.toPx() }.coerceAtMost(minOf(size.width, size.height) / 4f)
        if (s < 1f) return Outline.Rectangle(androidx.compose.ui.geometry.Rect(0f, 0f, size.width, size.height))
        val w = size.width; val h = size.height
        return Outline.Generic(Path().apply {
            moveTo(s, 0f); lineTo(w - s, 0f); lineTo(w - s, s); lineTo(w, s)
            lineTo(w, h - s); lineTo(w - s, h - s); lineTo(w - s, h); lineTo(s, h)
            lineTo(s, h - s); lineTo(0f, h - s); lineTo(0f, s); lineTo(s, s); close()
        })
    }

    override fun equals(other: Any?) = other is PixelCornerShape && other.step == step
    override fun hashCode() = step.hashCode()
}

/** Rounded corners of [radius], or in Pixel mode square ones notched like a sprite's. */
fun aniShape(radius: Dp): Shape = when {
    !AniColors.pixelMode.value -> RoundedCornerShape(radius)
    radius <= 4.dp -> RectangleShape
    else -> PixelCornerShape(if (radius >= 16.dp) 4.dp else 3.dp)
}

/** Rounded corners of [percent] of the shorter side (50: a pill), or Pixel mode's notched corners. */
fun aniShape(percent: Int): Shape = if (AniColors.pixelMode.value) PixelCornerShape(3.dp) else RoundedCornerShape(percent)

/** Material's colours for the current look ([neon] / [blue]: Pixel mode's palettes). */
private fun aniDarkScheme(accent: Color, deep: Color, neon: Boolean, blue: Boolean) = darkColorScheme(
    primary = accent,
    onPrimary = Color.White,
    // Blue Pixel mode's deep accent is its red glitch edge, so its containers take the cyan instead.
    primaryContainer = (if (blue) accent else deep).copy(alpha = 0.32f).compositeOver(AniColors.Bg),
    onPrimaryContainer = if (neon) Color(0xFFFFDDF0) else if (blue) Color(0xFFD6F4FF) else Color(0xFFDCE6FF),
    inversePrimary = deep,
    secondary = if (neon) Color(0xFFF1E4FF) else if (blue) Color(0xFFDDEBFA) else Color(0xFFE2E7F2),
    onSecondary = if (neon) Color(0xFF1F0F3E) else if (blue) Color(0xFF0F1C30) else Color(0xFF111522),
    secondaryContainer = if (neon) Color(0xFF2C1654) else if (blue) Color(0xFF16263F) else Color(0xFF1A2033),
    onSecondaryContainer = AniColors.Text,
    tertiary = AniColors.Info,
    onTertiary = Color(0xFF002025),
    tertiaryContainer = Color(0xFF0C3440),
    onTertiaryContainer = Color(0xFFA5F3FC),
    background = AniColors.Bg,
    onBackground = AniColors.Text,
    surface = AniColors.Bg,
    onSurface = AniColors.Text,
    surfaceVariant = if (neon) Color(0xFF24104A) else if (blue) Color(0xFF101E33) else Color(0xFF161B2B),
    onSurfaceVariant = AniColors.TextSecondary,
    surfaceTint = if (neon) Color(0xFF9A6BD8) else if (blue) Color(0xFF3C7FB0) else Color(0xFF7E8AA8),
    inverseSurface = AniColors.Text,
    inverseOnSurface = if (neon) Color(0xFF1F0F3E) else if (blue) Color(0xFF0F1C30) else Color(0xFF111522),
    error = AniColors.Danger,
    onError = Color(0xFF2D0001),
    errorContainer = Color(0xFF4A1014),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = if (neon) Color(0xFF5A2E8F) else if (blue) Color(0xFF2A5078) else Color(0xFF2F3650),
    outlineVariant = if (neon) Color(0xFF3B1D63) else if (blue) Color(0xFF1E3A5C) else Color(0xFF1E2436),
    scrim = Color.Black,
    surfaceBright = if (neon) Color(0xFF341A60) else if (blue) Color(0xFF1C3050) else Color(0xFF262C40),
    surfaceDim = AniColors.Bg,
    surfaceContainerLowest = if (neon) Color(0xFF08011A) else if (blue) Color(0xFF02040A) else Color(0xFF030409),
    surfaceContainerLow = if (neon) Color(0xFF120628) else if (blue) Color(0xFF060E1C) else Color(0xFF0A0D16),
    surfaceContainer = if (neon) Color(0xFF170A32) else if (blue) Color(0xFF0B1628) else Color(0xFF0E1220),
    surfaceContainerHigh = if (neon) Color(0xFF1F0F3E) else if (blue) Color(0xFF0F1C30) else Color(0xFF131827),
    surfaceContainerHighest = if (neon) Color(0xFF2A1450) else if (blue) Color(0xFF15243B) else Color(0xFF1A2032),
)

private val Base = Typography()

private val AniTypography = Typography(
    displayLarge = Base.displayLarge.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-1).sp),
    displayMedium = Base.displayMedium.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.8).sp),
    displaySmall = Base.displaySmall.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.6).sp),
    headlineLarge = Base.headlineLarge.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp),
    headlineMedium = Base.headlineMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp),
    headlineSmall = Base.headlineSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.3).sp),
    titleLarge = Base.titleLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.2).sp),
    titleMedium = Base.titleMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
    titleSmall = Base.titleSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
    bodyLarge = Base.bodyLarge,
    bodyMedium = Base.bodyMedium,
    bodySmall = Base.bodySmall,
    labelLarge = Base.labelLarge.copy(fontWeight = FontWeight.SemiBold),
    labelMedium = Base.labelMedium.copy(fontWeight = FontWeight.Medium),
    labelSmall = Base.labelSmall.copy(fontWeight = FontWeight.Medium, letterSpacing = 0.3.sp),
)

/**
 * The pixel font for headings, row titles and button labels, about 0.8 × the size so its capitals
 * stand as tall as Roboto's; card titles and body text stay in Roboto for reading.
 */
private fun TextStyle.pixel(size: TextUnit) = copy(
    fontFamily = CityPopPixelFont, fontWeight = FontWeight.Normal, fontSynthesis = FontSynthesis.None,
    fontSize = size, lineHeight = size * 1.35f, letterSpacing = 0.5.sp,
)

private val PixelTypography = AniTypography.copy(
    displayLarge = AniTypography.displayLarge.pixel(44.sp),
    displayMedium = AniTypography.displayMedium.pixel(36.sp),
    displaySmall = AniTypography.displaySmall.pixel(28.sp),
    headlineLarge = AniTypography.headlineLarge.pixel(26.sp),
    headlineMedium = AniTypography.headlineMedium.pixel(22.sp),
    headlineSmall = AniTypography.headlineSmall.pixel(19.sp),
    titleLarge = AniTypography.titleLarge.pixel(17.sp),
    labelLarge = AniTypography.labelLarge.pixel(12.sp),
)

private val AniShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/** Material's shape slots take corner-based shapes, so Pixel mode cuts every corner square. */
private val PixelShapes = Shapes(
    extraSmall = RoundedCornerShape(0.dp),
    small = RoundedCornerShape(0.dp),
    medium = RoundedCornerShape(0.dp),
    large = RoundedCornerShape(0.dp),
    extraLarge = RoundedCornerShape(0.dp),
)

/** The app theme: every Material component (buttons, switches, chips, dialogs) picks up the AniTrack palette. */
@Composable
fun AniTrackTheme(content: @Composable () -> Unit) {
    val accent = AniColors.Accent
    val deep = AniColors.AccentDeep
    val pixel = AniColors.pixelMode.value
    val neon = AniColors.neon
    val blue = AniColors.retroBlue
    val scheme = remember(accent, deep, neon, blue) { aniDarkScheme(accent, deep, neon, blue) }
    MaterialTheme(
        colorScheme = scheme,
        typography = if (pixel) PixelTypography else AniTypography,
        shapes = if (pixel) PixelShapes else AniShapes,
        content = content,
    )
}
