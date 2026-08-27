package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.RemoteConfig
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.Providers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Accent = Color(0xFFE50914)

// ── Detail ────────────────────────────────────────────────────────────────────

@Composable
fun DetailScreen(animeId: Int, onPlay: () -> Unit, onOpenAnime: (Int) -> Unit = {}) {
    var anime by remember { mutableStateOf<Anime?>(null) }
    LaunchedEffect(animeId) { anime = AniList.byId(animeId) }

    val a = anime ?: run {
        Box(Modifier.fillMaxSize(), contentAlignment = androidx.compose.ui.Alignment.Center) {
            CircularProgressIndicator(color = Accent)
        }
        return
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        // Banner
        Box(Modifier.fillMaxWidth().height(180.dp)) {
            AsyncImage(
                model = a.banner ?: a.cover,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            Box(
                Modifier.fillMaxSize().background(
                    androidx.compose.ui.graphics.Brush.verticalGradient(
                        listOf(Color.Transparent, Color.Black),
                    ),
                ),
            )
        }
        Row(Modifier.padding(16.dp)) {
            AsyncImage(
                model = a.cover,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.width(110.dp).height(156.dp).clip(RoundedCornerShape(10.dp)),
            )
            Spacer(Modifier.width(16.dp))
            Column {
                Text(a.title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                if (a.titleRomaji != null && a.titleRomaji != a.title) {
                    Text(a.titleRomaji, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.5f))
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    a.year?.let { Chip("$it") }
                    a.episodes?.let { Chip("$it eps") }
                    a.score?.let { Chip("★ ${it / 10.0}") }
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    a.genres.take(3).forEach { Chip(it, subtle = true) }
                }
                Spacer(Modifier.height(10.dp))
                ListStatusButton(a)
            }
        }
        if (a.synopsis != null) {
            Text(
                a.synopsis,
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.7f),
                maxLines = 6,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        Spacer(Modifier.height(20.dp))
        WatchOrderSection(a, onOpenAnime)
        RelatedSection(a, onOpenAnime)
        EpisodesSection(a, onPlay)
        Spacer(Modifier.height(32.dp))
    }
}

// ── Related (side stories / specials — non-chain relations, like desktop) ─────

private val relationLabels = mapOf(
    "SIDE_STORY" to "Side Story", "SPIN_OFF" to "Spin Off", "ALTERNATIVE" to "Alternative",
    "SPECIAL" to "Special", "SUMMARY" to "Summary", "PARENT" to "Parent",
    "CHARACTER" to "Character", "OTHER" to "Other",
)

@Composable
private fun RelatedSection(anime: Anime, onOpenAnime: (Int) -> Unit) {
    var rels by remember(anime.id) { mutableStateOf<List<AniList.Relation>>(emptyList()) }
    LaunchedEffect(anime.id) { runCatching { rels = AniList.relations(anime.id) } }
    val related = rels.filter { it.type != "PREQUEL" && it.type != "SEQUEL" }
    if (related.isEmpty()) return

    Column(Modifier.padding(bottom = 20.dp)) {
        Text("Related", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp))
        Spacer(Modifier.height(10.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(related.size) { i ->
                val r = related[i]
                Column(Modifier.width(120.dp).clickable { onOpenAnime(r.anime.id) }) {
                    Box(
                        Modifier.width(120.dp).height(170.dp).clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.06f)),
                    ) {
                        AsyncImage(model = r.anime.cover, contentDescription = r.anime.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        // Relation label strip (desktop's "Side Story" tag).
                        Box(
                            Modifier.align(Alignment.BottomStart).fillMaxWidth()
                                .background(
                                    androidx.compose.ui.graphics.Brush.verticalGradient(
                                        listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f)),
                                    ),
                                )
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                        ) {
                            Text(
                                relationLabels[r.type] ?: r.type.lowercase().replaceFirstChar { c -> c.uppercase() },
                                style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.85f),
                            )
                        }
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(r.anime.title, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
                }
            }
        }
    }
}

// ── Watch Order (franchise chain: PREQUEL hops back, SEQUEL forward) ──────────

private val watchOrderCache = HashMap<Int, List<Anime>>()

@Composable
private fun WatchOrderSection(anime: Anime, onOpenAnime: (Int) -> Unit) {
    var chain by remember(anime.id) { mutableStateOf(watchOrderCache[anime.id] ?: emptyList()) }

    LaunchedEffect(anime.id) {
        if (chain.isNotEmpty()) return@LaunchedEffect
        runCatching {
            fun pick(edges: List<AniList.Relation>, type: String): Anime? {
                val cands = edges.filter { it.type == type && it.anime.id > 0 }
                return (cands.firstOrNull { it.anime.format == "TV" } ?: cands.firstOrNull())?.anime
            }
            val before = ArrayDeque<Anime>()
            var cur = anime
            var guard = 0
            while (guard++ < 10) {
                val prev = pick(AniList.relations(cur.id), "PREQUEL") ?: break
                if (before.any { it.id == prev.id } || prev.id == anime.id) break
                before.addFirst(prev); cur = prev
            }
            val after = mutableListOf<Anime>()
            cur = anime; guard = 0
            while (guard++ < 10) {
                val next = pick(AniList.relations(cur.id), "SEQUEL") ?: break
                if (after.any { it.id == next.id } || next.id == anime.id) break
                after.add(next); cur = next
            }
            val full = before.toList() + anime + after
            if (full.size > 1) {
                if (watchOrderCache.size > 200) watchOrderCache.clear()
                full.forEach { watchOrderCache[it.id] = full }
                chain = full
            }
        }
    }

    if (chain.size < 2) return
    Column(Modifier.padding(bottom = 20.dp)) {
        Text("Watch Order", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp))
        Spacer(Modifier.height(10.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(chain.size) { i ->
                val m = chain[i]
                val isHere = m.id == anime.id
                Column(Modifier.width(120.dp).clickable(enabled = !isHere) { onOpenAnime(m.id) }) {
                    Box(
                        Modifier.width(120.dp).height(170.dp).clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.06f))
                            .then(if (isHere) Modifier.border(2.dp, Accent, RoundedCornerShape(10.dp)) else Modifier),
                    ) {
                        AsyncImage(model = m.cover, contentDescription = m.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        // Number badge
                        Box(
                            Modifier.align(Alignment.TopStart).padding(6.dp)
                                .size(24.dp).clip(RoundedCornerShape(50)).background(Accent),
                            contentAlignment = Alignment.Center,
                        ) { Text("${i + 1}", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
                        if (isHere) {
                            Box(
                                Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Accent).padding(vertical = 3.dp),
                                contentAlignment = Alignment.Center,
                            ) { Text("YOU ARE HERE", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = androidx.compose.ui.unit.TextUnit(1f, androidx.compose.ui.unit.TextUnitType.Sp)) }
                        }
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(m.title, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
                    m.year?.let { Text("$it", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f)) }
                }
            }
        }
    }
}

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
private fun EpisodesSection(anime: com.sanjay.anitrack.next.data.Anime, onPlay: () -> Unit) {
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

// ── List status control (detail page "Add to list" / status dropdown) ─────────

@Composable
private fun ListStatusButton(anime: Anime) {
    var status by remember { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val labels = mapOf(
        "watching" to "Watching", "completed" to "Completed", "on_hold" to "On hold",
        "dropped" to "Dropped", "plan_to_watch" to "Plan to watch",
    )

    LaunchedEffect(anime.id) {
        runCatching { status = com.sanjay.anitrack.next.data.Db.listStatusOf(anime.id) }
    }

    Box {
        OutlinedButton(onClick = { open = true }) {
            Text(status?.let { labels[it] } ?: "+ Add to list")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((key, label) in labels) {
                DropdownMenuItem(
                    text = { Text(label) },
                    onClick = {
                        open = false
                        scope.launch {
                            val connected = com.sanjay.anitrack.next.data.Mal.isConnected
                            com.sanjay.anitrack.next.data.Db.setListStatus(
                                anime.id, key, anime.title, anime.cover,
                                malId = anime.malId,
                                queueForMal = connected,
                            )
                            status = key
                            if (connected) com.sanjay.anitrack.next.data.Mal.requestFlush()
                        }
                    },
                )
            }
            if (status != null) {
                DropdownMenuItem(
                    text = { Text("Remove from list", color = Color(0xFFFF6B6B)) },
                    onClick = {
                        open = false
                        scope.launch {
                            val connected = com.sanjay.anitrack.next.data.Mal.isConnected
                            com.sanjay.anitrack.next.data.Db.removeFromList(
                                anime.id,
                                malId = anime.malId,
                                queueForMal = connected,
                            )
                            status = null
                            if (connected) com.sanjay.anitrack.next.data.Mal.requestFlush()
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun Chip(text: String, subtle: Boolean = false) {
    Box(
        Modifier
            .clip(RoundedCornerShape(50))
            .background(if (subtle) Color.White.copy(alpha = 0.08f) else Accent.copy(alpha = 0.18f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.85f))
    }
}
