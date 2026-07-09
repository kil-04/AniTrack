package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale as CS
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Db
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Accent = Color(0xFFE50914)

// ── Quick search (instant dropdown-style results, like the desktop header) ────

@Composable
fun QuickSearchScreen(onOpen: (Anime) -> Unit, onBack: () -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }

    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); return@LaunchedEffect }
        delay(350)
        searching = true
        runCatching { results = AniList.search(query.trim()) }
        searching = false
    }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, "Back", tint = Color.White) }
            OutlinedTextField(
                value = query, onValueChange = { query = it },
                placeholder = { Text("Search anime…") }, singleLine = true,
                modifier = Modifier.weight(1f).focusRequester(focus),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Accent, cursorColor = Accent),
            )
        }
        Spacer(Modifier.height(8.dp))
        if (searching && results.isEmpty()) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Accent)
        LazyColumn {
            items(results.size) { i ->
                val a = results[i]
                Row(
                    Modifier.fillMaxWidth().clickable { onOpen(a) }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AsyncImage(
                        model = a.cover, contentDescription = a.title, contentScale = CS.Crop,
                        modifier = Modifier.width(46.dp).height(64.dp).clip(RoundedCornerShape(6.dp)).background(Color.White.copy(alpha = 0.06f)),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(a.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            a.year?.let { Text("$it", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f)) }
                            a.score?.let { Text("★ ${it / 10.0}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF7CD07C)) }
                            a.status?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f)) }
                        }
                    }
                }
            }
        }
    }
}

// ── Continue Watching (full page) ─────────────────────────────────────────────

@Composable
fun ContinueWatchingScreen(onPlay: () -> Unit) {
    var rows by remember { mutableStateOf<List<Db.CwRow>>(emptyList()) }
    var resumingId by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { runCatching { rows = Db.continueWatching(100) } }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Continue Watching", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        if (rows.isEmpty()) Text("Nothing in progress.", color = Color.White.copy(alpha = 0.4f))
        LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(rows.size) { i ->
                val row = rows[i]
                Column(Modifier.clickable {
                    if (resumingId != null) return@clickable
                    resumingId = row.animeId
                    scope.launch {
                        val ok = prepareResume(row)
                        resumingId = null
                        if (ok) onPlay()
                    }
                }) {
                    Box {
                        AsyncImage(
                            model = row.cover, contentDescription = row.title, contentScale = CS.Crop,
                            modifier = Modifier.fillMaxWidth().height(84.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.06f)),
                        )
                        if (resumingId == row.animeId) {
                            Box(Modifier.matchParentSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Accent, modifier = Modifier.size(28.dp)) }
                        }
                        LinearProgressIndicator(
                            progress = { (row.percent / 100f).coerceIn(0f, 1f) }, color = Accent,
                            trackColor = Color.White.copy(alpha = 0.25f),
                            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp),
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(row.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
                    Text("Ep ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode} · ${row.percent}%", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
                }
            }
        }
    }
}

// ── Latest Episodes (full page) ───────────────────────────────────────────────

@Composable
fun LatestScreen(onOpen: (Anime) -> Unit) {
    var list by remember { mutableStateOf<List<AniList.Airing>>(emptyList()) }
    LaunchedEffect(Unit) { runCatching { list = AniList.recentEpisodes() } }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Latest Episodes", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        LazyVerticalGrid(columns = GridCells.Adaptive(180.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            items(list.size) { i ->
                val a = list[i]
                Column(Modifier.clickable { onOpen(a.anime) }) {
                    Box {
                        AsyncImage(
                            model = a.anime.banner ?: a.anime.cover, contentDescription = a.anime.title, contentScale = CS.Crop,
                            modifier = Modifier.fillMaxWidth().height(100.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.06f)),
                        )
                        Box(Modifier.align(Alignment.TopStart).padding(6.dp).clip(RoundedCornerShape(6.dp)).background(Accent).padding(horizontal = 7.dp, vertical = 2.dp)) {
                            Text("EP ${a.episode}", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(a.anime.title, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
                }
            }
        }
    }
}

// ── Schedule (next 7 days of airing, grouped by day) ──────────────────────────

@Composable
fun ScheduleScreen(onOpen: (Int) -> Unit) {
    var airing by remember { mutableStateOf<List<AniList.Airing>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        runCatching { airing = AniList.airingWeek() }
        loading = false
    }

    val dayFmt = remember { SimpleDateFormat("EEEE, MMM d", Locale.getDefault()) }
    val timeFmt = remember { SimpleDateFormat("HH:mm", Locale.getDefault()) }
    val grouped = remember(airing) { airing.groupBy { dayFmt.format(Date(it.airingAt * 1000)) } }

    if (loading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = Accent)
        }
        return
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
        item {
            Text("Schedule", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
        }
        for ((day, list) in grouped) {
            item {
                Text(
                    day,
                    style = MaterialTheme.typography.titleSmall,
                    color = Accent,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
            }
            items(list.size) { i ->
                val a = list[i]
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color.White.copy(alpha = 0.05f))
                        .clickable { onOpen(a.anime.id) }
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AsyncImage(
                        model = a.anime.cover,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.width(44.dp).height(60.dp).clip(RoundedCornerShape(6.dp)),
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(a.anime.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            "Episode ${a.episode}",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color.White.copy(alpha = 0.5f),
                        )
                    }
                    Text(
                        timeFmt.format(Date(a.airingAt * 1000)),
                        style = MaterialTheme.typography.labelLarge,
                        color = Color.White.copy(alpha = 0.7f),
                    )
                }
                Spacer(Modifier.height(8.dp))
            }
        }
        if (grouped.isEmpty()) {
            item { Text("Nothing airing this week.", color = Color.White.copy(alpha = 0.4f)) }
        }
    }
}

// ── My List (local watch statuses) ────────────────────────────────────────────

private val statusLabels = mapOf(
    "watching" to "Watching",
    "completed" to "Completed",
    "on_hold" to "On hold",
    "dropped" to "Dropped",
    "plan_to_watch" to "Plan to watch",
)

@Composable
fun MyListScreen(onOpen: (Int) -> Unit) {
    var status by remember { mutableStateOf("watching") }
    var rows by remember { mutableStateOf<List<Db.ListRow>>(emptyList()) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(status) {
        runCatching { rows = Db.listByStatus(status) }
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("My List", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(Db.STATUSES.size) { i ->
                val s = Db.STATUSES[i]
                FilterChip(
                    selected = status == s,
                    onClick = { status = s },
                    label = { Text(statusLabels[s] ?: s) },
                )
            }
        }
        Spacer(Modifier.height(16.dp))
        if (rows.isEmpty()) {
            Text("Nothing here yet.", color = Color.White.copy(alpha = 0.4f))
        }
        LazyColumn {
            items(rows.size) { i ->
                val r = rows[i]
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color.White.copy(alpha = 0.05f))
                        .clickable { onOpen(r.animeId) }
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AsyncImage(
                        model = r.cover,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.width(44.dp).height(60.dp).clip(RoundedCornerShape(6.dp)),
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(r.title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    TextButton(onClick = {
                        scope.launch {
                            Db.removeFromList(r.animeId)
                            rows = Db.listByStatus(status)
                        }
                    }) { Text("Remove", color = Color.White.copy(alpha = 0.5f)) }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}
