package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.ui.layout.ContentScale as CS
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Db

private val Accent = Color(0xFFE50914)

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
    var tab by remember { mutableStateOf("all") }
    var byStatus by remember { mutableStateOf<Map<String, List<Db.ListRow>>>(emptyMap()) }

    LaunchedEffect(Unit) {
        runCatching {
            val m = LinkedHashMap<String, List<Db.ListRow>>()
            for (s in Db.STATUSES) m[s] = Db.listByStatus(s)
            byStatus = m
        }
    }
    val rows = if (tab == "all") byStatus.values.flatten() else byStatus[tab].orEmpty()
    val total = byStatus.values.sumOf { it.size }

    @Composable
    fun TabItem(key: String, label: String, count: Int) {
        val selected = tab == key
        Column(Modifier.width(IntrinsicSize.Max).clickable { tab = key }) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 8.dp)) {
                Text(
                    label,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                    color = if (selected) Color.White else Color.White.copy(alpha = 0.55f),
                )
                Spacer(Modifier.width(7.dp))
                Box(Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 8.dp, vertical = 1.dp)) {
                    Text("$count", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.55f))
                }
            }
            Box(Modifier.height(3.dp).fillMaxWidth().clip(RoundedCornerShape(2.dp)).background(if (selected) Accent else Color.Transparent))
        }
    }

    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 20.dp)) {
        Text("My list", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(20.dp))
        // Desktop tabs: All + 5 statuses with count chips, red underline.
        LazyRow(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            item { TabItem("all", "All", total) }
            items(Db.STATUSES.size) { i ->
                val s = Db.STATUSES[i]
                TabItem(s, statusLabels[s] ?: s, byStatus[s]?.size ?: 0)
            }
        }
        Spacer(Modifier.height(20.dp))
        if (rows.isEmpty()) {
            Text("Nothing here yet.", color = Color.White.copy(alpha = 0.4f))
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(150.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            items(rows.size) { i ->
                val r = rows[i]
                Box(
                    Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                        .clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.05f))
                        .clickable { onOpen(r.animeId) },
                ) {
                    AsyncImage(
                        model = r.cover, contentDescription = r.title, contentScale = CS.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                    Box(
                        Modifier.fillMaxSize().background(
                            androidx.compose.ui.graphics.Brush.verticalGradient(
                                0f to Color.Transparent, 0.6f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.9f),
                            ),
                        ),
                    )
                    r.score?.takeIf { it > 0 }?.let {
                        Box(
                            Modifier.align(Alignment.TopEnd).padding(8.dp)
                                .clip(RoundedCornerShape(6.dp)).background(Color.Black.copy(alpha = 0.65f))
                                .padding(horizontal = 7.dp, vertical = 2.dp),
                        ) { Text("★ $it", style = MaterialTheme.typography.labelSmall, color = Color(0xFFE8C34A), fontWeight = FontWeight.Bold) }
                    }
                    Text(
                        r.title,
                        style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, color = Color.White,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
                    )
                }
            }
        }
    }
}
