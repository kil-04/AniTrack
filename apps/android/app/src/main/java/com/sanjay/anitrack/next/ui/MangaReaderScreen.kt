package com.sanjay.anitrack.next.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.AspectRatio
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.compose.AsyncImagePainter
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import com.sanjay.anitrack.next.data.manga.MangaChapters
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaReading
import com.sanjay.anitrack.next.data.manga.MangaSource
import com.sanjay.anitrack.next.data.manga.PageStrips
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts

private val ReaderAccent = Color(0xFFE50914)

/** One list item: a whole page, or one slice of a long-strip page. */
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

/** Page widths the reader cycles through; null fills the screen width. */
private val ReaderWidths = listOf(720, 960, null)
private const val PREFETCH_AHEAD = 4

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
    DisposableEffect(Unit) {
        view.keepScreenOn = true
        onDispose { view.keepScreenOn = false }
    }

    var pages by remember(chapter.id) { mutableStateOf<List<MangaPage>?>(null) }
    var error by remember(chapter.id) { mutableStateOf<String?>(null) }
    var attempt by remember(chapter.id) { mutableIntStateOf(0) }
    val connect = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (it.resultCode == android.app.Activity.RESULT_OK) attempt++
    }
    val displayed = remember(chapter.id, attempt) { mutableStateMapOf<Int, Boolean>() }
    LaunchedEffect(chapter.id, attempt) {
        error = null
        pages = null
        runCatching {
            // Downloaded chapters read from disk, without a connection.
            com.sanjay.anitrack.next.data.manga.MangaDownloads.localPages(session.manga.id, chapter.id)
                ?: session.source.pages(session.title, chapter)
        }
            .onSuccess {
                if (it.isEmpty()) error = "This chapter has no pages." else pages = it
            }
            .onFailure {
                if (it is CancellationException) throw it
                error = it.message ?: "Couldn't load this chapter."
            }
    }

    val loaded = pages
    val segments = remember(loaded) { loaded?.let(::segmentsOf).orEmpty() }
    val listState = remember(chapter.id, segments) {
        LazyListState(segments.indexOfFirst { it.page == session.startPage }.coerceAtLeast(0))
    }
    var chrome by remember { mutableStateOf(true) }
    var widthIndex by rememberSaveable { mutableIntStateOf(0) }

    // Last page on screen counts as read; saved shortly after scrolling settles.
    LaunchedEffect(chapter.id, segments, listState) {
        val count = loaded?.size ?: return@LaunchedEffect
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
    // Warm the disk cache a few pages ahead so scrolling never waits on the network.
    LaunchedEffect(chapter.id, segments, listState) {
        val list = loaded ?: return@LaunchedEffect
        snapshotFlow { segments.getOrNull(listState.firstVisibleItemIndex)?.page ?: 0 }.distinctUntilChanged().collectLatest { first ->
            for (page in list.drop(first + 1).take(PREFETCH_AHEAD)) {
                val image = try { session.source.resolvePage(page) }
                catch (e: CancellationException) { throw e }
                catch (_: Exception) { break } // Stop prefetch after a rejection; visible pages offer manual retry.
                if (PageStrips.isTall(image.width, image.height)) {
                    // Long strips are sliced from a local file: fetch it ahead instead.
                    runCatching { PageStrips.file(image) }.onFailure { if (it is CancellationException) throw it }
                    continue
                }
                context.imageLoader.enqueue(
                    pageRequest(context, image).newBuilder()
                        .memoryCachePolicy(CachePolicy.DISABLED)
                        .size(64)
                        .build(),
                )
            }
        }
    }

    Box(
        Modifier.fillMaxSize().background(Color.Black)
            .pointerInput(Unit) { detectTapGestures { chrome = !chrome } },
    ) {
        when {
            error != null -> ReaderMessage(error!!, action = "Retry", extra = {
                session.source.connectionActivity?.let { screen ->
                    TextButton(onClick = { connect.launch(android.content.Intent(context,screen)) }) {
                        Text("Connect ${session.source.label}")
                    }
                }
            }) { attempt++ }
            loaded == null -> CircularProgressIndicator(color = ReaderAccent, modifier = Modifier.align(Alignment.Center))
            else -> {
                val maxWidth = ReaderWidths[widthIndex]
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    items(count = segments.size, key = { "${chapter.id}:${segments[it].page}:${segments[it].rows?.first ?: -1}" }) { item ->
                        val segment = segments[item]
                        val width = Modifier.then(if (maxWidth != null) Modifier.widthIn(max = maxWidth.dp) else Modifier).fillMaxWidth()
                        val rows = segment.rows
                        if (rows != null) {
                            StripSlice(
                                loaded[segment.page],
                                segment.page,
                                rows,
                                session.source,
                                width,
                                onDisplayed = { if (segment.lastSlice) displayed[segment.page] = true },
                            )
                        } else {
                            ReaderPage(
                                loaded[segment.page],
                                segment.page,
                                session.source,
                                width,
                                onDisplayed = { displayed[segment.page] = true },
                            )
                        }
                    }
                    item(key = "${chapter.id}:end") {
                        ChapterEnd(
                            number = chapter.number,
                            hasNext = session.hasNext,
                            onNext = { MangaReading.step(1) },
                        )
                    }
                }
            }
        }

        AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopCenter)) {
            Row(
                Modifier.fillMaxWidth()
                    .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.92f), Color.Black.copy(alpha = 0.6f))))
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
                PillButton(
                    ReaderWidths[widthIndex]?.let { if (it < 900) "Narrow" else "Medium" } ?: "Full width",
                    { widthIndex = (widthIndex + 1) % ReaderWidths.size },
                    icon = Icons.Rounded.AspectRatio,
                    compact = true,
                )
                Spacer(Modifier.width(8.dp))
            }
        }
        AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.BottomCenter)) {
            Row(
                Modifier.fillMaxWidth()
                    .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.6f), Color.Black.copy(alpha = 0.92f))))
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PillButton("Previous", { MangaReading.step(-1) }, icon = Icons.AutoMirrored.Rounded.KeyboardArrowLeft, enabled = session.hasPrevious, compact = true)
                Spacer(Modifier.width(16.dp))
                val count = loaded?.size ?: 0
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (count > 0) {
                        val current = ((segments.getOrNull(listState.firstVisibleItemIndex)?.page ?: (count - 1)) + 1).coerceAtMost(count)
                        Text("Page $current of $count", color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.labelLarge)
                        Spacer(Modifier.height(6.dp))
                        ProgressStrip(current.toFloat() / count, Modifier.widthIn(max = 420.dp).fillMaxWidth(), height = 3.dp)
                    }
                }
                Spacer(Modifier.width(16.dp))
                PillButton("Next", { MangaReading.step(1) }, trailingIcon = Icons.AutoMirrored.Rounded.KeyboardArrowRight, enabled = session.hasNext, compact = true)
            }
        }
    }
}

private fun pageRequest(context: android.content.Context, page: MangaPage): ImageRequest =
    ImageRequest.Builder(context)
        .data(page.url)
        .apply { page.headers.forEach { (name, value) -> addHeader(name, value) } }
        .build()

@Composable
private fun ReaderPage(page: MangaPage, index: Int, source: MangaSource, modifier: Modifier, onDisplayed: () -> Unit) {
    val context = LocalContext.current
    var retry by remember(page.url) { mutableIntStateOf(0) }
    var state by remember(page.url) { mutableStateOf<AsyncImagePainter.State?>(null) }
    var resolved by remember(page.url) { mutableStateOf<MangaPage?>(null) }
    var failure by remember(page.url) { mutableStateOf<String?>(null) }
    LaunchedEffect(page.url, source.id, retry) {
        resolved = null; failure = null; state = null
        try { resolved = source.resolvePage(page) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { failure = e.message ?: "Page couldn't load." }
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
        modifier.then(if (aspect != null) Modifier.aspectRatio(aspect) else Modifier.heightIn(min = 360.dp)),
        contentAlignment = Alignment.Center,
    ) {
        if (request != null) AsyncImage(
            model = request,
            contentDescription = "Page ${index + 1}",
            contentScale = ContentScale.FillWidth,
            modifier = Modifier.fillMaxWidth(),
            onState = {
                state = it
                if (it is AsyncImagePainter.State.Success) onDisplayed()
            },
        )
        when {
            failure != null || state is AsyncImagePainter.State.Error -> TextButton(onClick = { retry++ }) {
                Text("Page ${index + 1} didn't load · Retry", color = Color.White)
            }
            state is AsyncImagePainter.State.Success -> Unit
            else -> Text("${index + 1}", color = Color.White.copy(alpha = 0.25f), style = MaterialTheme.typography.headlineMedium)
        }
    }
}

@Composable
private fun ChapterEnd(number: Float, hasNext: Boolean, onNext: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("End of chapter ${MangaChapters.label(number)}", color = Color.White.copy(alpha = 0.7f))
        Spacer(Modifier.height(16.dp))
        if (hasNext) {
            PillButton("Next chapter", onNext, style = PillStyle.Primary, trailingIcon = Icons.AutoMirrored.Rounded.KeyboardArrowRight)
        } else {
            Text("You're caught up.", color = Color.White.copy(alpha = 0.5f), style = MaterialTheme.typography.labelLarge)
        }
        Spacer(Modifier.height(80.dp))
    }
}

@Composable
private fun BoxScope.ReaderMessage(message: String, action: String, extra: @Composable () -> Unit = {}, onAction: () -> Unit) {
    Column(
        Modifier.align(Alignment.Center).padding(24.dp)
            .clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.06f)).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(message, color = Color.White.copy(alpha = 0.8f))
        Spacer(Modifier.height(12.dp))
        Button(onClick = onAction, colors = ButtonDefaults.buttonColors(containerColor = ReaderAccent, contentColor = Color.White)) { Text(action) }
        extra()
    }
}

/** One slice of a long-strip page, decoded only while on screen. */
@Composable
private fun StripSlice(page: MangaPage, index: Int, rows: IntRange, source: MangaSource, modifier: Modifier, onDisplayed: () -> Unit) {
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
            failure != null -> TextButton(onClick = { retry++ }) {
                Text("Page ${index + 1} didn't load \u00B7 Retry", color = Color.White)
            }
            rows.first == 0 -> Text("${index + 1}", color = Color.White.copy(alpha = 0.25f), style = MaterialTheme.typography.headlineMedium)
        }
    }
}
