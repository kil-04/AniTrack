package com.sanjay.anitrack.next.ui

import android.app.Activity
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.NewReleases
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.manga.MangaChapters
import com.sanjay.anitrack.next.data.manga.MangaSource
import com.sanjay.anitrack.next.data.manga.MangaVerificationRequired
import com.sanjay.anitrack.next.data.manga.MangaSources
import com.sanjay.anitrack.next.data.manga.SourceLatest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

private const val MAX_TRACKED = 40

private data class UpdateEntry(
    val mangaId: Int,
    val title: String,
    val cover: String?,
    val latest: Float?,
    val latestAt: Long?,
    val lastRead: Float?,
    val source: String,
) {
    /** Chapters out since the one you last read (null when you haven't started it). */
    val newCount: Int?
        get() {
            val read = lastRead ?: return null
            val newest = latest ?: return 0
            if (newest <= read) return 0
            return (kotlin.math.floor(newest) - kotlin.math.floor(read)).toInt().coerceAtLeast(1)
        }
}

/**
 * The newest chapter of one title. A saved match answers with one small request;
 * otherwise each source (the one chosen on its page first) looks the title up in
 * turn. Sources that ask for their browser check join [blocked] for the pass.
 */
private suspend fun latestFor(
    mangaId: Int,
    preferred: String?,
    blocked: MutableSet<String>,
    onBlocked: (MangaSource) -> Unit,
): Pair<MangaSource, SourceLatest>? {
    // Sources that need AniTrack in front for every read (Comix) aren't checked in bulk.
    val order = MangaSources.all.filterNot { it.foregroundOnly }.sortedBy { if (it.id == preferred) 0 else 1 }
    suspend fun <T> attempt(source: MangaSource, block: suspend () -> T?): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: MangaVerificationRequired) {
        blocked += source.id
        onBlocked(source)
        null
    } catch (_: Exception) {
        null // One title failing doesn't hide the others.
    }
    for (source in order) {
        if (source.id in blocked) continue
        val title = source.knownTitle(mangaId) ?: continue
        attempt(source) { source.latest(title) }?.let { return source to it }
    }
    val manga = runCatching { AniList.cachedManga(mangaId) ?: AniList.mangaById(mangaId) }.getOrNull() ?: return null
    for (source in order) {
        if (source.id in blocked || source.knownTitle(mangaId) != null) continue
        val title = attempt(source) { source.find(manga) } ?: continue
        attempt(source) { source.latest(title) }?.let { return source to it }
    }
    return null
}

/**
 * Manga mode's counterpart of the anime Schedule: the newest chapter of every
 * manga in your list or reading history, newest first, with what's new since the
 * chapter you last read. Each title is checked on the source it reads from (the
 * one chosen on its page, else wherever it was matched).
 */
@Composable
fun MangaUpdatesScreen(onOpen: (Int) -> Unit) {
    var entries by remember { mutableStateOf<List<UpdateEntry>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var needsConnect by remember { mutableStateOf<Set<String>>(emptySet()) }
    var empty by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var filter by remember { mutableStateOf("all") }
    val context = LocalContext.current
    val connect = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (it.resultCode == Activity.RESULT_OK) attempt++
    }

    val prefs = remember { context.getSharedPreferences("anitrack_next", android.content.Context.MODE_PRIVATE) }
    LaunchedEffect(attempt) {
        loading = true
        needsConnect = emptySet()
        entries = emptyList()
        // Sources that asked for their browser check are skipped for the rest of this pass.
        val blocked: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet())
        val list = runCatching { Db.mangaList() }.getOrDefault(emptyList()).filter { it.status != "dropped" && it.status != "completed" }
        val reading = runCatching { Db.continueReading(MAX_TRACKED) }.getOrDefault(emptyList())
        val lastRead = runCatching { Db.lastReadChapters() }.getOrDefault(emptyMap())
        val tracked = LinkedHashMap<Int, Pair<String, String?>>()
        reading.forEach { tracked[it.mangaId] = it.title to it.cover }
        list.forEach { tracked.putIfAbsent(it.mangaId, it.title to it.cover) }
        empty = tracked.isEmpty()
        // A few titles at a time: each source still spaces its own requests, but
        // the two sources and AniList lookups no longer wait on one another.
        val gate = Semaphore(4)
        coroutineScope {
            for ((mangaId, info) in tracked.entries.take(MAX_TRACKED)) {
                launch {
                    val found = gate.withPermit {
                        latestFor(mangaId, prefs.getString("manga_source_$mangaId", null), blocked) { needsConnect = needsConnect + it.id }
                    } ?: return@launch
                    val (source, latest) = found
                    entries = (entries + UpdateEntry(mangaId, info.first, info.second, latest.chapter, latest.at, lastRead[mangaId], source.label))
                        .sortedByDescending { it.latestAt ?: 0L }
                }
            }
        }
        loading = false
    }
    val fresh = entries.count { (it.newCount ?: 0) > 0 }
    val shown = if (filter == "new") entries.filter { (it.newCount ?: 0) > 0 } else entries

    val now = remember(entries) { System.currentTimeMillis() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 24.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            ScreenHeader(
                "Updates", scene = PixelScene.TOWER,
                subtitle = "Newest chapters for manga in your list and reading history.",
                icon = Icons.Rounded.NewReleases,
            ) {
                if (loading) CircularProgressIndicator(color = AniColors.Accent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                else IconButton(onClick = { attempt++ }) { Icon(Icons.Rounded.Refresh, "Check again", tint = AniColors.TextSecondary) }
            }
            Spacer(Modifier.height(10.dp))
            if (entries.isNotEmpty()) {
                PillTabs(
                    listOf("all" to "All", "new" to "New chapters"),
                    filter,
                    { filter = it },
                    counts = mapOf("all" to entries.size, "new" to fresh),
                    compact = true,
                )
                Spacer(Modifier.height(6.dp))
            }
        }
        for (source in MangaSources.all.filter { it.id in needsConnect }) {
            val activity = source.connectionActivity ?: continue
            item(key = "connect-${source.id}") {
                AniCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${source.label} needs a one-time check before AniTrack can check for updates.",
                            color = AniColors.TextSecondary,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(12.dp))
                        PillButton(
                            "Connect ${source.label}",
                            { connect.launch(Intent(context, activity)) },
                            icon = Icons.Rounded.Link,
                            style = PillStyle.Primary,
                            compact = true,
                        )
                    }
                }
            }
        }
        if (!loading && empty) item {
            EmptyState(
                Icons.Rounded.NewReleases,
                "Nothing to track yet",
                "Add manga to your list or start reading one, and its new chapters show up here.",
            )
        }
        if (loading && entries.isEmpty() && !empty) {
            items(5) { SkeletonBox(Modifier.fillMaxWidth().height(86.dp), corner = 14.dp) }
        }
        if (!loading && filter == "new" && shown.isEmpty() && entries.isNotEmpty()) item {
            EmptyState(
                Icons.Rounded.NewReleases,
                "You're all caught up",
                "No new chapters since the ones you last read.",
            )
        }
        items(shown.size, key = { shown[it].mangaId }) { i ->
            val entry = shown[i]
            val newCount = entry.newCount ?: 0
            val shape = aniShape(14.dp)
            Row(
                Modifier.fillMaxWidth().clip(shape)
                    .background(AniColors.Surface)
                    .border(1.dp, if (newCount > 0) AniColors.Accent.copy(alpha = 0.35f) else AniColors.BorderSoft, shape)
                    .clickable { onOpen(entry.mangaId) }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PosterImage(entry.cover, entry.title, Modifier.width(46.dp).height(64.dp).clip(aniShape(8.dp)))
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(entry.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        metaLine(
                            entry.latest?.let { "Ch. ${MangaChapters.label(it)}" },
                            entry.latestAt?.let { MangaChapters.uploadedLabel(it, now) },
                            entry.source,
                        ),
                        style = MaterialTheme.typography.labelMedium, color = AniColors.TextSecondary,
                    )
                    entry.lastRead?.let {
                        Text("You're on Ch. ${MangaChapters.label(it)}", style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary)
                    }
                }
                if (newCount > 0) Tag(if (newCount == 1) "1 NEW" else "$newCount NEW", tone = TagTone.Accent)
                Icon(Icons.Rounded.ChevronRight, null, tint = AniColors.TextTertiary)
            }
        }
    }
}
