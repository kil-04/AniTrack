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
import androidx.compose.foundation.border
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.material.icons.filled.KeyboardDoubleArrowLeft
import androidx.compose.material.icons.filled.KeyboardDoubleArrowRight
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Schedule
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
fun NavSearchBox(modifier: Modifier = Modifier, onOpen: (Anime) -> Unit, onViewAll: () -> Unit = {}) {
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
            trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, "Clear", tint = Color.White.copy(alpha = 0.6f), modifier = Modifier.size(16.dp)) } },
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
        // Aligned flush under the bar, same width — like the desktop dropdown.
        DropdownMenu(
            expanded = open,
            onDismissRequest = { open = false },
            properties = androidx.compose.ui.window.PopupProperties(focusable = false),
            offset = androidx.compose.ui.unit.DpOffset(0.dp, 6.dp),
            shape = RoundedCornerShape(14.dp),
            containerColor = Color(0xFF16161C),
            modifier = Modifier.width(320.dp).heightIn(max = 500.dp),
        ) {
            results.take(9).forEach { a ->
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
                                Text(a.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Spacer(Modifier.height(2.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    a.year?.let {
                                        Box(Modifier.clip(RoundedCornerShape(4.dp)).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 5.dp, vertical = 1.dp)) {
                                            Text("$it", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.7f))
                                        }
                                    }
                                    a.score?.let { Text("★ ${it / 10.0}", style = MaterialTheme.typography.labelSmall, color = Color(0xFF7CD07C)) }
                                    a.status?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f)) }
                                }
                            }
                        }
                    },
                )
            }
            HorizontalDivider(color = Color.White.copy(alpha = 0.08f))
            DropdownMenuItem(
                onClick = { open = false; onViewAll() },
                text = {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("View all results for \"$query\"", style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.8f), modifier = Modifier.weight(1f))
                        Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = Color.White.copy(alpha = 0.6f), modifier = Modifier.size(16.dp))
                    }
                },
            )
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

    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 16.dp)) {
        // Desktop header: clock icon + title + count chip.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Schedule, null, tint = Color.White, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("Continue Watching", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (allRows.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                Box(Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
                    Text("${allRows.size}", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.5f))
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        if (allRows.isEmpty()) {
            Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) {
                Text("Nothing here yet — start watching something!", color = Color.White.copy(alpha = 0.3f), style = MaterialTheme.typography.bodySmall)
            }
        }
        // Desktop grid: portrait 2:3 cards, EP badge, timestamp, red progress strip.
        LazyVerticalGrid(columns = GridCells.Adaptive(120.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.weight(1f)) {
            items(rows.size) { i ->
                val row = rows[i]
                Column {
                    Box(
                        Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                            .clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.05f))
                            .clickable {
                                if (resumingId != null) return@clickable
                                resumingId = row.animeId
                                scope.launch {
                                    val ok = prepareResume(row)
                                    resumingId = null
                                    if (ok) onPlay()
                                }
                            },
                    ) {
                        AsyncImage(
                            model = row.cover, contentDescription = row.title, contentScale = CS.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                        Box(
                            Modifier.fillMaxSize().background(
                                androidx.compose.ui.graphics.Brush.verticalGradient(
                                    0f to Color.Transparent, 0.5f to Color.Black.copy(alpha = 0.2f), 1f to Color.Black.copy(alpha = 0.9f),
                                ),
                            ),
                        )
                        // EP badge (red, top-left)
                        Box(
                            Modifier.align(Alignment.TopStart).padding(6.dp)
                                .clip(RoundedCornerShape(4.dp)).background(Accent).padding(horizontal = 6.dp, vertical = 2.dp),
                        ) { Text("EP ${if (row.episode % 1f == 0f) row.episode.toInt() else row.episode}", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
                        // ✕ dismiss (top-right)
                        Box(
                            Modifier.align(Alignment.TopEnd).padding(6.dp)
                                .size(22.dp).clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.7f))
                                .clickable {
                                    scope.launch {
                                        Db.dismiss(row.animeId)
                                        com.sanjay.anitrack.next.data.GistSync.deleteAnime(row.animeId)
                                        runCatching { allRows = Db.continueWatching(1000) }
                                    }
                                },
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Filled.Close, "Dismiss", tint = Color.White, modifier = Modifier.size(12.dp)) }
                        if (resumingId == row.animeId) {
                            Box(Modifier.matchParentSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Accent, modifier = Modifier.size(28.dp)) }
                        }
                        // Timestamp just above the progress strip (desktop)
                        Text(
                            "${com.sanjay.anitrack.next.ui.fmtSecs(row.positionSec)} / ${com.sanjay.anitrack.next.ui.fmtSecs(row.durationSec)}",
                            color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.align(Alignment.BottomStart).padding(start = 8.dp, bottom = 10.dp),
                        )
                        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(4.dp).background(Color.White.copy(alpha = 0.2f))) {
                            Box(Modifier.fillMaxWidth(fraction = (row.percent / 100f).coerceIn(0f, 1f)).fillMaxHeight().background(Accent))
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(row.title, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.8f))
                }
            }
        }
        if (pageCount > 1) NumberedPager(page, pageCount) { page = it }
    }
}

// Desktop-style pagination: « ‹ [1] [2] … [N] › » with the active page white.
@Composable
internal fun NumberedPager(page: Int, pageCount: Int, onPage: (Int) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        @Composable
        fun navBtn(icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, target: Int) {
            Box(
                Modifier.size(32.dp).clip(RoundedCornerShape(6.dp))
                    .clickable(enabled = enabled) { onPage(target) },
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, tint = Color.White.copy(alpha = if (enabled) 0.5f else 0.2f), modifier = Modifier.size(16.dp)) }
        }
        navBtn(Icons.Filled.KeyboardDoubleArrowLeft, page > 0, 0)
        navBtn(Icons.Filled.ChevronLeft, page > 0, page - 1)
        val pages = (0 until pageCount).filter { kotlin.math.abs(it - page) <= 2 || it == 0 || it == pageCount - 1 }
        var prev = -1
        for (p in pages) {
            if (prev >= 0 && p - prev > 1) Text("…", color = Color.White.copy(alpha = 0.3f), modifier = Modifier.padding(horizontal = 4.dp))
            prev = p
            Box(
                Modifier.padding(horizontal = 2.dp).sizeIn(minWidth = 32.dp, minHeight = 32.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (p == page) Color.White else Color.Transparent)
                    .clickable { onPage(p) }
                    .padding(horizontal = 8.dp),
                contentAlignment = Alignment.Center,
            ) { Text("${p + 1}", color = if (p == page) Color.Black else Color.White.copy(alpha = 0.6f), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
        }
        navBtn(Icons.Filled.ChevronRight, page + 1 < pageCount, page + 1)
        navBtn(Icons.Filled.KeyboardDoubleArrowRight, page + 1 < pageCount, pageCount - 1)
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
fun DownloadsScreen(onPlay: () -> Unit, onOpenAnime: (Int) -> Unit = {}) {
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

    // Desktop layout: centered, max-width column; bordered group cards.
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.FileDownload, null, tint = Accent, modifier = Modifier.size(24.dp))
                Spacer(Modifier.width(8.dp))
                Text("Downloads", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(2.dp))
            Text("Watch downloaded episodes offline, in the app.", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.4f))
            Spacer(Modifier.height(20.dp))

            if (items.isEmpty()) {
                Box(
                    Modifier.fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .androidxBorder()
                        .background(Color.White.copy(alpha = 0.05f))
                        .padding(vertical = 48.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "No downloads yet. Tap Download on an episode (or \"Download 100\") on a series page.",
                        style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.4f),
                    )
                }
            }

            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(groups.size) { gi ->
                    val group = groups[gi].sortedBy { it.episode }
                    val head = group.first()
                    val open = expanded[head.animeId] ?: false   // collapsed by default, like desktop
                    val done = group.filter { it.status == com.sanjay.anitrack.next.data.Downloads.Status.DONE }
                    val active = group.count {
                        it.status == com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING ||
                            it.status == com.sanjay.anitrack.next.data.Downloads.Status.QUEUED
                    }
                    val totalSize = done.sumOf { it.sizeBytes }
                    val summary = buildString {
                        append("${done.size} episode${if (done.size == 1) "" else "s"}")
                        if (totalSize > 0) append(" · ${com.sanjay.anitrack.next.data.Downloads.humanSize(totalSize)}")
                        if (active > 0) append(" · $active downloading")
                    }
                    Column(
                        Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .androidxBorder()
                            .background(Color.White.copy(alpha = 0.03f)),
                    ) {
                        // Header row: tap → expand/collapse; cover/title → series page.
                        Row(
                            Modifier.fillMaxWidth().clickable { expanded[head.animeId] = !open }
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            AsyncImage(
                                model = head.cover, contentDescription = head.title, contentScale = CS.Crop,
                                modifier = Modifier.width(36.dp).height(48.dp).clip(RoundedCornerShape(4.dp)).background(Color.White.copy(alpha = 0.05f))
                                    .clickable(enabled = head.animeId > 0) { onOpenAnime(head.animeId) },
                            )
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    head.title,
                                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                                    textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.clickable(enabled = head.animeId > 0) { onOpenAnime(head.animeId) },
                                )
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    if (active > 0) CircularProgressIndicator(Modifier.size(11.dp), strokeWidth = 1.5.dp, color = Color.White.copy(alpha = 0.4f))
                                    Text(summary, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f))
                                }
                            }
                            Icon(
                                if (open) Icons.Filled.KeyboardArrowUp else Icons.Filled.KeyboardArrowDown,
                                null, tint = Color.White.copy(alpha = 0.4f),
                            )
                        }
                        if (open) {
                            HorizontalDivider(color = Color.White.copy(alpha = 0.1f))
                            group.forEachIndexed { i, d ->
                                if (i > 0) HorizontalDivider(color = Color.White.copy(alpha = 0.05f))
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text("Episode ${if (d.episode % 1f == 0f) d.episode.toInt() else d.episode}", style = MaterialTheme.typography.bodyMedium, color = Color.White)
                                        val sub = when (d.status) {
                                            com.sanjay.anitrack.next.data.Downloads.Status.QUEUED -> "Queued"
                                            com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING -> "Downloading… ${d.progress}%"
                                            com.sanjay.anitrack.next.data.Downloads.Status.DONE -> com.sanjay.anitrack.next.data.Downloads.humanSize(d.sizeBytes)
                                            com.sanjay.anitrack.next.data.Downloads.Status.FAILED -> d.error ?: "Failed"
                                        }
                                        Text(sub, style = MaterialTheme.typography.labelSmall, color = if (d.status == com.sanjay.anitrack.next.data.Downloads.Status.FAILED) Color(0xFFFF6B6B) else Color.White.copy(alpha = 0.45f))
                                    }
                                    when (d.status) {
                                        com.sanjay.anitrack.next.data.Downloads.Status.DOWNLOADING -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White.copy(alpha = 0.6f))
                                            Text("${d.progress}%", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.6f))
                                        }
                                        com.sanjay.anitrack.next.data.Downloads.Status.QUEUED ->
                                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White.copy(alpha = 0.4f))
                                        com.sanjay.anitrack.next.data.Downloads.Status.DONE -> Row(
                                            Modifier.height(32.dp).clip(RoundedCornerShape(6.dp)).background(Accent)
                                                .clickable { playLocal(d) }.padding(horizontal = 12.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(14.dp))
                                            Spacer(Modifier.width(5.dp))
                                            Text("Play", color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
                                        }
                                        else -> {}
                                    }
                                    Box(
                                        Modifier.size(32.dp).clip(RoundedCornerShape(6.dp))
                                            .clickable { com.sanjay.anitrack.next.data.Downloads.remove(d.id) },
                                        contentAlignment = Alignment.Center,
                                    ) { Icon(Icons.Filled.Delete, "Delete", tint = Color.White.copy(alpha = 0.4f), modifier = Modifier.size(16.dp)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// 1dp white/10 border, matching the desktop's border-white/10 cards.
private fun Modifier.androidxBorder(): Modifier =
    this.then(Modifier.border(1.dp, Color.White.copy(alpha = 0.1f), RoundedCornerShape(10.dp)))

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

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 24.dp, vertical = 20.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.EditCalendar, null, tint = Accent, modifier = Modifier.size(24.dp))
                Spacer(Modifier.width(8.dp))
                Text("Schedule", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(2.dp))
            Text("Upcoming episodes for the next 7 days.", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.4f))
            Spacer(Modifier.height(16.dp))
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
