package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.manga.MangaDownloads
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Timelapse
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.border
import com.sanjay.anitrack.next.data.AniList
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaChapters
import com.sanjay.anitrack.next.data.manga.MangaReading
import com.sanjay.anitrack.next.data.manga.MangaSource
import com.sanjay.anitrack.next.data.manga.MangaSources
import com.sanjay.anitrack.next.data.manga.MangaVerificationRequired
import com.sanjay.anitrack.next.data.manga.ReadState
import com.sanjay.anitrack.next.data.manga.SourceTitle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import android.app.Activity
import android.content.Intent
import kotlinx.coroutines.CancellationException

private val MangaDetailAccent = Color(0xFFE50914)

@Composable
fun MangaDetailScreen(mangaId: Int, onRead: () -> Unit) {
    var manga by remember(mangaId) { mutableStateOf(AniList.cachedManga(mangaId)) }
    var failed by remember(mangaId) { mutableStateOf(false) }
    LaunchedEffect(mangaId) {
        if (manga == null) {
            manga = AniList.mangaById(mangaId)
            failed = manga == null
        }
    }

    val m = manga ?: run {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (failed) EmptyState(Icons.Rounded.CloudOff, "Couldn't load this title", "AniList didn't answer. Check your connection and try again.")
            else CircularProgressIndicator(color = MangaDetailAccent)
        }
        return
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        DetailHero(
            banner = m.banner,
            cover = m.cover,
            title = m.title,
            subtitle = m.titleRomaji?.takeIf { it != m.title },
            score = aniScore(m.score),
            meta = metaLine(
                m.kind,
                m.year?.toString(),
                m.chapters?.let { "$it ch" },
                m.volumes?.let { "$it vol" },
                m.status?.let(::statusLabel),
            ),
            genres = m.genres,
        ) {
            MangaListStatusButton(m)
        }
        Spacer(Modifier.height(14.dp))
        ExpandableSynopsis(m.synopsis)
        Spacer(Modifier.height(12.dp))
        ChaptersSection(m, onRead)
        Spacer(Modifier.height(32.dp))
    }
}

private fun statusLabel(status: String) = when (status) {
    "RELEASING" -> "Publishing"
    "FINISHED" -> "Completed"
    "NOT_YET_RELEASED" -> "Not yet published"
    "HIATUS" -> "On hiatus"
    "CANCELLED" -> "Cancelled"
    else -> status.lowercase().replaceFirstChar { it.uppercase() }
}

private sealed interface ChapterLoad {
    data object Loading : ChapterLoad
    data class Message(val text: String) : ChapterLoad
    /** [uploads] holds every group's upload of every chapter. */
    data class Ready(val source: MangaSource, val title: SourceTitle, val uploads: List<MangaChapter>) : ChapterLoad
}

/** Rows shown at first and per "Show more", like MangaDot's list. */
private const val CHAPTER_PAGE = 60

@Composable
private fun ChaptersSection(manga: Manga, onRead: () -> Unit) {
    var load by remember(manga.id) { mutableStateOf<ChapterLoad>(ChapterLoad.Loading) }
    var progress by remember(manga.id) { mutableStateOf<Map<Float, ReadState>>(emptyMap()) }
    var newestFirst by remember(manga.id) { mutableStateOf(true) }
    var attempt by remember(manga.id) { mutableIntStateOf(0) }
    // Sources the user stepped past with "Try another source" on this visit.
    var skipped by remember(manga.id) { mutableStateOf(emptySet<String>()) }
    // Sources that asked for their one-time human check during the last load.
    var needsConnect by remember(manga.id) { mutableStateOf(emptySet<String>()) }
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("anitrack_next", android.content.Context.MODE_PRIVATE) }
    val preferenceKey = "manga_source_${manga.id}"
    val groupKey = "manga_group_${manga.id}"
    // Group filter for this title (remembered); null shows every group's uploads.
    var groupFilter by remember(manga.id) { mutableStateOf(prefs.getString(groupKey, null)) }
    var query by remember(manga.id) { mutableStateOf("") }
    val connect = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (it.resultCode == Activity.RESULT_OK) attempt++
    }
    LaunchedEffect(manga.id, attempt) {
        load = ChapterLoad.Loading
        progress = Db.readingFor(manga.id)
        if (MangaSources.all.isEmpty()) {
            load = ChapterLoad.Message("Chapters will appear here once a reading source is connected.")
            return@LaunchedEffect
        }
        var lastError: Throwable? = null
        val needing = mutableSetOf<String>()
        // A source the user picked for this title before goes first.
        val preferred = prefs.getString(preferenceKey, null)
        val order = MangaSources.all.sortedBy { if (it.id == preferred) 0 else 1 }.filter { it.id !in skipped }
        for (source in order) {
            val result = runCatching {
                source.find(manga)?.let { title -> ChapterLoad.Ready(source, title, source.chapters(title)) }
            }
            result.exceptionOrNull()?.let {
                if (it is CancellationException) throw it
                if (it is MangaVerificationRequired) needing += source.id
                lastError = it
            }
            val ready = result.getOrNull()
            if (ready != null && MangaChapters.uploads(ready.uploads).isNotEmpty()) {
                if (skipped.isNotEmpty()) prefs.edit().putString(preferenceKey, source.id).apply()
                needsConnect = needing
                load = ready
                return@LaunchedEffect
            }
        }
        needsConnect = needing
        load = ChapterLoad.Message(
            when {
                skipped.isNotEmpty() -> "No other source has this title."
                else -> lastError?.message ?: "No chapters found for this title on the connected sources."
            },
        )
    }
    // Coming back from the reader refreshes the read markers.
    val reading by MangaReading.current
    LaunchedEffect(reading) { progress = Db.readingFor(manga.id) }

    val ready = load as? ChapterLoad.Ready
    val uploads = ready?.uploads.orEmpty()
    val groups = remember(ready) { ready?.let { MangaChapters.groups(it.uploads) }.orEmpty() }
    // A remembered group this source doesn't have shows everything instead.
    val activeGroup = groupFilter?.takeIf { chosen -> groups.any { it.first == chosen } }
    val rows = remember(ready, activeGroup, query, newestFirst) {
        MangaChapters.listing(uploads, activeGroup, query, newestFirst)
    }
    var limit by remember(manga.id, activeGroup, query, newestFirst) { mutableIntStateOf(CHAPTER_PAGE) }

    /** Opens [chapter]; next/previous then follow its group where that group has the chapter. */
    fun open(state: ChapterLoad.Ready, chapter: MangaChapter) {
        val progressState = progress[chapter.number]
        val start = if (progressState != null && !progressState.finished) progressState.page else 0
        val list = MangaChapters.withUpload(MangaChapters.normalize(state.uploads, chapter.group ?: activeGroup), chapter)
        if (MangaReading.open(manga, state.source, state.title, list, chapter, start)) onRead()
    }

    Row(Modifier.fillMaxWidth().padding(end = 24.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) { SectionHeader("Chapters") }
        MangaSources.all.filter { it.id in needsConnect }.forEach { source ->
            source.connectionActivity?.let { screen ->
                TextButton(onClick = { connect.launch(Intent(context, screen)) }, enabled = load !is ChapterLoad.Loading) {
                    Text("Connect ${source.label}", color = MangaDetailAccent)
                }
            }
        }
        if (ready != null) {
            Tag("via ${ready.source.label}", tone = TagTone.Outline)
            if (MangaSources.all.any { it.id != ready.source.id && it.id !in skipped }) {
                TextButton(onClick = {
                    skipped = skipped + ready.source.id
                    attempt++
                }) { Text("Try another source", color = Color.White.copy(alpha = 0.7f)) }
            }
        }
    }
    if (needsConnect.isNotEmpty() && load !is ChapterLoad.Loading) {
        val labels = MangaSources.all.filter { it.id in needsConnect }.joinToString(" and ") { it.label }
        Text(
            "$labels needs a one-time check before AniTrack can use it. Tap Connect $labels.",
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 2.dp),
            color = AniColors.TextSecondary,
            style = MaterialTheme.typography.labelMedium,
        )
    }
    when (val state = load) {
        ChapterLoad.Loading -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = MangaDetailAccent)
        }
        is ChapterLoad.Message -> AniCard(Modifier.padding(horizontal = 24.dp)) {
            StatusLine(state.text)
            if (MangaSources.all.isNotEmpty()) {
                TextButton(onClick = {
                    if (skipped.isNotEmpty()) {
                        skipped = emptySet()
                        prefs.edit().remove(preferenceKey).apply()
                    }
                    attempt++
                }) {
                    Text(if (skipped.isNotEmpty()) "Back to the first source" else "Retry", color = MangaDetailAccent)
                }
            }
        }
        is ChapterLoad.Ready -> {
            // One upload per chapter: the chosen group's (or the automatic pick), as Continue reads.
            val readingList = remember(state, activeGroup) { MangaChapters.normalize(state.uploads, activeGroup) }
            val target = MangaChapters.resumeTarget(readingList, progress)
            var rangeOpen by remember(manga.id) { mutableStateOf(false) }
            Row(
                Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (target != null) {
                    val resuming = progress.isNotEmpty()
                    PillButton(
                        (if (resuming) "Continue · Chapter " else "Start reading · Chapter ") + MangaChapters.label(target.number),
                        { open(state, target) },
                        icon = Icons.Rounded.AutoStories,
                        style = PillStyle.Primary,
                    )
                }
                PillButton("Download range", { rangeOpen = true }, icon = Icons.Rounded.Download)
            }
            if (rangeOpen) {
                // Start with the group this title's downloads already use, so batches don't
                // mix groups; else the list's group; else the group with the most chapters.
                val initialGroup = remember(groups) {
                    MangaDownloads.held(manga.id).values.mapNotNull { it.chapter.group }
                        .filter { group -> groups.any { it.first == group } }
                        .groupingBy { it }.eachCount().maxByOrNull { it.value }?.key
                        ?: activeGroup ?: groups.firstOrNull()?.first
                }
                DownloadRangeDialog(
                    uploads = state.uploads,
                    groups = groups,
                    initialGroup = initialGroup,
                    start = target,
                    held = MangaDownloads.held(manga.id),
                    onDismiss = { rangeOpen = false },
                    onDownload = { selection ->
                        rangeOpen = false
                        val added = MangaDownloads.enqueueAll(manga, state.source, state.title, selection)
                        android.widget.Toast.makeText(
                            context,
                            if (added == 0) "Those chapters are already downloaded or queued."
                            else "Downloading $added chapter${if (added == 1) "" else "s"}. Progress is in Downloads.",
                            android.widget.Toast.LENGTH_SHORT,
                        ).show()
                    },
                )
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (groups.size > 1) {
                    GroupFilter(groups, activeGroup) { choice ->
                        groupFilter = choice
                        prefs.edit().apply { if (choice == null) remove(groupKey) else putString(groupKey, choice) }.apply()
                    }
                }
                ChapterSearch(query, { query = it }, Modifier.weight(1f))
                NewestOldest(newestFirst) { newestFirst = it }
            }
            val now = remember(ready) { System.currentTimeMillis() }
            Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (rows.isEmpty()) {
                    Text(
                        "No chapters match.",
                        color = Color.White.copy(alpha = 0.5f),
                        modifier = Modifier.padding(vertical = 12.dp),
                    )
                }
                rows.take(limit).forEach { chapter ->
                    key(chapter.id) {
                        ChapterRow(
                            chapter,
                            progress[chapter.number],
                            now,
                            download = MangaDownloads.items.firstOrNull { it.key == MangaDownloads.keyOf(manga.id, chapter.id) },
                            onDownload = { MangaDownloads.enqueue(manga, state.source, state.title, chapter) },
                        ) { open(state, chapter) }
                    }
                }
                if (rows.size > limit) {
                    TextButton(
                        onClick = { limit += 100 },
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    ) {
                        Text(
                            "• SHOW ${rows.size - limit} MORE CHAPTERS",
                            color = Color(0xFF5FC9C0),
                            letterSpacing = 2.sp,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
            }
        }
    }
}

/** MangaDot-style group dropdown: [allLabel] ("All Groups"; null leaves it out) or one group's uploads only. */
@Composable
private fun GroupFilter(groups: List<Pair<String, Int>>, choice: String?, allLabel: String? = "All Groups", onChoose: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Row(
            Modifier.height(44.dp).clip(RoundedCornerShape(10.dp))
                .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(10.dp))
                .clickable { open = true }
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                choice ?: allLabel.orEmpty(),
                color = Color.White,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 220.dp),
            )
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Rounded.ExpandMore, null, tint = AniColors.TextSecondary, modifier = Modifier.size(20.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (allLabel != null) GroupMenuItem(allLabel, null, choice == null) { open = false; onChoose(null) }
            groups.forEach { (group, count) ->
                GroupMenuItem(group, "$count ch", group == choice) { open = false; onChoose(group) }
            }
        }
    }
}

@Composable
private fun GroupMenuItem(name: String, detail: String?, selected: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.widthIn(min = 200.dp)) {
                Text(name, modifier = Modifier.weight(1f, fill = false))
                if (detail != null) {
                    Spacer(Modifier.width(10.dp))
                    Text(detail, color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.labelSmall)
                }
                Spacer(Modifier.weight(1f))
                if (selected) Icon(Icons.Rounded.Check, "Selected", tint = AniColors.Text, modifier = Modifier.padding(start = 8.dp).size(18.dp))
            }
        },
        onClick = onClick,
    )
}

@Composable
private fun ChapterSearch(value: String, onChange: (String) -> Unit, modifier: Modifier) {
    Row(
        modifier.height(44.dp).clip(RoundedCornerShape(10.dp))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(10.dp))
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Search, null, tint = AniColors.TextTertiary, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        BasicTextField(
            value = value,
            onValueChange = { onChange(it.take(40)) },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = Color.White),
            cursorBrush = SolidColor(Color.White),
            modifier = Modifier.weight(1f),
            decorationBox = { inner ->
                if (value.isEmpty()) Text("Search chapters", color = Color.White.copy(alpha = 0.45f), style = MaterialTheme.typography.bodyMedium)
                inner()
            },
        )
        if (value.isNotEmpty()) {
            Icon(
                Icons.Rounded.Close, "Clear", tint = AniColors.TextSecondary,
                modifier = Modifier.clip(RoundedCornerShape(50)).clickable { onChange("") }.padding(4.dp).size(18.dp),
            )
        }
    }
}

@Composable
private fun NewestOldest(newestFirst: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.height(44.dp).clip(RoundedCornerShape(10.dp))
            .border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(10.dp))
            .padding(4.dp),
    ) {
        listOf(true to "Newest", false to "Oldest").forEach { (value, label) ->
            val selected = value == newestFirst
            Box(
                Modifier.fillMaxHeight().clip(RoundedCornerShape(8.dp))
                    .background(if (selected) Color(0xFF5FC9C0).copy(alpha = 0.18f) else Color.Transparent)
                    .clickable(enabled = !selected) { onChange(value) }
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    color = if (selected) Color(0xFF5FC9C0) else Color.White.copy(alpha = 0.7f),
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

/** One upload, laid out like MangaDot's rows: state · number · title · flag · group · pages · date. */
@Composable
private fun ChapterRow(
    chapter: MangaChapter,
    state: ReadState?,
    nowMs: Long,
    download: MangaDownloads.Item?,
    onDownload: () -> Unit,
    onClick: () -> Unit,
) {
    val read = state?.finished == true
    val label = MangaChapters.label(chapter.number)
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
            .background(Color.White.copy(alpha = if (read) 0.02f else 0.045f))
            .border(1.dp, Color.White.copy(alpha = 0.07f), RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            when {
                read -> Icons.Rounded.CheckCircle
                state != null -> Icons.Rounded.Timelapse
                else -> Icons.Rounded.RadioButtonUnchecked
            },
            when {
                read -> "Read"
                state != null -> "In progress"
                else -> "Unread"
            },
            tint = when {
                read -> AniColors.TextTertiary
                state != null -> MangaDetailAccent
                else -> AniColors.TextTertiary
            },
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(14.dp))
        Text(
            "Ch. $label",
            fontFamily = FontFamily.Monospace,
            color = Color.White.copy(alpha = if (read) 0.45f else 0.85f),
            maxLines = 1,
            modifier = Modifier.width(96.dp),
        )
        // Title, flag and group sit together; the columns after them stay right-aligned.
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Text(
                chapter.title ?: "Chapter $label",
                color = Color.White.copy(alpha = if (read) 0.45f else 0.95f),
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(10.dp))
            Text("🇬🇧")
            Spacer(Modifier.width(10.dp))
            Text(
                chapter.group ?: "Unknown group",
                color = Color.White.copy(alpha = 0.55f),
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 240.dp),
            )
        }
        if (state != null && !read) {
            Text(
                "p. ${state.page + 1}/${state.pageCount}",
                color = MangaDetailAccent,
                style = MaterialTheme.typography.labelMedium,
            )
            Spacer(Modifier.width(16.dp))
        }
        Text(
            chapter.pageCount?.let { "${it}p" } ?: "",
            color = Color.White.copy(alpha = 0.5f),
            fontFamily = FontFamily.Monospace,
            textAlign = TextAlign.End,
            modifier = Modifier.width(56.dp),
        )
        Text(
            chapter.uploadedAt?.let { MangaChapters.uploadedLabel(it, nowMs) } ?: "",
            color = Color.White.copy(alpha = 0.5f),
            fontFamily = FontFamily.Monospace,
            textAlign = TextAlign.End,
            maxLines = 1,
            modifier = Modifier.width(110.dp),
        )
        Spacer(Modifier.width(8.dp))
        DownloadControl(download, onDownload)
    }
}

/** ↓ to save a chapter for offline reading; progress while saving; ✓ once saved. */
@Composable
private fun DownloadControl(download: MangaDownloads.Item?, onDownload: () -> Unit) {
    Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
        when (download?.status) {
            null -> IconButton(onClick = onDownload) {
                Icon(Icons.Rounded.Download, "Download chapter", tint = AniColors.TextSecondary, modifier = Modifier.size(20.dp))
            }
            MangaDownloads.Status.QUEUED -> CircularProgressIndicator(color = Color.White.copy(alpha = 0.5f), strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            MangaDownloads.Status.DOWNLOADING -> CircularProgressIndicator(
                progress = { if (download.total > 0) download.done.toFloat() / download.total else 0f },
                color = MangaDetailAccent,
                strokeWidth = 2.dp,
                modifier = Modifier.size(20.dp),
            )
            MangaDownloads.Status.DONE -> Icon(Icons.Rounded.DownloadDone, "Downloaded", tint = AniColors.Success, modifier = Modifier.size(20.dp))
            MangaDownloads.Status.FAILED -> IconButton(onClick = onDownload) {
                Icon(Icons.Rounded.Refresh, "Download failed, retry", tint = AniColors.Danger, modifier = Modifier.size(20.dp))
            }
        }
    }
}

/**
 * Download a range of chapters from one group. Chapter numbers come from the
 * From/To fields (half chapters like 140.5 too) or presets from the next unread
 * chapter. Each number downloads once: the chosen group's upload, or another
 * group's where it has none and "Fill gaps" is on. Numbers already downloaded or
 * queued, from any group, are skipped.
 */
@Composable
private fun DownloadRangeDialog(
    uploads: List<MangaChapter>,
    groups: List<Pair<String, Int>>,
    initialGroup: String?,
    start: MangaChapter?,
    held: Map<Float, MangaDownloads.Item>,
    onDismiss: () -> Unit,
    onDownload: (List<MangaChapter>) -> Unit,
) {
    val numbers = remember(uploads) { MangaChapters.normalize(uploads) }
    val presets = remember(numbers, start) { MangaChapters.rangePresets(numbers, start) }
    var fromText by remember { mutableStateOf(presets.firstOrNull()?.second?.let(MangaChapters::label) ?: "") }
    var toText by remember { mutableStateOf(presets.firstOrNull()?.third?.let(MangaChapters::label) ?: "") }
    var group by remember { mutableStateOf(initialGroup) }
    var fillGaps by remember { mutableStateOf(true) }
    val from = fromText.toFloatOrNull()
    val to = toText.toFloatOrNull() ?: from
    val choice = if (from != null && to != null) MangaChapters.rangeChoice(uploads, group, from, to, fillGaps) else null
    val inRange = choice?.let { (it.chapters + it.gaps).map { chapter -> chapter.number }.toSet() }.orEmpty()
    val fresh = choice?.chapters.orEmpty().filter { it.number !in held }
    val have = inRange.mapNotNull { held[it] }
    // Numbers the chosen group never uploaded (ones already saved don't matter).
    val gaps = choice?.gaps.orEmpty().filter { it.number !in held }
    val pages = fresh.mapNotNull { it.pageCount }.sum()
    fun numeric(value: String) = value.filter { it.isDigit() || it == '.' }.take(7)
    fun chapterList(chapters: List<MangaChapter>) =
        "Ch. " + chapters.take(6).joinToString(", ") { MangaChapters.label(it.number) } +
            if (chapters.size > 6) " and ${chapters.size - 6} more" else ""

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Download chapters") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    presets.forEach { (label, low, high) ->
                        val chosen = from == low && to == high
                        Text(
                            label,
                            color = if (chosen) Color.Black else Color.White.copy(alpha = 0.8f),
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.clip(RoundedCornerShape(50))
                                .background(if (chosen) Color.White else Color.White.copy(alpha = 0.08f))
                                .clickable {
                                    fromText = MangaChapters.label(low)
                                    toText = MangaChapters.label(high)
                                }
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = fromText, onValueChange = { fromText = numeric(it) },
                        label = { Text("From chapter") }, singleLine = true, modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MangaDetailAccent, cursorColor = MangaDetailAccent),
                    )
                    OutlinedTextField(
                        value = toText, onValueChange = { toText = numeric(it) },
                        label = { Text("To chapter") }, singleLine = true, modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = MangaDetailAccent, cursorColor = MangaDetailAccent),
                    )
                }
                if (groups.size > 1) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Group", color = Color.White.copy(alpha = 0.6f), modifier = Modifier.width(64.dp))
                        GroupFilter(groups, group, allLabel = null) { group = it }
                    }
                } else if (group != null) {
                    Text("Group: $group", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.5f))
                }
                if (group != null && gaps.isNotEmpty()) {
                    Row(
                        Modifier.clip(RoundedCornerShape(8.dp)).clickable { fillGaps = !fillGaps }.padding(end = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Checkbox(
                            checked = fillGaps, onCheckedChange = { fillGaps = it },
                            colors = CheckboxDefaults.colors(checkedColor = MangaDetailAccent),
                        )
                        Text("Fill gaps from other groups", color = Color.White.copy(alpha = 0.85f))
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        when {
                            inRange.isEmpty() -> "No chapters in that range."
                            fresh.isEmpty() && have.size == inRange.size -> "You already have every chapter in this range."
                            fresh.isEmpty() -> "Nothing to download from $group in this range."
                            else -> buildString {
                                append("${fresh.size} chapter${if (fresh.size == 1) "" else "s"}")
                                if (pages > 0) append(" \u00B7 about $pages pages")
                            }
                        },
                        color = Color.White.copy(alpha = 0.85f),
                    )
                    if (have.isNotEmpty() && have.size < inRange.size) {
                        val others = have.mapNotNull { it.chapter.group }.filter { it != group }.distinct()
                        Text(
                            "Skipping ${have.size} you already have" + when (others.size) {
                                0 -> "."
                                1 -> " (from ${others.single()})."
                                else -> " (from other groups)."
                            },
                            style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.55f),
                        )
                    }
                    if (group != null && gaps.isNotEmpty()) {
                        Text(
                            chapterList(gaps) + (if (gaps.size == 1) " isn't" else " aren't") + " uploaded by $group" +
                                if (fillGaps) ", so ${if (gaps.size == 1) "it comes" else "they come"} from other groups."
                                else " and will be left out.",
                            style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.55f),
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onDownload(fresh) }, enabled = fresh.isNotEmpty()) {
                Text(if (fresh.isEmpty()) "Download" else "Download ${fresh.size}", color = if (fresh.isEmpty()) Color.White.copy(alpha = 0.4f) else MangaDetailAccent)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
