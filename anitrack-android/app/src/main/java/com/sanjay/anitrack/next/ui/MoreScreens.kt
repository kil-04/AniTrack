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
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
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

// ── Nav search box with a live results dropdown (desktop header search) ───────

@Composable
fun NavSearchBox(modifier: Modifier = Modifier, onOpen: (Anime) -> Unit) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var open by remember { mutableStateOf(false) }

    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); open = false; return@LaunchedEffect }
        delay(350)
        runCatching { results = AniList.search(query.trim()) }
        open = results.isNotEmpty()
    }

    Box(modifier) {
        OutlinedTextField(
            value = query, onValueChange = { query = it },
            placeholder = { Text("Search anime…", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.4f)) },
            singleLine = true,
            shape = RoundedCornerShape(50),   // pill, like the desktop header
            leadingIcon = { Icon(Icons.Filled.Search, null, tint = Color.White.copy(alpha = 0.5f)) },
            trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Text("✕", color = Color.White.copy(alpha = 0.6f)) } },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            textStyle = MaterialTheme.typography.bodyMedium,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Accent,
                unfocusedBorderColor = Color.White.copy(alpha = 0.15f),
                focusedContainerColor = Color.White.copy(alpha = 0.06f),
                unfocusedContainerColor = Color.White.copy(alpha = 0.06f),
                cursorColor = Accent,
            ),
        )
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            properties = androidx.compose.ui.window.PopupProperties(focusable = false),
            modifier = Modifier.width(360.dp).heightIn(max = 460.dp),
        ) {
            results.take(10).forEach { a ->
                DropdownMenuItem(
                    onClick = { open = false; query = ""; onOpen(a) },
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            AsyncImage(
                                model = a.cover, contentDescription = a.title, contentScale = CS.Crop,
                                modifier = Modifier.width(38.dp).height(52.dp).clip(RoundedCornerShape(5.dp)).background(Color.White.copy(alpha = 0.06f)),
                            )
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(a.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    a.year?.let { Text("$it", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f)) }
                                    a.score?.let { Text("★ ${it / 10.0}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF7CD07C)) }
                                    a.status?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f)) }
                                }
                            }
                        }
                    },
                )
            }
        }
    }
}

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
    var allRows by remember { mutableStateOf<List<Db.CwRow>>(emptyList()) }
    var page by remember { mutableStateOf(0) }
    var resumingId by remember { mutableStateOf<Int?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { runCatching { allRows = Db.continueWatching(1000) } }

    val pageSize = 24
    val pageCount = ((allRows.size + pageSize - 1) / pageSize).coerceAtLeast(1)
    val rows = allRows.drop(page * pageSize).take(pageSize)

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Continue Watching", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        if (allRows.isEmpty()) Text("Nothing in progress.", color = Color.White.copy(alpha = 0.4f))
        LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.weight(1f)) {
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
        if (pageCount > 1) Pager(page, pageCount) { page = it }
    }
}

@Composable
private fun Pager(page: Int, pageCount: Int, onPage: (Int) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = { if (page > 0) onPage(page - 1) }, enabled = page > 0) { Text("‹") }
        Text("${page + 1} / $pageCount", color = Color.White.copy(alpha = 0.7f))
        TextButton(onClick = { if (page + 1 < pageCount) onPage(page + 1) }, enabled = page + 1 < pageCount) { Text("›") }
    }
}

// ── Latest Episodes (full page) ───────────────────────────────────────────────

@Composable
fun LatestScreen(onOpen: (Anime) -> Unit) {
    var list by remember { mutableStateOf<List<AniList.Airing>>(emptyList()) }
    var page by remember { mutableStateOf(1) }
    var hasNext by remember { mutableStateOf(false) }
    LaunchedEffect(page) {
        runCatching {
            val (l, hn) = AniList.recentEpisodes(page)
            list = l; hasNext = hn
        }
    }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Latest Episodes", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(12.dp))
        LazyVerticalGrid(columns = GridCells.Adaptive(180.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.weight(1f)) {
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
        Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { if (page > 1) page-- }, enabled = page > 1) { Text("‹ Prev") }
            Text("Page $page", color = Color.White.copy(alpha = 0.7f))
            TextButton(onClick = { if (hasNext) page++ }, enabled = hasNext) { Text("Next ›") }
        }
    }
}

// ── Downloads (offline HLS library) ───────────────────────────────────────────

@Composable
fun DownloadsScreen(onPlay: () -> Unit) {
    val items = com.sanjay.anitrack.next.data.Downloads.items
    // Group by anime (title), sorted; each group collapsible with a total size.
    val groups = items.groupBy { it.animeId }.values.toList()
    val expanded = remember { mutableStateMapOf<Int, Boolean>() }

    fun playLocal(d: com.sanjay.anitrack.next.data.Downloads.Item) {
        val f = com.sanjay.anitrack.next.data.Downloads.localPlaylist(d.id) ?: return
        com.sanjay.anitrack.next.data.PlaySession.apply {
            provider = "anikoto"; animeId = d.animeId; animeTitle = d.title; animeCover = d.cover
            anime = null; localFile = f.absolutePath
            slug = ""; anikotoEps = listOf(com.sanjay.anitrack.next.data.Anikoto.Episode(d.episode, "Episode ${d.episode.toInt()}", "", ""))
            paheEps = emptyList(); index = 0
        }
        onPlay()
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("⬇  Downloads", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("Watch downloaded episodes offline, in the app. Long-press an episode on any show to add one.", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.45f))
        Spacer(Modifier.height(16.dp))
        if (items.isEmpty()) Text("No downloads yet.", color = Color.White.copy(alpha = 0.4f))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(groups.size) { gi ->
                val group = groups[gi].sortedBy { it.episode }
                val head = group.first()
                val open = expanded[head.animeId] ?: true
                val totalSize = group.sumOf { it.sizeBytes }
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.05f))) {
                    // Group header
                    Row(
                        Modifier.fillMaxWidth().clickable { expanded[head.animeId] = !open }.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AsyncImage(
                            model = head.cover, contentDescription = head.title, contentScale = CS.Crop,
                            modifier = Modifier.width(44.dp).height(60.dp).clip(RoundedCornerShape(6.dp)).background(Color.White.copy(alpha = 0.06f)),
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(head.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                "${group.size} episode${if (group.size == 1) "" else "s"} · ${com.sanjay.anitrack.next.data.Downloads.humanSize(totalSize)}",
                                style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f),
                            )
                        }
                        Text(if (open) "▲" else "▼", color = Color.White.copy(alpha = 0.5f))
                    }
                    if (open) {
                        group.forEach { d ->
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text("Episode ${if (d.episode % 1f == 0f) d.episode.toInt() else d.episode}", style = MaterialTheme.typography.bodyMedium)
                                    val sub = when (d.status) {
                                        com.sanjay.anitrack.next.data.Downloads.Status.QUEUED -> "queued…"
                                        com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING -> "${d.progress}%"
                                        com.sanjay.anitrack.next.data.Downloads.Status.DONE -> com.sanjay.anitrack.next.data.Downloads.humanSize(d.sizeBytes)
                                        com.sanjay.anitrack.next.data.Downloads.Status.FAILED -> "failed — long-press to retry"
                                    }
                                    Text(sub, style = MaterialTheme.typography.labelSmall, color = if (d.status == com.sanjay.anitrack.next.data.Downloads.Status.FAILED) Color(0xFFFF6B6B) else Color.White.copy(alpha = 0.45f))
                                    if (d.status == com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING) {
                                        LinearProgressIndicator(progress = { d.progress / 100f }, color = Accent, trackColor = Color.White.copy(alpha = 0.2f), modifier = Modifier.fillMaxWidth(0.6f).height(3.dp).padding(top = 3.dp))
                                    }
                                }
                                if (d.status == com.sanjay.anitrack.next.data.Downloads.Status.DONE) {
                                    Button(onClick = { playLocal(d) }, colors = ButtonDefaults.buttonColors(containerColor = Accent), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp)) {
                                        Icon(Icons.Filled.PlayArrow, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Play")
                                    }
                                }
                                IconButton(onClick = { com.sanjay.anitrack.next.data.Downloads.remove(d.id) }) {
                                    Icon(Icons.Filled.Delete, "Delete", tint = Color.White.copy(alpha = 0.5f))
                                }
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                    }
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
