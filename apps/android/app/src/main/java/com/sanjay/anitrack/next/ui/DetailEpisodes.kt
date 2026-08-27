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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.RemoteConfig
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.Providers

private val Accent = Color(0xFFE50914)

// ── Episodes (Anikoto + AnimePahe servers) ────────────────────────────────────

private data class EpUi(
    val number: Float,
    val title: String?,
    val snapshot: String?,
    val play: () -> Unit,
    val resolveForDownload: suspend () -> Triple<String, String, String>,
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
    var rangeStart by remember { mutableStateOf(0) }
    var watched by remember { mutableStateOf<Map<Float, Int>>(emptyMap()) }

    LaunchedEffect(anime.id) {
        runCatching { watched = com.sanjay.anitrack.next.data.Db.positionsFor(anime.id) }
    }
    // Load the selected server on demand.
    LaunchedEffect(anime.id, server) {
        rangeStart = 0
        if (server.isBlank() || server in attemptedProviders) return@LaunchedEffect
        val provider = registry.enabled(server, runtime) ?: return@LaunchedEffect
        loading = true
        val result = runCatching { provider.match(anime) }
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
                    Triple(media.url, media.referer, media.userAgent)
                },
            )
        }
    }

    Column(Modifier.padding(horizontal = 16.dp)) {
        // Header with SUB/DUB badges.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Episodes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            activeSeries?.badges?.forEachIndexed { index, badge ->
                Spacer(Modifier.width(if (index == 0) 10.dp else 6.dp))
                val isDub = badge.startsWith("DUB", ignoreCase = true)
                Box(
                    Modifier.clip(RoundedCornerShape(6.dp))
                        .background(
                            (if (isDub) Color(0xFF5865F2) else Color(0xFF3BA55D))
                                .copy(alpha = 0.25f),
                        )
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                ) {
                    Text(
                        badge,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (isDub) Color(0xFF9AA5FF) else Color(0xFF7CD07C),
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        // Server toggle
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            enabledProviders.forEach { provider ->
                val descriptor = provider.descriptor
                FilterChip(
                    selected = server == descriptor.id,
                    onClick = { server = descriptor.id },
                    label = { Text(descriptor.name) },
                )
            }
            if (loading) {
                Spacer(Modifier.width(4.dp))
                CircularProgressIndicator(Modifier.size(16.dp).align(Alignment.CenterVertically), strokeWidth = 2.dp, color = Accent)
            }
        }
        Spacer(Modifier.height(4.dp))
        if (activeSeries != null) {
            Text(
                if (activeSeries.verified) "verified ✓" else "best match",
                style = MaterialTheme.typography.labelSmall,
                color = if (activeSeries.verified) Color(0xFF4CAF50) else Color.White.copy(alpha = 0.5f),
            )
        }
        if (!loading && server in attemptedProviders && epUi.isEmpty()) {
            Text(
                failures[server]?.let { "No source: ${it.take(160)}" } ?: "No source on this server.",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.55f),
            )
        }
        Spacer(Modifier.height(10.dp))

        if (epUi.isNotEmpty()) {
            val ranges = epUi.chunked(100)
            val current = ranges.getOrElse(rangeStart) { emptyList() }

            // Action buttons (Open Player · Download N · Range), desktop style.
            var rangeDialog by remember(server) { mutableStateOf(false) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { (epUi.firstOrNull { (watched[it.number] ?: 0) < 85 } ?: epUi.first()).play() },
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black),
                    contentPadding = PaddingValues(horizontal = 18.dp, vertical = 8.dp),
                ) {
                    Icon(Icons.Filled.PlayArrow, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp)); Text("Open Player", fontWeight = FontWeight.Bold)
                }
                if (canDownload) {
                    Row(
                        Modifier.height(42.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.08f))
                            .clickable {
                                current.forEach { ep -> com.sanjay.anitrack.next.data.Downloads.enqueue(anime.id, ep.number, anime.title, anime.cover, ep.resolveForDownload) }
                            }
                            .padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.FileDownload, null, tint = Color.White, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(7.dp)); Text("Download ${current.size}", color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
                    }
                    Row(
                        Modifier.height(42.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.08f))
                            .clickable { rangeDialog = true }
                            .padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.FileDownload, null, tint = Color.White, modifier = Modifier.size(17.dp))
                        Spacer(Modifier.width(7.dp)); Text("Range", color = Color.White, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
                    }
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
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = fromTxt, onValueChange = { fromTxt = it.filter { c -> c.isDigit() }.take(4) },
                                label = { Text("From") }, singleLine = true, modifier = Modifier.weight(1f),
                                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
                            )
                            OutlinedTextField(
                                value = toTxt, onValueChange = { toTxt = it.filter { c -> c.isDigit() }.take(4) },
                                label = { Text("To") }, singleLine = true, modifier = Modifier.weight(1f),
                                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
                            )
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
                        }) { Text("Download", color = Accent) }
                    },
                    dismissButton = { TextButton(onClick = { rangeDialog = false }) { Text("Cancel") } },
                )
            }
            Spacer(Modifier.height(12.dp))

            if (ranges.size > 1) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(ranges.size) { i ->
                        FilterChip(
                            selected = rangeStart == i,
                            onClick = { rangeStart = i },
                            label = { Text("${ranges[i].first().number.toInt()}–${ranges[i].last().number.toInt()}") },
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
            }

            // Vertical episode list — each row a boxed card (desktop layout).
            val dls = com.sanjay.anitrack.next.data.Downloads.items
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (ep in current) {
                    val pct = watched[ep.number] ?: 0
                    val dl = dls.firstOrNull { it.id == com.sanjay.anitrack.next.data.Downloads.idOf(anime.id, ep.number) }
                    Row(
                        Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.05f))
                            .clickable { ep.play() }
                            .padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Thumbnail box (anime cover, 16:9).
                        AsyncImage(
                            model = ep.snapshot ?: anime.banner ?: anime.cover,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.width(72.dp).height(44.dp).clip(RoundedCornerShape(6.dp)).background(Color.White.copy(alpha = 0.08f)),
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    "Episode ${if (ep.number % 1f == 0f) ep.number.toInt() else ep.number}",
                                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold,
                                    color = if (pct >= 85) Color(0xFF7CD07C) else Color.White,
                                )
                                if (pct >= 85) {
                                    Spacer(Modifier.width(4.dp))
                                    Icon(Icons.Filled.Check, null, tint = Color(0xFF7CD07C), modifier = Modifier.size(14.dp))
                                }
                            }
                            Text(
                                when { pct >= 85 -> "Watched"; pct > 0 -> "$pct% watched"; else -> "Not watched" },
                                style = MaterialTheme.typography.labelSmall,
                                color = Color.White.copy(alpha = 0.4f),
                            )
                        }
                        // Download control — boxed like the desktop.
                        if (canDownload) when (dl?.status) {
                            com.sanjay.anitrack.next.data.Downloads.Status.DONE ->
                                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(end = 8.dp)) {
                                    Icon(Icons.Filled.Check, null, tint = Color(0xFF7CD07C), modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(4.dp)); Text("Saved", color = Color(0xFF7CD07C), style = MaterialTheme.typography.labelMedium)
                                }
                            com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING ->
                                Text("${dl.progress}%", color = Accent, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(end = 12.dp))
                            com.sanjay.anitrack.next.data.Downloads.Status.QUEUED ->
                                Text("queued…", color = Color.White.copy(alpha = 0.5f), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(end = 12.dp))
                            else -> Row(
                                // Desktop style: filled dark box, no border.
                                Modifier.clip(RoundedCornerShape(8.dp))
                                    .background(Color.White.copy(alpha = 0.1f))
                                    .clickable { com.sanjay.anitrack.next.data.Downloads.enqueue(anime.id, ep.number, anime.title, anime.cover, ep.resolveForDownload) }
                                    .padding(horizontal = 14.dp, vertical = 9.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Icon(Icons.Filled.Download, null, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(7.dp)); Text("Download", color = Color.White.copy(alpha = 0.9f), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                }
            }
        }
    }
}
