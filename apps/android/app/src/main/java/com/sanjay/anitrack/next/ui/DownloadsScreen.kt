package com.sanjay.anitrack.next.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.DownloadForOffline
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Downloads

// ── Downloads (offline HLS library) ───────────────────────────────────────────

@Composable
fun DownloadsScreen(onPlay: () -> Unit, onOpenAnime: (Int) -> Unit = {}) {
    val items = Downloads.items
    // Group by anime, each group collapsible with a total size.
    val groups = items.groupBy { it.animeId }.values.toList()
    val expanded = remember { mutableStateMapOf<Int, Boolean>() }

    fun playLocal(d: Downloads.Item) {
        val f = Downloads.localPlaylist(d.id) ?: return
        com.sanjay.anitrack.next.data.PlaySession.apply {
            provider = "anikoto"; animeId = d.animeId; animeTitle = d.title; animeCover = d.cover
            anime = null; localFile = f.absolutePath
            slug = ""; anikotoEps = listOf(com.sanjay.anitrack.next.data.Anikoto.Episode(d.episode, "Episode ${d.episode.toInt()}", "", ""))
            paheEps = emptyList(); index = 0
        }
        onPlay()
    }

    val done = items.filter { it.status == Downloads.Status.DONE }
    val totalSize = done.sumOf { it.sizeBytes }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 860.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 20.dp)) {
            ScreenHeader(
                "Downloads",
                subtitle = if (done.isEmpty()) "Watch downloaded episodes offline, in the app."
                else metaLine("${done.size} episode${if (done.size == 1) "" else "s"}", Downloads.humanSize(totalSize).ifEmpty { null }, "available offline"),
                icon = Icons.Rounded.DownloadForOffline,
            )
            Spacer(Modifier.height(20.dp))

            if (items.isEmpty()) {
                AniCard {
                    EmptyState(
                        Icons.Rounded.DownloadForOffline,
                        "No downloads yet",
                        "Open a series and tap Download on an episode, or use Download / Range to save several at once.",
                    )
                }
            }

            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(groups.size) { gi ->
                    val group = groups[gi].sortedBy { it.episode }
                    val head = group.first()
                    val open = expanded[head.animeId] ?: false   // collapsed by default, like desktop
                    val groupDone = group.filter { it.status == Downloads.Status.DONE }
                    val active = group.count { it.status == Downloads.Status.DOWNLOADING || it.status == Downloads.Status.QUEUED }
                    val groupSize = groupDone.sumOf { it.sizeBytes }
                    DownloadGroupCard(
                        cover = head.cover,
                        title = head.title,
                        summary = metaLine(
                            "${groupDone.size} episode${if (groupDone.size == 1) "" else "s"}",
                            Downloads.humanSize(groupSize).ifEmpty { null },
                            if (active > 0) "$active in queue" else null,
                        ),
                        active = active > 0,
                        open = open,
                        onToggle = { expanded[head.animeId] = !open },
                        onOpenSeries = if (head.animeId > 0) ({ onOpenAnime(head.animeId) }) else null,
                    ) {
                        group.forEach { d ->
                            DownloadItemRow(
                                title = "Episode ${if (d.episode % 1f == 0f) d.episode.toInt() else d.episode}",
                                detail = when (d.status) {
                                    Downloads.Status.QUEUED -> "Queued"
                                    Downloads.Status.DOWNLOADING -> "Downloading… ${d.progress}%"
                                    Downloads.Status.DONE -> Downloads.humanSize(d.sizeBytes)
                                    Downloads.Status.FAILED -> d.error ?: "Failed"
                                },
                                state = when (d.status) {
                                    Downloads.Status.QUEUED -> ItemState.Queued
                                    Downloads.Status.DOWNLOADING -> ItemState.Downloading
                                    Downloads.Status.DONE -> ItemState.Done
                                    Downloads.Status.FAILED -> ItemState.Failed
                                },
                                progress = d.progress / 100f,
                                actionLabel = "Play",
                                actionIcon = Icons.Rounded.PlayArrow,
                                onAction = { playLocal(d) },
                                onDelete = { Downloads.remove(d.id) },
                            )
                        }
                    }
                }
            }
        }
    }
}

internal enum class ItemState { Queued, Downloading, Done, Failed }

/** A series in a downloads list: cover, title, summary and a collapsible list of items. */
@Composable
internal fun DownloadGroupCard(
    cover: String?,
    title: String,
    summary: String,
    active: Boolean,
    open: Boolean,
    onToggle: () -> Unit,
    onOpenSeries: (() -> Unit)?,
    trailing: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    val rotation by animateFloatAsState(if (open) 180f else 0f, label = "chevron")
    AniCard(padding = PaddingValues(0.dp)) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PosterImage(
                cover, title,
                Modifier.width(44.dp).height(62.dp).clip(RoundedCornerShape(8.dp))
                    .then(if (onOpenSeries != null) Modifier.clickable(onClick = onOpenSeries) else Modifier),
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = if (onOpenSeries != null) Modifier.clickable(onClick = onOpenSeries) else Modifier,
                )
                Spacer(Modifier.height(3.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (active) CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp, color = AniColors.Accent)
                    Text(summary, style = MaterialTheme.typography.labelMedium, color = AniColors.TextSecondary)
                }
            }
            trailing()
            Icon(Icons.Rounded.ExpandMore, if (open) "Collapse" else "Expand", tint = AniColors.TextSecondary, modifier = Modifier.rotate(rotation))
        }
        if (open) {
            HorizontalDivider(color = AniColors.BorderSoft)
            Column(Modifier.padding(vertical = 4.dp), content = content)
        }
    }
}

/** One downloaded (or downloading) episode or chapter. */
@Composable
internal fun DownloadItemRow(
    title: String,
    detail: String,
    state: ItemState,
    progress: Float,
    actionLabel: String,
    actionIcon: androidx.compose.ui.graphics.vector.ImageVector,
    onAction: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            when (state) {
                ItemState.Done -> Icons.Rounded.CheckCircle
                ItemState.Failed -> Icons.Rounded.ErrorOutline
                else -> Icons.Rounded.DownloadForOffline
            },
            null,
            tint = when (state) {
                ItemState.Done -> AniColors.Success
                ItemState.Failed -> AniColors.Danger
                else -> AniColors.TextTertiary
            },
            modifier = Modifier.size(20.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                detail,
                style = MaterialTheme.typography.labelSmall,
                color = if (state == ItemState.Failed) AniColors.Danger else AniColors.TextTertiary,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (state == ItemState.Downloading) {
                Spacer(Modifier.height(5.dp))
                ProgressStrip(progress, Modifier.fillMaxWidth(0.6f), height = 3.dp, track = AniColors.SurfaceHighest)
            }
        }
        when (state) {
            ItemState.Done -> PillButton(actionLabel, onAction, icon = actionIcon, style = PillStyle.Primary, compact = true)
            ItemState.Queued -> CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = AniColors.TextTertiary)
            ItemState.Downloading -> CircularProgressIndicator(
                progress = { progress.coerceIn(0f, 1f) },
                modifier = Modifier.size(18.dp), strokeWidth = 2.dp, color = AniColors.Accent, trackColor = AniColors.SurfaceHighest,
            )
            ItemState.Failed -> {}
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Rounded.DeleteOutline, "Delete", tint = AniColors.TextTertiary, modifier = Modifier.size(20.dp))
        }
    }
}
