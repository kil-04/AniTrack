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
import androidx.compose.foundation.shape.CircleShape
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList

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

    Column(Modifier.padding(bottom = 8.dp)) {
        SectionHeader("Related")
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            items(related.size) { i ->
                val r = related[i]
                Column(Modifier.width(128.dp).clip(RoundedCornerShape(12.dp)).clickable { onOpenAnime(r.anime.id) }) {
                    Box {
                        PosterImage(
                            r.anime.cover, r.anime.title,
                            Modifier.fillMaxWidth().aspectRatio(1f / POSTER_RATIO).clip(RoundedCornerShape(12.dp)),
                        )
                        // Relation label (desktop's "Side Story" tag).
                        Tag(
                            relationLabels[r.type] ?: r.type.lowercase().replaceFirstChar { c -> c.uppercase() },
                            Modifier.align(Alignment.BottomStart).padding(8.dp),
                            tone = TagTone.Glass,
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(r.anime.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = AniColors.Text)
                    Text(metaLine(formatLabel(r.anime.format), r.anime.year?.toString()), style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary)
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
    Column(Modifier.padding(bottom = 8.dp)) {
        SectionHeader("Watch Order")
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            items(chain.size) { i ->
                val m = chain[i]
                val isHere = m.id == anime.id
                Column(Modifier.width(128.dp).clip(RoundedCornerShape(12.dp)).clickable(enabled = !isHere) { onOpenAnime(m.id) }) {
                    Box {
                        PosterImage(
                            m.cover, m.title,
                            Modifier.fillMaxWidth().aspectRatio(1f / POSTER_RATIO).clip(RoundedCornerShape(12.dp))
                                .then(if (isHere) Modifier.border(2.dp, AniColors.Accent, RoundedCornerShape(12.dp)) else Modifier),
                        )
                        // Position in the franchise.
                        Box(
                            Modifier.align(Alignment.TopStart).padding(8.dp)
                                .size(26.dp).clip(CircleShape).background(if (isHere) AniColors.Accent else Color.Black.copy(alpha = 0.65f)),
                            contentAlignment = Alignment.Center,
                        ) { Text("${i + 1}", color = Color.White, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
                        if (isHere) {
                            Tag("YOU ARE HERE", Modifier.align(Alignment.BottomStart).padding(8.dp), tone = TagTone.Accent)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Text(m.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = AniColors.Text)
                    Text(metaLine(formatLabel(m.format), m.year?.toString()), style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary)
                }
            }
        }
    }
}
