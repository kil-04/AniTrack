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
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Db
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Accent = Color(0xFFE50914)

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
