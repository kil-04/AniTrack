package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.DownloadForOffline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapters
import com.sanjay.anitrack.next.data.manga.MangaDownloads
import com.sanjay.anitrack.next.data.manga.MangaReading
import com.sanjay.anitrack.next.data.manga.MangaSources
import com.sanjay.anitrack.next.data.manga.SourceTitle
import com.sanjay.anitrack.next.data.manga.mangadot.MangaDotSource
import kotlinx.coroutines.launch

/** Downloads in manga mode: chapters saved for offline reading, grouped by series. */
@Composable
fun MangaDownloadsScreen(onOpenManga: (Int) -> Unit, onRead: () -> Unit) {
    val items = MangaDownloads.items
    val groups = items.groupBy { it.mangaId }.values.toList()
    val expanded = remember { mutableStateMapOf<Int, Boolean>() }
    val scope = rememberCoroutineScope()

    fun read(item: MangaDownloads.Item) {
        // Offline reading moves between this series' downloaded chapters, one per number:
        // where two groups' uploads of a chapter are saved, the opened chapter's group wins.
        val downloaded = items.filter { it.mangaId == item.mangaId && it.status == MangaDownloads.Status.DONE }.map { it.chapter }
        val chapters = MangaChapters.withUpload(MangaChapters.normalize(downloaded, item.chapter.group), item.chapter)
        val manga = AniList.cachedManga(item.mangaId) ?: Manga(
            id = item.mangaId, malId = null, title = item.mangaTitle, titleRomaji = null, cover = item.cover,
            banner = null, chapters = null, volumes = null, status = null, format = null, year = null,
            score = null, synopsis = null, genres = emptyList(),
        )
        val source = MangaSources.byId(item.sourceId) ?: MangaDotSource
        scope.launch {
            val progress = runCatching { Db.readingFor(item.mangaId) }.getOrDefault(emptyMap())[item.chapter.number]
            val start = if (progress != null && !progress.finished) progress.page else 0
            val title = SourceTitle(item.sourceId, item.sourceTitleId, item.sourceTitle)
            if (MangaReading.open(manga, source, title, chapters, item.chapter, start)) onRead()
        }
    }

    val done = items.filter { it.status == MangaDownloads.Status.DONE }
    val totalSize = done.sumOf { it.sizeBytes }

    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 860.dp).fillMaxWidth().padding(horizontal = 24.dp, vertical = 20.dp)) {
            ScreenHeader(
                "Manga downloads",
                subtitle = if (done.isEmpty()) "Read downloaded chapters offline, in the app."
                else metaLine("${done.size} chapter${if (done.size == 1) "" else "s"}", MangaDownloads.humanSize(totalSize).ifEmpty { null }, "available offline"),
                icon = Icons.Rounded.DownloadForOffline,
            )
            Spacer(Modifier.height(20.dp))
            if (items.isEmpty()) {
                AniCard {
                    EmptyState(
                        Icons.Rounded.DownloadForOffline,
                        "No downloads yet",
                        "Tap the download button on a chapter, or use Download range on a manga's page to save several.",
                    )
                }
            }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(groups.size) { gi ->
                    val group = groups[gi].sortedBy { it.chapter.number }
                    val head = group.first()
                    val open = expanded[head.mangaId] ?: false
                    val groupDone = group.filter { it.status == MangaDownloads.Status.DONE }
                    val active = group.count { it.status == MangaDownloads.Status.DOWNLOADING || it.status == MangaDownloads.Status.QUEUED }
                    DownloadGroupCard(
                        cover = head.cover,
                        title = head.mangaTitle,
                        summary = metaLine(
                            "${groupDone.size} chapter${if (groupDone.size == 1) "" else "s"}",
                            MangaDownloads.humanSize(groupDone.sumOf { it.sizeBytes }).ifEmpty { null },
                            if (active > 0) "$active in queue" else null,
                        ),
                        active = active > 0,
                        open = open,
                        onToggle = { expanded[head.mangaId] = !open },
                        onOpenSeries = { onOpenManga(head.mangaId) },
                        trailing = {
                            if (active > 0) {
                                TextButton(onClick = { MangaDownloads.cancel(head.mangaId) }) {
                                    Text("Cancel $active", color = AniColors.Danger)
                                }
                            }
                        },
                    ) {
                        group.forEach { item ->
                            DownloadItemRow(
                                title = listOfNotNull("Ch. ${MangaChapters.label(item.chapter.number)}", item.chapter.title).joinToString(" · "),
                                detail = when (item.status) {
                                    MangaDownloads.Status.DONE -> metaLine(item.chapter.group, "${item.total} pages", MangaDownloads.humanSize(item.sizeBytes).ifEmpty { null })
                                    MangaDownloads.Status.DOWNLOADING -> "Downloading ${item.done}/${item.total}"
                                    MangaDownloads.Status.QUEUED -> "Queued"
                                    MangaDownloads.Status.FAILED -> item.error ?: "Failed"
                                },
                                state = when (item.status) {
                                    MangaDownloads.Status.QUEUED -> ItemState.Queued
                                    MangaDownloads.Status.DOWNLOADING -> ItemState.Downloading
                                    MangaDownloads.Status.DONE -> ItemState.Done
                                    MangaDownloads.Status.FAILED -> ItemState.Failed
                                },
                                progress = if (item.total > 0) item.done.toFloat() / item.total else 0f,
                                actionLabel = "Read",
                                actionIcon = Icons.Rounded.AutoStories,
                                onAction = { read(item) },
                                onDelete = { MangaDownloads.remove(item.key) },
                            )
                        }
                    }
                }
            }
        }
    }
}
