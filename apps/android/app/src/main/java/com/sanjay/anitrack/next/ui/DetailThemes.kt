package com.sanjay.anitrack.next.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.AnimeThemes
import com.sanjay.anitrack.next.data.PlayerHolder
import com.sanjay.anitrack.next.data.ThemePlayer
import com.sanjay.anitrack.next.data.ThemeSong
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ── Theme songs: a show's openings and endings (AnimeThemes.moe) ──────────────

private val OpeningTone = Color(0xFFFF5C7A)
private val EndingTone = Color(0xFF7AA7FF)

private fun episodesLabel(episodes: String?): String? =
    episodes?.takeIf { it.isNotBlank() }?.let { if (it.contains('-') || it.contains(',')) "Eps ${it.replace("-", "–")}" else "Ep $it" }

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ThemesSection(anime: Anime) {
    val context = LocalContext.current
    var songs by remember(anime.id) { mutableStateOf<List<ThemeSong>>(emptyList()) }
    var video by remember(anime.id) { mutableStateOf<ThemeSong?>(null) }
    LaunchedEffect(anime.id) {
        songs = runCatching { AnimeThemes.forAnime(anime) }.getOrDefault(emptyList())
    }
    if (songs.isEmpty()) return
    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 820
    val playingHere = ThemePlayer.current?.animeId == anime.id
    Column(Modifier.padding(bottom = 8.dp)) {
        SectionHeader("Theme songs", trailing = {
            PillButton(
                if (playingHere && ThemePlayer.isPlaying.value) "Pause" else "Play all",
                {
                    if (playingHere) ThemePlayer.toggle()
                    else ThemePlayer.play(context, songs, 0, anime.title)
                },
                icon = if (playingHere && ThemePlayer.isPlaying.value) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                compact = true,
                style = PillStyle.Tonal,
            )
            Spacer(Modifier.width(8.dp))
        })
        FlowRow(
            Modifier.padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            songs.forEachIndexed { i, song ->
                ThemeRow(
                    song,
                    Modifier.then(if (wide) Modifier.width(380.dp) else Modifier.fillMaxWidth()),
                    onPlay = {
                        if (ThemePlayer.isCurrent(song)) ThemePlayer.toggle()
                        else ThemePlayer.play(context, songs, i, anime.title)
                    },
                    onWatch = { video = song },
                )
            }
        }
        Text(
            "Songs and creditless videos from AnimeThemes.moe.",
            style = MaterialTheme.typography.labelSmall,
            color = AniColors.TextTertiary,
            modifier = Modifier.padding(start = 16.dp, top = 10.dp),
        )
    }
    video?.let { ThemeVideoDialog(it, onClose = { video = null }) }
}

@Composable
private fun ThemeRow(song: ThemeSong, modifier: Modifier, onPlay: () -> Unit, onWatch: () -> Unit) {
    val current = ThemePlayer.isCurrent(song)
    val playing = current && ThemePlayer.isPlaying.value
    val tone = if (song.isOpening) OpeningTone else EndingTone
    val shape = RoundedCornerShape(14.dp)
    Row(
        modifier.clip(shape)
            .background(if (current) tone.copy(alpha = 0.12f) else AniColors.Surface)
            .border(1.dp, if (current) tone.copy(alpha = 0.45f) else AniColors.BorderSoft, shape)
            .clickable(enabled = song.audioUrl != null, onClick = onPlay)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(46.dp).clip(RoundedCornerShape(10.dp)).background(tone.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center,
        ) {
            if (current) {
                Icon(if (playing) Icons.Rounded.GraphicEq else Icons.Rounded.PlayArrow, null, tint = tone, modifier = Modifier.size(24.dp))
            } else {
                Text(song.slug.substringBefore('-'), color = tone, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Black)
            }
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(song.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                song.artistLine ?: "Unknown artist",
                style = MaterialTheme.typography.labelMedium,
                color = AniColors.TextSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    metaLine(song.slug.takeIf { it.contains('-') }, episodesLabel(song.episodes)),
                    style = MaterialTheme.typography.labelSmall,
                    color = AniColors.TextTertiary,
                )
                if (song.spoiler) {
                    Spacer(Modifier.width(6.dp))
                    Tag("Spoiler", tone = TagTone.Outline)
                }
            }
        }
        if (song.videoUrl != null && !song.nsfw) {
            IconButton(onClick = onWatch) {
                Icon(Icons.Rounded.Movie, "Watch the creditless video", tint = AniColors.TextSecondary)
            }
        }
    }
}

/** Plays a theme's creditless video full screen. */
@Composable
internal fun ThemeVideoDialog(song: ThemeSong, onClose: () -> Unit) {
    val context = LocalContext.current
    val url = song.videoUrl ?: return
    val exo = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(exo) {
        ThemePlayer.pause()
        PlayerHolder.peek()?.pause()
        onDispose { exo.release() }
    }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AndroidView(
                factory = { PlayerView(it).apply { player = exo; useController = true } },
                modifier = Modifier.fillMaxSize(),
            )
            Column(Modifier.align(Alignment.TopStart).padding(20.dp)) {
                Text("${song.slug} · ${song.title}", color = Color.White, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    listOfNotNull(song.artistLine, song.animeTitle).joinToString(" — "),
                    color = Color.White.copy(alpha = 0.7f),
                    style = MaterialTheme.typography.labelMedium,
                )
            }
            GlassIconButton(Icons.Rounded.Close, "Close", onClose, Modifier.align(Alignment.TopEnd).padding(16.dp), size = 40.dp)
        }
    }
}

/** The now-playing bar for theme songs, above every page. */
@Composable
internal fun ThemeBar(modifier: Modifier = Modifier, onOpenAnime: (Int) -> Unit) {
    val song = ThemePlayer.current ?: return
    val playing by ThemePlayer.isPlaying
    val buffering by ThemePlayer.buffering
    var progress by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(song.key, playing) {
        while (true) {
            progress = ThemePlayer.progress()
            delay(500)
        }
    }
    val tone = if (song.isOpening) OpeningTone else EndingTone
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier.clip(shape).background(AniColors.SurfaceHigh).border(1.dp, AniColors.Border, shape),
    ) {
        Row(
            Modifier.clickable { onOpenAnime(song.animeId) }.padding(start = 10.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PosterImage(song.cover, song.animeTitle, Modifier.size(44.dp).clip(RoundedCornerShape(8.dp)))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    "${song.slug} · ${song.title}",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    ThemePlayer.problem.value ?: listOfNotNull(song.artistLine, ThemePlayer.label.value ?: song.animeTitle).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (ThemePlayer.problem.value != null) AniColors.Danger else AniColors.TextSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            IconButton(onClick = { ThemePlayer.previous() }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Rounded.SkipPrevious, "Previous", tint = AniColors.Text)
            }
            IconButton(onClick = { ThemePlayer.toggle() }, modifier = Modifier.size(40.dp)) {
                if (buffering && !playing) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = tone)
                } else {
                    Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Pause" else "Play", tint = Color.White)
                }
            }
            IconButton(onClick = { ThemePlayer.next() }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Rounded.SkipNext, "Next", tint = AniColors.Text)
            }
            IconButton(onClick = { ThemePlayer.stop() }, modifier = Modifier.size(36.dp)) {
                Icon(Icons.Rounded.Close, "Stop", tint = AniColors.TextTertiary)
            }
        }
        ProgressStrip(progress, Modifier.fillMaxWidth(), height = 2.dp, color = tone, track = Color.Transparent)
    }
}

private const val RADIO_LABEL = "Theme radio"

/** Shuffles openings and endings from the shows you've watched. */
@Composable
internal fun ThemeRadioButton() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var building by remember { mutableStateOf(false) }
    val onAir = ThemePlayer.label.value == RADIO_LABEL && ThemePlayer.current != null
    PillButton(
        when {
            onAir && ThemePlayer.isPlaying.value -> "Pause radio"
            onAir -> "Resume radio"
            else -> RADIO_LABEL
        },
        {
            if (onAir) {
                ThemePlayer.toggle()
            } else {
                building = true
                scope.launch {
                    val songs = runCatching { com.sanjay.anitrack.next.data.ThemeRadio.build() }.getOrDefault(emptyList())
                    building = false
                    if (songs.isNotEmpty()) ThemePlayer.play(context, songs, 0, RADIO_LABEL)
                    else android.widget.Toast.makeText(context, "No theme songs found for your shows yet.", android.widget.Toast.LENGTH_SHORT).show()
                }
            }
        },
        icon = if (onAir && ThemePlayer.isPlaying.value) Icons.Rounded.Pause else Icons.Rounded.Shuffle,
        loading = building,
        compact = true,
        style = PillStyle.Tonal,
    )
}
