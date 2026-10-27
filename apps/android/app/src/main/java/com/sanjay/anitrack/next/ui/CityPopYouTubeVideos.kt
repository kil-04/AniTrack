package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sanjay.anitrack.next.data.CityPop
import com.sanjay.anitrack.next.data.CityPopTrack
import kotlinx.coroutines.CancellationException

private data class CityPopVideoQueue(val tracks: List<CityPopTrack>, val start: Int)

private val SUGGESTIONS = listOf("city pop music video", "Miki Matsubara Stay With Me", "Mariya Takeuchi Plastic Love", "Tatsuro Yamashita live")

/**
 * Real YouTube search, separate from the curated Classics, as on desktop: it runs when asked,
 * Watch plays the results from that video on, and a heart saves a video to the favorites.
 */
@Composable
internal fun CityPopYouTubeVideos(header: LazyListScope.() -> Unit, layout: CityPopLayout, query: String, onQueryChange: (String) -> Unit, favorites: CityPopFavorites) {
    var search by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var results by remember { mutableStateOf<List<CityPopTrack>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var playing by remember { mutableStateOf<CityPopVideoQueue?>(null) }
    LaunchedEffect(search, attempt) {
        val wanted = search ?: return@LaunchedEffect
        searching = true
        problem = null
        try { results = CityPop.search(wanted) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem = e.message ?: "Couldn't search YouTube. Check your connection and try again." }
        finally { searching = false }
    }
    fun submit(value: String = query) {
        val wanted = value.trim()
        if (wanted.length !in 2..200) return
        onQueryChange(value)
        search = wanted
        attempt++
    }
    val favoriteVideos = favorites.videos
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = layout.padding, end = layout.padding, top = 16.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        header()
        item(key = "videos-search") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CityPopSearchField(query, onQueryChange, "Search YouTube for any song, artist, or music video", { submit() }, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                CityPopButton(if (searching) "Searching…" else "Search YouTube", { submit() }, icon = Icons.Rounded.Search, enabled = !searching && query.trim().length >= 2, loading = searching)
            }
        }
        item(key = "videos-hint") { Text("Search YouTube's online catalogue by song or artist. Videos play in the visible City Pop player.", color = Color.White.copy(alpha = 0.45f), fontSize = 12.sp, lineHeight = 18.sp) }
        item(key = "videos-suggestions") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Try a search", color = Color.White.copy(alpha = 0.35f), fontSize = 12.sp)
                Spacer(Modifier.width(10.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(SUGGESTIONS) { suggestion ->
                        Text(
                            suggestion, color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp, textDecoration = TextDecoration.Underline,
                            modifier = Modifier.clip(RoundedCornerShape(4.dp)).clickable { submit(suggestion) }.padding(vertical = 8.dp, horizontal = 2.dp),
                        )
                    }
                }
            }
        }
        problem?.let { item(key = "videos-problem") { CityPopProblem(it) { attempt++ } } }
        val found = results
        when {
            searching -> item(key = "videos-searching") { CityPopEmpty(null, "Searching YouTube…", loading = true) }
            !found.isNullOrEmpty() -> {
                item(key = "videos-count") { Text("${found.size} videos for “$search” · YouTube", color = Color.White.copy(alpha = 0.4f), fontSize = 12.sp) }
                cityPopGrid(found, layout.cardColumns, key = { it.videoId }) { track, modifier ->
                    CityPopTrackCard(
                        track, track.videoId in favoriteVideos, { favorites.toggle(track) },
                        onWatch = { playing = CityPopVideoQueue(CityPop.playOrder(found, found.indexOf(track)), 0) },
                        modifier = modifier, watchOnly = true,
                    )
                }
            }
            else -> item(key = "videos-empty") {
                CityPopEmpty(
                    Icons.Rounded.Tv,
                    if (found != null) "No YouTube videos found for “$search”." else "Find the video you have in mind.",
                    if (found != null) "Try another song title, artist, or performance."
                    else "Type a song title or artist and press Search, or choose a search above. Results come from YouTube, beyond the starter collection.",
                )
            }
        }
        item(key = "videos-note") { Text("YouTube videos stream online. Choose Internet Archive for downloadable videos; availability varies by upload.", color = Color.White.copy(alpha = 0.35f), fontSize = 11.sp, lineHeight = 17.sp) }
        item(key = "footer") { CityPopFooter(enabled = true) }
    }
    playing?.let { queue ->
        CityPopPlayerDialog(queue.tracks, queue.start, queue.tracks[queue.start].title, listen = false) { playing = null }
    }
}
