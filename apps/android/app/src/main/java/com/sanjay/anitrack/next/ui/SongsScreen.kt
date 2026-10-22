package com.sanjay.anitrack.next.ui

import android.content.Context
import android.view.SoundEffectConstants
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.material.icons.rounded.Fullscreen
import androidx.compose.material.icons.rounded.FullscreenExit
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.positionChange
import kotlin.math.abs
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.AcUnit
import androidx.compose.material.icons.rounded.Album
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Casino
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Eco
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.LocalFlorist
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.OndemandVideo
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.sanjay.anitrack.next.data.AniSong
import com.sanjay.anitrack.next.data.AniSongs
import com.sanjay.anitrack.next.data.BackgroundMusic
import com.sanjay.anitrack.next.data.PlayerHolder
import com.sanjay.anitrack.next.data.SongCharts
import com.sanjay.anitrack.next.data.ThemePlayer
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/*
 * Songs as a jukebox, as on desktop (pages/Songs.tsx): a spinning record for the chart's #1,
 * a radio dial from 1960 to now (drag for a year, tap a decade), and tabs for the chart,
 * seasons and search so nothing needs a long scroll. Long-press a song to hear a few
 * seconds of it; the dial clicks and ticks under your finger. Both can be switched off.
 */

private val GOLDEN = listOf(1970, 1980, 1990)
private val ERA_NOTE = mapOf(
    1960 to "Astro Boy and the first TV anime themes.",
    1970 to "Super robots, space operas and the first anisong stars.",
    1980 to "City pop, idols and the golden age of TV anime.",
    1990 to "Evangelion, Sailor Moon and the anisong boom.",
    2000 to "J-rock openings and the late-night anime wave.",
    2010 to "Idol units, viral openings and streaming.",
    2020 to "Global hits and openings everyone covers.",
)
private const val SONGS_PREFS = "songs"
private const val CHART_PREVIEW = 20
private val Gold = Color(0xFFFCD34D)
private val PODIUM = listOf(Gold, Color(0xFFCBD5E1), Color(0xFFD97706))

/** "decade" / "year" with a start year, or "all". */
private data class Scope(val type: String, val value: Int = 0) {
    val title get() = when (type) { "all" -> "All time"; "decade" -> "The ${value % 100}s".replace("The 0s", "The 00s"); else -> "$value" }
    val key get() = if (type == "all") "all" else "$type:$value"
    companion object {
        fun parse(raw: String?, thisYear: Int): Scope {
            if (raw == "all") return Scope("all")
            val m = Regex("""(decade|year):(\d{4})""").matchEntire(raw ?: "") ?: return Scope("decade", 1980)
            val v = m.groupValues[2].toInt()
            return if (v in AniSongs.FIRST_YEAR..thisYear) Scope(m.groupValues[1], v) else Scope("decade", 1980)
        }
    }
}

/** 2858 → "2.9K", 180283 → "180K". Same as compactCount in Songs.tsx. */
private fun compactCount(n: Long): String = when {
    n >= 1_000_000 -> "%.1fM".format(n / 1_000_000.0)
    n >= 10_000 -> "${Math.round(n / 1000.0)}K"
    n >= 1000 -> "%.1fK".format(n / 1000.0)
    else -> n.toString()
}

/** Eight seconds of a song, faded in and out, on its own player (not the theme queue). */
private object SongPreview {
    private var player: ExoPlayer? = null
    var playingId by mutableStateOf<Int?>(null)
        private set

    suspend fun play(context: Context, song: AniSong) {
        val url = AniSongs.audioUrl(song) ?: return
        if (ThemePlayer.isPlaying.value) return
        val exo = player ?: ExoPlayer.Builder(context.applicationContext).build().also { player = it }
        exo.setMediaItem(MediaItem.fromUri(url))
        exo.volume = 0f
        exo.prepare()
        exo.play()
        playingId = song.id
        try {
            repeat(10) { exo.volume = (it + 1) * 0.05f; delay(40) }
            delay(7000)
        } finally {
            if (playingId == song.id) stop()
        }
    }

    fun stop() {
        player?.let { p -> p.pause(); p.volume = 0f }
        playingId = null
    }
}

@Composable
fun SongsScreen(onOpenAnime: (Int) -> Unit) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(SONGS_PREFS, Context.MODE_PRIVATE) }
    val thisYear = remember { java.time.Year.now().value }
    var charts by remember { mutableStateOf<SongCharts?>(null) }
    var chartsFailed by remember { mutableStateOf(false) }
    var scope by remember { mutableStateOf(Scope.parse(prefs.getString("scope", null), thisYear)) }
    var kind by remember { mutableStateOf("OP") }
    var order by remember { mutableStateOf(if (prefs.getString("order", "best") == "known") "known" else "best") }
    var tab by remember { mutableStateOf("chart") }
    var sounds by remember { mutableStateOf(prefs.getBoolean("sounds", true)) }
    var previews by remember { mutableStateOf(prefs.getBoolean("previews", true)) }
    var queue by remember { mutableStateOf<VideoQueue?>(null) }
    var full by remember { mutableStateOf(false) }
    val video = queue?.let { rememberSongVideo(it) }
    var previewSong by remember { mutableStateOf<AniSong?>(null) }
    val themePlaying by ThemePlayer.isPlaying
    val view = LocalView.current
    val haptics = LocalHapticFeedback.current

    LaunchedEffect(Unit) {
        try { charts = AniSongs.charts(context) } catch (e: CancellationException) { throw e } catch (_: Exception) { chartsFailed = true }
    }
    LaunchedEffect(scope, order, sounds, previews) {
        prefs.edit().putString("scope", scope.key).putString("order", order).putBoolean("sounds", sounds).putBoolean("previews", previews).apply()
    }
    LaunchedEffect(previewSong) { previewSong?.let { SongPreview.play(context, it); previewSong = null } }
    DisposableEffect(Unit) { onDispose { SongPreview.stop() } }

    fun click() { if (sounds) view.playSoundEffect(SoundEffectConstants.CLICK) }
    fun tick() { haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove); if (sounds) view.playSoundEffect(SoundEffectConstants.CLICK) }

    val chart = remember(charts, scope, kind, order) {
        val c = charts ?: return@remember emptyList()
        val set = when (scope.type) { "all" -> c.allTime; "decade" -> c.decades[scope.value]; else -> c.years[scope.value] }
        set?.get(order)?.get(kind).orEmpty()
    }
    val label = "${scope.title} · ${if (kind == "OP") "openings" else "endings"}"
    fun watch(songs: List<AniSong>, index: Int, title: String) {
        SongPreview.stop()
        val playable = songs.filter { it.video != null }
        if (playable.isEmpty()) return
        val at = playable.indexOf(songs.getOrNull(index)).coerceAtLeast(0)
        // The same list already playing: just move to the song, without a new player.
        if (video != null && video.queue.items.map { it.key } == playable.map { it.id.toString() }) video.jump(at)
        else queue = VideoQueue(playable.map(::songItem), at, title)
    }
    fun listen(songs: List<AniSong>, index: Int, title: String) {
        SongPreview.stop()
        val playable = songs.filter { it.audio != null }
        if (playable.isEmpty()) return
        ThemePlayer.play(context, playable.map(AniSongs::toThemeSong), playable.indexOf(songs.getOrNull(index)).coerceAtLeast(0), title)
    }
    val preview: (AniSong) -> Unit = { song ->
        if (previews) { haptics.performHapticFeedback(HapticFeedbackType.LongPress); previewSong = song }
    }
    val actions = SongActions(::watch, ::listen, preview, onOpenAnime)
    fun step(by: Int) { tick(); video?.go(by) }
    fun close() { click(); queue = null; full = false }

    BoxWithConstraints(Modifier.fillMaxSize().background(AniColors.Bg)) {
    // Room for the side player beside the page (tablets); phones always play full screen.
    val canDock = maxWidth >= 900.dp
    val docked = video != null && canDock && !full
    BackHandler(enabled = docked) { close() }
    Row(Modifier.fillMaxSize()) {
    LazyColumn(
        modifier = Modifier.weight(1f).fillMaxHeight(),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 120.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        item {
            Jukebox(
                scope = scope, lead = chart.firstOrNull(), spinning = themePlaying || SongPreview.playingId != null || video != null, compact = docked,
                order = order, kind = kind, sounds = sounds, previews = previews, thisYear = thisYear, hasChart = chart.isNotEmpty(),
                onWatch = { click(); watch(chart, 0, label) },
                onListen = { click(); listen(chart, 0, label) },
                onSurprise = { click(); if (chart.isNotEmpty()) watch(chart, chart.indices.random(), "$label · surprise") },
                onOrder = { click(); order = it }, onKind = { click(); kind = it },
                onSounds = { sounds = !sounds }, onPreviews = { previews = !previews; SongPreview.stop() },
                onScope = { scope = it; if (tab == "search") tab = "chart" }, onTick = ::tick, onClick = ::click,
            )
        }
        item {
            Row(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                listOf(Triple("chart", "Chart", Icons.AutoMirrored.Rounded.QueueMusic), Triple("seasons", "Seasons", Icons.Rounded.AutoAwesome), Triple("search", "Search", Icons.Rounded.Search))
                    .forEach { (key, text, icon) -> PillTab(text, icon, tab == key) { click(); tab = key } }
                Spacer(Modifier.weight(1f))
                Text(if (previews) "Long-press a song to hear it" else "Previews off", color = AniColors.TextTertiary, fontSize = 12.sp)
            }
        }
        when (tab) {
            "chart" -> when {
                chartsFailed -> item { Note("The charts couldn't be read.") }
                charts == null -> item { Loading() }
                chart.isEmpty() -> item { Note("No chart for this year yet.") }
                else -> chartItems(chart, order, label, actions, playingId = video?.item?.key?.toIntOrNull())
            }
            "seasons" -> item {
                SeasonsView(
                    startYear = when (scope.type) { "year" -> scope.value; "decade" -> scope.value + 5; else -> 1998 }.coerceAtMost(thisYear),
                    kind = kind, thisYear = thisYear, actions = actions, onClick = ::click,
                )
            }
            else -> item { SearchView(actions) }
        }
        item {
            Text(
                (if (order == "best") "Best: ranked by how much people play each song: its views across everyone's YouTube uploads, or its Last.fm listeners, with kids' shows weighted down; songs neither knows use half their quiz score."
                else "Most known: ranked by the share of Anime Music Quiz players who recognise each song (AnisongDB).") + " Videos and songs from AnisongDB.",
                color = AniColors.TextTertiary, fontSize = 11.sp, modifier = Modifier.padding(top = 12.dp),
            )
        }
    }

    AnimatedVisibility(
        visible = docked,
        enter = expandHorizontally(tween(320), expandFrom = Alignment.Start) + fadeIn(tween(320)),
        exit = shrinkHorizontally(tween(260), shrinkTowards = Alignment.Start) + fadeOut(tween(200)),
    ) {
        video?.let { SongSidePlayer(it, onFull = { click(); full = true }, onClose = ::close, onStep = ::step, onJump = { at -> tick(); it.jump(at) }) }
    }
    }
    if (video != null && (full || !canDock)) {
        SongFullPlayer(video, onDock = if (canDock) ({ click(); full = false }) else null, onClose = ::close, onStep = ::step, onJump = { at -> tick(); video.jump(at) })
    }
    }
}

private class SongActions(
    val watch: (List<AniSong>, Int, String) -> Unit,
    val listen: (List<AniSong>, Int, String) -> Unit,
    val preview: (AniSong) -> Unit,
    val openAnime: (Int) -> Unit,
)

// ── Jukebox ───────────────────────────────────────────────────────────────

@Composable
private fun Jukebox(
    scope: Scope, lead: AniSong?, spinning: Boolean, compact: Boolean, order: String, kind: String, sounds: Boolean, previews: Boolean,
    thisYear: Int, hasChart: Boolean, onWatch: () -> Unit, onListen: () -> Unit, onSurprise: () -> Unit,
    onOrder: (String) -> Unit, onKind: (String) -> Unit, onSounds: () -> Unit, onPreviews: () -> Unit,
    onScope: (Scope) -> Unit, onTick: () -> Unit, onClick: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(24.dp)).background(AniColors.Surface)) {
        Box {
            lead?.cover?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, alpha = 0.22f, modifier = Modifier.matchParentSize().blur(24.dp)) }
            Box(Modifier.matchParentSize().background(Brush.horizontalGradient(listOf(Color.Black.copy(alpha = 0.85f), Color.Black.copy(alpha = 0.4f), Color.Transparent))))
            Row(Modifier.padding(22.dp), verticalAlignment = Alignment.CenterVertically) {
                // Beside the docked player the record steps aside to leave room for the buttons.
                AnimatedVisibility(!compact) {
                    Row { Vinyl(lead, spinning, onWatch); Spacer(Modifier.width(24.dp)) }
                }
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.MusicNote, null, tint = AniColors.Accent, modifier = Modifier.size(14.dp))
                        Text(" ANITRACK JUKEBOX", color = AniColors.Accent, fontSize = 11.sp, fontWeight = FontWeight.Black, letterSpacing = 2.sp)
                    }
                    AnimatedContent(
                        scope.title,
                        transitionSpec = { (slideInVertically { it / 2 } + fadeIn()).togetherWith(slideOutVertically { -it / 2 } + fadeOut()) },
                        label = "scope-title",
                    ) { Text(it, color = Color.White, fontSize = 44.sp, fontWeight = FontWeight.Black) }
                    Text(
                        if (scope.type == "all") "Sixty years of openings and endings." else ERA_NOTE[AniSongs.decadeOf(scope.value)].orEmpty(),
                        color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp,
                    )
                    lead?.let {
                        Spacer(Modifier.height(10.dp))
                        Text("#1 ${it.title} · ${it.artist} · ${it.anime}", color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Spacer(Modifier.height(14.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onWatch, enabled = hasChart, colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black)) {
                            Icon(Icons.Rounded.OndemandVideo, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Watch all", fontWeight = FontWeight.Bold)
                        }
                        FilledTonalButton(onClick = onListen, enabled = hasChart) { Icon(Icons.Rounded.Headphones, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Listen") }
                        FilledTonalButton(onClick = onSurprise, enabled = hasChart) { Icon(Icons.Rounded.Casino, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Surprise me") }
                    }
                    Spacer(Modifier.height(10.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Segments(listOf("best" to "Best", "known" to "Most known"), order, onOrder)
                        Segments(listOf("OP" to "Openings", "ED" to "Endings"), kind, onKind)
                        // Here rather than top-right, where the app's Music button floats.
                        SwitchChip("Sounds", sounds, if (sounds) Icons.AutoMirrored.Rounded.VolumeUp else Icons.AutoMirrored.Rounded.VolumeOff, onSounds)
                        SwitchChip("Previews", previews, Icons.Rounded.GraphicEq, onPreviews)
                    }
                }
            }
        }
        YearDial(scope, thisYear, onScope, onTick, onClick)
    }
}

@Composable
private fun Vinyl(song: AniSong?, spinning: Boolean, onClick: () -> Unit) {
    var angle by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(spinning) {
        var last = 0L
        while (spinning && isActive) {
            withFrameMillis { now -> if (last != 0L) angle = (angle + (now - last) * 0.072f) % 360f; last = now }
        }
    }
    Box(Modifier.size(170.dp).clip(CircleShape).clickable(enabled = song != null, onClick = onClick), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize().rotate(angle)) {
            drawCircle(Color(0xFF111111))
            var r = size.minDimension / 2 - 2f
            while (r > size.minDimension * 0.18f) { drawCircle(Color(0xFF1E1E1E), radius = r, style = androidx.compose.ui.graphics.drawscope.Stroke(1.2f)); r -= 5f }
            drawArc(Color.White.copy(alpha = 0.07f), -30f, 50f, true)
            drawArc(Color.White.copy(alpha = 0.05f), 150f, 50f, true)
        }
        Box(Modifier.size(64.dp).rotate(angle).clip(CircleShape).background(AniColors.Accent).border(3.dp, Color.Black.copy(alpha = 0.6f), CircleShape)) {
            song?.cover?.let { AsyncImage(it, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
        }
        Box(Modifier.size(8.dp).clip(CircleShape).background(Color.Black))
    }
}

/** A radio tuner from 1960 to now: drag or tap for a year, tap a decade chip for the decade. */
@Composable
private fun YearDial(scope: Scope, thisYear: Int, onScope: (Scope) -> Unit, onTick: () -> Unit, onClick: () -> Unit) {
    val years = thisYear - AniSongs.FIRST_YEAR + 1
    var width by remember { mutableIntStateOf(1) }
    var lastYear by remember { mutableIntStateOf(-1) }
    fun yearAt(x: Float) = AniSongs.FIRST_YEAR + (x / width * years).toInt().coerceIn(0, years - 1)
    fun tune(year: Int) { if (year != lastYear) { onTick(); lastYear = year }; onScope(Scope("year", year)) }
    val glow by rememberInfiniteTransition(label = "golden").animateFloat(0.35f, 0.9f, infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "glow")
    Column(Modifier.fillMaxWidth().background(Color.Black.copy(alpha = 0.3f)).padding(horizontal = 22.dp, vertical = 12.dp)) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(AniSongs.DECADES) { d ->
                val active = scope.type == "decade" && scope.value == d
                val golden = d in GOLDEN
                Box(
                    Modifier.clip(CircleShape)
                        .background(if (active) Color.White else Color.Transparent)
                        .border(1.dp, if (golden && !active) Gold.copy(alpha = glow * 0.6f) else Color.Transparent, CircleShape)
                        .clickable { onClick(); onScope(Scope("decade", d)) }
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                ) {
                    Text("${d}s", color = if (active) Color.Black else if (golden) Gold else Color.White.copy(alpha = 0.6f), fontWeight = FontWeight.Black, fontSize = 13.sp)
                }
            }
            item {
                val active = scope.type == "all"
                Box(Modifier.clip(CircleShape).background(if (active) Color.White else Color.Transparent).clickable { onClick(); onScope(Scope("all")) }.padding(horizontal = 14.dp, vertical = 6.dp)) {
                    Text("All time", color = if (active) Color.Black else Color.White.copy(alpha = 0.6f), fontWeight = FontWeight.Black, fontSize = 13.sp)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        val accent = AniColors.Accent
        val needle = when (scope.type) { "year" -> scope.value + 0.5f; "decade" -> scope.value + 5f; else -> null }
        BoxWithConstraints(Modifier.fillMaxWidth().height(56.dp)) {
            Canvas(
                Modifier.matchParentSize()
                    .pointerInput(years) { width = size.width; detectTapGestures { tune(yearAt(it.x)) } }
                    .pointerInput(years) {
                        detectHorizontalDragGestures(
                            onDragStart = { lastYear = -1; tune(yearAt(it.x)) },
                            onHorizontalDrag = { change, _ -> tune(yearAt(change.position.x)) },
                        )
                    },
            ) {
                val step = size.width / years
                val x = { year: Float -> (year - AniSongs.FIRST_YEAR) * step }
                drawRect(Gold.copy(alpha = 0.07f), topLeft = Offset(x(1970f), 0f), size = androidx.compose.ui.geometry.Size(step * 30, size.height))
                for (i in 0 until years) {
                    val year = AniSongs.FIRST_YEAR + i
                    val px = x(year + 0.5f)
                    val h = when { year % 10 == 0 -> 30f; year % 5 == 0 -> 20f; else -> 11f }
                    drawLine(Color.White.copy(alpha = if (year % 10 == 0) 0.55f else 0.2f), Offset(px, size.height - 18f - h), Offset(px, size.height - 18f), strokeWidth = if (year % 10 == 0) 2.5f else 1.5f)
                }
                needle?.let {
                    val px = x(it)
                    drawLine(accent, Offset(px, 4f), Offset(px, size.height - 14f), strokeWidth = 5f)
                    drawCircle(accent.copy(alpha = 0.35f), radius = 14f, center = Offset(px, size.height / 2))
                }
            }
            // Decade labels under the scale.
            Row(Modifier.fillMaxWidth().align(Alignment.BottomStart)) {
                for (d in AniSongs.DECADES) {
                    Box(Modifier.weight(if (d == AniSongs.DECADES.last()) (thisYear - d + 1).toFloat() else 10f)) {
                        Text("$d", color = Color.White.copy(alpha = 0.4f), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            if (scope.type == "year") {
                // The year rides on the needle.
                val x = maxWidth * ((scope.value + 0.5f - AniSongs.FIRST_YEAR) / years) - 20.dp
                Text(
                    "${scope.value}", color = Color.White, fontWeight = FontWeight.Black, fontSize = 12.sp,
                    modifier = Modifier.offset(x = x.coerceIn(0.dp, maxWidth - 40.dp), y = (-2).dp).clip(RoundedCornerShape(6.dp)).background(accent).padding(horizontal = 6.dp, vertical = 1.dp),
                )
            }
        }
        Text("Drag the dial for any year", color = AniColors.TextTertiary, fontSize = 11.sp)
    }
}

/** Pill toggles sized to their labels, as desktop's Toggle. */
@Composable
private fun Segments(options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit) {
    Row(Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.06f)).padding(4.dp)) {
        options.forEach { (key, text) ->
            val selected = value == key
            Text(
                text, maxLines = 1, fontWeight = FontWeight.Bold, fontSize = 13.sp,
                color = if (selected) Color.Black else Color.White.copy(alpha = 0.65f),
                modifier = Modifier.clip(CircleShape).background(if (selected) Color.White else Color.Transparent)
                    .clickable { onChange(key) }.padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun SwitchChip(text: String, on: Boolean, icon: ImageVector, onClick: () -> Unit) {
    FilterChip(selected = on, onClick = onClick, label = { Text(text) }, leadingIcon = { Icon(icon, null, Modifier.size(16.dp)) })
}

@Composable
private fun PillTab(text: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.clip(CircleShape).background(if (selected) AniColors.Accent else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 18.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (selected) Color.White else AniColors.TextSecondary, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, color = if (selected) Color.White else AniColors.TextSecondary, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Equalizer() {
    val t = rememberInfiniteTransition(label = "eq")
    Row(Modifier.height(16.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        listOf(0, 150, 300, 80).forEach { offset ->
            val h by t.animateFloat(0.3f, 1f, infiniteRepeatable(tween(350, offset, LinearEasing), RepeatMode.Reverse), label = "bar")
            Box(Modifier.width(3.dp).fillMaxHeight(h).clip(CircleShape).background(AniColors.Accent))
        }
    }
}

@Composable private fun Loading() = Row(Modifier.padding(vertical = 20.dp), verticalAlignment = Alignment.CenterVertically) {
    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = AniColors.Accent)
    Spacer(Modifier.width(10.dp)); Text("Loading songs…", color = AniColors.TextSecondary)
}
@Composable private fun Note(text: String) = Text(text, color = AniColors.TextTertiary, modifier = Modifier.padding(vertical = 16.dp))

// ── Chart ─────────────────────────────────────────────────────────────────

private fun androidx.compose.foundation.lazy.LazyListScope.chartItems(chart: List<AniSong>, order: String, label: String, actions: SongActions, playingId: Int?) {
    item(key = "podium") {
        Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Bottom) {
            listOf(1, 0, 2).forEachIndexed { slot, i ->
                chart.getOrNull(i)?.let { song ->
                    // Number one lands first, then two and three.
                    Box(Modifier.weight(1f).popIn(chart, listOf(110, 0, 220)[slot], from = 0.85f)) {
                        PodiumCard(song, i + 1, order, playingId == song.id, { actions.watch(chart, i, label) }, { actions.preview(song) })
                    }
                }
            }
        }
    }
    item(key = "rest") { ChartRest(chart, order, label, actions, playingId) }
}

@Composable
private fun ChartRest(chart: List<AniSong>, order: String, label: String, actions: SongActions, playingId: Int?) {
    var expanded by remember(chart) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        chart.drop(3).take(if (expanded) chart.size else CHART_PREVIEW - 3).forEachIndexed { i, song ->
            SongRow(song, rank = i + 4, order = order, playing = playingId == song.id, modifier = Modifier.popIn(chart, 160 + minOf(i, 20) * 22, from = 0.97f), onWatch = { actions.watch(chart, i + 3, label) }, onListen = { actions.listen(chart, i + 3, label) }, onPreview = { actions.preview(song) }, onOpenAnime = actions.openAnime)
        }
        if (chart.size > CHART_PREVIEW) TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Show the top 20" else "Show all ${chart.size}") }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PodiumCard(song: AniSong, rank: Int, order: String, onScreen: Boolean, onWatch: () -> Unit, onPreview: () -> Unit) {
    val color = PODIUM[rank - 1]
    val playing = SongPreview.playingId == song.id || onScreen
    Box(
        Modifier.fillMaxWidth().height(if (rank == 1) 240.dp else 200.dp).clip(RoundedCornerShape(18.dp))
            .border(if (playing) 3.dp else 1.dp, color.copy(alpha = if (playing) 0.9f else 0.45f), RoundedCornerShape(18.dp))
            .combinedClickable(onClick = onWatch, onLongClick = onPreview),
    ) {
        if (song.cover != null) AsyncImage(song.cover, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
        else Box(Modifier.matchParentSize().background(AniColors.SurfaceHigh))
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.6f), Color.Black))))
        Box(Modifier.padding(10.dp).size(38.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) {
            Text("$rank", color = Color.Black, fontWeight = FontWeight.Black, fontSize = 18.sp)
        }
        if (playing) Box(Modifier.align(Alignment.TopEnd).padding(12.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)).padding(8.dp)) { Equalizer() }
        Column(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
            Text(song.title, color = Color.White, fontWeight = FontWeight.Black, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(song.artist, color = Color.White.copy(alpha = 0.65f), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(listOfNotNull(song.anime, AniSongs.slug(song), song.year?.toString()).joinToString(" · "), color = Color.White.copy(alpha = 0.45f), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Score(song, order, compact = true)
            }
        }
    }
}

@Composable
private fun Score(song: AniSong, order: String?, compact: Boolean = false) {
    when (order) {
        "best" -> if (song.licensed) Text("not counted", color = Color.White.copy(alpha = 0.4f), fontSize = 11.sp) else Text(song.views?.let { "▶ ${compactCount(it)}${if (compact) "" else " views"}" } ?: song.listeners?.let { "♫ ${compactCount(it)}${if (compact) "" else " listeners"}" } ?: "—", color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        "known" -> song.recognition?.let { Text("${it.toInt()}%${if (compact) "" else " know it"}", color = Color.White.copy(alpha = 0.7f), fontSize = 11.sp, fontWeight = FontWeight.SemiBold) }
        else -> {}
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SongRow(
    song: AniSong, rank: Int?, order: String?, onWatch: () -> Unit, onListen: () -> Unit, onPreview: () -> Unit, onOpenAnime: (Int) -> Unit,
    playing: Boolean = false, modifier: Modifier = Modifier,
) {
    val playing = SongPreview.playingId == song.id || playing
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (playing) AniColors.AccentSoft else Color.Transparent)
            .combinedClickable(enabled = song.video != null, onClick = onWatch, onLongClick = onPreview).padding(horizontal = 6.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (rank != null) Text("$rank", modifier = Modifier.width(32.dp), fontWeight = FontWeight.Black, color = AniColors.TextTertiary, fontSize = 14.sp)
        Box(Modifier.size(52.dp).clip(RoundedCornerShape(10.dp)).background(AniColors.SurfaceHighest), contentAlignment = Alignment.Center) {
            if (song.cover != null) AsyncImage(song.cover, null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
            else Icon(Icons.Rounded.Album, null, tint = AniColors.TextTertiary)
            if (playing) Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = 0.5f)), contentAlignment = Alignment.Center) { Equalizer() }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(song.title, color = AniColors.Text, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(song.artist, song.anime, AniSongs.slug(song), song.season).joinToString(" · "),
                color = AniColors.TextSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = if (song.anilistId != null) Modifier.clickable { onOpenAnime(song.anilistId) } else Modifier,
            )
        }
        Box(Modifier.width(90.dp).padding(end = 6.dp), contentAlignment = Alignment.CenterEnd) { Score(song, order) }
        IconButton(onClick = onListen, enabled = song.audio != null) { Icon(Icons.Rounded.Headphones, "Listen", tint = AniColors.TextSecondary) }
    }
}

// ── Seasons ───────────────────────────────────────────────────────────────

/** One season of the dial's year (or the newest one), fetched live and ranked by quiz score. */
@Composable
private fun SeasonsView(startYear: Int, kind: String, thisYear: Int, actions: SongActions, onClick: () -> Unit) {
    var year by remember(startYear) { mutableIntStateOf(startYear) }
    var season by remember { mutableStateOf("latest") }
    var title by remember { mutableStateOf<String?>(null) }
    var songs by remember { mutableStateOf<List<AniSong>?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(season, year) {
        songs = null; failed = false
        try {
            if (season == "latest") {
                var (s, y) = AniSongs.seasonOf(System.currentTimeMillis())
                repeat(3) {
                    val found = AniSongs.season(s, y)
                    if (found.isNotEmpty()) { title = "$s $y"; songs = found; return@LaunchedEffect }
                    AniSongs.previousSeason(s, y).let { (ps, py) -> s = ps; y = py }
                }
                failed = true
            } else {
                songs = AniSongs.season(season, year); title = "$season $year"
            }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { failed = true }
    }
    val looks = mapOf(
        "Winter" to (Icons.Rounded.AcUnit to Color(0xFF38BDF8)), "Spring" to (Icons.Rounded.LocalFlorist to Color(0xFFF472B6)),
        "Summer" to (Icons.Rounded.WbSunny to Color(0xFFFBBF24)), "Fall" to (Icons.Rounded.Eco to Color(0xFFEA580C)),
    )
    Column {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SeasonCard("Latest", "Newest songs", Icons.Rounded.AutoAwesome, AniColors.Accent, season == "latest", Modifier.weight(1f)) { onClick(); season = "latest" }
            AniSongs.SEASONS.forEach { s ->
                val (icon, tint) = looks.getValue(s)
                SeasonCard(s, "$year", icon, tint, season == s, Modifier.weight(1f)) { onClick(); season = s }
            }
        }
        if (season != "latest") {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
                IconButton(onClick = { onClick(); year = (year - 1).coerceAtLeast(AniSongs.FIRST_YEAR) }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "Previous year", tint = AniColors.Text) }
                Text("$year", color = AniColors.Text, fontWeight = FontWeight.Black, fontSize = 20.sp)
                IconButton(onClick = { onClick(); year = (year + 1).coerceAtMost(thisYear) }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "Next year", tint = AniColors.Text) }
                Text("Seasons are fetched live and ranked by how many fans know them.", color = AniColors.TextTertiary, fontSize = 12.sp)
            }
        }
        Spacer(Modifier.height(10.dp))
        val ranked = songs?.let { AniSongs.rank(it, kind, 60) }
        val label = "${title.orEmpty()} · ${if (kind == "OP") "openings" else "endings"}"
        when {
            failed -> Note("Couldn't reach AnisongDB. Try again later.")
            ranked == null -> Loading()
            ranked.isEmpty() -> Note("No ${if (kind == "OP") "openings" else "endings"} with videos for ${title.orEmpty()}.")
            else -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(label, color = AniColors.TextSecondary, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 4.dp))
                ranked.forEachIndexed { i, song ->
                    SongRow(song, rank = null, order = if (season == "latest") null else "known", onWatch = { actions.watch(ranked, i, label) }, onListen = { actions.listen(ranked, i, label) }, onPreview = { actions.preview(song) }, onOpenAnime = actions.openAnime)
                }
            }
        }
    }
}

@Composable
private fun SeasonCard(title: String, sub: String, icon: ImageVector, tint: Color, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.clip(RoundedCornerShape(18.dp))
            .border(1.dp, if (selected) tint else Color.White.copy(alpha = 0.1f), RoundedCornerShape(18.dp))
            .background(Brush.linearGradient(listOf(tint.copy(alpha = if (selected) 0.35f else 0.18f), Color.Transparent)))
            .clickable(onClick = onClick).padding(14.dp),
    ) {
        Icon(icon, null, tint = tint)
        Spacer(Modifier.height(6.dp))
        Text(title, color = AniColors.Text, fontWeight = FontWeight.Black)
        Text(sub, color = AniColors.TextTertiary, fontSize = 11.sp)
    }
}

// ── Search ────────────────────────────────────────────────────────────────

@Composable
private fun SearchView(actions: SongActions) {
    var query by remember { mutableStateOf("") }
    var by by remember { mutableStateOf("song") }
    var submitted by remember { mutableStateOf<Pair<String, String>?>(null) }
    var songs by remember { mutableStateOf<List<AniSong>?>(null) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(submitted) {
        val (q, b) = submitted ?: return@LaunchedEffect
        busy = true
        songs = try {
            val found = AniSongs.search(q, b)
            AniSongs.rank(found, null, 60) + found.filter { it.recognition == null && it.video != null }.take(20)
        } catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() }
        busy = false
    }
    Column {
        OutlinedTextField(
            value = query, onValueChange = { query = it }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = CircleShape,
            leadingIcon = { Icon(Icons.Rounded.Search, null) },
            placeholder = { Text(when (by) { "artist" -> "Artist, e.g. LiSA"; "anime" -> "Anime, e.g. Cowboy Bebop"; else -> "Song title, e.g. Tank!" }) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { if (query.trim().length >= 2) submitted = query.trim() to by }),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 10.dp)) {
            Segments(listOf("song" to "Song", "artist" to "Artist", "anime" to "Anime"), by) { by = it }
            Button(onClick = { if (query.trim().length >= 2) submitted = query.trim() to by }) { Text("Search") }
        }
        val label = "“${submitted?.first.orEmpty()}”"
        when {
            busy -> Loading()
            songs == null -> {}
            songs!!.isEmpty() -> Note("No songs found.")
            else -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                songs!!.forEachIndexed { i, song ->
                    SongRow(song, rank = null, order = "known", onWatch = { actions.watch(songs!!, i, label) }, onListen = { actions.listen(songs!!, i, label) }, onPreview = { actions.preview(song) }, onOpenAnime = actions.openAnime)
                }
            }
        }
    }
}

/** Pops in once, [delayMs] after it first appears: the podium and chart rows. */
private fun Modifier.popIn(key: Any, delayMs: Int, from: Float = 0.9f): Modifier = composed {
    val progress = remember(key) { Animatable(0f) }
    LaunchedEffect(key) { delay(delayMs.toLong()); progress.animateTo(1f, spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessLow)) }
    graphicsLayer {
        val p = progress.value
        alpha = p.coerceIn(0f, 1f)
        scaleX = from + (1f - from) * p
        scaleY = from + (1f - from) * p
        translationY = (1f - p) * 24.dp.toPx()
    }
}

/** A song as the video player takes it. */
private fun songItem(song: AniSong) = VideoItem(
    key = song.id.toString(),
    title = song.title,
    byline = listOfNotNull(song.artist, song.anime, AniSongs.slug(song), song.year?.toString()).joinToString(" · "),
    cover = song.cover,
    url = AniSongs.videoUrl(song)!!,
)
