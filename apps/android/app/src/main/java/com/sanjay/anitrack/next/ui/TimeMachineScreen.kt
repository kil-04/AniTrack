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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.TimeMachineArchive
import kotlin.random.Random

@Composable
fun TimeMachineScreen(onOpen: (Anime) -> Unit, onOpenGenome: () -> Unit = {}) {
    var year by remember { mutableIntStateOf(1988) }
    var requestedYear by remember { mutableIntStateOf(1988) }
    var anime by remember { mutableStateOf<List<Anime>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    val era = TimeMachineArchive.eraFor(year)
    val accent = Color(era.accent)

    LaunchedEffect(requestedYear) {
        loading = true
        failed = false
        runCatching {
            AniList.advancedSearch(null, null, requestedYear, null, null, null, "SCORE_DESC", 1).first
        }.onSuccess { anime = it }.onFailure { failed = true }
        loading = false
    }

    val formats = remember(anime) {
        listOf(
            "TV signals" to anime.count { it.format == "TV" || it.format == "TV_SHORT" },
            "Films" to anime.count { it.format == "MOVIE" },
            "OVA artifacts" to anime.count { it.format == "OVA" },
        )
    }
    val genres = remember(anime) {
        anime.flatMap { it.genres }.groupingBy { it }.eachCount().entries
            .sortedByDescending { it.value }.take(5)
    }
    val hero = anime.firstOrNull()

    LazyColumn(Modifier.fillMaxSize().background(Color.Black)) {
        item {
            Box(Modifier.fillMaxWidth().heightIn(min = 330.dp)) {
                hero?.banner?.let {
                    AsyncImage(
                        model = it,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.matchParentSize(),
                        alpha = 0.42f,
                    )
                }
                Box(
                    Modifier.matchParentSize().background(
                        Brush.horizontalGradient(listOf(Color.Black, Color.Black.copy(alpha = 0.82f), Color.Transparent))
                    )
                )
                Box(
                    Modifier.matchParentSize().background(
                        Brush.verticalGradient(listOf(Color.Transparent, Color.Black))
                    )
                )
                Column(Modifier.align(Alignment.BottomStart).padding(24.dp)) {
                    Text(
                        TimeMachineArchive.transmission(year).uppercase(),
                        color = accent,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 2.sp,
                    )
                    Text(year.toString(), fontSize = 82.sp, lineHeight = 82.sp, fontWeight = FontWeight.Black)
                    Text(era.headline, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.height(6.dp))
                    Text(era.atmosphere, color = Color.White.copy(alpha = 0.62f), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.widthIn(max = 620.dp))
                    Spacer(Modifier.height(18.dp))
                    Button(
                        onClick = { anime.take(15).takeIf { it.isNotEmpty() }?.let { onOpen(it[Random.nextInt(it.size)]) } },
                        enabled = anime.isNotEmpty(),
                        colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black),
                    ) { Text("✦  Mystery screening", fontWeight = FontWeight.Bold) }
                    TextButton(onClick = onOpenGenome) { Text("⌁  View Taste Genome", color = Color(0xFFFFB3FF), fontWeight = FontWeight.Bold) }
                }
            }
        }

        item {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Set the dial", fontWeight = FontWeight.Bold)
                        Text("Travel through the AniList archive", color = Color.White.copy(alpha = 0.4f), style = MaterialTheme.typography.labelSmall)
                    }
                    listOf(1970, 1980, 1990).forEach { decade ->
                        val selected = era.start == decade
                        Box(
                            Modifier.padding(start = 6.dp).clip(RoundedCornerShape(50))
                                .background(if (selected) accent else Color.White.copy(alpha = 0.07f))
                                .clickable { year = decade + 5; requestedYear = year }
                                .padding(horizontal = 13.dp, vertical = 8.dp)
                        ) { Text("${decade}s", color = if (selected) Color.Black else Color.White.copy(alpha = 0.65f), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
                    }
                }
                Slider(
                    value = year.toFloat(),
                    onValueChange = { year = it.toInt() },
                    onValueChangeFinished = { requestedYear = year },
                    valueRange = 1960f..java.time.Year.now().value.coerceAtMost(2029).toFloat(),
                    steps = java.time.Year.now().value.coerceAtMost(2029) - 1961,
                    colors = SliderDefaults.colors(thumbColor = accent, activeTrackColor = accent),
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TimeMachineArchive.eras.forEach { Text(it.start.toString(), fontSize = 9.sp, color = Color.White.copy(alpha = 0.25f)) }
                }
            }
        }

        item {
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                formats.forEach { (label, count) ->
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.045f)).padding(14.dp)) {
                        Text(count.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Black)
                        Text(label.uppercase(), fontSize = 9.sp, letterSpacing = 1.sp, color = Color.White.copy(alpha = 0.38f))
                    }
                }
            }
        }

        if (genres.isNotEmpty()) item {
            Column(Modifier.padding(top = 24.dp)) {
                Text("GENRE SIGNAL", modifier = Modifier.padding(horizontal = 24.dp), color = accent, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Spacer(Modifier.height(10.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(genres.toList()) { genre ->
                        Text("${genre.key} · ${genre.value}", Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.07f)).padding(horizontal = 13.dp, vertical = 8.dp), color = Color.White.copy(alpha = 0.65f), style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }

        item {
            Column(Modifier.padding(top = 28.dp, bottom = 40.dp)) {
                Text("RECOVERED FROM $requestedYear", modifier = Modifier.padding(horizontal = 24.dp), color = accent, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Text("The essential transmission", modifier = Modifier.padding(horizontal = 24.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
                Spacer(Modifier.height(14.dp))
                when {
                    loading -> LinearProgressIndicator(Modifier.fillMaxWidth().padding(horizontal = 24.dp), color = accent)
                    failed -> Text("The archive did not answer. Move the dial and try again.", modifier = Modifier.padding(horizontal = 24.dp), color = Color(0xFFFF8A80))
                    else -> LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        items(anime.take(24), key = { it.id }) { item -> AnimeCard(item, onOpen, width = 142) }
                    }
                }
            }
        }
    }
}
