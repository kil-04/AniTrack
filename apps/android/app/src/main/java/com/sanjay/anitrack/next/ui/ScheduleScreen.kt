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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.material.icons.filled.Schedule
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.AniList
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
