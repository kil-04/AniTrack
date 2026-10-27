package com.sanjay.anitrack.next.ui

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.FormatListBulleted
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Timelapse
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.sanjay.anitrack.next.data.Db
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapters
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaReading
import com.sanjay.anitrack.next.data.manga.MangaSource
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.manga.MangaSpreads
import com.sanjay.anitrack.next.data.manga.MangaVerificationRequired
import com.sanjay.anitrack.next.data.manga.PageStrips
import com.sanjay.anitrack.next.data.manga.ReadState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

private val ReaderAccent: Color get() = AniColors.Accent

/** How pages are laid out. Auto reads Japanese manga as right-to-left pages and everything else as a vertical strip. */
internal enum class ReaderMode(val label: String) {
    Auto("Auto"),
    Vertical("Vertical scroll"),
    PagedLtr("Pages, left to right"),
    PagedRtl("Pages, right to left"),
}

/** Page modes: Auto shows two pages side by side whenever the screen is wider than tall. */
internal enum class ReaderSpread(val label: String) {
    Auto("Auto"),
    Single("One page"),
    Double("Two pages"),
}

internal enum class ReaderBackground(val label: String, val color: Color, val content: Color) {
    Black("Black", Color.Black, Color.White),
    Gray("Dark gray", Color(0xFF1C1C1F), Color.White),
    White("White", Color(0xFFF2F2F2), Color(0xFF1C1C1F)),
}

/** Page widths for vertical reading; null fills the screen width. */
private val ReaderWidths = listOf(720, 960, null)
private val ReaderWidthLabels = listOf("Narrow", "Medium", "Full")
private const val PREFETCH_AHEAD = 4

/** One vertical-list item: a whole page, or one slice of a long-strip page. */
private data class Segment(val page: Int, val rows: IntRange? = null, val lastSlice: Boolean = true)

private fun segmentsOf(pages: List<MangaPage>): List<Segment> = buildList {
    pages.forEachIndexed { index, page ->
        if (PageStrips.isTall(page.width, page.height)) {
            val slices = PageStrips.slices(page.height!!)
            slices.forEachIndexed { i, rows -> add(Segment(index, rows, i == slices.lastIndex)) }
        } else {
            add(Segment(index))
        }
    }
}

/** The layout Auto picks: strips scroll vertically; Japanese manga turns right to left. */
private fun effectiveMode(mode: ReaderMode, manga: Manga, pages: List<MangaPage>?): ReaderMode {
    if (mode != ReaderMode.Auto) return mode
    val strips = pages.orEmpty().any { p ->
        PageStrips.isTall(p.width, p.height) || (p.width != null && p.height != null && p.height > p.width * 2)
    }
    return when {
        strips -> ReaderMode.Vertical
        manga.country.equals("JP", ignoreCase = true) -> ReaderMode.PagedRtl
        else -> ReaderMode.Vertical
    }
}

/** A failure that a source's one-time browser check would fix. */
private fun Throwable.needsCheck(): Boolean =
    this is MangaVerificationRequired || (this is MangaSourceException && status == 403) ||
        (this is coil.network.HttpException && response.code == 403)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MangaReaderScreen(onBack: () -> Unit) {
    val session = MangaReading.current.value
    if (session == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val chapter = session.chapter
    val context = LocalContext.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }
    val prefs = remember { context.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE) }
    var mode by remember { mutableStateOf(runCatching { ReaderMode.valueOf(prefs.getString("reader_mode", null) ?: "") }.getOrDefault(ReaderMode.Auto)) }
    var widthIndex by remember { mutableIntStateOf(prefs.getInt("reader_width", 0).coerceIn(0, ReaderWidths.lastIndex)) }
    var background by remember { mutableStateOf(runCatching { ReaderBackground.valueOf(prefs.getString("reader_bg", null) ?: "") }.getOrDefault(ReaderBackground.Black)) }
    var volumeKeys by remember { mutableStateOf(prefs.getBoolean("reader_volume_keys", false)) }
    var spread by remember { mutableStateOf(runCatching { ReaderSpread.valueOf(prefs.getString("reader_spread", null) ?: "") }.getOrDefault(ReaderSpread.Auto)) }
    var spreadShift by remember { mutableStateOf(prefs.getBoolean("reader_spread_shift", false)) }
    val configuration = LocalConfiguration.current
    val landscape = configuration.screenWidthDp > configuration.screenHeightDp
    // Holds key focus so the volume keys reach the reader instead of changing the volume.
    val keyFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { keyFocus.requestFocus() } }

    var pages by remember(chapter.id) { mutableStateOf<List<MangaPage>?>(null) }
    var error by remember(chapter.id) { mutableStateOf<Throwable?>(null) }
    var attempt by remember(chapter.id) { mutableIntStateOf(0) }
    var blocked by remember(chapter.id, attempt) { mutableStateOf(false) }
    var chrome by remember { mutableStateOf(true) }
    var chaptersOpen by remember { mutableStateOf(false) }
    var settingsOpen by remember { mutableStateOf(false) }
    val connect = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (it.resultCode == android.app.Activity.RESULT_OK) attempt++
    }
    val displayed = remember(chapter.id, attempt) { mutableStateMapOf<Int, Boolean>() }
    LaunchedEffect(chapter.id, attempt) {
        error = null
        pages = null
        runCatching { MangaReading.pages(session) }
            .onSuccess { if (it.isEmpty()) error = MangaSourceException("This chapter has no pages.") else pages = it }
            .onFailure {
                if (it is CancellationException) throw it
                error = it
            }
    }

    val loaded = pages
    val effective = effectiveMode(mode, session.manga, loaded)
    val paged = effective == ReaderMode.PagedLtr || effective == ReaderMode.PagedRtl
    val rtl = effective == ReaderMode.PagedRtl
    val count = loaded?.size ?: 0
    val twoPage = paged && (spread == ReaderSpread.Double || (spread == ReaderSpread.Auto && landscape))
    // Page shapes learned from loaded images, for sources that don't report sizes.
    val wideSeen = remember(chapter.id) { mutableStateMapOf<Int, Boolean>() }
    // What one pager page shows: a single page, or a pair in two-page reading. Wide pages
    // found while reading split their pair in place; earlier pairs never change.
    val units by remember(loaded, twoPage, spreadShift) {
        derivedStateOf {
            val list = loaded.orEmpty()
            if (!twoPage) list.indices.map { listOf(it) }
            else MangaSpreads.of(list.size, spreadShift) { i ->
                val w = list[i].width
                val h = list[i].height
                if (w != null && h != null) w > h else wideSeen[i] == true
            }
        }
    }
    fun unitOf(page: Int) = units.indexOfFirst { page in it }.coerceAtLeast(0)
    val segments = remember(loaded) { loaded?.let(::segmentsOf).orEmpty() }
    // Where a (re)built layout starts: the resume page, or the page shown before a mode switch.
    var resumePage by remember(chapter.id) { mutableIntStateOf(session.startPage) }
    val listState = remember(chapter.id, segments, paged) {
        LazyListState(segments.indexOfFirst { it.page == resumePage }.coerceAtLeast(0))
    }
    val pagerState = remember(chapter.id, count, paged, twoPage, spreadShift) {
        androidx.compose.foundation.pager.PagerState(currentPage = unitOf(resumePage)) { units.size + 1 }
    }
    // The page on screen (the first of a pair), in either layout.
    val currentPage by remember(paged, segments, count, listState, pagerState) {
        derivedStateOf {
            if (paged) units.getOrNull(pagerState.currentPage)?.first() ?: (count - 1).coerceAtLeast(0)
            else segments.getOrNull(listState.firstVisibleItemIndex)?.page ?: 0
        }
    }
    // Rebuilt layouts (one/two pages, rotation, mode) start from the page last shown.
    LaunchedEffect(pagerState, listState, count) {
        if (count == 0) return@LaunchedEffect
        snapshotFlow { currentPage }.collect { resumePage = it }
    }
    val onBlocked: () -> Unit = { if (session.source.connectionActivity != null) blocked = true }

    fun jumpTo(page: Int) {
        scope.launch {
            if (paged) pagerState.scrollToPage(unitOf(page.coerceIn(0, (count - 1).coerceAtLeast(0))))
            else segments.indexOfFirst { it.page == page }.takeIf { it >= 0 }?.let { listState.scrollToItem(it) }
        }
    }

    /** One step in reading order: a page when paged, most of a screen when scrolling. */
    fun turn(forward: Boolean) {
        scope.launch {
            if (paged) pagerState.animateScrollToPage((pagerState.currentPage + if (forward) 1 else -1).coerceIn(0, units.size))
            else listState.animateScrollBy(listState.layoutInfo.viewportSize.height * 0.85f * if (forward) 1f else -1f)
        }
    }

    // Progress: the last page shown counts as read; saved shortly after reading settles.
    LaunchedEffect(chapter.id, segments, listState, paged) {
        if (count == 0 || paged) return@LaunchedEffect
        snapshotFlow {
            listState.layoutInfo.visibleItemsInfo
                .mapNotNull { segments.getOrNull(it.index) }
                .lastOrNull { displayed[it.page] == true }?.page
        }.distinctUntilChanged().collectLatest { page ->
            if (page == null) return@collectLatest
            delay(600)
            MangaReading.save(session, page, count)
        }
    }
    LaunchedEffect(chapter.id, count, paged, pagerState) {
        if (count == 0 || !paged) return@LaunchedEffect
        // Observe image completion too: a page can load after the pager settles.
        snapshotFlow {
            pagedReaderSavePage(pagerState.settledPage, units, count) { displayed[it] == true }
        }.distinctUntilChanged().collectLatest { page ->
            if (page == null) return@collectLatest
            delay(600)
            MangaReading.save(session, page, count)
        }
    }
    // Warm the disk cache a few pages ahead, and fetch the next chapter's pages near the end.
    LaunchedEffect(chapter.id, loaded, paged, twoPage) {
        val list = loaded ?: return@LaunchedEffect
        snapshotFlow { currentPage }.distinctUntilChanged().collectLatest { first ->
            for ((offset, page) in list.drop(first + 1).take(if (twoPage) PREFETCH_AHEAD * 2 else PREFETCH_AHEAD).withIndex()) {
                val index = first + 1 + offset
                val image = try { session.source.resolvePage(page) }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { break } // Stop after a rejection; visible pages offer a retry.
                if (PageStrips.isTall(image.width, image.height)) {
                    runCatching { PageStrips.file(image) }.onFailure { if (it is CancellationException) throw it }
                    continue
                }
                val request = pageRequest(context, image).newBuilder().memoryCachePolicy(CachePolicy.DISABLED).size(64).build()
                if (twoPage && (image.width == null || image.height == null) && index !in wideSeen) {
                    // Learn its shape before it's on screen, so a wide page never shows squeezed into a pair.
                    context.imageLoader.execute(request).drawable?.let { d ->
                        if (d.intrinsicWidth > 0 && d.intrinsicHeight > 0) wideSeen[index] = d.intrinsicWidth > d.intrinsicHeight
                    }
                } else {
                    context.imageLoader.enqueue(request)
                }
            }
            if (first >= list.size - 3 && session.hasNext) {
                runCatching { MangaReading.pages(session, session.chapters[session.index + 1]) }
                    .onFailure { if (it is CancellationException) throw it }
            }
        }
    }

    Box(
        Modifier.fillMaxSize().background(background.color)
            .focusRequester(keyFocus)
            .focusable()
            .onPreviewKeyEvent { event ->
                if (!volumeKeys || count == 0) return@onPreviewKeyEvent false
                val forward = when (event.nativeKeyEvent.keyCode) {
                    android.view.KeyEvent.KEYCODE_VOLUME_DOWN -> true
                    android.view.KeyEvent.KEYCODE_VOLUME_UP -> false
                    else -> return@onPreviewKeyEvent false
                }
                if (event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 0) turn(forward)
                true
            },
    ) {
        when {
            error != null -> ReaderMessage(
                error?.message ?: "Couldn't load this chapter.",
                content = background.content,
                onRetry = { attempt++ },
                connectLabel = session.source.connectionActivity?.let { "Connect ${session.source.label}" }
                    ?.takeIf { error?.needsCheck() == true },
                onConnect = { session.source.connectionActivity?.let { connect.launch(android.content.Intent(context, it)) } },
            )
            loaded == null -> CircularProgressIndicator(color = ReaderAccent, modifier = Modifier.align(Alignment.Center))
            paged -> HorizontalPager(
                state = pagerState,
                reverseLayout = rtl,
                beyondViewportPageCount = 1,
                key = { if (it < units.size) "${chapter.id}:${units[it].first()}" else "${chapter.id}:end" },
                modifier = Modifier.fillMaxSize(),
            ) { index ->
                if (index >= units.size) {
                    Box(Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { chrome = !chrome } }, contentAlignment = Alignment.Center) {
                        ChapterEnd(chapter.number, session.hasNext, background.content) { MangaReading.step(1) }
                    }
                } else {
                    ZoomablePage(
                        onTap = { position, size ->
                            val third = size.width / 3f
                            val forward = when {
                                position.x < third -> effective == ReaderMode.PagedRtl
                                position.x > size.width - third -> effective != ReaderMode.PagedRtl
                                else -> null
                            }
                            if (forward == null) chrome = !chrome else turn(forward)
                        },
                    ) {
                        val unit = units[index]
                        if (unit.size == 1) {
                            ReaderPage(
                                loaded[unit[0]], unit[0], session.source, Modifier.fillMaxSize(),
                                fit = true,
                                content = background.content,
                                onDisplayed = { displayed[unit[0]] = true },
                                onBlocked = onBlocked,
                                onSize = { w, h -> if (twoPage) wideSeen[unit[0]] = w > h },
                            )
                        } else {
                            // An open book: the pages meet in the middle, and right-to-left
                            // reading puts the earlier page on the right.
                            Row(Modifier.fillMaxSize()) {
                                (if (rtl) unit.reversed() else unit).forEachIndexed { side, page ->
                                    ReaderPage(
                                        loaded[page], page, session.source, Modifier.weight(1f).fillMaxHeight(),
                                        fit = true,
                                        content = background.content,
                                        onDisplayed = { displayed[page] = true },
                                        onBlocked = onBlocked,
                                        alignment = if (side == 0) Alignment.CenterEnd else Alignment.CenterStart,
                                        onSize = { w, h -> wideSeen[page] = w > h },
                                    )
                                }
                            }
                        }
                    }
                }
            }
            else -> {
                val maxWidth = ReaderWidths[widthIndex]
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize().pointerInput(Unit) { detectTapGestures { chrome = !chrome } },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    items(count = segments.size, key = { "${chapter.id}:${segments[it].page}:${segments[it].rows?.first ?: -1}" }) { item ->
                        val segment = segments[item]
                        val width = Modifier.then(if (maxWidth != null) Modifier.widthIn(max = maxWidth.dp) else Modifier).fillMaxWidth()
                        val rows = segment.rows
                        if (rows != null) {
                            StripSlice(
                                loaded[segment.page], segment.page, rows, session.source, width,
                                content = background.content,
                                onDisplayed = { if (segment.lastSlice) displayed[segment.page] = true },
                                onBlocked = onBlocked,
                            )
                        } else {
                            ReaderPage(
                                loaded[segment.page], segment.page, session.source, width,
                                fit = false,
                                content = background.content,
                                onDisplayed = { displayed[segment.page] = true },
                                onBlocked = onBlocked,
                            )
                        }
                    }
                    item(key = "${chapter.id}:end") {
                        ChapterEnd(chapter.number, session.hasNext, background.content) { MangaReading.step(1) }
                    }
                }
            }
        }

        // A page the source refused: offer its browser check instead of failing page by page.
        AnimatedVisibility(blocked, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopCenter).padding(top = 76.dp)) {
            Row(
                Modifier.padding(horizontal = 16.dp).clip(aniShape(14.dp)).background(AniColors.Surface)
                    .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "${session.source.label} needs a quick check to load pages.",
                    color = AniColors.Text,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.width(12.dp))
                PillButton(
                    "Connect ${session.source.label}",
                    { session.source.connectionActivity?.let { connect.launch(android.content.Intent(context, it)) } },
                    icon = Icons.Rounded.Link,
                    style = PillStyle.Primary,
                    compact = true,
                )
            }
        }

        AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopCenter)) {
            Row(
                Modifier.fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.92f), Color.Black.copy(alpha = 0.6f))))
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White)
                }
                Column(Modifier.weight(1f)) {
                    Text(session.manga.title, color = Color.White, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull("Chapter ${MangaChapters.label(chapter.number)}", chapter.title, chapter.group).joinToString(" · "),
                        color = Color.White.copy(alpha = 0.6f),
                        style = MaterialTheme.typography.labelMedium,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                // Background music keeps playing while reading; its controls ride along in the reader bar.
                BackgroundMusicBar(compact = true, onOpenSettings = {})
                Spacer(Modifier.width(8.dp))
                PillButton("Chapters", { chaptersOpen = true }, icon = Icons.AutoMirrored.Rounded.FormatListBulleted, compact = true)
                Spacer(Modifier.width(8.dp))
                PillButton(effective.label, { settingsOpen = true }, icon = Icons.Rounded.Tune, compact = true)
                Spacer(Modifier.width(8.dp))
            }
        }
        AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter)) {
            Row(
                Modifier.fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.6f), Color.Black.copy(alpha = 0.92f))))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PillButton("Previous", { MangaReading.step(-1) }, icon = Icons.AutoMirrored.Rounded.KeyboardArrowLeft, enabled = session.hasPrevious, compact = true)
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (count > 0) {
                        var dragging by remember(chapter.id) { mutableStateOf<Float?>(null) }
                        val shown = ((dragging?.toInt() ?: currentPage) + 1).coerceIn(1, count)
                        val pair = if (dragging == null && paged) units.getOrNull(pagerState.currentPage)?.takeIf { it.size == 2 } else null
                        Text(
                            if (pair != null) "Pages ${pair[0] + 1}–${pair[1] + 1} of $count" else "Page $shown of $count",
                            color = Color.White.copy(alpha = 0.85f),
                            style = MaterialTheme.typography.labelLarge,
                        )
                        if (count > 1) {
                            Slider(
                                value = dragging ?: currentPage.toFloat(),
                                onValueChange = { dragging = it },
                                onValueChangeFinished = {
                                    dragging?.let { jumpTo(it.toInt()) }
                                    dragging = null
                                },
                                valueRange = 0f..(count - 1).toFloat(),
                                colors = SliderDefaults.colors(
                                    thumbColor = ReaderAccent,
                                    activeTrackColor = ReaderAccent,
                                    inactiveTrackColor = Color.White.copy(alpha = 0.25f),
                                ),
                                modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth().height(28.dp)
                                    // Right-to-left reading runs the slider the same way as the pages.
                                    .graphicsLayer { scaleX = if (effective == ReaderMode.PagedRtl) -1f else 1f },
                            )
                        }
                    }
                }
                Spacer(Modifier.width(16.dp))
                PillButton("Next", { MangaReading.step(1) }, trailingIcon = Icons.AutoMirrored.Rounded.KeyboardArrowRight, enabled = session.hasNext, compact = true)
            }
        }

        ReaderPanel(chaptersOpen, "Chapters", onDismiss = { chaptersOpen = false }) {
            ChapterList(session) { index ->
                chaptersOpen = false
                MangaReading.jump(index)
            }
        }
        ReaderPanel(settingsOpen, "Reader settings", onDismiss = { settingsOpen = false }) {
            ReaderSettings(
                mode = mode,
                autoResolved = effectiveMode(ReaderMode.Auto, session.manga, loaded),
                widthIndex = widthIndex,
                background = background,
                onMode = {
                    resumePage = currentPage
                    mode = it
                    prefs.edit().putString("reader_mode", it.name).apply()
                },
                onWidth = { widthIndex = it; prefs.edit().putInt("reader_width", it).apply() },
                onBackground = { background = it; prefs.edit().putString("reader_bg", it.name).apply() },
                volumeKeys = volumeKeys,
                onVolumeKeys = { volumeKeys = it; prefs.edit().putBoolean("reader_volume_keys", it).apply() },
                spread = spread,
                onSpread = {
                    resumePage = currentPage
                    spread = it
                    prefs.edit().putString("reader_spread", it.name).apply()
                },
                spreadShift = spreadShift,
                onSpreadShift = {
                    resumePage = currentPage
                    spreadShift = it
                    prefs.edit().putBoolean("reader_spread_shift", it).apply()
                },
            )
        }
    }
}

/** A panel sliding in from the right over a scrim, inside the reader's own window. */
@Composable
private fun BoxScope.ReaderPanel(open: Boolean, title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    androidx.activity.compose.BackHandler(enabled = open, onBack = onDismiss)
    AnimatedVisibility(open, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.matchParentSize()) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)).pointerInput(Unit) { detectTapGestures { onDismiss() } })
    }
    AnimatedVisibility(
        open,
        enter = androidx.compose.animation.slideInHorizontally { it },
        exit = androidx.compose.animation.slideOutHorizontally { it },
        modifier = Modifier.align(Alignment.CenterEnd),
    ) {
        Column(
            Modifier.fillMaxHeight().widthIn(max = 440.dp).fillMaxWidth(0.9f)
                .background(AniColors.Surface)
                .pointerInput(Unit) { detectTapGestures { } },
        ) {
            Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 8.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Rounded.Close, "Close", tint = AniColors.TextSecondary) }
            }
            content()
        }
    }
}

/** Pinch or double-tap to zoom a page; taps report their position for page-turn zones. */
@Composable
private fun ZoomablePage(onTap: (Offset, IntSize) -> Unit, content: @Composable () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    fun clamp(value: Offset, zoom: Float): Offset {
        val maxX = size.width * (zoom - 1f) / 2f
        val maxY = size.height * (zoom - 1f) / 2f
        return Offset(value.x.coerceIn(-maxX, maxX), value.y.coerceIn(-maxY, maxY))
    }
    Box(
        Modifier.fillMaxSize().clipToBounds()
            .onSizeChanged { size = it }
            .pointerInput(Unit) {
                detectTapGestures(
                    onDoubleTap = { tap ->
                        if (scale > 1f) {
                            scale = 1f
                            offset = Offset.Zero
                        } else {
                            scale = 2.5f
                            val center = Offset(size.width / 2f, size.height / 2f)
                            offset = clamp((center - tap) * 1.5f, 2.5f)
                        }
                    },
                    onTap = { onTap(it, size) },
                )
            }
            .pointerInput(Unit) {
                // Two fingers zoom; while zoomed in, one finger pans (the pager only turns pages at 1×).
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val pinching = event.changes.count { it.pressed } > 1
                        if (pinching || scale > 1f) {
                            val next = (scale * event.calculateZoom()).coerceIn(1f, 5f)
                            offset = if (next <= 1f) Offset.Zero else clamp(offset + event.calculatePan(), next)
                            scale = next
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                }
            }
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offset.x
                translationY = offset.y
            },
        contentAlignment = Alignment.Center,
    ) { content() }
}

private fun pageRequest(context: Context, page: MangaPage): ImageRequest =
    ImageRequest.Builder(context)
        .data(page.url)
        .apply { page.headers.forEach { (name, value) -> addHeader(name, value) } }
        .build()

@Composable
private fun ReaderPage(
    page: MangaPage,
    index: Int,
    source: MangaSource,
    modifier: Modifier,
    fit: Boolean,
    content: Color,
    onDisplayed: () -> Unit,
    onBlocked: () -> Unit,
    /** Where a fitted page sits in its box (pairs meet in the middle). */
    alignment: Alignment = Alignment.Center,
    /** The drawn image's size, once it has loaded. */
    onSize: (Int, Int) -> Unit = { _, _ -> },
) {
    val context = LocalContext.current
    var retry by remember(page.url) { mutableIntStateOf(0) }
    var state by remember(page.url) { mutableStateOf<AsyncImagePainter.State?>(null) }
    var resolved by remember(page.url) { mutableStateOf<MangaPage?>(null) }
    var failure by remember(page.url) { mutableStateOf<String?>(null) }
    LaunchedEffect(page.url, source.id, retry) {
        resolved = null; failure = null; state = null
        try { resolved = source.resolvePage(page) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) {
            if (e.needsCheck()) onBlocked()
            failure = e.message ?: "Page couldn't load."
        }
    }
    val image = resolved ?: page
    val maxWidthPx = with(LocalDensity.current) { LocalConfiguration.current.screenWidthDp.dp.roundToPx() }
    val request = remember(resolved, retry, maxWidthPx) {
        resolved?.let {
            val builder = pageRequest(context, it).newBuilder().setParameter("retry", retry, memoryCacheKey = null)
            if (it.width == null || it.height == null) {
                // Size unknown: never decode taller than the GPU can draw (long strips go blank).
                builder.size(coil.size.Size(coil.size.Dimension.Pixels(maxWidthPx), coil.size.Dimension.Pixels(8192)))
                    .precision(coil.size.Precision.INEXACT)
            }
            builder.build()
        }
    }
    val aspect = if (image.width != null && image.height != null && image.width > 0 && image.height > 0) {
        image.width.toFloat() / image.height
    } else null
    Box(
        modifier.then(
            when {
                fit -> Modifier
                aspect != null -> Modifier.aspectRatio(aspect)
                else -> Modifier.heightIn(min = 360.dp)
            },
        ),
        contentAlignment = Alignment.Center,
    ) {
        if (request != null) AsyncImage(
            model = request,
            contentDescription = "Page ${index + 1}",
            contentScale = if (fit) ContentScale.Fit else ContentScale.FillWidth,
            alignment = alignment,
            modifier = if (fit) Modifier.fillMaxSize() else Modifier.fillMaxWidth(),
            onState = {
                state = it
                if (it is AsyncImagePainter.State.Success) {
                    onDisplayed()
                    val d = it.result.drawable
                    if (d.intrinsicWidth > 0 && d.intrinsicHeight > 0) onSize(d.intrinsicWidth, d.intrinsicHeight)
                }
                if (it is AsyncImagePainter.State.Error && it.result.throwable.needsCheck()) onBlocked()
            },
        )
        when {
            failure != null || state is AsyncImagePainter.State.Error -> PageRetry(index, content) { retry++ }
            state is AsyncImagePainter.State.Success -> Unit
            else -> Text("${index + 1}", color = content.copy(alpha = 0.25f), style = MaterialTheme.typography.headlineMedium)
        }
    }
}

@Composable
private fun PageRetry(index: Int, content: Color, onRetry: () -> Unit) {
    Row(
        Modifier.clip(aniShape(50)).background(content.copy(alpha = 0.08f)).clickable(onClick = onRetry)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Refresh, null, tint = content, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Page ${index + 1} didn't load · Retry", color = content, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun ChapterEnd(number: Float, hasNext: Boolean, content: Color, onNext: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Rounded.CheckCircle, null, tint = AniColors.Success, modifier = Modifier.size(32.dp))
        Spacer(Modifier.height(10.dp))
        Text("End of chapter ${MangaChapters.label(number)}", color = content.copy(alpha = 0.8f), style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(16.dp))
        if (hasNext) {
            PillButton("Next chapter", onNext, style = PillStyle.Primary, trailingIcon = Icons.AutoMirrored.Rounded.KeyboardArrowRight)
        } else {
            Text("You're caught up.", color = content.copy(alpha = 0.55f), style = MaterialTheme.typography.labelLarge)
        }
        Spacer(Modifier.height(80.dp))
    }
}

@Composable
private fun BoxScope.ReaderMessage(
    message: String,
    content: Color,
    onRetry: () -> Unit,
    connectLabel: String?,
    onConnect: () -> Unit,
) {
    Column(
        Modifier.align(Alignment.Center).padding(24.dp).widthIn(max = 520.dp)
            .clip(aniShape(16.dp)).background(content.copy(alpha = 0.06f)).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, color = content.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (connectLabel != null) PillButton(connectLabel, onConnect, icon = Icons.Rounded.Link, style = PillStyle.Primary)
            PillButton("Retry", onRetry, icon = Icons.Rounded.Refresh, style = if (connectLabel == null) PillStyle.Primary else PillStyle.Tonal)
        }
    }
}

/** One slice of a long-strip page, decoded only while on screen. */
@Composable
private fun StripSlice(
    page: MangaPage,
    index: Int,
    rows: IntRange,
    source: MangaSource,
    modifier: Modifier,
    content: Color,
    onDisplayed: () -> Unit,
    onBlocked: () -> Unit,
) {
    var retry by remember(page.url, rows) { mutableIntStateOf(0) }
    var bitmap by remember(page.url, rows) { mutableStateOf<ImageBitmap?>(null) }
    var failure by remember(page.url, rows) { mutableStateOf<String?>(null) }
    val sourceWidth = page.width ?: 1
    BoxWithConstraints(
        modifier.aspectRatio(sourceWidth.toFloat() / (rows.last - rows.first + 1)),
        contentAlignment = Alignment.Center,
    ) {
        val targetWidth = constraints.maxWidth
        LaunchedEffect(page.url, rows, retry) {
            failure = null
            try {
                val file = PageStrips.file(source.resolvePage(page))
                bitmap = PageStrips.decode(file, rows, sourceWidth, targetWidth).asImageBitmap()
                onDisplayed()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (e.needsCheck()) onBlocked()
                failure = e.message ?: "Page couldn't load."
            }
        }
        val image = bitmap
        when {
            image != null -> Image(
                image,
                contentDescription = if (rows.first == 0) "Page ${index + 1}" else null,
                contentScale = ContentScale.FillBounds,
                modifier = Modifier.fillMaxSize(),
            )
            failure != null -> PageRetry(index, content) { retry++ }
            rows.first == 0 -> Text("${index + 1}", color = content.copy(alpha = 0.25f), style = MaterialTheme.typography.headlineMedium)
        }
    }
}

/** The session's chapters, newest first, with read state; tapping one opens it. */
@Composable
private fun ChapterList(session: MangaReading.Session, onPick: (Int) -> Unit) {
    var progress by remember { mutableStateOf<Map<Float, ReadState>>(emptyMap()) }
    LaunchedEffect(session.manga.id) { progress = runCatching { Db.readingFor(session.manga.id) }.getOrDefault(emptyMap()) }
    val order = remember(session.chapters) { session.chapters.indices.reversed().toList() }
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = order.indexOf(session.index).coerceAtLeast(0))
    run {
        LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(bottom = 24.dp)) {
            items(order.size) { i ->
                val index = order[i]
                val item = session.chapters[index]
                val state = progress[item.number]
                val current = index == session.index
                Row(
                    Modifier.fillMaxWidth().clickable { onPick(index) }
                        .background(if (current) AniColors.AccentSoft else Color.Transparent)
                        .padding(horizontal = 24.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        when {
                            state?.finished == true -> Icons.Rounded.CheckCircle
                            state != null -> Icons.Rounded.Timelapse
                            else -> Icons.Rounded.RadioButtonUnchecked
                        },
                        null,
                        tint = if (state != null && !state.finished) ReaderAccent else AniColors.TextTertiary,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            listOfNotNull("Chapter ${MangaChapters.label(item.number)}", item.title).joinToString(" · "),
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = if (current) FontWeight.Bold else FontWeight.Normal,
                            color = if (state?.finished == true && !current) AniColors.TextSecondary else AniColors.Text,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        item.group?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary, maxLines = 1) }
                    }
                    if (current) Tag("READING", tone = TagTone.Accent)
                }
            }
        }
    }
}

@Composable
private fun ReaderSettings(
    mode: ReaderMode,
    autoResolved: ReaderMode,
    widthIndex: Int,
    background: ReaderBackground,
    onMode: (ReaderMode) -> Unit,
    onWidth: (Int) -> Unit,
    onBackground: (ReaderBackground) -> Unit,
    volumeKeys: Boolean,
    onVolumeKeys: (Boolean) -> Unit,
    spread: ReaderSpread,
    onSpread: (ReaderSpread) -> Unit,
    spreadShift: Boolean,
    onSpreadShift: (Boolean) -> Unit,
) {
    run {
        Column(
            Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Reading mode", style = MaterialTheme.typography.labelLarge, color = AniColors.TextSecondary)
            ReaderMode.entries.forEach { option ->
                Row(
                    Modifier.fillMaxWidth().clip(aniShape(12.dp)).clickable { onMode(option) }.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = option == mode, onClick = { onMode(option) }, colors = RadioButtonDefaults.colors(selectedColor = ReaderAccent))
                    Column {
                        Text(option.label, style = MaterialTheme.typography.bodyLarge)
                        if (option == ReaderMode.Auto) {
                            Text(
                                "Japanese manga turn right to left; manhwa, manhua and long strips scroll. Now: ${autoResolved.label.lowercase()}.",
                                style = MaterialTheme.typography.labelMedium,
                                color = AniColors.TextTertiary,
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(6.dp))
            Text("Pages side by side (page modes)", style = MaterialTheme.typography.labelLarge, color = AniColors.TextSecondary)
            PillTabs(ReaderSpread.entries.map { it.name to it.label }, spread.name, { onSpread(ReaderSpread.valueOf(it)) })
            Text(
                "Auto shows two pages, like an open book, whenever the screen is wider than tall.",
                style = MaterialTheme.typography.labelMedium,
                color = AniColors.TextTertiary,
            )
            if (spread != ReaderSpread.Single) {
                Row(
                    Modifier.fillMaxWidth().clip(aniShape(12.dp)).clickable { onSpreadShift(!spreadShift) }.padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Shift pairs by one page", style = MaterialTheme.typography.bodyLarge)
                        Text("For chapters whose two-page art comes out split.", style = MaterialTheme.typography.labelMedium, color = AniColors.TextTertiary)
                    }
                    Spacer(Modifier.width(12.dp))
                    Switch(checked = spreadShift, onCheckedChange = onSpreadShift, colors = SwitchDefaults.colors(checkedTrackColor = ReaderAccent))
                }
            }
            Spacer(Modifier.height(6.dp))
            Text("Page width (vertical scroll)", style = MaterialTheme.typography.labelLarge, color = AniColors.TextSecondary)
            PillTabs(ReaderWidthLabels.mapIndexed { i, label -> i.toString() to label }, widthIndex.toString(), { onWidth(it.toInt()) })
            Spacer(Modifier.height(6.dp))
            Text("Background", style = MaterialTheme.typography.labelLarge, color = AniColors.TextSecondary)
            PillTabs(ReaderBackground.entries.map { it.name to it.label }, background.name, { onBackground(ReaderBackground.valueOf(it)) })
            Spacer(Modifier.height(6.dp))
            Row(
                Modifier.fillMaxWidth().clip(aniShape(12.dp)).clickable { onVolumeKeys(!volumeKeys) }.padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Volume keys turn pages", style = MaterialTheme.typography.bodyLarge)
                    Text("Volume down goes forward, volume up goes back.", style = MaterialTheme.typography.labelMedium, color = AniColors.TextTertiary)
                }
                Spacer(Modifier.width(12.dp))
                Switch(
                    checked = volumeKeys,
                    onCheckedChange = onVolumeKeys,
                    colors = SwitchDefaults.colors(checkedTrackColor = ReaderAccent),
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "In page modes, tap the left or right side to turn pages, the middle to show or hide controls, and pinch or double-tap to zoom.",
                style = MaterialTheme.typography.labelMedium,
                color = AniColors.TextTertiary,
            )
        }
    }
}
