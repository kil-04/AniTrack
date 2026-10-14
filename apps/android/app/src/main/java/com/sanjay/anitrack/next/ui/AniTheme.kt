package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * AniTrack's design tokens, matching the desktop app (apps/desktop/renderer/index.css):
 * midnight blue-black surfaces stepped up by elevation, hairline borders, and an azure
 * accent that turns a deep royal blue in manga mode. Screens use these instead of ad-hoc
 * colours.
 */
object AniColors {
    /** Set by the app shell; reading the accent in composition recomposes on a mode change. */
    val mangaMode = mutableStateOf(false)

    val Bg = Color(0xFF05060B)
    /** Cards and panels. */
    val Surface = Color(0xFF0C0F19)
    /** Inputs, chips and raised controls. */
    val SurfaceHigh = Color(0xFF111522)
    val SurfaceHighest = Color(0xFF191E2F)
    val Border = Color(0x1AFFFFFF)
    val BorderSoft = Color(0x0FFFFFFF)

    // Manga: a deep royal blue into navy indigo, clearly darker than anime's azure.
    val Accent: Color get() = if (mangaMode.value) Color(0xFF1D4ED8) else Color(0xFF3D8BFF)
    val AccentBright: Color get() = if (mangaMode.value) Color(0xFF3563E9) else Color(0xFF6EA8FF)
    val AccentDeep: Color get() = if (mangaMode.value) Color(0xFF2E2C9E) else Color(0xFF635BFF)
    /** The accent at low opacity, for selected backgrounds and icon tiles. */
    val AccentSoft: Color get() = Accent.copy(alpha = 0.18f)

    val Text = Color(0xFFECF0F8)
    val TextSecondary = Color(0xFF9EA7BD)
    val TextTertiary = Color(0xFF656F87)

    val Success = Color(0xFF34D399)
    val Warning = Color(0xFFFBBF24)
    val Danger = Color(0xFFFF6B6B)
    val Info = Color(0xFF22D3EE)
    val Star = Color(0xFFFFC857)

    val BrandGradient: Brush get() = Brush.linearGradient(listOf(AccentBright, Accent, AccentDeep))
}

private fun aniDarkScheme(accent: Color, deep: Color) = darkColorScheme(
    primary = accent,
    onPrimary = Color.White,
    primaryContainer = deep.copy(alpha = 0.32f).compositeOver(AniColors.Bg),
    onPrimaryContainer = Color(0xFFDCE6FF),
    inversePrimary = deep,
    secondary = Color(0xFFE2E7F2),
    onSecondary = Color(0xFF111522),
    secondaryContainer = Color(0xFF1A2033),
    onSecondaryContainer = AniColors.Text,
    tertiary = AniColors.Info,
    onTertiary = Color(0xFF002025),
    tertiaryContainer = Color(0xFF0C3440),
    onTertiaryContainer = Color(0xFFA5F3FC),
    background = AniColors.Bg,
    onBackground = AniColors.Text,
    surface = AniColors.Bg,
    onSurface = AniColors.Text,
    surfaceVariant = Color(0xFF161B2B),
    onSurfaceVariant = AniColors.TextSecondary,
    surfaceTint = Color(0xFF7E8AA8),
    inverseSurface = AniColors.Text,
    inverseOnSurface = Color(0xFF111522),
    error = AniColors.Danger,
    onError = Color(0xFF2D0001),
    errorContainer = Color(0xFF4A1014),
    onErrorContainer = Color(0xFFFFDAD6),
    outline = Color(0xFF2F3650),
    outlineVariant = Color(0xFF1E2436),
    scrim = Color.Black,
    surfaceBright = Color(0xFF262C40),
    surfaceDim = AniColors.Bg,
    surfaceContainerLowest = Color(0xFF030409),
    surfaceContainerLow = Color(0xFF0A0D16),
    surfaceContainer = Color(0xFF0E1220),
    surfaceContainerHigh = Color(0xFF131827),
    surfaceContainerHighest = Color(0xFF1A2032),
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
    val accent = AniColors.Accent
    val deep = AniColors.AccentDeep
    val scheme = remember(accent, deep) { aniDarkScheme(accent, deep) }
    MaterialTheme(colorScheme = scheme, typography = AniTypography, shapes = AniShapes, content = content)
}
