package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Checklist
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.RemoteConfig
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.Providers

// ── Episodes (Anikoto + AnimePahe servers) ────────────────────────────────────

private data class EpUi(
    val number: Float,
    val title: String?,
    val snapshot: String?,
    val play: () -> Unit,
    val resolveForDownload: suspend () -> com.sanjay.anitrack.next.data.Downloads.Source,
)

@OptIn(ExperimentalLayoutApi::class, ExperimentalFoundationApi::class)
@Composable
internal fun EpisodesSection(anime: com.sanjay.anitrack.next.data.Anime, onPlay: () -> Unit) {
    val runtime = RemoteConfig.current()
    val registry = Providers.registry
    val enabledProviders = remember(runtime) { registry.enabled(runtime) }
    val enabledProviderIds = enabledProviders.map { it.descriptor.id }
    var server by remember(anime.id, enabledProviderIds) {
        mutableStateOf(enabledProviderIds.firstOrNull().orEmpty())
    }
    var seriesByProvider by remember(anime.id) {
        mutableStateOf<Map<String, ProviderSeries>>(emptyMap())
    }
    var attemptedProviders by remember(anime.id) { mutableStateOf<Set<String>>(emptySet()) }
    var failures by remember(anime.id) { mutableStateOf<Map<String, String?>>(emptyMap()) }
    var loading by remember(anime.id) { mutableStateOf(false) }
    var accessRevision by remember(anime.id) { mutableIntStateOf(0) }
    var rangeStart by remember { mutableStateOf(0) }
    var watched by remember { mutableStateOf<Map<Float, Int>>(emptyMap()) }

    LaunchedEffect(anime.id) {
        runCatching { watched = com.sanjay.anitrack.next.data.Db.positionsFor(anime.id) }
    }
    // Load the selected server on demand.
    LaunchedEffect(anime.id, server, accessRevision) {
        rangeStart = 0
        if (server.isBlank() || server in attemptedProviders) return@LaunchedEffect
        val provider = registry.enabled(server, runtime) ?: return@LaunchedEffect
        loading = true
        val result = try { Result.success(provider.match(anime)) }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (error: Exception) { Result.failure(error) }
        result.getOrNull()?.takeIf { it.episodes.isNotEmpty() }?.let { series ->
            seriesByProvider = seriesByProvider + (server to series)
        }
        attemptedProviders = attemptedProviders + server
        if (seriesByProvider[server] == null) {
            failures = failures + (server to result.exceptionOrNull()?.message)
        }
        loading = false
    }

    val activeProvider = enabledProviders.firstOrNull { it.descriptor.id == server }
    val activeSeries = seriesByProvider[server]
    val canDownload = runtime.features.downloads &&
        activeProvider?.descriptor?.capabilities?.downloads == true

    // Build player and download actions from the normalized connector result.
    val epUi: List<EpUi> = remember(activeSeries, anime, onPlay) {
        val series = activeSeries ?: return@remember emptyList()
        series.episodes.mapIndexed { index, episode ->
            EpUi(
                number = episode.number,
                title = episode.title,
                snapshot = episode.snapshot,
                play = {
                    PlaySession.startSeries(
                        series = series,
                        selectedIndex = index,
                        animeId = anime.id,
                        animeTitle = anime.title,
                        animeCover = anime.cover,
                        anime = anime,
                    )
                    onPlay()
                },
                resolveForDownload = {
                    val media = episode.resolve()
                    check(media.downloadable) { "Downloads are not supported by this server" }
                    val captions = media.subtitles.filter { it.mimeType == "text/vtt" }
                    val caption = captions.firstOrNull { it.default }
                        ?: captions.firstOrNull { it.language == "en" || it.label.contains("english", ignoreCase = true) }
                        ?: captions.firstOrNull()
                    com.sanjay.anitrack.next.data.Downloads.Source(media.url, media.referer, media.userAgent, caption?.url)
                },
            )
        }
    }

    Column {
        // Header with SUB/DUB badges.
        SectionHeader("Episodes", trailing = {
            activeSeries?.badges?.forEach { badge ->
                val isDub = badge.startsWith("DUB", ignoreCase = true)
                Tag(badge, Modifier.padding(end = 6.dp), tone = if (isDub) TagTone.Info else TagTone.Success)
            }
        })
        Column(Modifier.padding(horizontal = 24.dp)) {
            // Server picker
            Row(verticalAlignment = Alignment.CenterVertically) {
                PillTabs(
                    enabledProviders.map { it.descriptor.id to it.descriptor.name },
                    selected = server,
                    onSelect = { server = it },
                    compact = true,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (loading) {
                    Spacer(Modifier.width(12.dp))
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = AniColors.Accent)
                }
            }
            Spacer(Modifier.height(6.dp))
            ProviderAccessControls(activeProvider) {
                attemptedProviders = attemptedProviders - server
                seriesByProvider = seriesByProvider - server
                failures = failures - server
                accessRevision++
            }
            if (activeSeries != null) {
                Spacer(Modifier.height(4.dp))
                if (activeSeries.verified) Tag("Verified match", tone = TagTone.Success, icon = Icons.Rounded.Verified)
                else Tag("Best match", tone = TagTone.Outline)
            }
            if (!loading && server in attemptedProviders && epUi.isEmpty()) {
                Spacer(Modifier.height(8.dp))
                StatusLine(failures[server]?.let { "No source: ${it.take(160)}" } ?: "No source on this server.", false)
                Spacer(Modifier.height(8.dp))
                PillButton("Retry", {
                    attemptedProviders = attemptedProviders - server
                    failures = failures - server
                    accessRevision++
                }, icon = Icons.Rounded.Refresh, compact = true)
            }
            Spacer(Modifier.height(14.dp))

            if (epUi.isNotEmpty()) {
                val ranges = epUi.chunked(100)
                val current = ranges.getOrElse(rangeStart) { emptyList() }
                val next = epUi.firstOrNull { (watched[it.number] ?: 0) < 85 } ?: epUi.first()
                val nextPct = watched[next.number] ?: 0

                // Actions: play the next episode, Download N, Range (desktop parity).
                var rangeDialog by remember(server) { mutableStateOf(false) }
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    PillButton(
                        (if (nextPct > 0) "Continue · Ep " else "Watch · Ep ") + epLabel(next.number),
                        { next.play() },
                        icon = Icons.Rounded.PlayArrow,
                        style = PillStyle.Light,
                    )
                    if (canDownload) {
                        PillButton(
                            "Download ${current.size}",
                            {
                                current.forEach { ep -> com.sanjay.anitrack.next.data.Downloads.enqueue(anime.id, ep.number, anime.title, anime.cover, ep.resolveForDownload) }
                            },
                            icon = Icons.Rounded.Download,
                        )
                        PillButton("Range", { rangeDialog = true }, icon = Icons.Rounded.Checklist)
                    }
                }
                // Range download dialog (desktop's custom episode range).
                if (rangeDialog && canDownload) {
                    var fromTxt by remember { mutableStateOf("") }
                    var toTxt by remember { mutableStateOf("") }
                    AlertDialog(
                        onDismissRequest = { rangeDialog = false },
                        title = { Text("Download a range") },
                        text = {
                            Column {
                                Text(
                                    "Episodes ${epLabel(epUi.first().number)}–${epLabel(epUi.last().number)} are available on this server.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = AniColors.TextSecondary,
                                )
                                Spacer(Modifier.height(12.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    OutlinedTextField(
                                        value = fromTxt, onValueChange = { fromTxt = it.filter { c -> c.isDigit() }.take(4) },
                                        label = { Text("From") }, singleLine = true, modifier = Modifier.weight(1f),
                                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = AniColors.Accent, cursorColor = AniColors.Accent, focusedLabelColor = AniColors.Accent),
                                    )
                                    OutlinedTextField(
                                        value = toTxt, onValueChange = { toTxt = it.filter { c -> c.isDigit() }.take(4) },
                                        label = { Text("To") }, singleLine = true, modifier = Modifier.weight(1f),
                                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = AniColors.Accent, cursorColor = AniColors.Accent, focusedLabelColor = AniColors.Accent),
                                    )
                                }
                            }
                        },
                        confirmButton = {
                            TextButton(onClick = {
                                val from = fromTxt.toIntOrNull() ?: 1
                                val to = toTxt.toIntOrNull() ?: from
                                epUi.filter { it.number >= from && it.number <= to }.forEach { ep ->
                                    com.sanjay.anitrack.next.data.Downloads.enqueue(anime.id, ep.number, anime.title, anime.cover, ep.resolveForDownload)
                                }
                                rangeDialog = false
                            }) { Text("Download", fontWeight = FontWeight.Bold) }
                        },
                        dismissButton = { TextButton(onClick = { rangeDialog = false }) { Text("Cancel", color = AniColors.TextSecondary) } },
                    )
                }
                Spacer(Modifier.height(14.dp))

                if (ranges.size > 1) {
                    PillTabs(
                        ranges.indices.map { i -> i.toString() to "${ranges[i].first().number.toInt()}–${ranges[i].last().number.toInt()}" },
                        selected = rangeStart.toString(),
                        onSelect = { rangeStart = it.toInt() },
                        compact = true,
                    )
                    Spacer(Modifier.height(12.dp))
                }

                // Episode list: thumbnail, title, watch state and download control.
                val dls = com.sanjay.anitrack.next.data.Downloads.items
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (ep in current) {
                        val pct = watched[ep.number] ?: 0
                        val dl = dls.firstOrNull { it.id == com.sanjay.anitrack.next.data.Downloads.idOf(anime.id, ep.number) }
                        val shape = RoundedCornerShape(14.dp)
                        Row(
                            Modifier.fillMaxWidth()
                                .clip(shape)
                                .background(AniColors.Surface)
                                .border(1.dp, AniColors.BorderSoft, shape)
                                .clickable { ep.play() }
                                .padding(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.width(128.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp))) {
                                PosterImage(ep.snapshot ?: anime.banner ?: anime.cover, null, Modifier.fillMaxSize())
                                Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.28f)))
                                Icon(
                                    Icons.Rounded.PlayCircle, null,
                                    tint = Color.White.copy(alpha = 0.9f),
                                    modifier = Modifier.align(Alignment.Center).size(30.dp),
                                )
                                if (pct in 1..99) {
                                    ProgressStrip(
                                        pct / 100f,
                                        Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(6.dp),
                                        height = 3.dp,
                                    )
                                }
                            }
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        "Episode ${epLabel(ep.number)}",
                                        style = MaterialTheme.typography.titleSmall,
                                        color = if (pct >= 85) AniColors.Success else AniColors.Text,
                                    )
                                    if (pct >= 85) {
                                        Spacer(Modifier.width(5.dp))
                                        Icon(Icons.Rounded.CheckCircle, "Watched", tint = AniColors.Success, modifier = Modifier.size(16.dp))
                                    }
                                }
                                ep.title?.takeIf { it.isNotBlank() && !it.equals("Episode ${epLabel(ep.number)}", ignoreCase = true) }?.let {
                                    Text(it, style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                Text(
                                    when { pct >= 85 -> "Watched"; pct > 0 -> "$pct% watched"; else -> "Not watched" },
                                    style = MaterialTheme.typography.labelSmall,
                                    color = AniColors.TextTertiary,
                                )
                            }
                            // Download control.
                            if (canDownload) when (dl?.status) {
                                com.sanjay.anitrack.next.data.Downloads.Status.DONE ->
                                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 8.dp)) {
                                        Icon(Icons.Rounded.DownloadDone, null, tint = AniColors.Success, modifier = Modifier.size(18.dp))
                                        Spacer(Modifier.width(5.dp)); Text("Saved", color = AniColors.Success, style = MaterialTheme.typography.labelLarge)
                                    }
                                com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING ->
                                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 10.dp)) {
                                        CircularProgressIndicator(
                                            progress = { dl.progress.coerceIn(0, 100) / 100f },
                                            modifier = Modifier.size(18.dp), strokeWidth = 2.dp,
                                            color = AniColors.Accent, trackColor = AniColors.SurfaceHighest,
                                        )
                                        Spacer(Modifier.width(6.dp))
                                        Text("${dl.progress}%", color = AniColors.Text, style = MaterialTheme.typography.labelLarge)
                                    }
                                com.sanjay.anitrack.next.data.Downloads.Status.QUEUED ->
                                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 10.dp)) {
                                        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = AniColors.TextTertiary)
                                        Spacer(Modifier.width(6.dp))
                                        Text("Queued", color = AniColors.TextTertiary, style = MaterialTheme.typography.labelMedium)
                                    }
                                else -> PillButton(
                                    "Download",
                                    { com.sanjay.anitrack.next.data.Downloads.enqueue(anime.id, ep.number, anime.title, anime.cover, ep.resolveForDownload) },
                                    icon = Icons.Rounded.Download,
                                    compact = true,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** "12" for whole episode numbers, "12.5" otherwise. */
private fun epLabel(number: Float): String = if (number % 1f == 0f) number.toInt().toString() else number.toString()
