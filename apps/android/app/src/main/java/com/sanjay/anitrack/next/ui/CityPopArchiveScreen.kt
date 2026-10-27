package com.sanjay.anitrack.next.ui

import android.app.DownloadManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.PowerSettingsNew
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Tv
import androidx.compose.material.icons.rounded.WbTwilight
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.CityPop
import com.sanjay.anitrack.next.data.CityPopArchive
import com.sanjay.anitrack.next.data.CityPopArchiveDownload
import com.sanjay.anitrack.next.data.CityPopArchiveItem
import com.sanjay.anitrack.next.data.CityPopArchiveMediaFilter
import com.sanjay.anitrack.next.data.CityPopArchiveSearch
import com.sanjay.anitrack.next.data.CityPopArchiveTrack
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** What the Archive player plays: an album's files from [index], each from its saved copy when there is one. */
private data class ArchivePlaying(val tracks: List<CityPopArchiveTrack>, val uris: List<String>, val index: Int, val cover: String?)

private fun archiveCover(itemId: String) = "https://archive.org/services/img/${android.net.Uri.encode(itemId)}"
private const val ARCHIVE_NOTE = "Internet Archive is a community archive. Availability, descriptions, and file quality vary by upload."

/** City Pop: an optional music pack opened from Songs, laid out as on desktop. */
@Composable
fun CityPopScreen() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE) }
    var enabled by remember { mutableStateOf(prefs.getBoolean(CityPop.ENABLED_PREF, false)) }
    var pack by rememberSaveable { mutableStateOf("archive") }
    var section by rememberSaveable { mutableStateOf("browse") }
    var videoSource by rememberSaveable { mutableStateOf("youtube") }
    var archiveQuery by rememberSaveable { mutableStateOf("") }
    var videoQuery by rememberSaveable { mutableStateOf("") }
    val favorites = remember { CityPopFavorites(prefs) }
    LaunchedEffect(enabled) { if (enabled && favorites.catalog.isEmpty()) favorites.load(context) }
    // Downloads for the tab's count and an album's "Saved offline" marks, kept fresh while the pack is open.
    var downloads by remember { mutableStateOf<List<CityPopArchiveDownload>>(emptyList()) }
    var downloadsTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(enabled, downloadsTick) {
        while (enabled) {
            downloads = withContext(Dispatchers.IO) { runCatching { CityPopArchive.downloads(context) }.getOrDefault(emptyList()) }
            delay(2000)
        }
    }
    fun setEnabled(on: Boolean) { enabled = on; prefs.edit().putBoolean(CityPop.ENABLED_PREF, on).apply() }
    BoxWithConstraints(Modifier.fillMaxSize().background(AniColors.Bg)) {
        val layout = cityPopLayout(maxWidth)
        val header: LazyListScope.() -> Unit = {
            item(key = "city-pop-header") {
                // Wide screens float the music pill at the header's right, so Disable pack moves
                // to the end of the pack tabs there.
                ScreenHeader("City Pop", subtitle = "Songs · Optional music pack", icon = Icons.Rounded.WbTwilight, pixelBanner = false) {
                    if (enabled && layout.narrow) CityPopButton("Disable pack", { setEnabled(false) }, icon = Icons.Rounded.PowerSettingsNew, style = CityPopButtonStyle.Quiet)
                }
            }
            item(key = "city-pop-hero") { CityPopHero(enabled, layout.narrow) { setEnabled(true) } }
            if (enabled) item(key = "city-pop-tabs") {
                CityPopPackTabs(pack, { pack = it }) {
                    if (!layout.narrow) CityPopButton("Disable pack", { setEnabled(false) }, icon = Icons.Rounded.PowerSettingsNew, style = CityPopButtonStyle.Quiet)
                }
            }
        }
        val refreshDownloads: () -> Unit = { downloadsTick++ }
        when {
            !enabled -> CityPopOffPage(header, layout)
            pack == "classics" -> CityPopClassics(header, layout, favorites)
            else -> {
                val music: LazyListScope.() -> Unit = {
                    header()
                    item(key = "music-header") { CityPopMusicHeader(section, downloads.size) { section = it } }
                    if (section == "videos") item(key = "music-source") { CityPopVideoSource(videoSource) { videoSource = it } }
                }
                when {
                    section == "downloads" -> CityPopDownloads(music, layout, downloads, refreshDownloads) { section = "browse" }
                    section == "videos" && videoSource == "youtube" -> CityPopYouTubeVideos(music, layout, videoQuery, { videoQuery = it }, favorites)
                    else -> CityPopArchiveBrowser(music, layout, videosOnly = section == "videos", archiveQuery, { archiveQuery = it }, downloads, refreshDownloads)
                }
            }
        }
    }
}

/** "The City Pop archive" (or videos) with Browse · Videos · Downloads. */
@Composable
private fun CityPopMusicHeader(section: String, downloads: Int, onSelect: (String) -> Unit) {
    FlowRow(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        CityPopSectionTitle(
            if (section == "videos") "City Pop videos" else "The City Pop archive",
            if (section == "videos") "Find song videos, live performances, and music videos on YouTube or Internet Archive."
            else "Explore audio and video from Internet Archive. Open an album to choose a track, or save files for offline listening and viewing.",
            Modifier.widthIn(max = 640.dp),
        )
        CityPopSubTabs(
            listOf(Triple("browse", "Browse", Icons.Rounded.LibraryMusic), Triple("videos", "Videos", Icons.Rounded.Tv), Triple("downloads", "Downloads", Icons.Rounded.Download)),
            section, onSelect, counts = mapOf("downloads" to downloads),
        )
    }
}

/** Where Videos come from: YouTube (streaming) or Internet Archive (watch and download). */
@Composable
private fun CityPopVideoSource(source: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Video source", color = Color.White.copy(alpha = 0.53f), fontSize = 12.sp)
            Spacer(Modifier.width(10.dp))
            Box {
                Row(
                    Modifier.height(40.dp).pixelPanel(CityPopColors.Ink, CityPopColors.Pink, CityPopColors.PinkShadow, 3.dp)
                        .clickable { open = true }.padding(start = 12.dp, end = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PixelText(if (source == "youtube") "YouTube" else "Internet Archive", CityPopColors.PinkLight, 11.sp, maxLines = 1)
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Rounded.ExpandMore, "Choose the video source", tint = CityPopColors.Pink, modifier = Modifier.size(20.dp))
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    DropdownMenuItem(text = { Text("YouTube") }, onClick = { open = false; onChange("youtube") })
                    DropdownMenuItem(text = { Text("Internet Archive") }, onClick = { open = false; onChange("archive") })
                }
            }
        }
        Text(
            if (source == "youtube") "Song videos, performances, and music videos · Streaming only" else "Community video archive · Watch and download",
            color = Color.White.copy(alpha = 0.4f), fontSize = 11.sp,
        )
    }
}

/** Internet Archive search: albums (or video collections) in a grid, opened in a sheet of their files. */
@Composable
private fun CityPopArchiveBrowser(
    header: LazyListScope.() -> Unit, layout: CityPopLayout, videosOnly: Boolean, query: String, onQueryChange: (String) -> Unit,
    downloads: List<CityPopArchiveDownload>, refreshDownloads: () -> Unit,
) {
    val filter = if (videosOnly) CityPopArchiveMediaFilter.VIDEO else CityPopArchiveMediaFilter.ALL
    var submitted by rememberSaveable(videosOnly) { mutableStateOf(query.trim().take(200)) }
    var page by rememberSaveable(videosOnly) { mutableIntStateOf(1) }
    var result by remember(videosOnly) { mutableStateOf<CityPopArchiveSearch?>(null) }
    var searching by remember(videosOnly) { mutableStateOf(false) }
    var problem by remember(videosOnly) { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var selected by remember(videosOnly) { mutableStateOf<CityPopArchiveItem?>(null) }
    var playing by remember { mutableStateOf<ArchivePlaying?>(null) }
    LaunchedEffect(submitted, page, attempt, filter) {
        searching = true
        problem = null
        result = null
        try { result = CityPopArchive.search(submitted, page, filter) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem = e.message ?: "Couldn't reach Internet Archive. Check your connection and try again." }
        finally { searching = false }
    }
    fun search(value: String = query) { page = 1; submitted = value.trim().take(200); attempt++ }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = layout.padding, end = layout.padding, top = 16.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        header()
        item(key = "archive-search") {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CityPopSearchField(query, onQueryChange, if (videosOnly) "City pop, an artist, or a performance" else "City pop, an artist, or an album", { search() }, Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    CityPopButton(if (searching) "Searching…" else "Search Archive", { search() }, icon = Icons.Rounded.Search, enabled = !searching, loading = searching)
                }
                if (submitted.isNotEmpty()) CityPopButton(if (videosOnly) "Browse city pop videos" else "Browse city pop", { onQueryChange(""); search("") }, style = CityPopButtonStyle.Quiet)
            }
        }
        problem?.let { item(key = "archive-problem") { CityPopProblem(it) { attempt++ } } }
        val found = result
        when {
            searching || (found == null && problem == null) -> item(key = "archive-loading") { CityPopEmpty(null, "Tuning into the archive…", loading = true) }
            found == null -> item(key = "archive-failed") { CityPopEmpty(Icons.Rounded.Search, "The archive couldn't load right now.") { CityPopButton("Try again", { attempt++ }, icon = Icons.Rounded.Refresh, style = CityPopButtonStyle.Quiet) } }
            found.items.isEmpty() -> item(key = "archive-empty") {
                CityPopEmpty(Icons.Rounded.Search, if (videosOnly) "No videos found. Try an artist or a different performance." else "No archive items found. Try an artist or a different album.") {
                    CityPopButton("Try again", { attempt++ }, icon = Icons.Rounded.Refresh, style = CityPopButtonStyle.Quiet)
                }
            }
            else -> {
                item(key = "archive-count") {
                    Row {
                        Text("${String.format(java.util.Locale.US, "%,d", found.total)} ${if (videosOnly) "archive videos" else "archive items"}${if (submitted.isEmpty()) " for city pop" else ""}",
                            color = Color.White.copy(alpha = 0.4f), fontSize = 12.sp, modifier = Modifier.weight(1f))
                        Text("Page ${found.page}", color = Color.White.copy(alpha = 0.4f), fontSize = 12.sp)
                    }
                }
                cityPopGrid(found.items, if (videosOnly) (layout.albumColumns - 1).coerceIn(2, 4) else layout.albumColumns, key = { it.id }) { item, modifier ->
                    CityPopAlbumCard(item, videosOnly, { selected = item }, modifier)
                }
                item(key = "archive-pages") {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
                        CityPopButton("Previous", { page-- }, icon = Icons.AutoMirrored.Rounded.KeyboardArrowLeft, enabled = page > 1)
                        Text("Page $page", color = Color.White.copy(alpha = 0.45f), fontSize = 12.sp)
                        CityPopButton("Next", { page++ }, icon = Icons.AutoMirrored.Rounded.KeyboardArrowRight, enabled = page < 1000 && page * 24 < found.total)
                    }
                }
            }
        }
        item(key = "archive-note") { Text(ARCHIVE_NOTE, color = Color.White.copy(alpha = 0.35f), fontSize = 11.sp, lineHeight = 17.sp) }
        item(key = "footer") { CityPopFooter(enabled = true) }
    }
    selected?.let { item ->
        CityPopAlbumSheet(item, videosOnly, layout, downloads, refreshDownloads, onClose = { selected = null }) { tracks, uris, index ->
            playing = ArchivePlaying(tracks, uris, index, item.coverUrl)
        }
    }
    playing?.let { session -> CityPopArchivePlayer(session.tracks, session.uris, session.index, session.cover) { playing = null } }
}

/** A download's place in DownloadManager, read the way the rows show it. */
private val CityPopArchiveDownload.saved get() = status == DownloadManager.STATUS_SUCCESSFUL && localUri != null
private val CityPopArchiveDownload.active get() = status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PAUSED

/** An album's files: Play album (or Watch videos), Download all, and each file's Listen / Watch / Download. */
@Composable
private fun CityPopAlbumSheet(
    item: CityPopArchiveItem, videosOnly: Boolean, layout: CityPopLayout, downloads: List<CityPopArchiveDownload>, refreshDownloads: () -> Unit,
    onClose: () -> Unit, onPlay: (List<CityPopArchiveTrack>, List<String>, Int) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var tracks by remember(item) { mutableStateOf<List<CityPopArchiveTrack>?>(null) }
    var problem by remember(item) { mutableStateOf<String?>(null) }
    var notice by remember(item) { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(item, attempt) {
        tracks = null
        problem = null
        try { tracks = CityPopArchive.tracks(item).let { all -> if (videosOnly) all.filter { it.mediaType == "video" } else all } }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { problem = e.message ?: "Couldn't load this item's playable files. Please try again." }
    }
    val byFile = downloads.associateBy { it.track.itemId to it.track.fileName }
    fun enqueue(list: List<CityPopArchiveTrack>) {
        scope.launch {
            try {
                // A failed download is cleared first, so Retry and Download all start it again.
                val count = withContext(Dispatchers.IO) {
                    list.count { track ->
                        byFile[track.itemId to track.fileName]?.takeIf { it.status == DownloadManager.STATUS_FAILED }?.let { CityPopArchive.remove(context, it.downloadId) }
                        CityPopArchive.enqueue(context, track)
                    }
                }
                notice = if (count == 0) "Already in your download queue." else "$count ${if (count == 1) "track" else "tracks"} added to downloads."
                refreshDownloads()
            } catch (e: CancellationException) { throw e } catch (e: Exception) { problem = e.message ?: "Couldn't add this download." }
        }
    }
    // As on desktop: the album from the chosen file on, saved files played offline.
    fun play(ready: List<CityPopArchiveTrack>, index: Int) =
        onPlay(ready, ready.map { track -> byFile[track.itemId to track.fileName]?.takeIf { it.saved }?.localUri?.toString() ?: track.url }, index)
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.widthIn(max = 850.dp).fillMaxWidth(0.94f).fillMaxHeight(0.9f).pixelPanel(CityPopColors.Panel, CityPopColors.Pink, Color(0xFF3D0A2C), 6.dp)
                .padding(if (layout.narrow) 16.dp else 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AsyncImage(item.coverUrl, null, Modifier.size(if (layout.narrow) 64.dp else 80.dp).pixelPanel(CityPopColors.Night, CityPopColors.Line, depth = 3.dp).padding(2.dp), contentScale = ContentScale.Crop)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    PixelText("${if (item.mediaType == "video") "Video collection" else "Audio collection"}${item.year?.let { " · $it" }.orEmpty()}",
                        CityPopColors.Teal, 9.sp, Modifier.padding(bottom = 4.dp), maxLines = 1)
                    Text(item.title, color = Color.White, fontSize = if (layout.narrow) 18.sp else 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(item.creator.ifBlank { "Internet Archive" }, color = Color.White.copy(alpha = 0.45f), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Close album", tint = Color.White) }
            }
            val ready = tracks
            when {
                problem != null && ready == null -> CityPopProblem(problem!!) { attempt++ }
                ready == null -> CityPopEmpty(null, if (videosOnly) "Finding playable videos…" else "Finding playable files…", loading = true)
                ready.isEmpty() -> CityPopEmpty(
                    if (videosOnly) Icons.Rounded.Tv else Icons.Rounded.MusicNote,
                    if (videosOnly) "No supported video files are available for this item." else "No supported audio or video files are available for this item.",
                ) { CityPopButton("Try again", { attempt++ }, icon = Icons.Rounded.Refresh, style = CityPopButtonStyle.Quiet) }
                else -> {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        CityPopButton(if (videosOnly) "Watch videos" else "Play album", { play(ready, 0) }, icon = if (videosOnly) Icons.Rounded.Tv else Icons.Rounded.PlayArrow, style = CityPopButtonStyle.Primary)
                        CityPopButton("Download all", { enqueue(ready.filter { byFile[it.itemId to it.fileName].let { d -> d == null || d.status == DownloadManager.STATUS_FAILED } }) },
                            icon = Icons.Rounded.Download, style = CityPopButtonStyle.Teal)
                    }
                    notice?.let { CityPopNotice(it) }
                    problem?.let { CityPopProblem(it) }
                    LazyColumn(Modifier.weight(1f)) {
                        itemsIndexed(ready, key = { _, track -> track.fileName }) { index, track ->
                            if (index > 0) HorizontalDivider(color = Color.White.copy(alpha = 0.06f))
                            CityPopFileRow(index, track, item, videosOnly, layout.narrow, byFile[track.itemId to track.fileName],
                                onListen = { play(ready, index) }, onDownload = { enqueue(listOf(track)) })
                        }
                    }
                }
            }
        }
    }
}

/** One file of an album; on a phone its buttons go under the title. */
@Composable
private fun CityPopFileRow(
    index: Int, track: CityPopArchiveTrack, item: CityPopArchiveItem, videosOnly: Boolean, narrow: Boolean, download: CityPopArchiveDownload?,
    onListen: () -> Unit, onDownload: () -> Unit,
) {
    val status = when {
        download == null -> null
        download.saved -> "Saved offline"
        download.status == DownloadManager.STATUS_FAILED -> null
        download.status == DownloadManager.STATUS_RUNNING -> "Downloading"
        else -> "Queued"
    }
    val meta = listOfNotNull(track.artist.ifBlank { item.creator.ifBlank { "Internet Archive" } }, cityPopSize(track.size).ifEmpty { null }, status).joinToString(" · ")
    val actions = @Composable {
        if (!videosOnly) CityPopFileAction("Listen", Icons.Rounded.Headphones, onListen)
        if (track.mediaType == "video") CityPopFileAction("Watch", Icons.Rounded.Tv, onListen)
        when {
            download?.saved == true -> Row(Modifier.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.WifiOff, null, tint = CityPopColors.Teal.copy(alpha = 0.55f), modifier = Modifier.size(13.dp))
                Spacer(Modifier.width(5.dp))
                Text("Offline", color = CityPopColors.Teal.copy(alpha = 0.55f), fontSize = 11.sp)
            }
            download != null && download.active -> CityPopFileAction("Saving…", Icons.Rounded.Download, {}, teal = true, enabled = false)
            else -> CityPopFileAction(if (download?.status == DownloadManager.STATUS_FAILED) "Retry" else "Download", Icons.Rounded.Download, onDownload, teal = true)
        }
    }
    val title = @Composable { modifier: Modifier ->
        Row(modifier, verticalAlignment = Alignment.CenterVertically) {
            Text("${index + 1}", color = Color.White.copy(alpha = 0.3f), fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.width(26.dp))
            Column(Modifier.padding(start = 6.dp)) {
                Text(track.title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(meta, color = Color.White.copy(alpha = 0.4f), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
            }
        }
    }
    if (narrow) Column(Modifier.padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        title(Modifier.fillMaxWidth())
        Row(Modifier.padding(start = 32.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { actions() }
    } else Row(Modifier.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        title(Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { actions() }
    }
}

@Composable
private fun CityPopFileAction(text: String, icon: ImageVector, onClick: () -> Unit, teal: Boolean = false, enabled: Boolean = true) {
    val tint = if (teal) CityPopColors.Teal else CityPopColors.Lilac
    Row(
        Modifier.height(36.dp).alpha(if (enabled) 1f else 0.5f)
            .pixelPanel(CityPopColors.Ink, if (teal) CityPopColors.CyanShadow else CityPopColors.Line, depth = 3.dp)
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(15.dp))
        Spacer(Modifier.width(6.dp))
        PixelText(text, tint, 10.sp, maxLines = 1)
    }
}

/** Saved files: play offline, retry, cancel or remove, as on desktop. */
@Composable
private fun CityPopDownloads(
    header: LazyListScope.() -> Unit, layout: CityPopLayout, downloads: List<CityPopArchiveDownload>, refreshDownloads: () -> Unit, onBrowse: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var playing by remember { mutableStateOf<ArchivePlaying?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    fun act(task: suspend () -> Unit) {
        scope.launch {
            problem = null
            try { task() } catch (e: CancellationException) { throw e } catch (e: Exception) { problem = e.message ?: "That action couldn't finish. Please try again." }
            refreshDownloads()
        }
    }
    val completed = downloads.count { it.saved }
    val active = downloads.count { it.active }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = layout.padding, end = layout.padding, top = 16.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        header()
        item(key = "downloads-summary") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("$completed saved offline${if (active > 0) " · $active in queue" else ""}. Downloads stay on this device.", color = Color.White.copy(alpha = 0.45f), fontSize = 12.sp, modifier = Modifier.weight(1f))
                CityPopButton("Refresh", refreshDownloads, icon = Icons.Rounded.Refresh, style = CityPopButtonStyle.Quiet)
            }
        }
        problem?.let { item(key = "downloads-problem") { CityPopProblem(it) } }
        if (downloads.isEmpty()) item(key = "downloads-empty") {
            CityPopEmpty(Icons.Rounded.Download, "Your offline collection starts here.", "Open an archive album or video collection and download a file. Completed downloads play without an internet connection.") {
                CityPopButton("Explore the archive", onBrowse)
            }
        } else items(downloads, key = { it.downloadId }) { download ->
            CityPopDownloadRow(
                download, layout.narrow,
                onPlay = { download.localUri?.let { playing = ArchivePlaying(listOf(download.track), listOf(it.toString()), 0, archiveCover(download.track.itemId)) } },
                onRemove = { act { withContext(Dispatchers.IO) { CityPopArchive.remove(context, download.downloadId) } } },
                onRetry = { act { withContext(Dispatchers.IO) { CityPopArchive.remove(context, download.downloadId); CityPopArchive.enqueue(context, download.track) } } },
            )
        }
        item(key = "downloads-note") { Text(ARCHIVE_NOTE, color = Color.White.copy(alpha = 0.35f), fontSize = 11.sp, lineHeight = 17.sp, modifier = Modifier.padding(top = 6.dp)) }
        item(key = "footer") { CityPopFooter(enabled = true) }
    }
    playing?.let { session -> CityPopArchivePlayer(session.tracks, session.uris, session.index, session.cover) { playing = null } }
}

@Composable
private fun CityPopDownloadRow(download: CityPopArchiveDownload, narrow: Boolean, onPlay: () -> Unit, onRemove: () -> Unit, onRetry: () -> Unit) {
    val track = download.track
    val percent = if (download.total > 0) (download.downloaded * 100 / download.total).toInt().coerceIn(0, 100) else null
    val status = when {
        download.saved -> "Saved offline${cityPopSize(download.total.takeIf { it > 0 } ?: track.size).let { if (it.isEmpty()) "" else " · $it" }}"
        download.status == DownloadManager.STATUS_SUCCESSFUL -> "File missing · remove and download again"
        download.status == DownloadManager.STATUS_FAILED -> "Download failed"
        download.status == DownloadManager.STATUS_PAUSED -> "Waiting for a connection"
        download.status == DownloadManager.STATUS_PENDING -> "Waiting in queue"
        else -> "Downloading ${cityPopSize(download.downloaded)}${if (download.total > 0) " / ${cityPopSize(download.total)}" else ""}${percent?.let { " · $it%" }.orEmpty()}"
    }
    val actions = @Composable {
        when {
            download.saved -> {
                CityPopFileAction("Play offline", if (track.mediaType == "video") Icons.Rounded.Tv else Icons.Rounded.Headphones, onPlay)
                IconButton(onClick = onRemove) { Icon(Icons.Rounded.Delete, "Remove download ${track.title}", tint = Color.White.copy(alpha = 0.6f)) }
            }
            download.status == DownloadManager.STATUS_FAILED || download.status == DownloadManager.STATUS_SUCCESSFUL -> {
                if (download.status == DownloadManager.STATUS_FAILED) CityPopFileAction("Retry", Icons.Rounded.Refresh, onRetry)
                IconButton(onClick = onRemove) { Icon(Icons.Rounded.Delete, "Remove download ${track.title}", tint = Color.White.copy(alpha = 0.6f)) }
            }
            else -> CityPopFileAction("Cancel", Icons.Rounded.Close, onRemove)
        }
    }
    Column(Modifier.fillMaxWidth().pixelPanel(CityPopColors.Panel, CityPopColors.Line).padding(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).pixelPanel(CityPopColors.Night, CityPopColors.Pink.copy(alpha = 0.5f), depth = 0.dp), contentAlignment = Alignment.Center) {
                Icon(if (track.mediaType == "video") Icons.Rounded.Tv else Icons.Rounded.MusicNote, null, tint = CityPopColors.Pink.copy(alpha = 0.67f), modifier = Modifier.size(18.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(track.title, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOf(track.artist, status).filter { it.isNotBlank() }.joinToString(" · "), color = Color.White.copy(alpha = 0.45f), fontSize = 11.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
                if (download.active) LinearProgressIndicator(
                    progress = { (percent ?: 0) / 100f }, color = CityPopColors.Teal, trackColor = CityPopColors.Line,
                    strokeCap = StrokeCap.Butt, gapSize = 0.dp, drawStopIndicator = {},
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(6.dp),
                )
            }
            if (!narrow) { Spacer(Modifier.width(10.dp)); Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { actions() } }
        }
        if (narrow) Row(Modifier.padding(start = 54.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { actions() }
    }
}
