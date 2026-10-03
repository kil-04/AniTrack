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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.NewReleases
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
import com.sanjay.anitrack.next.data.manga.MangaVerificationRequired
import com.sanjay.anitrack.next.data.manga.mangadot.MangaDotSource
import kotlinx.coroutines.CancellationException

private const val MAX_TRACKED = 40

private data class UpdateEntry(
    val mangaId: Int,
    val title: String,
    val cover: String?,
    val latest: Float?,
    val latestAt: Long?,
    val lastRead: Float?,
)

/**
 * Manga mode's counterpart of the anime Schedule: the newest MangaDot chapter of
 * every manga in your list or reading history, newest first, with what's new
 * since the chapter you last read.
 */
@Composable
fun MangaUpdatesScreen(onOpen: (Int) -> Unit) {
    var entries by remember { mutableStateOf<List<UpdateEntry>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var needsConnect by remember { mutableStateOf(false) }
    var empty by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    val context = LocalContext.current
    val connect = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (it.resultCode == Activity.RESULT_OK) attempt++
    }

    LaunchedEffect(attempt) {
        loading = true
        needsConnect = false
        entries = emptyList()
        val list = runCatching { Db.mangaList() }.getOrDefault(emptyList()).filter { it.status != "dropped" && it.status != "completed" }
        val reading = runCatching { Db.continueReading(MAX_TRACKED) }.getOrDefault(emptyList())
        val lastRead = runCatching { Db.lastReadChapters() }.getOrDefault(emptyMap())
        val tracked = LinkedHashMap<Int, Pair<String, String?>>()
        reading.forEach { tracked[it.mangaId] = it.title to it.cover }
        list.forEach { tracked.putIfAbsent(it.mangaId, it.title to it.cover) }
        empty = tracked.isEmpty()
        for ((mangaId, info) in tracked.entries.take(MAX_TRACKED)) {
            try {
                val title = MangaDotSource.knownTitle(mangaId)
                    ?: (AniList.cachedManga(mangaId) ?: AniList.mangaById(mangaId))?.let { MangaDotSource.find(it) }
                    ?: continue
                val latest = MangaDotSource.latest(title) ?: continue
                entries = (entries + UpdateEntry(mangaId, info.first, info.second, latest.chapter, latest.at, lastRead[mangaId]))
                    .sortedByDescending { it.latestAt ?: 0L }
            } catch (e: CancellationException) {
                throw e
            } catch (e: MangaVerificationRequired) {
                needsConnect = true
                break
            } catch (_: Exception) {
                // One title failing doesn't hide the others.
            }
        }
        loading = false
    }

    val now = remember(entries) { System.currentTimeMillis() }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 24.dp, vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            ScreenHeader(
                "Updates",
                subtitle = "Newest chapters on MangaDot for manga in your list and reading history.",
                icon = Icons.Rounded.NewReleases,
            ) {
                if (loading) CircularProgressIndicator(color = AniColors.Accent, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.height(10.dp))
        }
        if (needsConnect) item {
            AniCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "MangaDot needs a one-time check before AniTrack can check for updates.",
                        color = AniColors.TextSecondary,
                        modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(12.dp))
                    PillButton(
                        "Connect MangaDot",
                        { connect.launch(Intent(context, MangaDotSource.connectionActivity)) },
                        icon = Icons.Rounded.Link,
                        style = PillStyle.Primary,
                        compact = true,
                    )
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
        items(entries.size) { i ->
            val entry = entries[i]
            val unread = entry.latest != null && (entry.lastRead == null || entry.latest > entry.lastRead)
            val shape = RoundedCornerShape(14.dp)
            Row(
                Modifier.fillMaxWidth().clip(shape)
                    .background(AniColors.Surface)
                    .border(1.dp, if (unread && entry.lastRead != null) AniColors.Accent.copy(alpha = 0.35f) else AniColors.BorderSoft, shape)
                    .clickable { onOpen(entry.mangaId) }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PosterImage(entry.cover, entry.title, Modifier.width(46.dp).height(64.dp).clip(RoundedCornerShape(8.dp)))
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(entry.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.height(2.dp))
                    Text(
                        metaLine(
                            entry.latest?.let { "Ch. ${MangaChapters.label(it)}" },
                            entry.latestAt?.let { MangaChapters.uploadedLabel(it, now) },
                        ),
                        style = MaterialTheme.typography.labelMedium, color = AniColors.TextSecondary,
                    )
                    entry.lastRead?.let {
                        Text("You're on Ch. ${MangaChapters.label(it)}", style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary)
                    }
                }
                if (unread && entry.lastRead != null) Tag("NEW", tone = TagTone.Accent)
                Icon(Icons.Rounded.ChevronRight, null, tint = AniColors.TextTertiary)
            }
        }
    }
}
