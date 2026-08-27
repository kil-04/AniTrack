package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.items
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
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList

private val Accent = Color(0xFFE50914)

// ── Related (side stories / specials — non-chain relations, like desktop) ─────

private val relationLabels = mapOf(
    "SIDE_STORY" to "Side Story", "SPIN_OFF" to "Spin Off", "ALTERNATIVE" to "Alternative",
    "SPECIAL" to "Special", "SUMMARY" to "Summary", "PARENT" to "Parent",
    "CHARACTER" to "Character", "OTHER" to "Other",
)

@Composable
internal fun RelatedSection(anime: Anime, onOpenAnime: (Int) -> Unit) {
    var rels by remember(anime.id) { mutableStateOf<List<AniList.Relation>>(emptyList()) }
    LaunchedEffect(anime.id) { runCatching { rels = AniList.relations(anime.id) } }
    val related = rels.filter { it.type != "PREQUEL" && it.type != "SEQUEL" }
    if (related.isEmpty()) return

    Column(Modifier.padding(bottom = 20.dp)) {
        Text("Related", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp))
        Spacer(Modifier.height(10.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(related.size) { i ->
                val r = related[i]
                Column(Modifier.width(120.dp).clickable { onOpenAnime(r.anime.id) }) {
                    Box(
                        Modifier.width(120.dp).height(170.dp).clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.06f)),
                    ) {
                        AsyncImage(model = r.anime.cover, contentDescription = r.anime.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        // Relation label strip (desktop's "Side Story" tag).
                        Box(
                            Modifier.align(Alignment.BottomStart).fillMaxWidth()
                                .background(
                                    androidx.compose.ui.graphics.Brush.verticalGradient(
                                        listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f)),
                                    ),
                                )
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                        ) {
                            Text(
                                relationLabels[r.type] ?: r.type.lowercase().replaceFirstChar { c -> c.uppercase() },
                                style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.85f),
                            )
                        }
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(r.anime.title, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
                }
            }
        }
    }
}

// ── Watch Order (franchise chain: PREQUEL hops back, SEQUEL forward) ──────────

private val watchOrderCache = HashMap<Int, List<Anime>>()

@Composable
internal fun WatchOrderSection(anime: Anime, onOpenAnime: (Int) -> Unit) {
    var chain by remember(anime.id) { mutableStateOf(watchOrderCache[anime.id] ?: emptyList()) }

    LaunchedEffect(anime.id) {
        if (chain.isNotEmpty()) return@LaunchedEffect
        runCatching {
            fun pick(edges: List<AniList.Relation>, type: String): Anime? {
                val cands = edges.filter { it.type == type && it.anime.id > 0 }
                return (cands.firstOrNull { it.anime.format == "TV" } ?: cands.firstOrNull())?.anime
            }
            val before = ArrayDeque<Anime>()
            var cur = anime
            var guard = 0
            while (guard++ < 10) {
                val prev = pick(AniList.relations(cur.id), "PREQUEL") ?: break
                if (before.any { it.id == prev.id } || prev.id == anime.id) break
                before.addFirst(prev); cur = prev
            }
            val after = mutableListOf<Anime>()
            cur = anime; guard = 0
            while (guard++ < 10) {
                val next = pick(AniList.relations(cur.id), "SEQUEL") ?: break
                if (after.any { it.id == next.id } || next.id == anime.id) break
                after.add(next); cur = next
            }
            val full = before.toList() + anime + after
            if (full.size > 1) {
                if (watchOrderCache.size > 200) watchOrderCache.clear()
                full.forEach { watchOrderCache[it.id] = full }
                chain = full
            }
        }
    }

    if (chain.size < 2) return
    Column(Modifier.padding(bottom = 20.dp)) {
        Text("Watch Order", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp))
        Spacer(Modifier.height(10.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(chain.size) { i ->
                val m = chain[i]
                val isHere = m.id == anime.id
                Column(Modifier.width(120.dp).clickable(enabled = !isHere) { onOpenAnime(m.id) }) {
                    Box(
                        Modifier.width(120.dp).height(170.dp).clip(RoundedCornerShape(10.dp))
                            .background(Color.White.copy(alpha = 0.06f))
                            .then(if (isHere) Modifier.border(2.dp, Accent, RoundedCornerShape(10.dp)) else Modifier),
                    ) {
                        AsyncImage(model = m.cover, contentDescription = m.title, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                        // Number badge
                        Box(
                            Modifier.align(Alignment.TopStart).padding(6.dp)
                                .size(24.dp).clip(RoundedCornerShape(50)).background(Accent),
                            contentAlignment = Alignment.Center,
                        ) { Text("${i + 1}", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) }
                        if (isHere) {
                            Box(
                                Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Accent).padding(vertical = 3.dp),
                                contentAlignment = Alignment.Center,
                            ) { Text("YOU ARE HERE", color = Color.White, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, letterSpacing = androidx.compose.ui.unit.TextUnit(1f, androidx.compose.ui.unit.TextUnitType.Sp)) }
                        }
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(m.title, style = MaterialTheme.typography.labelMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.85f))
                    m.year?.let { Text("$it", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f)) }
                }
            }
        }
    }
}
