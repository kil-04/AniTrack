package com.sanjay.anitrack.next.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * Title header shared by anime and manga pages: the banner fades into the page
 * and the cover overlaps it, with title, score, metadata, genres and actions.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DetailHero(
    banner: String?,
    cover: String?,
    title: String,
    subtitle: String?,
    score: String?,
    meta: String,
    genres: List<String>,
    actions: @Composable RowScope.() -> Unit,
) {
    val wide = LocalConfiguration.current.screenWidthDp >= 820
    val bannerHeight = if (wide) 320.dp else 220.dp
    val posterWidth = if (wide) 168.dp else 112.dp
    val overlap = if (wide) 150.dp else 96.dp
    Box(Modifier.fillMaxWidth()) {
        PosterImage(banner ?: cover, null, Modifier.fillMaxWidth().height(bannerHeight), alignment = Alignment.TopCenter)
        Box(
            Modifier.fillMaxWidth().height(bannerHeight).background(
                Brush.verticalGradient(
                    0f to AniColors.Bg.copy(alpha = 0.2f),
                    0.5f to AniColors.Bg.copy(alpha = 0.5f),
                    1f to AniColors.Bg,
                ),
            ),
        )
        Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = bannerHeight - overlap)) {
            PosterImage(
                cover, title,
                Modifier.width(posterWidth).aspectRatio(1f / POSTER_RATIO)
                    .clip(RoundedCornerShape(16.dp))
                    .border(1.dp, AniColors.Border, RoundedCornerShape(16.dp)),
            )
            Spacer(Modifier.width(if (wide) 24.dp else 16.dp))
            Column(Modifier.weight(1f).padding(top = if (wide) 70.dp else 44.dp)) {
                Text(
                    title,
                    style = if (wide) MaterialTheme.typography.headlineLarge else MaterialTheme.typography.headlineSmall,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                    color = Color.White,
                )
                if (!subtitle.isNullOrBlank()) {
                    Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = AniColors.TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ScoreBadge(score)
                    if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.labelLarge, color = AniColors.TextSecondary)
                }
                if (genres.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        genres.take(6).forEach { Chip(it, subtle = true) }
                    }
                }
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
            }
        }
    }
}

/** Synopsis that shows a few lines with a Show more / Show less toggle. */
@Composable
internal fun ExpandableSynopsis(text: String?, modifier: Modifier = Modifier, collapsedLines: Int = 4) {
    if (text.isNullOrBlank()) return
    var expanded by remember(text) { mutableStateOf(false) }
    var overflows by remember(text) { mutableStateOf(false) }
    Column(modifier.padding(horizontal = 24.dp).animateContentSize()) {
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = AniColors.Text.copy(alpha = 0.78f),
            maxLines = if (expanded) Int.MAX_VALUE else collapsedLines,
            overflow = TextOverflow.Ellipsis,
            onTextLayout = { if (!expanded) overflows = it.hasVisualOverflow },
        )
        if (overflows || expanded) {
            Row(
                Modifier.padding(top = 4.dp).clip(RoundedCornerShape(50)).clickable { expanded = !expanded }
                    .padding(horizontal = 4.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (expanded) "Show less" else "Show more", style = MaterialTheme.typography.labelLarge, color = AniColors.TextSecondary)
                Icon(if (expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, null, tint = AniColors.TextSecondary, modifier = Modifier.size(18.dp))
            }
        }
    }
}
