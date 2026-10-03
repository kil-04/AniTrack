package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BookmarkBorder
import androidx.compose.material.icons.rounded.Bookmarks
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.Manga
import kotlinx.coroutines.launch

internal val MANGA_STATUS_LABELS = mapOf(
    "reading" to "Reading",
    "completed" to "Completed",
    "on_hold" to "On hold",
    "dropped" to "Dropped",
    "plan_to_read" to "Plan to read",
)

/** My List in manga mode: the anime list's tabs and cover grid, for reading statuses. */
@Composable
fun MangaListScreen(onOpen: (Int) -> Unit, onBrowse: () -> Unit = {}) {
    var tab by remember { mutableStateOf("all") }
    var rows by remember { mutableStateOf<List<Db.MangaListRow>>(emptyList()) }
    var lastRead by remember { mutableStateOf<Map<Int, Float>>(emptyMap()) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        rows = runCatching { Db.mangaList() }.getOrDefault(emptyList())
        lastRead = runCatching { Db.lastReadChapters() }.getOrDefault(emptyMap())
        loaded = true
    }
    val shown = if (tab == "all") rows else rows.filter { it.status == tab }

    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 20.dp)) {
        ScreenHeader(
            "My Manga",
            subtitle = if (rows.isEmpty()) "Manga you track appear here." else "${rows.size} ${if (rows.size == 1) "title" else "titles"} tracked",
            icon = Icons.Rounded.Bookmarks,
        )
        Spacer(Modifier.height(18.dp))
        PillTabs(
            listOf("all" to "All") + Db.MANGA_STATUSES.map { it to (MANGA_STATUS_LABELS[it] ?: it) },
            selected = tab,
            onSelect = { tab = it },
            counts = mapOf("all" to rows.size) + Db.MANGA_STATUSES.associateWith { status -> rows.count { it.status == status } },
        )
        Spacer(Modifier.height(18.dp))
        if (loaded && shown.isEmpty()) {
            EmptyState(
                Icons.Rounded.BookmarkBorder,
                if (tab == "all") "Your manga list is empty" else "Nothing in ${MANGA_STATUS_LABELS[tab] ?: tab} yet",
                "Use Add to list on a manga's page to keep track of what you're reading.",
                actionLabel = "Browse manga",
                onAction = onBrowse,
            )
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(150.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            items(shown.size) { i ->
                val row = shown[i]
                ListPosterCard(
                    cover = row.cover,
                    title = row.title,
                    status = row.status.takeIf { tab == "all" },
                    statusLabel = MANGA_STATUS_LABELS[row.status],
                    score = null,
                    badge = lastRead[row.mangaId]?.let { "CH ${com.sanjay.anitrack.next.data.manga.MangaChapters.label(it)}" },
                    onClick = { onOpen(row.mangaId) },
                )
            }
        }
    }
}

/** "Add to list" / reading status menu on a manga's page. */
@Composable
internal fun MangaListStatusButton(manga: Manga, compact: Boolean = false) {
    var status by remember(manga.id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(manga.id) { status = runCatching { Db.mangaStatusOf(manga.id) }.getOrNull() }
    StatusMenuButton(
        status, MANGA_STATUS_LABELS, compact = compact,
        onPick = { key ->
            scope.launch {
                Db.setMangaStatus(manga.id, key, manga.title, manga.cover)
                status = key
            }
        },
        onRemove = {
            scope.launch {
                Db.removeMangaFromList(manga.id)
                status = null
            }
        },
    )
}
