package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.NewReleases
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AniList

// ── Latest Episodes (full page) ───────────────────────────────────────────────

@Composable
fun LatestScreen(onOpen: (Anime) -> Unit) {
    var list by remember { mutableStateOf<List<AniList.Airing>>(emptyList()) }
    var page by remember { mutableIntStateOf(1) }
    var hasNext by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(page) {
        loading = true
        runCatching {
            val (l, hn) = AniList.recentEpisodes(page)
            list = l; hasNext = hn
        }
        loading = false
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 20.dp)) {
        ScreenHeader("Latest Episodes", subtitle = "Recently aired episodes across AniList.", icon = Icons.Rounded.NewReleases)
        Spacer(Modifier.height(18.dp))
        LazyVerticalGrid(
            columns = GridCells.Adaptive(220.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
            modifier = Modifier.weight(1f),
        ) {
            if (loading && list.isEmpty()) {
                items(12) { SkeletonBox(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) }
            }
            items(list.size) { i ->
                val a = list[i]
                LatestCard(a.anime, a.episode, onOpen, Modifier.fillMaxWidth())
            }
            if (list.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                PageControls(page, hasNext, onPrevious = { if (page > 1) page-- }, onNext = { if (hasNext) page++ })
            }
        }
    }
}
