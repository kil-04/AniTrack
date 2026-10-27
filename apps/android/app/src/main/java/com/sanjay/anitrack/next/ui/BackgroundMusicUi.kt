package com.sanjay.anitrack.next.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.GraphicEq
import androidx.compose.material.icons.rounded.LibraryAdd
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.VolumeDown
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.sanjay.anitrack.next.data.BackgroundMusic
import com.sanjay.anitrack.next.data.BackgroundMusic.Hold
import com.sanjay.anitrack.next.data.BackgroundMusicRules.Mode
import kotlinx.coroutines.launch

private fun modeLabel(mode: Mode) = when (mode) {
    Mode.ALL -> "Play all"
    Mode.ONE -> "Repeat one"
    Mode.SHUFFLE -> "Shuffle"
}

private fun modeIcon(mode: Mode) = when (mode) {
    Mode.ALL -> Icons.Rounded.Repeat
    Mode.ONE -> Icons.Rounded.RepeatOne
    Mode.SHUFFLE -> Icons.Rounded.Shuffle
}

/** What the music is doing, in a few words. */
@Composable
private fun musicStatus(): String {
    val tracks by BackgroundMusic.tracks
    val enabled by BackgroundMusic.enabled
    val paused by BackgroundMusic.paused
    val holds by BackgroundMusic.holds
    val playing by BackgroundMusic.isPlaying
    BackgroundMusic.trackId.value // Recompose when the track changes.
    val current = BackgroundMusic.current
    return when {
        tracks.isEmpty() -> "No tracks yet"
        !enabled -> "Off"
        paused -> "Paused"
        Hold.PLAYER in holds || Hold.EPISODE in holds -> "Paused while an episode plays"
        Hold.THEME in holds || Hold.VIDEO in holds -> "Paused while a theme song plays"
        Hold.BACKGROUND in holds -> "Paused while AniTrack is in the background"
        playing && current != null -> "Playing ${current.title}"
        else -> "Starting…"
    }
}

/** Previous, Play/Pause and Next; [small] for the top bar. */
@Composable
private fun Transport(small: Boolean) {
    val tracks by BackgroundMusic.tracks
    val enabled by BackgroundMusic.enabled
    val paused by BackgroundMusic.paused
    val on = enabled && !paused
    val side: Dp = if (small) 32.dp else 40.dp
    val playSize: Dp = if (small) 30.dp else 44.dp
    Row(verticalAlignment = Alignment.CenterVertically) {
        RoundIcon(Icons.Rounded.SkipPrevious, "Previous track", side, enabled = tracks.isNotEmpty()) { BackgroundMusic.previous() }
        Box(
            Modifier.size(playSize).clip(CircleShape).background(Color.White)
                .clickable(enabled = tracks.isNotEmpty(), role = Role.Button) { BackgroundMusic.togglePlay() },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                if (on) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                contentDescription = if (on) "Pause music" else "Play music",
                tint = Color.Black,
                modifier = Modifier.size(if (small) 18.dp else 26.dp),
            )
        }
        RoundIcon(Icons.Rounded.SkipNext, "Next track", side, enabled = tracks.isNotEmpty()) { BackgroundMusic.next() }
    }
}

@Composable
private fun RoundIcon(
    icon: ImageVector,
    description: String,
    size: Dp,
    tint: Color = AniColors.TextSecondary,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        Modifier.size(size).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, description, tint = if (enabled) tint else tint.copy(alpha = 0.4f), modifier = Modifier.size(size * 0.55f))
    }
}

/** The Settings card: on/off, transport, order, volume, import and the track list. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun BackgroundMusicCard() {
    val tracks by BackgroundMusic.tracks
    val enabled by BackgroundMusic.enabled
    val paused by BackgroundMusic.paused
    val mode by BackgroundMusic.mode
    val trackId by BackgroundMusic.trackId
    val defaultId by BackgroundMusic.defaultId
    val volume by BackgroundMusic.volume
    val playing by BackgroundMusic.isPlaying
    val status = musicStatus()
    val scope = rememberCoroutineScope()
    var importing by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, Boolean?>?>(null) }
    var confirming by remember { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        importing = true
        message = "Importing…" to null
        scope.launch {
            val result = runCatching { BackgroundMusic.import(uris) }.getOrNull()
            importing = false
            message = when {
                result == null -> "Import failed." to false
                result.added == 0 && result.skipped == 0 -> "No audio files found." to false
                else -> buildString {
                    append(if (result.added > 0) "Added ${result.added} track${if (result.added == 1) "" else "s"}" else "No new tracks")
                    if (result.skipped > 0) append(" · ${result.skipped} skipped (already there, too large or unreadable)")
                } to (result.added > 0)
            }
        }
    }
    val current = trackId.let { id -> tracks.firstOrNull { it.id == id } } ?: tracks.firstOrNull()

    SettingsSection(
        Icons.Rounded.MusicNote,
        "Background music",
        "Plays while you browse. It pauses for episodes, theme songs and while AniTrack is in the background. Star a track to open the app with it.",
    ) {
        SwitchRow("Background music", status, enabled) { BackgroundMusic.setEnabled(it) }
        Spacer(Modifier.height(10.dp))
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Transport(small = false)
            Spacer(Modifier.width(4.dp))
            listOf(Mode.ALL, Mode.ONE, Mode.SHUFFLE).forEach { m ->
                val selected = mode == m
                Row(
                    Modifier.height(34.dp).clip(aniShape(50))
                        .background(if (selected) AniColors.AccentSoft else Color.White.copy(alpha = 0.05f))
                        .border(1.dp, if (selected) AniColors.Accent.copy(alpha = 0.5f) else AniColors.BorderSoft, aniShape(50))
                        .clickable(role = Role.RadioButton) { BackgroundMusic.setMode(m) }
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(modeIcon(m), null, tint = if (selected) AniColors.Text else AniColors.TextSecondary, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(modeLabel(m), style = MaterialTheme.typography.labelLarge, color = if (selected) AniColors.Text else AniColors.TextSecondary)
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                when { volume == 0f -> Icons.Rounded.VolumeOff; volume < 0.5f -> Icons.Rounded.VolumeDown; else -> Icons.Rounded.VolumeUp },
                null, tint = AniColors.TextTertiary, modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(8.dp))
            Slider(
                value = volume,
                onValueChange = { BackgroundMusic.setVolume(it) },
                modifier = Modifier.weight(1f),
                colors = SliderDefaults.colors(thumbColor = AniColors.Accent, activeTrackColor = AniColors.Accent),
            )
            Spacer(Modifier.width(8.dp))
            Text("${(volume * 100).toInt()}%", style = MaterialTheme.typography.labelMedium, color = AniColors.TextTertiary, modifier = Modifier.width(40.dp))
        }
        Spacer(Modifier.height(4.dp))
        PillButton(
            "Import music…",
            onClick = { picker.launch(arrayOf("audio/*", "application/zip", "application/x-zip-compressed")) },
            icon = Icons.Rounded.LibraryAdd,
            style = PillStyle.Primary,
            loading = importing,
            compact = true,
        )
        message?.let { (text, ok) ->
            Spacer(Modifier.height(8.dp))
            StatusLine(text, ok)
        }
        Spacer(Modifier.height(12.dp))
        if (tracks.isEmpty()) {
            Text(
                "No tracks yet. Import MP3, M4A, OGG, FLAC or WAV files, or a .zip of them.",
                style = MaterialTheme.typography.bodySmall,
                color = AniColors.TextTertiary,
            )
        } else {
            LazyColumn(
                Modifier.fillMaxWidth().heightIn(max = 360.dp).clip(aniShape(12.dp))
                    .border(1.dp, AniColors.BorderSoft, aniShape(12.dp)).padding(4.dp),
            ) {
                items(tracks, key = { it.id }) { track ->
                    val isCurrent = track.id == current?.id
                    val isDefault = track.id == defaultId
                    Row(
                        Modifier.fillMaxWidth().clip(aniShape(8.dp))
                            .background(if (isCurrent) AniColors.AccentSoft else Color.Transparent)
                            .clickable { if (isCurrent) BackgroundMusic.togglePlay() else BackgroundMusic.select(track.id) }
                            .padding(start = 8.dp, end = 2.dp, top = 2.dp, bottom = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.width(30.dp), contentAlignment = Alignment.Center) {
                            if (isCurrent && enabled && !paused && playing) {
                                Icon(Icons.Rounded.GraphicEq, "Playing", tint = AniColors.Accent, modifier = Modifier.size(18.dp))
                            } else if (track.number != null) {
                                Text("${track.number}", style = MaterialTheme.typography.labelMedium, color = if (isCurrent) AniColors.Accent else AniColors.TextTertiary)
                            } else {
                                Icon(Icons.Rounded.MusicNote, null, tint = if (isCurrent) AniColors.Accent else AniColors.TextTertiary, modifier = Modifier.size(16.dp))
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                        Text(
                            track.title,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = if (isCurrent) FontWeight.SemiBold else FontWeight.Normal,
                            color = if (isCurrent) AniColors.Text else AniColors.TextSecondary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (track.bundled) {
                            Text("Built in", style = MaterialTheme.typography.labelSmall, color = AniColors.TextTertiary)
                            Spacer(Modifier.width(4.dp))
                        }
                        if (confirming == track.id) {
                            TextButton(onClick = { confirming = null; BackgroundMusic.remove(track.id) }) {
                                Text("Remove", color = AniColors.Danger)
                            }
                            TextButton(onClick = { confirming = null }) { Text("Keep", color = AniColors.TextSecondary) }
                        } else {
                            RoundIcon(
                                if (isDefault) Icons.Rounded.Star else Icons.Rounded.StarBorder,
                                if (isDefault) "Default track: AniTrack opens with it" else "Make this the default track",
                                36.dp,
                                tint = if (isDefault) AniColors.Accent else AniColors.TextTertiary,
                            ) { BackgroundMusic.setDefault(if (isDefault) null else track.id) }
                            if (track.bundled) {
                                Spacer(Modifier.size(36.dp))
                            } else {
                                RoundIcon(Icons.Rounded.DeleteOutline, "Remove ${track.title}", 36.dp, tint = AniColors.TextTertiary) {
                                    confirming = track.id
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * The music controls floating under the top bar, styled like Home's Anime | Manga
 * switch: a Music segment (on/off; long-press for Settings), then Previous,
 * Play/Pause, Next and Repeat while it is on. [compact] drops the label and Repeat. (A phone
 * shows [BackgroundMusicButton] in its top bar instead.)
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BackgroundMusicBar(compact: Boolean, onOpenSettings: () -> Unit, modifier: Modifier = Modifier) {
    val tracks by BackgroundMusic.tracks
    val enabled by BackgroundMusic.enabled
    val paused by BackgroundMusic.paused
    val mode by BackgroundMusic.mode
    val playing by BackgroundMusic.isPlaying
    if (tracks.isEmpty()) return
    val status = musicStatus()
    val on = enabled && !paused
    val shape = aniShape(50)
    val labelColor = if (enabled) Color.White else Color.White.copy(alpha = 0.7f)
    Row(
        modifier
            .clip(shape)
            .background(Color.Black.copy(alpha = 0.62f))
            .border(1.dp, Color.White.copy(alpha = 0.12f), shape)
            .padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.clip(shape)
                .then(if (enabled) Modifier.background(AniColors.BrandGradient) else Modifier)
                .combinedClickable(role = Role.Switch, onLongClick = onOpenSettings) { BackgroundMusic.toggle() }
                .padding(horizontal = if (compact) 10.dp else 14.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                if (on && playing) Icons.Rounded.GraphicEq else Icons.Rounded.MusicNote,
                contentDescription = if (enabled) "Background music on: $status. Tap to turn off." else "Turn background music on",
                tint = labelColor,
                modifier = Modifier.size(17.dp),
            )
            if (!compact) {
                Spacer(Modifier.width(7.dp))
                Text(
                    "Music",
                    color = labelColor,
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = if (enabled) FontWeight.Bold else FontWeight.Medium,
                )
            }
        }
        if (enabled) {
            Spacer(Modifier.width(2.dp))
            PillIcon(Icons.Rounded.SkipPrevious, "Previous track") { BackgroundMusic.previous() }
            PillIcon(if (on) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (on) "Pause music" else "Play music") {
                BackgroundMusic.togglePlay()
            }
            PillIcon(Icons.Rounded.SkipNext, "Next track") { BackgroundMusic.next() }
            if (!compact) PillIcon(modeIcon(mode), "Playback order: ${modeLabel(mode)}") { BackgroundMusic.cycleMode() }
        }
    }
}

/**
 * A phone's Music switch: one round button in the top bar (on/off; long-press for Settings,
 * where the full controls are), so nothing floats over the top of each page.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun BackgroundMusicButton(onOpenSettings: () -> Unit, modifier: Modifier = Modifier) {
    val tracks by BackgroundMusic.tracks
    val enabled by BackgroundMusic.enabled
    val paused by BackgroundMusic.paused
    val playing by BackgroundMusic.isPlaying
    if (tracks.isEmpty()) return
    val status = musicStatus()
    Box(
        modifier.size(40.dp).clip(CircleShape)
            .then(if (enabled) Modifier.background(AniColors.BrandGradient) else Modifier.background(AniColors.SurfaceHigh))
            .border(1.dp, if (enabled) Color.Transparent else AniColors.BorderSoft, CircleShape)
            .combinedClickable(role = Role.Switch, onLongClick = onOpenSettings) { BackgroundMusic.toggle() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (enabled && !paused && playing) Icons.Rounded.GraphicEq else Icons.Rounded.MusicNote,
            contentDescription = if (enabled) "Background music on: $status. Tap to turn off." else "Turn background music on",
            tint = if (enabled) Color.White else AniColors.TextSecondary,
            modifier = Modifier.size(19.dp),
        )
    }
}

/** A white icon button the height of the Music segment. */
@Composable
private fun PillIcon(icon: ImageVector, description: String, onClick: () -> Unit) {
    Box(
        Modifier.size(34.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, description, tint = Color.White.copy(alpha = 0.9f), modifier = Modifier.size(20.dp))
    }
}
