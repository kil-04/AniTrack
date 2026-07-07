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

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 16.dp)) {
        if (cw.isNotEmpty()) {
            item { SectionHeader("Continue Watching") }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(cw.size) { i ->
                        val row = cw[i]
                        ContinueCard(
                            row,
                            onResume = {
                                val slug = row.slug ?: return@ContinueCard
                                scope.launch {
                                    val eps = runCatching { com.sanjay.anitrack.next.data.Anikoto.episodes(slug).episodes }.getOrNull() ?: return@launch
                                    val idx = eps.indexOfFirst { it.number == row.episode }.takeIf { it >= 0 } ?: 0
                                    com.sanjay.anitrack.next.data.PlaySession.apply {
                                        animeId = row.animeId; animeTitle = row.title; animeCover = row.cover
                                        this.slug = slug; episodes = eps; index = idx
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

// ── Episodes (Anikoto provider) ───────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EpisodesSection(anime: com.sanjay.anitrack.next.data.Anime, onPlay: () -> Unit) {
    var matched by remember { mutableStateOf<com.sanjay.anitrack.next.data.Anikoto.Matched?>(null) }
    var failed by remember { mutableStateOf(false) }
    var rangeStart by remember { mutableStateOf(0) } // index into ranges of 100
    var watched by remember { mutableStateOf<Map<Float, Int>>(emptyMap()) }

    LaunchedEffect(anime.id) {
        matched = null; failed = false; rangeStart = 0
        runCatching { watched = com.sanjay.anitrack.next.data.Db.positionsFor(anime.id) }
        runCatching { matched = com.sanjay.anitrack.next.data.Anikoto.matchFor(anime) }
            .onFailure { failed = true }
        if (matched == null) failed = true
    }

    Column(Modifier.padding(horizontal = 16.dp)) {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text("Episodes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.width(10.dp))
            val m = matched
            when {
                m != null -> {
                    Text(
                        if (m.verified) "Anikoto · verified ✓" else "Anikoto · best match",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (m.verified) Color(0xFF4CAF50) else Color.White.copy(alpha = 0.5f),
                    )
                }
                failed -> Text("no source found", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
                else -> CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Accent)
            }
        }
        Spacer(Modifier.height(10.dp))

        val eps = matched?.list?.episodes.orEmpty()
        if (eps.isNotEmpty()) {
            // Range selector for long series (chunks of 100).
            val ranges = eps.chunked(100)
            if (ranges.size > 1) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(ranges.size) { i ->
                        val first = ranges[i].first().number.toInt()
                        val last = ranges[i].last().number.toInt()
                        FilterChip(
                            selected = rangeStart == i,
                            onClick = { rangeStart = i },
                            label = { Text("$first–$last") },
                        )
                    }
                }
                Spacer(Modifier.height(10.dp))
            }
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val allEps = matched!!.list.episodes
                for (ep in ranges.getOrElse(rangeStart) { emptyList() }) {
                    val pct = watched[ep.number] ?: 0
                    val bg = when {
                        pct >= 85 -> Accent.copy(alpha = 0.30f)      // watched
                        pct > 0 -> Color.White.copy(alpha = 0.16f)   // partial
                        else -> Color.White.copy(alpha = 0.07f)
                    }
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(bg)
                            .clickable {
                                com.sanjay.anitrack.next.data.PlaySession.apply {
                                    animeId = anime.id
                                    animeTitle = anime.title
                                    animeCover = anime.cover
                                    slug = matched!!.source.slug
                                    episodes = allEps
                                    index = allEps.indexOf(ep).coerceAtLeast(0)
                                }
                                onPlay()
                            }
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
