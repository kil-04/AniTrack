package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Anime

@Composable
internal fun AnimeRow(list: List<Anime>, onOpen: (Anime) -> Unit) {
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        items(list.size) { i -> AnimeCard(list[i], onOpen) }
    }
}

/** Poster-row skeleton while a feed loads. */
@Composable
internal fun RowPlaceholder() {
    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        repeat(6) {
            Column {
                SkeletonBox(Modifier.width(POSTER_WIDTH.dp).height((POSTER_WIDTH * POSTER_RATIO).dp))
                Spacer(Modifier.height(8.dp))
                SkeletonBox(Modifier.width((POSTER_WIDTH * 0.8f).dp).height(12.dp), corner = 4.dp)
                Spacer(Modifier.height(6.dp))
                SkeletonBox(Modifier.width((POSTER_WIDTH * 0.5f).dp).height(10.dp), corner = 4.dp)
            }
        }
    }
}
