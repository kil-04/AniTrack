package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Search
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale as CS
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList
import kotlinx.coroutines.delay

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
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White) }
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
