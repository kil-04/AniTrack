package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SearchOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.SearchHistory
import kotlinx.coroutines.delay

// ── Quick search (instant dropdown-style results, like the desktop header) ────

@Composable
fun QuickSearchScreen(
    onOpen: (Anime) -> Unit,
    onBack: () -> Unit,
    manga: Boolean = false,
    onOpenManga: (com.sanjay.anitrack.next.data.Manga) -> Unit = {},
    novel: Boolean = false,
    onOpenNovel: OpenNovel = { _, _ -> },
) {
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchHit>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var searched by remember { mutableStateOf(false) }
    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
    val context = androidx.compose.ui.platform.LocalContext.current
    val history = searchHistoryMode(manga, novel)
    var recent by remember(history) { mutableStateOf(SearchHistory.recent(context, history)) }
    // Novels come from the source the Search tab last used; anime and manga from AniList.
    val where = remember(novel) { if (novel) preferredNovelSource(context).label else "AniList" }

    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    LaunchedEffect(query) {
        if (query.isBlank()) { results = emptyList(); searched = false; searching = false; return@LaunchedEffect }
        delay(350)
        searching = true
        try {
            results = if (novel) novelSearchHits(context, query.trim(), onOpenNovel) else searchHits(query.trim(), manga, onOpen, onOpenManga)
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            results = emptyList()
        }
        searching = false
        searched = true
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = AniColors.Text) }
            OutlinedTextField(
                value = query, onValueChange = { query = it },
                placeholder = { Text(if (novel) "Search novels…" else if (manga) "Search manga…" else "Search anime…", color = AniColors.TextTertiary) },
                singleLine = true,
                shape = RoundedCornerShape(50),
                leadingIcon = { Icon(Icons.Rounded.Search, null, tint = AniColors.TextTertiary) },
                trailingIcon = if (query.isEmpty()) null else {
                    { IconButton(onClick = { query = "" }) { Icon(Icons.Rounded.Close, "Clear", tint = AniColors.TextSecondary) } }
                },
                modifier = Modifier.weight(1f).focusRequester(focus),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = AniColors.Accent.copy(alpha = 0.8f),
                    unfocusedBorderColor = AniColors.BorderSoft,
                    focusedContainerColor = AniColors.SurfaceHigh,
                    unfocusedContainerColor = AniColors.SurfaceHigh,
                    cursorColor = AniColors.Accent,
                ),
            )
        }
        Spacer(Modifier.height(10.dp))
        if (searching && results.isEmpty()) {
            LinearProgressIndicator(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)), color = AniColors.Accent, trackColor = AniColors.SurfaceHigh)
        }
        when {
            query.isBlank() && recent.isNotEmpty() -> Column {
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Recent searches", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    TextButton(onClick = { SearchHistory.clear(context, history); recent = emptyList() }) {
                        Text("Clear", color = AniColors.TextSecondary)
                    }
                }
                recent.forEach { past ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { query = past }
                            .padding(horizontal = 12.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Rounded.History, null, tint = AniColors.TextTertiary, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(14.dp))
                        Text(past, style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
            query.isBlank() -> EmptyState(
                Icons.Rounded.Search,
                if (novel) "Find a novel" else if (manga) "Find a manga" else "Find an anime",
                "Search $where by title. Results appear as you type.",
            )
            searched && !searching && results.isEmpty() -> EmptyState(
                Icons.Rounded.SearchOff,
                "No matches",
                "Nothing on $where matches \"${query.trim()}\". " + if (novel) "Try another spelling." else "Try another spelling or the romaji title.",
            )
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            items(results.size) { i ->
                val hit = results[i]
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                        .clickable { SearchHistory.remember(context, history, query); hit.open() }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                ) { SearchHitRow(hit) }
            }
        }
    }
}
