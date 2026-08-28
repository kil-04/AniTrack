package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.*

private val GenomePink = Color(0xFFE879F9)
private val GenomeBlue = Color(0xFF60A5FA)
private val GenomeGreen = Color(0xFF34D399)

@Composable
fun TasteGenomeScreen(onOpen: (Int) -> Unit, onOpenTimeMachine: () -> Unit) {
    var rows by remember { mutableStateOf<List<Db.ListRow>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        suspend fun loadRows() = Db.STATUSES.flatMap { Db.listByStatus(it) }
        rows = runCatching { loadRows() }.getOrDefault(emptyList())
        val experienced = rows.filter { it.status != "plan_to_watch" }
        if (Mal.isConnected && experienced.isNotEmpty() && experienced.count { it.genres.isNotEmpty() } * 2 < experienced.size) {
            runCatching { Mal.importList() }
            rows = runCatching { loadRows() }.getOrDefault(rows)
        }
        loading = false
    }

    val genome = remember(rows) { TasteGenomeAnalyzer.analyze(rows.map { TasteGenomeInput(it.status, it.score, it.year, it.genres, it.format) }) }
    val signalTitles = remember(rows) {
        rows.filter { it.status == "completed" || it.status == "watching" }
            .sortedWith(compareByDescending<Db.ListRow> { it.score ?: 0.0 }.thenByDescending { it.updatedAt }).take(12)
    }

    LazyColumn(Modifier.fillMaxSize().background(Color.Black)) {
        item {
            Box(
                Modifier.fillMaxWidth().background(
                    Brush.radialGradient(listOf(Color(0x3326A7E8), Color.Black), radius = 900f)
                ).padding(horizontal = 24.dp, vertical = 34.dp)
            ) {
                Column(Modifier.fillMaxWidth()) {
                    Text("⌁  PERSONAL TASTE SEQUENCE", color = GenomePink, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
                    Spacer(Modifier.height(14.dp))
                    Text(genome.archetype, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Black)
                    Spacer(Modifier.height(10.dp))
                    Text(genome.summary, color = Color.White.copy(alpha = 0.58f), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.widthIn(max = 680.dp))
                    Spacer(Modifier.height(20.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(92.dp)) {
                            CircularProgressIndicator(
                                progress = { genome.confidence / 100f },
                                modifier = Modifier.fillMaxSize(),
                                color = GenomePink,
                                trackColor = Color.White.copy(alpha = 0.08f),
                                strokeWidth = 7.dp,
                            )
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text("${genome.confidence}%", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
                                Text("CONFIDENCE", fontSize = 7.sp, letterSpacing = 1.sp, color = Color.White.copy(alpha = 0.35f))
                            }
                        }
                        Spacer(Modifier.width(18.dp))
                        Button(
                            onClick = onOpenTimeMachine,
                            colors = ButtonDefaults.buttonColors(containerColor = GenomePink.copy(alpha = 0.16f), contentColor = Color(0xFFFFC4FF)),
                        ) { Text("Enter the Time Machine →", fontWeight = FontWeight.Bold) }
                    }
                }
            }
        }

        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GenomeStat(genome.analyzed.toString(), "EXPERIENCED", Modifier.weight(1f))
                GenomeStat(genome.meanScore?.let { "%.2f".format(it) } ?: "—", "MEAN SCORE", Modifier.weight(1f))
                GenomeStat("${genome.classicShare}%", "PRE-2000", Modifier.weight(1f))
                GenomeStat(genome.rated.toString(), "RATINGS", Modifier.weight(1f))
            }
        }

        if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp), color = GenomePink) }
        else if (genome.analyzed == 0) item {
            Column(Modifier.fillMaxWidth().padding(48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("No taste signal yet", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Connect MAL or mark anime as watching/completed. Plan-to-watch titles are excluded because curiosity is not the same as taste.", color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.bodySmall)
            }
        } else {
            item { GenomeSignals("ERA CHROMOSOMES", genome.eras, GenomePink) }
            item { GenomeSignals("GENRE CHROMOSOMES", genome.genres, GenomeBlue) }
            item { GenomeSignals("FORMAT CHROMOSOMES", genome.formats, GenomeGreen) }
            if (signalTitles.isNotEmpty()) item {
                Column(Modifier.padding(top = 12.dp, bottom = 40.dp)) {
                    Text("TITLES SHAPING YOUR SEQUENCE", modifier = Modifier.padding(horizontal = 24.dp), color = GenomePink, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                    Spacer(Modifier.height(12.dp))
                    LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(signalTitles, key = { it.animeId }) { row ->
                            Column(Modifier.width(126.dp).clickable { onOpen(row.animeId) }) {
                                AsyncImage(row.cover, row.title, Modifier.width(126.dp).height(180.dp).clip(RoundedCornerShape(10.dp)).background(Color.White.copy(alpha = 0.05f)), contentScale = ContentScale.Crop)
                                Spacer(Modifier.height(6.dp))
                                Text(row.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                                row.score?.let { Text("★ $it", color = Color(0xFFE8C34A), style = MaterialTheme.typography.labelSmall) }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GenomeStat(value: String, label: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(11.dp)).background(Color.White.copy(alpha = 0.045f)).padding(12.dp)) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
        Text(label, fontSize = 8.sp, letterSpacing = 0.8.sp, color = Color.White.copy(alpha = 0.35f), maxLines = 1)
    }
}

@Composable
private fun GenomeSignals(title: String, items: List<TasteAffinity>, color: Color) {
    Column(Modifier.padding(horizontal = 24.dp, vertical = 14.dp)) {
        Text(title, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
        Spacer(Modifier.height(12.dp))
        items.forEach { item ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(item.label, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                Text("${item.count} titles${item.averageScore?.let { " · %.1f".format(it) } ?: ""}", color = Color.White.copy(alpha = 0.35f), style = MaterialTheme.typography.labelSmall)
            }
            Spacer(Modifier.height(5.dp))
            LinearProgressIndicator(
                progress = { item.strength / 100f },
                color = color,
                trackColor = Color.White.copy(alpha = 0.06f),
                modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(50)),
            )
            Spacer(Modifier.height(13.dp))
        }
    }
}
