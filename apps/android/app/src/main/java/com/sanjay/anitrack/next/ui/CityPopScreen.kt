package com.sanjay.anitrack.next.ui

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sanjay.anitrack.next.data.CityPop
import com.sanjay.anitrack.next.data.CityPopTrack
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private data class CityPopQueue(val tracks: List<CityPopTrack>, val label: String, val listen: Boolean)

internal const val CITY_POP_CLASSICS_NOTE = "YouTube Classics opens a visible player for listening or watching. These tracks stream online; downloads are available in the Internet Archive collection."

/**
 * The pack's favorites, kept in prefs as on desktop: the curated catalog, saved search results,
 * and the favorite ids. Shared by YouTube Classics and the Videos search.
 */
@Stable
internal class CityPopFavorites(private val prefs: SharedPreferences) {
    var catalog by mutableStateOf<List<CityPopTrack>>(emptyList()); private set
    var saved by mutableStateOf<List<CityPopTrack>>(emptyList()); private set
    var ids by mutableStateOf<Set<String>>(emptySet()); private set
    var problem by mutableStateOf<String?>(null); private set
    var loading by mutableStateOf(true); private set

    suspend fun load(context: Context) {
        loading = true
        problem = null
        try {
            val tracks = withContext(Dispatchers.IO) { CityPop.load(context) }
            // A saved result for a curated video is that curated track (its favorite moves to the catalog id).
            val kept = CityPop.parseSavedTracks(prefs.getString(CityPop.SAVED_TRACKS_PREF, null)).filter { CityPop.canonical(it, tracks) === it }
            catalog = tracks
            saved = kept
            ids = CityPop.parseFavorites(prefs.getString(CityPop.FAVORITES_PREF, null), tracks + kept)
        } catch (e: CancellationException) { throw e } catch (_: Exception) {
            problem = "The City Pop collection couldn't be loaded. Disable and enable the pack to try again."
        } finally { loading = false }
    }

    /** Hearts match by video: a search result for a curated song shows that song's favorite. */
    val videos: Set<String> get() = (catalog + saved).filter { it.id in ids }.mapTo(HashSet()) { it.videoId }

    /** A search result for a curated song is favorited as the curated track, so it is saved once. */
    fun toggle(result: CityPopTrack) {
        val target = CityPop.canonical(result, catalog)
        val removing = target.id in ids
        val kept = if (!target.id.startsWith("youtube-")) saved
            else saved.filterNot { it.id == target.id }.let { if (removing) it else (it + target).takeLast(100) }
        val all = catalog + kept
        val next = (if (removing) ids - target.id else ids + target.id).filterTo(LinkedHashSet()) { id -> all.any { it.id == id } }
        saved = kept
        ids = next
        prefs.edit().putString(CityPop.FAVORITES_PREF, CityPop.serializeFavorites(next, all))
            .putString(CityPop.SAVED_TRACKS_PREF, CityPop.serializeSavedTracks(kept)).apply()
    }
}

/** "Find your frequency": the three stations, as on desktop. */
internal fun LazyListScope.cityPopStations(
    layout: CityPopLayout, catalog: List<CityPopTrack>, enabled: Boolean, mood: String,
    onBrowse: (String) -> Unit, onPlay: (String, List<CityPopTrack>) -> Unit,
) {
    item(key = "stations-title") {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PixelText("Find your frequency", Color.White, 16.sp, Modifier.weight(1f), maxLines = 1, shadow = Color(0xFF3D0A63))
            // A phone has no room for both on one line.
            if (!layout.narrow) Text("Three ways to drift away", color = Color.White.copy(alpha = 0.4f), fontSize = 12.sp)
        }
    }
    item(key = "stations") {
        @Composable fun card(index: Int, modifier: Modifier) {
            val station = CityPop.stations[index]
            val queue = catalog.filter { station.id in it.moods }
            CityPopStationCard(station, index + 1, queue.size, enabled, enabled && mood == station.id, { onBrowse(station.id) }, { onPlay(station.title, queue) }, modifier)
        }
        // A phone swipes through them; a wider screen has room for all three.
        if (layout.narrow) LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            items(CityPop.stations.size) { card(it, Modifier.width(270.dp)) }
        } else Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.height(IntrinsicSize.Max)) {
            CityPop.stations.indices.forEach { card(it, Modifier.weight(1f).fillMaxHeight()) }
        }
    }
}

/** YouTube Classics, as on desktop: stations, the starting collection, YouTube search and favorites. */
@Composable
internal fun CityPopClassics(header: LazyListScope.() -> Unit, layout: CityPopLayout, favorites: CityPopFavorites) {
    var mood by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    var onlyFavorites by rememberSaveable { mutableStateOf(false) }
    var search by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var results by remember { mutableStateOf<List<CityPopTrack>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var queue by remember { mutableStateOf<CityPopQueue?>(null) }
    LaunchedEffect(search, attempt) {
        val wanted = search ?: return@LaunchedEffect
        searching = true
        problem = null
        try { results = CityPop.search(wanted) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem = e.message ?: "Couldn't search YouTube. Check your connection and try again." }
        finally { searching = false }
    }
    fun browseCollection() { search = null; results = null; searching = false; problem = null; query = ""; mood = "all"; onlyFavorites = false }
    fun searchOnline() {
        val wanted = query.trim()
        if (wanted.length !in 2..200) return
        mood = "all"; onlyFavorites = false; results = null; search = wanted; attempt++
    }
    // From the chosen track round to the one before it, each once (as on desktop).
    fun play(list: List<CityPopTrack>, label: String, listen: Boolean, start: Int = 0) {
        val ordered = CityPop.playOrder(list, start)
        if (ordered.isNotEmpty()) queue = CityPopQueue(ordered, label, listen)
    }
    val station = CityPop.stations.firstOrNull { it.id == mood }
    val shown = remember(favorites.catalog, favorites.saved, favorites.ids, results, query, mood, onlyFavorites) {
        val base = if (onlyFavorites) (favorites.catalog + favorites.saved).distinctBy { it.videoId } else results ?: favorites.catalog
        CityPop.filter(base, if (results != null && !onlyFavorites) "" else query, mood, favorites.ids.takeIf { onlyFavorites })
    }
    val favoriteVideos = favorites.videos
    val selectionLabel = if (onlyFavorites) "Your favorites" else station?.title ?: "The selection"
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = layout.padding, end = layout.padding, top = 16.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        header()
        item(key = "classics-note") { CityPopNote(Icons.Rounded.Tv, CITY_POP_CLASSICS_NOTE) }
        cityPopStations(layout, favorites.catalog, enabled = true, mood = mood,
            onBrowse = { id -> browseCollection(); mood = id },
            onPlay = { title, tracks -> play(tracks, title, listen = true) })
        item(key = "collection-title") {
            FlowRow(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                CityPopSectionTitle(
                    if (onlyFavorites) "Your favorites" else if (results != null) "YouTube search" else station?.title ?: "The collection",
                    if (results != null && !onlyFavorites) "Results for “$search” · availability is set by YouTube." else "A starting collection, plus online search for any song or artist.",
                )
                CityPopButton("Play selection", { play(shown, selectionLabel, listen = true) }, icon = Icons.Rounded.PlayArrow, enabled = shown.isNotEmpty())
            }
        }
        item(key = "collection-search") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CityPopSearchField(query, { query = it; search = null; results = null; searching = false; problem = null }, "Search any song or artist", ::searchOnline, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                CityPopButton(if (searching) "Searching…" else "Search YouTube", ::searchOnline, icon = Icons.Rounded.Search, enabled = !searching && query.trim().length >= 2, loading = searching)
            }
        }
        item(key = "collection-filters") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CityPopFilter("Collection", mood == "all" && !onlyFavorites && results == null, ::browseCollection)
                CityPopFilter("Favorites", onlyFavorites, { search = null; searching = false; onlyFavorites = !onlyFavorites; mood = "all"; query = "" },
                    icon = if (onlyFavorites) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder, count = favorites.ids.size)
                if (station != null) CityPopFilter(station.title, true, { mood = "all" }, trailingIcon = Icons.Rounded.Close)
            }
        }
        item(key = "collection-artists") {
            val artists = remember(favorites.catalog) { favorites.catalog.map { it.artist }.distinct() }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Try an artist", color = Color.White.copy(alpha = 0.35f), fontSize = 12.sp)
                Spacer(Modifier.width(10.dp))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(artists) { artist ->
                        Text(
                            artist, color = if (query == artist) CityPopColors.PinkLight else Color.White.copy(alpha = 0.6f), fontSize = 13.sp, textDecoration = TextDecoration.Underline,
                            modifier = Modifier.clip(RoundedCornerShape(4.dp)).clickable { browseCollection(); query = artist }.padding(vertical = 8.dp, horizontal = 2.dp),
                        )
                    }
                }
            }
        }
        favorites.problem?.let { item(key = "collection-problem") { CityPopProblem(it) } }
        problem?.let { item(key = "search-problem") { CityPopProblem(it) { attempt++ } } }
        when {
            favorites.loading -> item(key = "collection-loading") { CityPopEmpty(null, "Loading the collection…", loading = true) }
            searching -> item(key = "collection-searching") { CityPopEmpty(null, "Searching YouTube…", loading = true) }
            shown.isEmpty() -> item(key = "collection-empty") {
                val firstFavorite = onlyFavorites && favorites.ids.isEmpty()
                CityPopEmpty(
                    Icons.Rounded.FavoriteBorder,
                    if (firstFavorite) "Keep a little collection of your own." else "No tracks match this selection.",
                    if (firstFavorite) "Tap a heart on any track to save it here." else if (results != null) "Try a different song or artist in Search YouTube." else "Search YouTube to go beyond the starting collection.",
                ) { CityPopButton("Browse the collection", ::browseCollection, style = CityPopButtonStyle.Quiet) }
            }
            else -> {
                item(key = "collection-count") { Text("${shown.size} ${if (shown.size == 1) "track" else "tracks"}", color = Color.White.copy(alpha = 0.4f), fontSize = 12.sp) }
                cityPopGrid(shown, layout.cardColumns, key = { it.id }) { track, modifier ->
                    val index = shown.indexOf(track)
                    CityPopTrackCard(
                        track, track.videoId in favoriteVideos, { favorites.toggle(track) },
                        onWatch = { play(shown, track.title, listen = false, start = index) },
                        onListen = { play(shown, track.title, listen = true, start = index) },
                        modifier = modifier,
                    )
                }
            }
        }
        item(key = "footer") { CityPopFooter(enabled = true) }
    }
    queue?.let { playing -> CityPopPlayerDialog(playing.tracks, 0, playing.label, playing.listen, onClose = { queue = null }) }
}

/** The pack switched off: the banner with Enable, and what the stations hold. */
@Composable
internal fun CityPopOffPage(header: LazyListScope.() -> Unit, layout: CityPopLayout) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = layout.padding, end = layout.padding, top = 16.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        header()
        item(key = "classics-note") { CityPopNote(Icons.Rounded.Tv, CITY_POP_CLASSICS_NOTE) }
        cityPopStations(layout, emptyList(), enabled = false, mood = "all", onBrowse = {}, onPlay = { _, _ -> })
        item(key = "footer") { CityPopFooter(enabled = false) }
    }
}
