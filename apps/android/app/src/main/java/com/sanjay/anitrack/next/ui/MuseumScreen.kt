package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.LivingMuseumCurator
import com.sanjay.anitrack.next.data.TimeMachineArchive

@Composable
fun MuseumScreen(
    animeId: Int,
    onOpenAnime: (Anime) -> Unit,
    onBack: () -> Unit,
) {
    var anime by remember(animeId) { mutableStateOf<Anime?>(null) }
    var shelf by remember(animeId) { mutableStateOf<List<Anime>>(emptyList()) }
    var loading by remember(animeId) { mutableStateOf(true) }
    var error by remember(animeId) { mutableStateOf<String?>(null) }

    LaunchedEffect(animeId) {
        loading = true
        error = null
        runCatching { AniList.byId(animeId) ?: throw IllegalStateException("This artifact is missing from the archive.") }
            .onSuccess { loaded ->
                anime = loaded
                loaded.year?.let { year ->
                    shelf = runCatching {
                        AniList.advancedSearch(null, null, year, null, null, null, "SCORE_DESC", 1).first
                            .filter { it.id != loaded.id }.take(12)
                    }.getOrDefault(emptyList())
                }
            }
            .onFailure { error = it.message ?: "The museum archive did not answer." }
        loading = false
    }

    val artifact = anime
    val exhibit = remember(artifact) { artifact?.let(LivingMuseumCurator::build) }
    val era = artifact?.year?.let(TimeMachineArchive::eraFor)
    val accent = Color(era?.accent ?: 0xFFD6C29E)

    if (loading) {
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = accent)
        }
        return
    }
    if (artifact == null || exhibit == null) {
        Box(Modifier.fillMaxSize().background(Color.Black).padding(24.dp), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(error ?: "Artifact not found.", color = Color(0xFFFF8A80))
                TextButton(onClick = onBack) { Text("Return to Time Machine") }
            }
        }
        return
    }

    LazyColumn(Modifier.fillMaxSize().background(Color.Black)) {
        item {
            Box(Modifier.fillMaxWidth().heightIn(min = 480.dp)) {
                (artifact.banner ?: artifact.cover)?.let {
                    AsyncImage(model = it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize(), alpha = 0.36f)
                }
                Box(Modifier.matchParentSize().background(Brush.horizontalGradient(listOf(Color.Black, Color.Black.copy(alpha = 0.88f), Color.Transparent))))
                Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.25f), Color.Transparent, Color.Black))))
                Column(Modifier.align(Alignment.BottomStart).padding(24.dp)) {
                    TextButton(onClick = onBack, contentPadding = PaddingValues(0.dp)) { Text("←  RETURN TO TIME MACHINE", color = Color.White.copy(alpha = 0.58f), letterSpacing = 1.sp) }
                    Spacer(Modifier.height(20.dp))
                    Text("⌂  ${exhibit.eyebrow.uppercase()}", color = accent, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Black, letterSpacing = 2.sp)
                    Text(artifact.title, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Black, modifier = Modifier.widthIn(max = 760.dp))
                    artifact.titleRomaji?.takeIf { it != artifact.title }?.let { Text(it, color = Color.White.copy(alpha = 0.42f), style = MaterialTheme.typography.titleMedium) }
                    Spacer(Modifier.height(12.dp))
                    Text(exhibit.curatorLine, color = Color.White.copy(alpha = 0.68f), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.widthIn(max = 680.dp))
                    Spacer(Modifier.height(20.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Button(onClick = { onOpenAnime(artifact) }, colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black)) { Text("Open full anime record", fontWeight = FontWeight.Bold) }
                        Text("ACCESSION ${exhibit.accession}", color = Color.White.copy(alpha = 0.52f), fontFamily = FontFamily.Monospace, fontSize = 11.sp)
                    }
                }
            }
        }

        item {
            Column(Modifier.padding(horizontal = 24.dp, vertical = 28.dp)) {
                Text("ARTIFACT LABEL", color = accent, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Spacer(Modifier.height(12.dp))
                exhibit.facts.chunked(3).forEach { row ->
                    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { fact ->
                            Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.045f)).padding(14.dp)) {
                                Text(fact.label.uppercase(), color = Color.White.copy(alpha = 0.32f), fontSize = 9.sp, letterSpacing = 1.sp)
                                Text(fact.value, fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleMedium)
                            }
                        }
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }

        item {
            Column(Modifier.padding(horizontal = 24.dp).clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.04f)).padding(20.dp)) {
                Text("CURATOR'S TRANSCRIPT", color = accent, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Text(exhibit.room, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
                Spacer(Modifier.height(10.dp))
                Text(artifact.synopsis ?: "No synopsis is preserved in the current catalogue record.", color = Color.White.copy(alpha = 0.58f), lineHeight = 23.sp)
                if (exhibit.tags.isNotEmpty()) {
                    Spacer(Modifier.height(16.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(exhibit.tags) { tag -> Text(tag, Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.07f)).padding(horizontal = 12.dp, vertical = 7.dp), color = Color.White.copy(alpha = 0.66f), style = MaterialTheme.typography.labelMedium) }
                    }
                }
            }
        }

        if (shelf.isNotEmpty()) item {
            Column(Modifier.padding(top = 30.dp, bottom = 44.dp)) {
                Text("NEARBY IN THE ARCHIVE", modifier = Modifier.padding(horizontal = 24.dp), color = accent, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                Text("The ${artifact.year} shelf", modifier = Modifier.padding(horizontal = 24.dp), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Black)
                Text("Other highly rated works from the same year.", modifier = Modifier.padding(horizontal = 24.dp), color = Color.White.copy(alpha = 0.36f), style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(14.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(shelf, key = { it.id }) { candidate -> AnimeCard(candidate, onOpenAnime, width = 142) }
                }
            }
        }
    }
}
