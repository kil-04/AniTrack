package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val Accent = Color(0xFFE50914)

// ── Shared card ───────────────────────────────────────────────────────────────

@Composable
fun AnimeCard(anime: Anime, onClick: (Anime) -> Unit, width: Int = 126) {
    Column(Modifier.width(width.dp).clickable { onClick(anime) }) {
        AsyncImage(
            model = anime.cover,
            contentDescription = anime.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .width(width.dp)
                .height((width * 1.42).dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Color.White.copy(alpha = 0.06f)),
        )
        Spacer(Modifier.height(6.dp))
        Text(
            anime.title,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            color = Color.White.copy(alpha = 0.85f),
        )
        val meta = listOfNotNull(anime.year?.toString(), anime.episodes?.let { "$it eps" }).joinToString(" · ")
        if (meta.isNotEmpty()) {
            Text(meta, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
        }
    }
}

// ── Home ──────────────────────────────────────────────────────────────────────

@Composable
fun HomeScreen(onOpen: (Anime) -> Unit, onPlay: () -> Unit) {
    var trending by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var rows by remember { mutableStateOf<Map<String, List<Anime>>>(emptyMap()) }
    var cw by remember { mutableStateOf<List<com.sanjay.anitrack.next.data.Db.CwRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    val genres = listOf("Action", "Romance", "Comedy", "Fantasy")
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        // Local data first — instant; network rows stream in after.
        runCatching { cw = com.sanjay.anitrack.next.data.Db.continueWatching() }
        // Cloud reconcile in the background; refresh CW only if it changed
        // something (same non-blocking pattern as the main app).
        scope.launch {
            val changed = runCatching { com.sanjay.anitrack.next.data.GistSync.pullAndMerge() }.getOrDefault(false)
            if (changed) runCatching { cw = com.sanjay.anitrack.next.data.Db.continueWatching() }
        }
        runCatching { trending = AniList.trending() }
        loading = false
        for (g in genres) {
            runCatching { rows = rows + (g to AniList.popularByGenre(g)) }
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        item {
            if (trending.isNotEmpty()) HeroBanner(trending.first(), onOpen)
            else Spacer(Modifier.height(16.dp))
        }
        if (cw.isNotEmpty()) {
            item { SectionHeader("Continue Watching") }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(cw.size) { i ->
                        val row = cw[i]
                        ContinueCardWide(
                            row,
                            onResume = {
                                val key = row.slug ?: return@ContinueCardWide
                                scope.launch {
                                    if (key.startsWith("pahe:")) {
                                        val session = key.removePrefix("pahe:")
                                        val eps = runCatching { com.sanjay.anitrack.next.data.Pahe.episodesAll(session) }.getOrNull() ?: return@launch
                                        val idx = eps.indexOfFirst { it.number == row.episode }.takeIf { it >= 0 } ?: 0
                                        com.sanjay.anitrack.next.data.PlaySession.apply {
                                            provider = "animepahe"; animeId = row.animeId
                                            animeTitle = row.title; animeCover = row.cover
                                            anime = null; anikotoEps = emptyList()
                                            paheSession = session; paheEps = eps; index = idx
                                        }
                                        // Fetch full metadata so in-player server switching works.
                                        scope.launch {
                                            com.sanjay.anitrack.next.data.AniList.byId(row.animeId)?.let {
                                                com.sanjay.anitrack.next.data.PlaySession.anime = it
                                            }
                                        }
                                    } else {
                                        val eps = runCatching { com.sanjay.anitrack.next.data.Anikoto.episodes(key).episodes }.getOrNull() ?: return@launch
                                        val idx = eps.indexOfFirst { it.number == row.episode }.takeIf { it >= 0 } ?: 0
                                        com.sanjay.anitrack.next.data.PlaySession.apply {
                                            provider = "anikoto"; animeId = row.animeId
                                            animeTitle = row.title; animeCover = row.cover
                                            anime = null; paheEps = emptyList()
                                            slug = key; anikotoEps = eps; index = idx
                                        }
                                        scope.launch {
                                            com.sanjay.anitrack.next.data.AniList.byId(row.animeId)?.let {
                                                com.sanjay.anitrack.next.data.PlaySession.anime = it
                                            }
                                        }
                                    }
                                    onPlay()
                                }
                            },
                            onDismiss = {
                                scope.launch {
                                    com.sanjay.anitrack.next.data.Db.dismiss(row.animeId)
                                    // Tombstone → the dismissal propagates to desktop too.
                                    com.sanjay.anitrack.next.data.GistSync.deleteAnime(row.animeId)
                                    cw = com.sanjay.anitrack.next.data.Db.continueWatching()
                                }
                            },
                        )
                    }
                }
            }
        }
        item { SectionHeader("Trending Now") }
        item {
            if (loading && trending.isEmpty()) RowPlaceholder()
            else AnimeRow(trending, onOpen)
        }
        for (g in genres) {
            val list = rows[g] ?: continue
            item { SectionHeader(g) }
            item { AnimeRow(list, onOpen) }
        }
    }
}

// Full-bleed hero banner (the desktop app's #1 trending spotlight).
@Composable
private fun HeroBanner(anime: Anime, onOpen: (Anime) -> Unit) {
    Box(Modifier.fillMaxWidth().height(260.dp).clickable { onOpen(anime) }) {
        AsyncImage(
            model = anime.banner ?: anime.cover,
            contentDescription = anime.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        Box(
            Modifier.fillMaxSize().background(
                androidx.compose.ui.graphics.Brush.verticalGradient(
                    0f to Color.Transparent, 0.55f to Color(0xFF0B0B0F).copy(alpha = 0.65f), 1f to Color(0xFF0B0B0F),
                ),
            ),
        )
        Column(Modifier.align(Alignment.BottomStart).padding(16.dp)) {
            Text("TRENDING NOW", style = MaterialTheme.typography.labelSmall, color = Accent, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(anime.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                anime.year?.let { Text("$it", color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.labelMedium) }
                anime.status?.let { Text(it, color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.labelMedium) }
            }
            Spacer(Modifier.height(10.dp))
            Button(onClick = { onOpen(anime) }, colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black)) {
                Text("▶  Play Now", fontWeight = FontWeight.Bold)
            }
        }
    }
}

// Landscape Continue-Watching card (the desktop app's wide format).
@Composable
private fun ContinueCardWide(
    row: com.sanjay.anitrack.next.data.Db.CwRow,
    onResume: () -> Unit,
    onDismiss: () -> Unit,
) {
    Column(Modifier.width(260.dp)) {
        Box {
            AsyncImage(
                model = row.cover,
                contentDescription = row.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .width(260.dp).height(146.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color.White.copy(alpha = 0.06f))
                    .clickable { onResume() },
            )
            // EP badge
            Box(
                Modifier.align(Alignment.TopStart).padding(8.dp)
                    .clip(RoundedCornerShape(6.dp)).background(Accent)
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            ) { Text("EP ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode}", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
            // Dismiss ✕
            Box(
                Modifier.align(Alignment.TopEnd).padding(8.dp)
                    .clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.6f))
                    .clickable { onDismiss() }.padding(horizontal = 7.dp, vertical = 2.dp),
            ) { Text("✕", color = Color.White, style = MaterialTheme.typography.labelSmall) }
            // Play scrim
            Box(
                Modifier.fillMaxSize().clip(RoundedCornerShape(10.dp)).clickable { onResume() },
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.45f)).padding(10.dp)) {
                    Text("▶", color = Color.White, style = MaterialTheme.typography.titleMedium)
                }
            }
            LinearProgressIndicator(
                progress = { (row.percent / 100f).coerceIn(0f, 1f) },
                color = Accent,
                trackColor = Color.White.copy(alpha = 0.25f),
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(row.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.9f))
        Text("Ep ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode} · ${row.percent}%", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
    }
}

@Composable
private fun ContinueCard(
    row: com.sanjay.anitrack.next.data.Db.CwRow,
    onResume: () -> Unit,
    onDismiss: () -> Unit,
) {
    Column(Modifier.width(126.dp)) {
        Box {
            AsyncImage(
                model = row.cover,
                contentDescription = row.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .width(126.dp).height(179.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color.White.copy(alpha = 0.06f))
                    .clickable { onResume() },
            )
            // Dismiss ✕
            Box(
                Modifier.align(Alignment.TopEnd).padding(6.dp)
                    .clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.6f))
                    .clickable { onDismiss() }.padding(horizontal = 7.dp, vertical = 2.dp),
            ) { Text("✕", color = Color.White, style = MaterialTheme.typography.labelSmall) }
            // Progress bar
            LinearProgressIndicator(
                progress = { (row.percent / 100f).coerceIn(0f, 1f) },
                color = Accent,
                trackColor = Color.White.copy(alpha = 0.25f),
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp),
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(row.title, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
        Text(
            "Ep ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode} · ${row.percent}%",
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.4f),
        )
    }
}

@Composable
private fun SectionHeader(title: String) {
    Row(
        Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 8.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).height(18.dp).clip(RoundedCornerShape(2.dp)).background(Accent))
        Spacer(Modifier.width(8.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun AnimeRow(list: List<Anime>, onOpen: (Anime) -> Unit) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(list.size) { i -> AnimeCard(list[i], onOpen) }
    }
}

@Composable
private fun RowPlaceholder() {
    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        repeat(5) {
            Box(
                Modifier.width(126.dp).height(180.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color.White.copy(alpha = 0.05f)),
            )
        }
    }
}

// ── Search ────────────────────────────────────────────────────────────────────

@Composable
fun SearchScreen(onOpen: (Anime) -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }

    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); return@LaunchedEffect }
        delay(400) // debounce
        searching = true
        runCatching { results = AniList.search(query.trim()) }
        searching = false
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Search anime…") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Accent,
                cursorColor = Accent,
            ),
        )
        Spacer(Modifier.height(12.dp))
        if (searching) {
            LinearProgressIndicator(Modifier.fillMaxWidth(), color = Accent)
            Spacer(Modifier.height(12.dp))
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(126.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(results, key = { it.id }) { a -> AnimeCard(a, onOpen) }
        }
    }
}

// ── Detail ────────────────────────────────────────────────────────────────────

@Composable
fun DetailScreen(animeId: Int, onPlay: () -> Unit) {
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
                        listOf(Color.Transparent, Color(0xFF0B0B0F)),
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
        EpisodesSection(a, onPlay)
        Spacer(Modifier.height(32.dp))
    }
}

// ── Episodes (Anikoto + AnimePahe servers) ────────────────────────────────────

private data class EpUi(val number: Float, val play: () -> Unit)

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EpisodesSection(anime: com.sanjay.anitrack.next.data.Anime, onPlay: () -> Unit) {
    var server by remember { mutableStateOf("anikoto") } // "anikoto" | "animepahe"
    var anikotoMatch by remember { mutableStateOf<com.sanjay.anitrack.next.data.Anikoto.Matched?>(null) }
    var paheMatch by remember { mutableStateOf<com.sanjay.anitrack.next.data.Pahe.Matched?>(null) }
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var rangeStart by remember { mutableStateOf(0) }
    var watched by remember { mutableStateOf<Map<Float, Int>>(emptyMap()) }

    LaunchedEffect(anime.id) {
        runCatching { watched = com.sanjay.anitrack.next.data.Db.positionsFor(anime.id) }
    }
    // Load the selected server on demand.
    LaunchedEffect(anime.id, server) {
        rangeStart = 0; failed = false
        if (server == "anikoto" && anikotoMatch == null) {
            loading = true
            runCatching { anikotoMatch = com.sanjay.anitrack.next.data.Anikoto.matchFor(anime) }
                .onFailure { failed = true }
            if (anikotoMatch == null) failed = true
            loading = false
        } else if (server == "animepahe" && paheMatch == null) {
            loading = true
            runCatching { paheMatch = com.sanjay.anitrack.next.data.Pahe.matchFor(anime) }
                .onFailure { failed = true }
            if (paheMatch == null) failed = true
            loading = false
        }
    }

    // Build the unified episode list + click actions for the active server.
    val epUi: List<EpUi> = remember(server, anikotoMatch, paheMatch) {
        when (server) {
            "animepahe" -> paheMatch?.let { m ->
                m.episodes.map { ep ->
                    EpUi(ep.number) {
                        com.sanjay.anitrack.next.data.PlaySession.apply {
                            provider = "animepahe"; animeId = anime.id
                            animeTitle = anime.title; animeCover = anime.cover
                            this.anime = anime
                            paheSession = m.source.session; paheEps = m.episodes
                            anikotoEps = emptyList()
                            index = m.episodes.indexOf(ep).coerceAtLeast(0)
                        }
                        onPlay()
                    }
                }
            }.orEmpty()
            else -> anikotoMatch?.let { m ->
                m.list.episodes.map { ep ->
                    EpUi(ep.number) {
                        com.sanjay.anitrack.next.data.PlaySession.apply {
                            provider = "anikoto"; animeId = anime.id
                            animeTitle = anime.title; animeCover = anime.cover
                            this.anime = anime
                            slug = m.source.slug; anikotoEps = m.list.episodes
                            paheEps = emptyList()
                            index = m.list.episodes.indexOf(ep).coerceAtLeast(0)
                        }
                        onPlay()
                    }
                }
            }.orEmpty()
        }
    }

    Column(Modifier.padding(horizontal = 16.dp)) {
        Text("Episodes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        // Server toggle
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = server == "anikoto", onClick = { server = "anikoto" }, label = { Text("Anikoto") })
            FilterChip(selected = server == "animepahe", onClick = { server = "animepahe" }, label = { Text("AnimePahe") })
            if (loading) {
                Spacer(Modifier.width(4.dp))
                CircularProgressIndicator(Modifier.size(16.dp).align(Alignment.CenterVertically), strokeWidth = 2.dp, color = Accent)
            }
        }
        Spacer(Modifier.height(4.dp))
        if (server == "anikoto" && anikotoMatch != null) {
            Text(
                if (anikotoMatch!!.verified) "verified ✓" else "best match",
                style = MaterialTheme.typography.labelSmall,
                color = if (anikotoMatch!!.verified) Color(0xFF4CAF50) else Color.White.copy(alpha = 0.5f),
            )
        }
        if (!loading && failed && epUi.isEmpty()) {
            Text("No source on this server.", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
        }
        Spacer(Modifier.height(10.dp))

        if (epUi.isNotEmpty()) {
            val ranges = epUi.chunked(100)
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
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (ep in ranges.getOrElse(rangeStart) { emptyList() }) {
                    val pct = watched[ep.number] ?: 0
                    val bg = when {
                        pct >= 85 -> Accent.copy(alpha = 0.30f)
                        pct > 0 -> Color.White.copy(alpha = 0.16f)
                        else -> Color.White.copy(alpha = 0.07f)
                    }
                    Box(
                        Modifier.clip(RoundedCornerShape(8.dp)).background(bg)
                            .clickable { ep.play() }
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                    ) {
                        Text(
                            "${if (ep.number % 1f == 0f) ep.number.toInt() else ep.number}",
                            style = MaterialTheme.typography.labelLarge,
                            color = if (pct >= 85) Color.White else Color.White.copy(alpha = 0.9f),
                        )
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
                            com.sanjay.anitrack.next.data.Db.setListStatus(anime.id, key, anime.title, anime.cover)
                            status = key
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
                            com.sanjay.anitrack.next.data.Db.removeFromList(anime.id)
                            status = null
                        }
                    },
                )
            }
        }
    }
}

// ── Settings ──────────────────────────────────────────────────────────────────

@Composable
fun SettingsScreen() {
    var token by remember { mutableStateOf(com.sanjay.anitrack.next.data.GistSync.token) }
    var statusMsg by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(24.dp))

        Text("Cross-device Sync", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(
            "Shares Continue Watching with the desktop app via a private GitHub gist. " +
                "Paste the same token (gist scope) you use there.",
            style = MaterialTheme.typography.bodySmall,
            color = Color.White.copy(alpha = 0.5f),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("GitHub Token (gist scope)") },
            singleLine = true,
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                onClick = {
                    com.sanjay.anitrack.next.data.GistSync.token = token.trim()
                    statusMsg = if (token.isBlank()) "Sync disabled." else "Token saved."
                },
                colors = ButtonDefaults.buttonColors(containerColor = Accent),
            ) { Text("Save") }
            OutlinedButton(
                enabled = com.sanjay.anitrack.next.data.GistSync.configured() && !busy,
                onClick = {
                    busy = true; statusMsg = "Syncing…"
                    scope.launch {
                        val changed = runCatching { com.sanjay.anitrack.next.data.GistSync.pullAndMerge() }
                        statusMsg = if (changed.isSuccess) "Synced ✓" else "Sync failed — check the token."
                        busy = false
                    }
                },
            ) { Text("Sync now") }
        }
        statusMsg?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, style = MaterialTheme.typography.labelMedium, color = Accent)
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
