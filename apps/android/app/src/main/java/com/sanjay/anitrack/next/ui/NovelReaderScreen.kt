package com.sanjay.anitrack.next.ui

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.FormatListBulleted
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Remove
import androidx.compose.material.icons.rounded.TextFields
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sanjay.anitrack.next.data.novel.NovelChapterText
import com.sanjay.anitrack.next.data.novel.NovelReading
import com.sanjay.anitrack.next.data.novel.NovelSources
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch

private data class ReaderTheme(val label: String, val bg: Color, val text: Color, val muted: Color, val rule: Color, val chrome: Color)

private val READER_THEMES = linkedMapOf(
    "night" to ReaderTheme("Night", Color(0xFF0A0D16), Color(0xFFD9DEEA), Color(0xFF7C8499), Color(0x14FFFFFF), Color(0xEB0A0D16)),
    "dusk" to ReaderTheme("Dusk", Color(0xFF1C1E27), Color(0xFFCDD0DA), Color(0xFF868A99), Color(0x14FFFFFF), Color(0xEB1C1E27)),
    "sepia" to ReaderTheme("Sepia", Color(0xFFF3EAD6), Color(0xFF4A3A2B), Color(0xFF8C7A63), Color(0x244A3A2B), Color(0xF0F3EAD6)),
    "paper" to ReaderTheme("Paper", Color(0xFFFBFBF9), Color(0xFF1E2229), Color(0xFF6B7280), Color(0x17000000), Color(0xF0FBFBF9)),
)

/** Per-device reader settings. */
private class NovelPrefs(context: Context) {
    private val p = context.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)
    var size by mutableIntStateOf(p.getInt("novel_size", 19).coerceIn(14, 32))
    var leading by mutableFloatStateOf(p.getFloat("novel_leading", 1.7f).coerceIn(1.3f, 2.4f))
    var width by mutableIntStateOf(p.getInt("novel_width", 720).coerceIn(420, 1400))
    var theme by mutableStateOf(p.getString("novel_theme", "night").takeIf { it in READER_THEMES } ?: "night")
    var serif by mutableStateOf(p.getBoolean("novel_serif", true))
    fun save() {
        p.edit().putInt("novel_size", size).putFloat("novel_leading", leading).putInt("novel_width", width)
            .putString("novel_theme", theme).putBoolean("novel_serif", serif).apply()
    }
}

@Composable
fun NovelReaderScreen(onBack: () -> Unit) {
    val session = NovelReading.current.value
    if (session == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val context = LocalContext.current
    val prefs = remember { NovelPrefs(context) }
    val theme = READER_THEMES[prefs.theme]!!
    val font = if (prefs.serif) FontFamily.Serif else FontFamily.SansSerif
    var text by remember { mutableStateOf<NovelChapterText?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var chrome by remember { mutableStateOf(true) }
    var panel by remember { mutableStateOf("none") }
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val chapter = session.chapter

    LaunchedEffect(session.source, session.titleId, chapter.id, attempt) {
        text = null
        error = null
        runCatching { NovelSources.chapter(session.source, session.titleId, chapter.id) }
            .onSuccess { loaded ->
                text = loaded
                // Item 0 is the heading; paragraph n is item n + 1.
                val start = (session.startFraction?.let { (it * loaded.paragraphs.size).toInt() } ?: session.startParagraph)
                    .coerceIn(0, (loaded.paragraphs.size - 1).coerceAtLeast(0))
                list.scrollToItem(if (start > 0) start + 1 else 0)
                NovelReading.save(session, start, loaded.paragraphs.size)
                // Fetch the next chapter ahead, so turning the page is instant.
                session.next?.let { n -> delay(2500); runCatching { NovelSources.chapter(session.source, session.titleId, n.id) } }
            }
            .onFailure { error = (it as? com.sanjay.anitrack.next.data.manga.MangaSourceException)?.message ?: "Couldn't load this chapter. Try again." }
    }

    // The first paragraph on screen is the saved place.
    @OptIn(kotlinx.coroutines.FlowPreview::class)
    LaunchedEffect(text) {
        val t = text ?: return@LaunchedEffect
        snapshotFlow {
            val info = list.layoutInfo
            val atEnd = info.visibleItemsInfo.lastOrNull()?.index == info.totalItemsCount - 1
            if (atEnd) t.paragraphs.size - 1 else (list.firstVisibleItemIndex - 1).coerceAtLeast(0)
        }.distinctUntilChanged().debounce(700).collectLatest { NovelReading.save(session, it, t.paragraphs.size) }
    }
    // Scrolling down hides the bars; scrolling back up shows them.
    LaunchedEffect(list) {
        var last = 0
        snapshotFlow { list.firstVisibleItemIndex * 10_000 + list.firstVisibleItemScrollOffset }.collect { now ->
            if (now > last + 40) { chrome = false; panel = "none" } else if (now < last - 40) chrome = true
            last = now
        }
    }
    BackHandler(enabled = panel != "none") { panel = "none" }

    val progress by remember { derivedStateOf {
        val total = list.layoutInfo.totalItemsCount
        if (total <= 1) 0f else (list.firstVisibleItemIndex.toFloat() / (total - 1)).coerceIn(0f, 1f)
    } }

    Box(Modifier.fillMaxSize().background(theme.bg)) {
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize().clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                chrome = !chrome; panel = "none"
            },
            horizontalAlignment = Alignment.CenterHorizontally,
            contentPadding = PaddingValues(top = 84.dp, bottom = 96.dp, start = 22.dp, end = 22.dp),
        ) {
            val t = text
            item(key = "heading") {
                Text(
                    chapter.label, color = theme.text, fontFamily = font, fontWeight = FontWeight.Bold,
                    fontSize = (prefs.size * 1.4f).sp, lineHeight = (prefs.size * 1.8f).sp, textAlign = TextAlign.Center,
                    modifier = Modifier.widthIn(max = prefs.width.dp).fillMaxWidth().padding(bottom = 28.dp),
                )
            }
            when {
                error != null -> item(key = "error") {
                    Column(Modifier.widthIn(max = prefs.width.dp).fillMaxWidth().border(1.dp, theme.rule, RoundedCornerShape(16.dp)).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(error!!, color = theme.muted, textAlign = TextAlign.Center)
                        Spacer(Modifier.height(12.dp))
                        PillButton("Retry", { attempt++ }, icon = Icons.Rounded.Refresh, style = PillStyle.Primary)
                    }
                }
                t == null -> items(8) {
                    Box(Modifier.widthIn(max = prefs.width.dp).fillMaxWidth().padding(vertical = 8.dp).height(16.dp).clip(RoundedCornerShape(4.dp)).background(theme.rule))
                }
                else -> {
                    itemsIndexed(t.paragraphs, key = { i, _ -> i }) { _, p ->
                        val rule = p == "* * *"
                        SelectionContainer {
                            Text(
                                p,
                                style = TextStyle(
                                    color = if (rule) theme.muted else theme.text, fontFamily = font, fontSize = prefs.size.sp,
                                    lineHeight = (prefs.size * prefs.leading).sp, textAlign = if (rule) TextAlign.Center else TextAlign.Start,
                                ),
                                modifier = Modifier.widthIn(max = prefs.width.dp).fillMaxWidth().padding(bottom = (prefs.size * 0.9f).dp),
                            )
                        }
                    }
                    item(key = "nav") {
                        Row(
                            Modifier.widthIn(max = prefs.width.dp).fillMaxWidth().padding(top = 36.dp),
                            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically,
                        ) {
                            PillButton("Previous", { NovelReading.jump(session.index - 1) }, icon = Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                                enabled = session.previous != null, style = PillStyle.Tonal)
                            val next = session.next
                            if (next != null) PillButton(next.label, { NovelReading.jump(session.index + 1) }, trailingIcon = Icons.AutoMirrored.Rounded.KeyboardArrowRight, style = PillStyle.Primary)
                            else Text("You're caught up — this is the newest chapter.", color = theme.muted, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }

        // Progress line
        Box(Modifier.fillMaxWidth().height(3.dp).background(theme.rule)) {
            Box(Modifier.fillMaxWidth(progress).fillMaxHeight().background(AniColors.BrandGradient))
        }

        AnimatedVisibility(chrome || panel != "none", enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.TopCenter)) {
            Row(
                Modifier.fillMaxWidth().padding(top = 3.dp).background(theme.chrome).padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = theme.text) }
                Column(Modifier.weight(1f)) {
                    Text(session.detail.card.title, color = theme.text, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${chapter.label} · ${session.index + 1} of ${session.chapters.size}", color = theme.muted, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                }
                // Background music keeps playing while reading; its controls ride along in the reader bar.
                BackgroundMusicBar(compact = true, onOpenSettings = {}, modifier = Modifier.padding(end = 4.dp))
                IconButton(onClick = { NovelReading.jump(session.index - 1) }, enabled = session.previous != null) {
                    Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "Previous chapter", tint = theme.text.copy(alpha = if (session.previous != null) 1f else 0.3f))
                }
                IconButton(onClick = { NovelReading.jump(session.index + 1) }, enabled = session.next != null) {
                    Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "Next chapter", tint = theme.text.copy(alpha = if (session.next != null) 1f else 0.3f))
                }
                IconButton(onClick = { panel = if (panel == "chapters") "none" else "chapters" }) { Icon(Icons.AutoMirrored.Rounded.FormatListBulleted, "Chapters", tint = theme.text) }
                IconButton(onClick = { panel = if (panel == "type") "none" else "type" }) { Icon(Icons.Rounded.TextFields, "Text settings", tint = theme.text) }
            }
        }

        if (panel == "type") TypePanel(prefs, theme, Modifier.align(Alignment.TopEnd).padding(top = 66.dp, end = 12.dp))
        if (panel == "chapters") {
            val chapters = session.chapters
            val chapterList = rememberLazyListState(initialFirstVisibleItemIndex = (session.index - 5).coerceAtLeast(0))
            Column(
                Modifier.align(Alignment.TopEnd).padding(top = 66.dp, end = 12.dp, bottom = 12.dp).width(320.dp).fillMaxHeight()
                    .clip(RoundedCornerShape(18.dp)).background(theme.chrome).border(1.dp, theme.rule, RoundedCornerShape(18.dp)),
            ) {
                Text("${chapters.size} chapters", color = theme.muted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(16.dp))
                LazyColumn(state = chapterList) {
                    itemsIndexed(chapters, key = { _, c -> c.id }) { i, c ->
                        Row(
                            Modifier.fillMaxWidth().clickable { panel = "none"; NovelReading.jump(i) }
                                .background(if (i == session.index) AniColors.AccentSoft else Color.Transparent)
                                .padding(horizontal = 16.dp, vertical = 10.dp),
                        ) {
                            Text("${i + 1}", color = theme.muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.width(44.dp))
                            Text(c.label, color = theme.text, fontWeight = if (i == session.index) FontWeight.Bold else FontWeight.Normal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TypePanel(prefs: NovelPrefs, theme: ReaderTheme, modifier: Modifier) {
    Column(
        modifier.width(300.dp).clip(RoundedCornerShape(18.dp)).background(theme.chrome).border(1.dp, theme.rule, RoundedCornerShape(18.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            READER_THEMES.forEach { (key, t) ->
                Box(
                    Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(12.dp)).background(t.bg)
                        .border(if (prefs.theme == key) 2.dp else 1.dp, if (prefs.theme == key) AniColors.Accent else t.rule, RoundedCornerShape(12.dp))
                        .clickable { prefs.theme = key; prefs.save() },
                    contentAlignment = Alignment.Center,
                ) { Text(t.label, color = t.text, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(true to "Serif", false to "Sans").forEach { (serif, label) ->
                Box(
                    Modifier.weight(1f).height(38.dp).clip(RoundedCornerShape(12.dp))
                        .border(if (prefs.serif == serif) 2.dp else 1.dp, if (prefs.serif == serif) AniColors.Accent else theme.rule, RoundedCornerShape(12.dp))
                        .clickable { prefs.serif = serif; prefs.save() },
                    contentAlignment = Alignment.Center,
                ) { Text(label, color = theme.text, fontFamily = if (serif) FontFamily.Serif else FontFamily.SansSerif) }
            }
        }
        Stepper("Text size", "${prefs.size}", theme, { prefs.size = (prefs.size - 1).coerceAtLeast(14); prefs.save() }, { prefs.size = (prefs.size + 1).coerceAtMost(32); prefs.save() })
        Stepper("Line spacing", "%.1f".format(prefs.leading), theme, { prefs.leading = (prefs.leading - 0.1f).coerceAtLeast(1.3f); prefs.save() }, { prefs.leading = (prefs.leading + 0.1f).coerceAtMost(2.4f); prefs.save() })
        Stepper("Column width", "${prefs.width}", theme, { prefs.width = (prefs.width - 60).coerceAtLeast(420); prefs.save() }, { prefs.width = (prefs.width + 60).coerceAtMost(1400); prefs.save() })
    }
}

@Composable
private fun Stepper(label: String, value: String, theme: ReaderTheme, onMinus: () -> Unit, onPlus: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = theme.muted, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
        IconButton(onClick = onMinus, modifier = Modifier.size(34.dp).border(1.dp, theme.rule, RoundedCornerShape(10.dp))) { Icon(Icons.Rounded.Remove, "Less", tint = theme.text) }
        Text(value, color = theme.text, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.width(52.dp))
        IconButton(onClick = onPlus, modifier = Modifier.size(34.dp).border(1.dp, theme.rule, RoundedCornerShape(10.dp))) { Icon(Icons.Rounded.Add, "More", tint = theme.text) }
    }
}
