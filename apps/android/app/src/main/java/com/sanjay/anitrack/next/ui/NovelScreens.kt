package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.novel.NovelCard
import com.sanjay.anitrack.next.data.novel.NovelChapter
import com.sanjay.anitrack.next.data.novel.NovelDetail
import com.sanjay.anitrack.next.data.novel.NovelDownloads
import com.sanjay.anitrack.next.data.novel.NovelFilters
import com.sanjay.anitrack.next.data.novel.NovelGenres
import com.sanjay.anitrack.next.data.novel.NovelHome
import com.sanjay.anitrack.next.data.novel.NovelProgress
import com.sanjay.anitrack.next.data.novel.NovelReading
import com.sanjay.anitrack.next.data.novel.NovelSort
import com.sanjay.anitrack.next.data.novel.NovelSourceId
import com.sanjay.anitrack.next.data.novel.NovelSources
import com.sanjay.anitrack.next.data.novel.NovelStore
import com.sanjay.anitrack.next.data.novel.Novels
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

typealias OpenNovel = (NovelSourceId, String) -> Unit

private fun statusLabel(status: String?) = when (status) { "ongoing" -> "Ongoing"; "completed" -> "Complete"; else -> null }

/** A source's message for a failure, or a general one. */
internal fun Throwable.novelMessage() = (this as? com.sanjay.anitrack.next.data.manga.MangaSourceException)?.message
    ?: "Something went wrong reaching the source. Try again."

private val HOME_GENRES = listOf("Fantasy", "Action", "Romance", "Martial Arts", "Xianxia", "Sci-fi", "Mystery", "Comedy", "Drama", "Horror", "Slice of Life", "Historical")
private const val HERO_COUNT = 6

// ── Cards ─────────────────────────────────────────────────────────────────────

/** A novel's cover, or a typeset stand-in when the source has none (or it fails to load). */
@Composable
internal fun NovelCover(cover: String?, title: String, modifier: Modifier = Modifier) {
    var broken by remember(cover) { mutableStateOf(false) }
    if (cover != null && !broken) {
        Box(modifier.background(AniColors.SurfaceHigh)) {
            coil.compose.AsyncImage(
                model = cover, contentDescription = title, contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                onError = { broken = true }, modifier = Modifier.matchParentSize(),
            )
        }
    } else {
        Box(modifier.background(Brush.linearGradient(listOf(AniColors.Accent.copy(alpha = 0.45f), AniColors.SurfaceHigh))).padding(10.dp)) {
            Icon(Icons.Rounded.MenuBook, null, tint = Color.White.copy(alpha = 0.6f), modifier = Modifier.size(20.dp))
            Text(title, color = Color.White.copy(alpha = 0.88f), fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.bodySmall, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.align(Alignment.BottomStart).padding(bottom = 26.dp))
        }
    }
}

@Composable
fun NovelCardView(novel: NovelCard, onOpen: OpenNovel, width: Int? = POSTER_WIDTH, badge: String? = null) {
    val outer = if (width != null) Modifier.width(width.dp) else Modifier.fillMaxWidth()
    Column(outer.clip(RoundedCornerShape(12.dp)).clickable { onOpen(novel.source, novel.id) }) {
        Box {
            NovelCover(novel.cover, novel.title, Modifier.fillMaxWidth().aspectRatio(1f / POSTER_RATIO).clip(RoundedCornerShape(12.dp)))
            if (novel.status == "completed") Tag("Complete", Modifier.align(Alignment.TopStart).padding(6.dp), tone = TagTone.Glass)
            if (novel.mtl) Tag("MTL", Modifier.align(Alignment.TopStart).padding(6.dp), tone = TagTone.Glass)
            novel.rating?.let { ScoreBadge("%.1f".format(it), Modifier.align(Alignment.TopEnd).padding(6.dp), onImage = true) }
            (badge ?: novel.chapters?.let { "$it ch" })?.let {
                Tag(it, Modifier.align(Alignment.BottomStart).padding(6.dp), tone = if (badge != null) TagTone.Accent else TagTone.Glass)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(novel.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = AniColors.Text)
        val meta = novel.genres.take(2).joinToString(" · ")
        if (meta.isNotEmpty()) {
            Spacer(Modifier.height(2.dp))
            Text(meta, style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** The top bar's search in novels mode: opens the Search tab (results come from the chosen source). */
@Composable
internal fun NovelSearchPill(modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier.height(40.dp).clip(RoundedCornerShape(50)).background(AniColors.SurfaceHigh)
            .border(1.dp, AniColors.BorderSoft, RoundedCornerShape(50))
            .clickable(onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Search, null, tint = AniColors.TextTertiary, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Search novels…", color = AniColors.TextTertiary, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
    }
}

// ── Home ──────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NovelHomeScreen(onOpen: OpenNovel, onRead: () -> Unit, onBrowseGenre: (String) -> Unit, toggle: @Composable (Modifier) -> Unit) {
    var home by remember { mutableStateOf<NovelHome?>(null) }
    var failed by remember { mutableStateOf<String?>(null) }
    var reading by remember { mutableStateOf<List<NovelStore.ReadingRow>>(emptyList()) }
    var updates by remember { mutableStateOf<List<NovelSources.Update>>(emptyList()) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        reading = runCatching { NovelStore.continueReading() }.getOrDefault(emptyList())
        // Continue Reading follows other devices: reconcile, and repaint when that changed anything.
        if (runCatching { com.sanjay.anitrack.next.data.GistSync.syncNovelReading() }.getOrDefault(false)) {
            reading = runCatching { NovelStore.continueReading() }.getOrDefault(reading)
        }
        // New chapters are checked on the slow lane and cached for a while.
        updates = runCatching { NovelSources.updates() }.getOrDefault(emptyList())
    }
    LaunchedEffect(Unit) {
        runCatching { NovelSources.home() }.onSuccess { home = it }.onFailure { failed = it.novelMessage() }
    }
    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820
    /** Straight back into a chapter, from the saved title page and list. */
    val resume: (NovelStore.ReadingRow) -> Unit = { row ->
        if (row.finished) onOpen(row.source, row.titleId)
        else scope.launch {
            val saved = NovelSources.saved(row.source, row.titleId)
            val chapters = saved?.second.orEmpty()
            val chapter = chapters.firstOrNull { it.id == row.chapterId }
            if (saved != null && chapter != null && NovelReading.open(saved.first, chapters, chapter, row.paragraph)) onRead()
            else onOpen(row.source, row.titleId)
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 28.dp)) {
        item(key = "hero") {
            Box(Modifier.fillMaxWidth()) {
                val heroes = home?.trending.orEmpty().take(HERO_COUNT)
                if (heroes.isNotEmpty()) NovelHeroCarousel(heroes, reading, onOpen, resume, wide)
                else if (failed == null) SkeletonBox(Modifier.fillMaxWidth().height(380.dp), corner = 0.dp)
                else Spacer(Modifier.height(110.dp))
                toggle(Modifier.align(Alignment.TopStart).padding(16.dp))
            }
        }
        if (reading.isNotEmpty()) {
            item(key = "continue-header") { SectionHeader("Continue Reading") }
            item(key = "continue-row") {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(reading, key = { "${it.source.key}:${it.titleId}" }) { row ->
                        val fresh = updates.firstOrNull { it.source == row.source && it.titleId == row.titleId }?.newCount ?: 0
                        Column(Modifier.width(POSTER_WIDTH.dp).clip(RoundedCornerShape(12.dp)).clickable { resume(row) }) {
                            Box {
                                NovelCover(row.cover, row.title, Modifier.fillMaxWidth().aspectRatio(1f / POSTER_RATIO).clip(RoundedCornerShape(12.dp)))
                                Box(Modifier.matchParentSize().clip(RoundedCornerShape(12.dp)).background(BottomScrim))
                                if (fresh > 0) Tag("+$fresh NEW", Modifier.align(Alignment.TopStart).padding(8.dp), tone = TagTone.SuccessSolid)
                                else Tag(row.chapterLabel.uppercase(), Modifier.align(Alignment.TopStart).padding(8.dp), tone = TagTone.Accent)
                                GlassIconButton(Icons.Rounded.Close, "Remove from Continue Reading", {
                                    scope.launch { NovelStore.forget(row.source, row.titleId); com.sanjay.anitrack.next.data.GistSync.novelRemoved(); reading = NovelStore.continueReading() }
                                }, Modifier.align(Alignment.TopEnd).padding(6.dp), size = 26.dp)
                                if (row.paragraphCount > 0) {
                                    ProgressStrip(if (row.finished) 1f else (row.paragraph + 1f) / row.paragraphCount,
                                        Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(10.dp))
                                }
                            }
                            Spacer(Modifier.height(8.dp))
                            Text(row.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, color = AniColors.Text)
                            Text(
                                if (fresh > 0) "${row.chapterLabel} · $fresh new" else if (row.finished) "${row.chapterLabel} read"
                                else "${row.chapterLabel} · ${((row.paragraph + 1) * 100 / row.paragraphCount.coerceAtLeast(1))}%",
                                style = MaterialTheme.typography.labelSmall, color = if (fresh > 0) Color(0xFF34D399) else AniColors.TextTertiary,
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
        item(key = "genres") {
            Column {
                SectionHeader("Browse by genre")
                FlowRow(
                    Modifier.padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    HOME_GENRES.forEach { genre ->
                        Text(
                            genre,
                            color = AniColors.TextSecondary,
                            style = MaterialTheme.typography.labelLarge,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.05f))
                                .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(50))
                                .clickable { onBrowseGenre(genre) }.padding(horizontal = 16.dp, vertical = 9.dp),
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
        val h = home
        if (h == null) {
            item(key = "loading") {
                if (failed != null) EmptyState(Icons.Rounded.CloudOff, "Couldn't load novels", "$failed Check your connection and reopen Home.")
                else Column { SectionHeader("Trending now"); RowPlaceholder() }
            }
        } else {
            novelSection("Trending now", h.trending.drop(HERO_COUNT), onOpen)
            novelSection("Recently updated", h.latest, onOpen)
            novelSection("Fan favourites", h.favourites, onOpen)
            novelSection("Most read", h.popular, onOpen)
            novelSection("Finished series", h.completed, onOpen)
        }
    }
}

/** The top of Home: the most-read novels right now, one at a time, with their blurbs. */
@Composable
private fun NovelHeroCarousel(
    items: List<NovelCard>,
    reading: List<NovelStore.ReadingRow>,
    onOpen: OpenNovel,
    onContinue: (NovelStore.ReadingRow) -> Unit,
    wide: Boolean,
) {
    val pager = rememberPagerState(pageCount = { items.size })
    LaunchedEffect(pager) {
        while (true) {
            delay(8000)
            runCatching { pager.animateScrollToPage((pager.currentPage + 1) % items.size) }
        }
    }
    Box {
        HorizontalPager(state = pager) { page ->
            val hero = items[page]
            val inProgress = reading.firstOrNull { it.source == hero.source && it.titleId == hero.id }
            Box(Modifier.fillMaxWidth().height(if (wide) 460.dp else 420.dp).background(AniColors.Bg).clickable { onOpen(hero.source, hero.id) }) {
                // The cover, blurred, tints the whole banner.
                if (hero.cover != null) PosterImage(hero.cover, null, Modifier.fillMaxSize().blur(48.dp))
                Box(Modifier.matchParentSize().background(Brush.horizontalGradient(listOf(AniColors.Bg, AniColors.Bg.copy(alpha = 0.86f), AniColors.Bg.copy(alpha = 0.4f)))))
                Box(Modifier.matchParentSize().background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to AniColors.Bg)))
                Row(
                    Modifier.fillMaxSize().padding(start = 24.dp, end = 28.dp, top = 110.dp, bottom = 38.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    Column(Modifier.weight(1f)) {
                        Tag("#${page + 1} TRENDING NOVEL", tone = TagTone.Accent, icon = Icons.Rounded.LocalFireDepartment)
                        Spacer(Modifier.height(10.dp))
                        Text(hero.title, style = if (wide) MaterialTheme.typography.headlineLarge else MaterialTheme.typography.headlineMedium,
                            maxLines = 2, overflow = TextOverflow.Ellipsis, color = Color.White)
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            hero.rating?.let { ScoreBadge("%.1f".format(it)) }
                            Text(
                                metaLine(statusLabel(hero.status), hero.chapters?.let { "%,d chapters".format(it) }, hero.genres.take(3).joinToString(" · ").ifBlank { null }),
                                style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.72f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                        hero.synopsis?.let {
                            Spacer(Modifier.height(10.dp))
                            Text(it, style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.72f),
                                maxLines = if (wide) 3 else 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 640.dp))
                        }
                        Spacer(Modifier.height(18.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (inProgress != null) PillButton("Continue · ${inProgress.chapterLabel}", { onContinue(inProgress) }, icon = Icons.Rounded.AutoStories, style = PillStyle.Primary)
                            else PillButton("Start reading", { onOpen(hero.source, hero.id) }, icon = Icons.Rounded.AutoStories, style = PillStyle.Light)
                            PillButton("Details", { onOpen(hero.source, hero.id) }, icon = Icons.Rounded.Info, style = PillStyle.Tonal)
                        }
                    }
                    if (wide) {
                        Spacer(Modifier.width(32.dp))
                        NovelCover(hero.cover, hero.title, Modifier.padding(bottom = 18.dp).width(190.dp).aspectRatio(1f / POSTER_RATIO).rotate(2f).clip(RoundedCornerShape(16.dp)))
                    }
                }
            }
        }
        HeroDots(items.size, pager.currentPage, Modifier.align(Alignment.BottomEnd).padding(end = 28.dp, bottom = 16.dp))
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.novelSection(title: String, list: List<NovelCard>, onOpen: OpenNovel) {
    if (list.isEmpty()) return
    item(key = "$title-header") { SectionHeader(title) }
    item(key = "$title-row") {
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            items(list, key = { it.id }) { NovelCardView(it, onOpen) }
        }
    }
}

// ── Search ────────────────────────────────────────────────────────────────────

private val NOVEL_STATUSES = listOf("Any status" to null, "Ongoing" to "ongoing", "Completed" to "completed")

@Composable
fun NovelSearchScreen(initialQuery: String = "", initialGenre: String? = null, onOpen: OpenNovel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val prefs = remember { context.getSharedPreferences("anitrack_next", android.content.Context.MODE_PRIVATE) }
    var source by remember { mutableStateOf(NovelSourceId.of(prefs.getString("novel_source", null)) ?: NovelSourceId.NovelBuddy) }
    var query by remember { mutableStateOf(initialQuery) }
    var genre by remember { mutableStateOf(initialGenre?.takeIf { it in NovelGenres.all }) }
    var status by remember { mutableStateOf<String?>(null) }
    var sort by remember { mutableStateOf(NovelSort.Popular) }
    var page by remember { mutableIntStateOf(1) }
    var hasNext by remember { mutableStateOf(false) }
    var results by remember { mutableStateOf<List<NovelCard>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }
    var showMtl by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }

    LaunchedEffect(reload, page, source) {
        searching = true
        error = null
        runCatching { NovelSources.search(source, NovelFilters(query, genre, status, sort, page)) }
            .onSuccess { results = it.items; hasNext = it.hasNext }
            .onFailure { results = emptyList(); error = it.novelMessage() }
        searching = false
    }
    val apply: () -> Unit = { page = 1; reload++ }
    val shown = if (showMtl) results else results.filter { !it.mtl }
    val mtlCount = results.count { it.mtl }

    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 20.dp)) {
        ScreenHeader("Browse novels", subtitle = "${source.label}: ${source.blurb}", icon = Icons.Rounded.MenuBook)
        Spacer(Modifier.height(14.dp))
        PillTabs(
            NovelSourceId.entries.map { it.key to it.label },
            selected = source.key,
            onSelect = { key ->
                NovelSourceId.of(key)?.let { source = it; page = 1; prefs.edit().putString("novel_source", it.key).apply() }
            },
        )
        Spacer(Modifier.height(14.dp))
        AniCard(padding = PaddingValues(16.dp)) {
            @OptIn(ExperimentalLayoutApi::class)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                FilterSearchField(query, { query = it }, "Search novels…", onSearch = apply)
                FilterDropdown("Select genre", genre, listOf("Select genre" to null) + NovelGenres.all.map { it to it }) { genre = it; apply() }
                FilterDropdown("Select status", NOVEL_STATUSES.firstOrNull { it.second == status }?.first?.takeIf { status != null }, NOVEL_STATUSES) { status = it; apply() }
                FilterDropdown("Popular", sort.label.takeIf { sort != NovelSort.Popular }, NovelSort.entries.map { it.label to it }) { sort = it; apply() }
                PillButton("Search", apply, icon = Icons.Rounded.Search, style = PillStyle.Primary)
                if (mtlCount > 0) {
                    PillButton(if (showMtl) "Hide machine translations" else "Show machine translations ($mtlCount)", { showMtl = !showMtl }, style = PillStyle.Ghost)
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        when {
            searching && results.isEmpty() ->
                LinearProgressIndicator(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)), color = AniColors.Accent, trackColor = AniColors.SurfaceHigh)
            error != null -> EmptyState(Icons.Rounded.CloudOff, "${source.label} didn't answer", "$error Try again, or switch to the other source.", actionLabel = "Retry", onAction = apply)
            !searching && shown.isEmpty() -> EmptyState(Icons.Rounded.SearchOff, "No results", "Nothing matches on ${source.label}. Try fewer filters, another spelling, or the other source.")
        }
        LazyVerticalGrid(
            columns = GridCells.Adaptive(140.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
            modifier = Modifier.weight(1f),
        ) {
            items(shown, key = { it.id }) { NovelCardView(it, onOpen, width = null) }
            if (shown.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                PageControls(page, hasNext, onPrevious = { page-- }, onNext = { page++ })
            }
        }
    }
}

// ── My List ───────────────────────────────────────────────────────────────────

@Composable
fun NovelListScreen(onOpen: OpenNovel, onBrowse: () -> Unit) {
    var tab by remember { mutableStateOf("all") }
    var rows by remember { mutableStateOf<List<NovelStore.ListRow>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        rows = runCatching { NovelStore.list() }.getOrDefault(emptyList())
        loaded = true
        // The list follows other devices.
        if (runCatching { com.sanjay.anitrack.next.data.GistSync.syncNovelReading() }.getOrDefault(false)) rows = runCatching { NovelStore.list() }.getOrDefault(rows)
    }
    val shown = if (tab == "all") rows else rows.filter { it.status == tab }
    Column(Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 20.dp)) {
        ScreenHeader(
            "My Novels",
            subtitle = if (rows.isEmpty()) "Novels you track appear here." else "${rows.size} ${if (rows.size == 1) "title" else "titles"} tracked",
            icon = Icons.Rounded.Bookmarks,
        )
        Spacer(Modifier.height(18.dp))
        PillTabs(
            listOf("all" to "All") + NovelStore.STATUSES.map { it to (NovelStore.STATUS_LABELS[it] ?: it) },
            selected = tab,
            onSelect = { tab = it },
            counts = mapOf("all" to rows.size) + NovelStore.STATUSES.associateWith { s -> rows.count { it.status == s } },
        )
        Spacer(Modifier.height(18.dp))
        if (loaded && shown.isEmpty()) {
            EmptyState(
                Icons.Rounded.BookmarkBorder,
                if (tab == "all") "Your novel list is empty" else "Nothing in ${NovelStore.STATUS_LABELS[tab] ?: tab} yet",
                "Use Add to list on a novel's page to keep track of what you're reading.",
                actionLabel = "Browse novels",
                onAction = onBrowse,
            )
        }
        LazyVerticalGrid(columns = GridCells.Adaptive(150.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            items(shown, key = { "${it.source.key}:${it.titleId}" }) { row ->
                ListPosterCard(
                    cover = row.cover, title = row.title,
                    status = row.status.takeIf { tab == "all" }, statusLabel = NovelStore.STATUS_LABELS[row.status],
                    score = null, badge = row.source.label.uppercase(),
                    onClick = { onOpen(row.source, row.titleId) },
                )
            }
        }
    }
}

// ── Title page ────────────────────────────────────────────────────────────────

private const val CHAPTER_PAGE = 100

/** Looking for this novel on another source. */
private sealed interface Finding {
    val target: NovelSourceId
    data class Searching(override val target: NovelSourceId) : Finding
    data class Pick(override val target: NovelSourceId, val items: List<NovelCard>) : Finding
    data class Message(override val target: NovelSourceId, val text: String) : Finding
}

/**
 * A novel's page on one source copy. The source chips switch to the same novel on
 * another source (found and linked by name and author, or picked by hand); progress
 * follows by chapter name, never by position.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NovelDetailScreen(source: NovelSourceId, titleId: String, onRead: () -> Unit, onOpen: OpenNovel, onSwitch: OpenNovel) {
    var detail by remember { mutableStateOf<NovelDetail?>(null) }
    var detailError by remember { mutableStateOf<String?>(null) }
    var chapters by remember { mutableStateOf<List<NovelChapter>?>(null) }
    var chaptersError by remember { mutableStateOf<String?>(null) }
    var stale by remember { mutableStateOf(false) }
    var progress by remember { mutableStateOf<Map<String, NovelProgress>>(emptyMap()) }
    var status by remember { mutableStateOf<String?>(null) }
    var group by remember { mutableStateOf<List<NovelStore.Member>>(emptyList()) }
    var finding by remember { mutableStateOf<Finding?>(null) }
    var newestFirst by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var limit by remember { mutableIntStateOf(CHAPTER_PAGE) }
    var expanded by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    var showDownloads by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val downloads = NovelDownloads.titles.firstOrNull { it.source == source && it.titleId == titleId }
    val savedIds = downloads?.savedIds.orEmpty()

    LaunchedEffect(source, titleId, attempt) {
        detailError = null; chaptersError = null
        NovelSources.saved(source, titleId)?.let { (d, list) ->
            if (detail == null) detail = d
            if (chapters == null && list.isNotEmpty()) { chapters = list; stale = true }
        }
        progress = runCatching { NovelStore.progressFor(source, titleId) }.getOrDefault(emptyMap())
        status = runCatching { NovelStore.statusOf(source, titleId) }.getOrNull()
        group = runCatching { NovelStore.group(source, titleId) }.getOrDefault(emptyList())
        runCatching { NovelSources.title(source, titleId) }
            .onSuccess {
                detail = it
                // Fetching the details may have linked this copy to one already known (shared with other devices).
                val before = group.size
                group = runCatching { NovelStore.group(source, titleId) }.getOrDefault(group)
                if (group.size != before) com.sanjay.anitrack.next.data.GistSync.novelReadingChanged()
                progress = runCatching { NovelStore.progressFor(source, titleId) }.getOrDefault(progress)
            }
            .onFailure { if (detail == null) detailError = it.novelMessage() }
        runCatching { NovelSources.chapters(source, titleId) }
            .onSuccess { list ->
                chapters = list
                stale = false
                runCatching { NovelSources.markSeen(source, titleId, list.size) }
            }
            .onFailure { if (chapters == null) chaptersError = it.novelMessage() else stale = true }
        // Progress, links and the list follow other devices.
        if (runCatching { com.sanjay.anitrack.next.data.GistSync.syncNovelReading() }.getOrDefault(false)) {
            progress = runCatching { NovelStore.progressFor(source, titleId) }.getOrDefault(progress)
            group = runCatching { NovelStore.group(source, titleId) }.getOrDefault(group)
            status = runCatching { NovelStore.statusOf(source, titleId) }.getOrNull()
        }
    }
    // Read marks follow the reader.
    val session by NovelReading.current
    LaunchedEffect(session?.index) { progress = runCatching { NovelStore.progressFor(source, titleId) }.getOrDefault(progress) }

    val d = detail
    if (d == null) {
        if (detailError != null) {
            EmptyState(Icons.Rounded.CloudOff, "${source.label} didn't answer", detailError!!, actionLabel = "Retry", onAction = { attempt++ })
        } else {
            Column(Modifier.padding(24.dp)) { SkeletonBox(Modifier.fillMaxWidth().height(260.dp)); Spacer(Modifier.height(16.dp)); SkeletonBox(Modifier.fillMaxWidth(0.6f).height(32.dp)) }
        }
        return
    }
    val list = chapters.orEmpty()
    val resume = remember(list, progress) { Novels.resumeTarget(list, progress, source) }
    val resumeIndex = resume?.let { r -> list.indexOfFirst { it.id == r.chapter.id } } ?: -1
    val started = progress.isNotEmpty()
    val elsewhere = progress.values.maxByOrNull { it.updatedAt }?.source?.takeIf { resume != null && resume.via != "same" && resume.via != "start" }
    val rows = remember(list, query, newestFirst) {
        val q = query.trim().lowercase().removePrefix("chapter").removePrefix("ch.").trim()
        val matched = if (q.isEmpty()) list else list.filter { it.label.lowercase().contains(q) }
        if (newestFirst) matched.asReversed() else matched
    }
    val open: (NovelChapter, Int, Float?) -> Unit = { chapter, paragraph, fraction -> if (NovelReading.open(d, list, chapter, paragraph, fraction)) onRead() }
    val save: (List<NovelChapter>) -> Unit = { picked -> scope.launch { NovelDownloads.enqueue(d, picked, list) } }
    val switchTo: (NovelSourceId) -> Unit = { target ->
        val member = group.firstOrNull { it.source == target }
        if (member != null) onSwitch(member.source, member.id)
        else scope.launch {
            finding = Finding.Searching(target)
            finding = runCatching { NovelSources.findOn(d, target) }.fold(
                onSuccess = { found ->
                    when (found) {
                        is NovelSources.FindResult.Linked -> { com.sanjay.anitrack.next.data.GistSync.novelReadingChanged(); onSwitch(found.member.source, found.member.id); null }
                        is NovelSources.FindResult.Candidates -> Finding.Pick(target, found.items)
                        NovelSources.FindResult.None -> Finding.Message(target, "${target.label} doesn't seem to have this novel.")
                    }
                },
                onFailure = { Finding.Message(target, it.novelMessage()) },
            )
        }
    }
    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 32.dp)) {
        item(key = "head") {
            Box(Modifier.fillMaxWidth()) {
                PosterImage(d.card.cover, null, Modifier.fillMaxWidth().height(280.dp).blur(32.dp))
                Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.45f), AniColors.Bg))))
                Row(Modifier.padding(start = 24.dp, end = 24.dp, top = 40.dp), verticalAlignment = Alignment.Bottom) {
                    NovelCover(d.card.cover, d.card.title, Modifier.width(if (wide) 170.dp else 120.dp).aspectRatio(1f / POSTER_RATIO).clip(RoundedCornerShape(14.dp)))
                    Spacer(Modifier.width(20.dp))
                    Column(Modifier.weight(1f)) {
                        Text(d.card.title, style = MaterialTheme.typography.headlineMedium, color = Color.White, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        val by = metaLine(d.author?.let { "by $it" }, d.altNames.take(2).joinToString(" · ").ifBlank { null })
                        if (by.isNotEmpty()) Text(by, style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary, maxLines = 2)
                        Spacer(Modifier.height(10.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            d.card.rating?.let { ScoreBadge("%.1f".format(it)) }
                            statusLabel(d.card.status)?.let { Tag(it) }
                            (list.size.takeIf { it > 0 } ?: d.card.chapters)?.let { Tag("%,d chapters".format(it)) }
                            if (d.card.mtl) Tag("MTL", tone = TagTone.Outline)
                        }
                        Spacer(Modifier.height(14.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            resume?.let { r ->
                                PillButton("${if (started) "Continue" else "Start reading"} · ${r.chapter.label}", { open(r.chapter, r.paragraph, r.fraction) },
                                    icon = Icons.Rounded.AutoStories, style = PillStyle.Primary)
                            }
                            StatusMenuButton(
                                status, NovelStore.STATUS_LABELS,
                                onPick = { key -> scope.launch { NovelStore.setStatus(source, titleId, key, d.card.title, d.card.cover); status = key; com.sanjay.anitrack.next.data.GistSync.novelReadingChanged() } },
                                onRemove = { scope.launch { NovelStore.setStatus(source, titleId, null, d.card.title, d.card.cover); status = null; com.sanjay.anitrack.next.data.GistSync.novelRemoved() } },
                            )
                            if (list.isNotEmpty()) {
                                val busy = (downloads?.queued ?: 0) > 0
                                PillButton(
                                    when {
                                        busy -> "Saving · ${downloads!!.queued} left"
                                        (downloads?.saved ?: 0) > 0 -> "${downloads!!.saved} offline"
                                        else -> "Download"
                                    },
                                    { showDownloads = true },
                                    icon = if (busy) Icons.Rounded.Downloading else Icons.Rounded.Download, style = PillStyle.Tonal,
                                )
                            }
                        }
                        if (elsewhere != null && resume != null) {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                if (resume.via == "label") "Picks up where you left off on ${elsewhere.label} (matched by chapter name)."
                                else "${elsewhere.label}'s chapter isn't on ${source.label}, so this continues from the next one here.",
                                style = MaterialTheme.typography.labelMedium, color = AniColors.TextTertiary,
                            )
                        }
                    }
                }
            }
        }
        if (d.card.genres.isNotEmpty()) item(key = "genres") {
            Text(d.card.genres.joinToString("  ·  "), style = MaterialTheme.typography.bodySmall, color = AniColors.TextSecondary, modifier = Modifier.padding(horizontal = 24.dp, vertical = 6.dp))
        }
        d.synopsis?.let { synopsis ->
            item(key = "synopsis") {
                Text(synopsis, style = MaterialTheme.typography.bodyMedium, color = AniColors.TextSecondary, maxLines = if (expanded) Int.MAX_VALUE else 4,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp).clickable { expanded = !expanded })
            }
        }
        item(key = "chapters-header") {
            Column(Modifier.padding(start = 24.dp, end = 24.dp, top = 18.dp, bottom = 8.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Chapters", style = MaterialTheme.typography.titleLarge, color = AniColors.Text)
                    Spacer(Modifier.width(14.dp))
                    // One novel, read from whichever copy works.
                    Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        NovelSourceId.entries.forEach { s ->
                            val on = s == source
                            val linked = on || group.any { it.source == s }
                            val busy = (finding as? Finding.Searching)?.target == s
                            Row(
                                Modifier.clip(RoundedCornerShape(50))
                                    .background(if (on) AniColors.AccentSoft else Color.White.copy(alpha = 0.05f))
                                    .border(1.dp, if (on) AniColors.Accent.copy(alpha = 0.5f) else Color.White.copy(alpha = 0.08f), RoundedCornerShape(50))
                                    .clickable(enabled = !on) { switchTo(s) }
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                if (busy) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = AniColors.Accent)
                                else Icon(if (linked) Icons.Rounded.Link else Icons.Rounded.Search, null, tint = if (on) AniColors.Accent else AniColors.TextTertiary, modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(s.label, style = MaterialTheme.typography.labelLarge, color = if (on) Color.White else AniColors.TextSecondary, fontWeight = if (on) FontWeight.Bold else FontWeight.Medium)
                            }
                        }
                        if (group.size > 1) {
                            Text(
                                "Unlink", style = MaterialTheme.typography.labelMedium, color = AniColors.TextTertiary,
                                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable {
                                    scope.launch {
                                        NovelStore.unlink(source, titleId)
                                        com.sanjay.anitrack.next.data.GistSync.novelReadingChanged()
                                        group = NovelStore.group(source, titleId)
                                        progress = NovelStore.progressFor(source, titleId)
                                    }
                                }.padding(6.dp),
                            )
                        }
                    }
                    if (list.isNotEmpty()) {
                        FilterSearchField(query, { query = it; limit = CHAPTER_PAGE }, "Find chapter", onSearch = {})
                        Spacer(Modifier.width(8.dp))
                        PillButton(if (newestFirst) "Newest first" else "Oldest first", { newestFirst = !newestFirst }, icon = Icons.Rounded.SwapVert, style = PillStyle.Ghost, compact = true)
                    }
                }
                when (val f = finding) {
                    is Finding.Pick -> AniCard(Modifier.padding(top = 12.dp), padding = PaddingValues(14.dp)) {
                        Text("Which of these is \"${d.card.title}\" on ${f.target.label}?", style = MaterialTheme.typography.labelLarge, color = AniColors.Text)
                        Spacer(Modifier.height(10.dp))
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(f.items, key = { it.id }) { card ->
                                NovelCardView(card, { s, id ->
                                    scope.launch {
                                        NovelStore.link(source, titleId, s, id)
                                        com.sanjay.anitrack.next.data.GistSync.novelReadingChanged()
                                        onSwitch(s, id)
                                    }
                                }, width = 110)
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Picking one links it to this novel: your progress carries over by chapter name.", style = MaterialTheme.typography.labelMedium, color = AniColors.TextTertiary, modifier = Modifier.weight(1f))
                            PillButton("None of these", { finding = null }, style = PillStyle.Ghost, compact = true)
                        }
                    }
                    is Finding.Message -> Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(f.text, style = MaterialTheme.typography.labelMedium, color = Color(0xFFFCD34D), modifier = Modifier.weight(1f))
                        PillButton("OK", { finding = null }, style = PillStyle.Ghost, compact = true)
                    }
                    else -> Unit
                }
                Spacer(Modifier.height(8.dp))
                val note = when {
                    chaptersError != null -> "$chaptersError You can try the other source above."
                    stale -> "Showing the list saved last time."
                    list.isNotEmpty() -> "%,d chapters on %s".format(list.size, source.label) + if (savedIds.isNotEmpty()) " · %,d saved offline".format(savedIds.size) else ""
                    else -> null
                }
                note?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = if (stale || chaptersError != null) Color(0xFFFCD34D) else AniColors.TextTertiary) }
                if (chaptersError != null) PillButton("Retry", { attempt++ }, icon = Icons.Rounded.Refresh, style = PillStyle.Tonal, modifier = Modifier.padding(top = 12.dp))
                if (chapters == null && chaptersError == null) Column(Modifier.padding(top = 12.dp)) { repeat(5) { SkeletonBox(Modifier.fillMaxWidth().height(44.dp)); Spacer(Modifier.height(6.dp)) } }
            }
        }
        items(rows.take(limit), key = { it.id }) { chapter ->
            val state = Novels.progressFor(progress, chapter)
            val done = state?.finished == true
            val current = state != null && !done
            val here = current && state!!.source == source && state.chapterId == chapter.id
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 18.dp).clip(RoundedCornerShape(10.dp))
                    .clickable {
                        open(chapter, if (here) state!!.paragraph else 0,
                            if (current && !here && state!!.paragraphCount > 0) state.paragraph.toFloat() / state.paragraphCount else null)
                    }
                    .padding(horizontal = 8.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("${chapter.order + 1}", style = MaterialTheme.typography.labelMedium, color = if (current) AniColors.Accent else AniColors.TextTertiary, modifier = Modifier.width(52.dp))
                Text(chapter.label, style = MaterialTheme.typography.bodyMedium, color = if (done) AniColors.TextTertiary else AniColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (current && state!!.paragraphCount > 0) {
                    Text("${(state.paragraph + 1) * 100 / state.paragraphCount}%", style = MaterialTheme.typography.labelMedium, color = AniColors.Accent)
                    Spacer(Modifier.width(10.dp))
                }
                NovelChapterDownload(
                    when {
                        chapter.id in savedIds -> ChapterSave.Saved
                        downloads?.currentId == chapter.id -> ChapterSave.Saving
                        downloads?.queuedIds?.contains(chapter.id) == true -> ChapterSave.Queued
                        downloads?.failedIds?.contains(chapter.id) == true -> ChapterSave.Failed
                        else -> ChapterSave.None
                    },
                ) { save(listOf(chapter)) }
                IconButton(onClick = {
                    scope.launch {
                        NovelStore.mark(source, titleId, listOf(chapter), !done, d.card.title, d.card.cover)
                        if (done) com.sanjay.anitrack.next.data.GistSync.novelRemoved() else com.sanjay.anitrack.next.data.GistSync.novelReadingChanged()
                        progress = NovelStore.progressFor(source, titleId)
                    }
                }, modifier = Modifier.size(34.dp)) {
                    Icon(Icons.Rounded.Check, if (done) "Mark as unread" else "Mark as read", tint = if (done) Color(0xFF34D399) else Color.White.copy(alpha = 0.25f))
                }
            }
        }
        if (rows.size > limit) item(key = "more") {
            PillButton("Show more (%,d left)".format(rows.size - limit), { limit += CHAPTER_PAGE * 3 }, style = PillStyle.Tonal, modifier = Modifier.padding(24.dp))
        }
        if (resumeIndex > 0) item(key = "mark-before") {
            PillButton("Mark everything before ${resume!!.chapter.label} read", {
                scope.launch {
                    NovelStore.mark(source, titleId, list.take(resumeIndex).filter { Novels.progressFor(progress, it)?.finished != true }, true, d.card.title, d.card.cover)
                    com.sanjay.anitrack.next.data.GistSync.novelReadingChanged()
                    progress = NovelStore.progressFor(source, titleId)
                }
            }, icon = Icons.Rounded.DoneAll, style = PillStyle.Ghost, modifier = Modifier.padding(horizontal = 24.dp))
        }
    }

    if (showDownloads) {
        NovelDownloadDialog(
            chapters = list,
            startIndex = resumeIndex.coerceAtLeast(0),
            saved = savedIds,
            state = downloads,
            onDownload = { picked -> save(picked); showDownloads = false },
            onStop = { scope.launch { NovelDownloads.cancel(source, titleId) } },
            onRemoveAll = { scope.launch { NovelDownloads.remove(source, titleId) }; showDownloads = false },
            onDismiss = { showDownloads = false },
        )
    }
}

internal enum class ChapterSave { None, Queued, Saving, Saved, Failed }

/** ↓ to save one chapter offline; waiting, saving, ✓ once saved, or retry — like manga's rows. */
@Composable
private fun NovelChapterDownload(state: ChapterSave, onSave: () -> Unit) {
    Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
        when (state) {
            ChapterSave.None -> IconButton(onClick = onSave) {
                Icon(Icons.Rounded.Download, "Save chapter offline", tint = AniColors.TextSecondary, modifier = Modifier.size(20.dp))
            }
            ChapterSave.Queued -> CircularProgressIndicator(color = Color.White.copy(alpha = 0.5f), strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            ChapterSave.Saving -> CircularProgressIndicator(color = AniColors.Accent, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            ChapterSave.Saved -> Icon(Icons.Rounded.DownloadDone, "Saved offline", tint = Color(0xFF34D399), modifier = Modifier.size(20.dp))
            ChapterSave.Failed -> IconButton(onClick = onSave) {
                Icon(Icons.Rounded.Refresh, "Couldn't save, retry", tint = Color(0xFFF87171), modifier = Modifier.size(20.dp))
            }
        }
    }
}
