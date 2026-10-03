package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * AniTrack's design tokens. Screens use these instead of ad-hoc colours so the
 * whole app shares one dark palette: layered near-black surfaces, hairline
 * borders and the brand red.
 */
object AniColors {
    val Bg = Color(0xFF09090B)
    /** Cards and panels. */
    val Surface = Color(0xFF121215)
    /** Inputs, chips and raised controls. */
    val SurfaceHigh = Color(0xFF1A1A1F)
    val SurfaceHighest = Color(0xFF232329)
    val Border = Color(0x1AFFFFFF)
    val BorderSoft = Color(0x0FFFFFFF)

    val Accent = Color(0xFFE50914)
    val AccentBright = Color(0xFFFF3B47)
    val AccentDeep = Color(0xFFA3060E)
    /** Brand red at low opacity, for selected backgrounds and icon tiles. */
    val AccentSoft = Color(0x2EE50914)

    val Text = Color(0xFFF4F4F5)
    val TextSecondary = Color(0xFFA1A1AA)
    val TextTertiary = Color(0xFF71717A)

    val Success = Color(0xFF34D399)
    val Warning = Color(0xFFFBBF24)
    val Danger = Color(0xFFFF6B6B)
    val Info = Color(0xFF5FC9C0)
    val Star = Color(0xFFFFC857)

    val BrandGradient = Brush.linearGradient(listOf(AccentBright, Accent, AccentDeep))
}

private val AniDarkScheme = darkColorScheme(
    primary = AniColors.Accent,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF4A0B10),
    onPrimaryContainer = Color(0xFFFFDAD8),
    inversePrimary = AniColors.AccentDeep,
    secondary = Color(0xFFE4E4E7),
    onSecondary = Color(0xFF18181B),
    secondaryContainer = Color(0xFF27272A),
    onSecondaryContainer = AniColors.Text,
    tertiary = AniColors.Info,
    onTertiary = Color(0xFF00201D),
    tertiaryContainer = Color(0xFF0F3A36),
    onTertiaryContainer = Color(0xFFA6F2E9),
    background = AniColors.Bg,
    onBackground = AniColors.Text,
    surface = AniColors.Bg,
    onSurface = AniColors.Text,
    surfaceVariant = Color(0xFF1F1F24),
    onSurfaceVariant = AniColors.TextSecondary,
    surfaceTint = Color(0xFF8A8A93),
    inverseSurface = AniColors.Text,
    inverseOnSurface = Color(0xFF18181B),
    error = AniColors.Danger,
    onError = Color(0xFF2D0001),
    errorContainer = Color(0xFF4A1014),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = Color(0xFF3F3F46),
    outlineVariant = Color(0xFF27272A),
    scrim = Color.Black,
    surfaceBright = Color(0xFF2A2A30),
    surfaceDim = AniColors.Bg,
    surfaceContainerLowest = Color(0xFF050506),
    surfaceContainerLow = Color(0xFF0F0F12),
    surfaceContainer = Color(0xFF141418),
    surfaceContainerHigh = Color(0xFF1A1A1F),
    surfaceContainerHighest = Color(0xFF222228),
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

private val AniShapes = Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

/** The app theme: every Material component (buttons, switches, chips, dialogs) picks up the AniTrack palette. */
@Composable
fun AniTrackTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = AniDarkScheme, typography = AniTypography, shapes = AniShapes, content = content)
}
