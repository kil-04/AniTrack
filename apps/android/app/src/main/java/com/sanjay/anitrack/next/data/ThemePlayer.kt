package com.sanjay.anitrack.next.data

import android.content.Context
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * Plays theme songs (AnimeThemes audio) as a queue: a show's openings and endings,
 * or the theme radio. Separate from the episode player, and never both at once.
 * Used from the main thread only.
 */
object ThemePlayer {
    val queue = mutableStateListOf<ThemeSong>()
    val index = mutableIntStateOf(-1)
    val isPlaying = mutableStateOf(false)
    val buffering = mutableStateOf(false)
    /** What the queue is ("Frieren", "Theme radio"), shown in the now-playing bar. */
    val label = mutableStateOf<String?>(null)
    val problem = mutableStateOf<String?>(null)

    val current: ThemeSong? get() = queue.getOrNull(index.intValue)

    private var player: ExoPlayer? = null

    private fun ensure(context: Context): ExoPlayer = player ?: ExoPlayer.Builder(context.applicationContext)
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
            /* handleAudioFocus = */ true,
        )
        .setHandleAudioBecomingNoisy(true)
        .build()
        .also { created ->
            created.addListener(object : Player.Listener {
                override fun onIsPlayingChanged(playing: Boolean) {
                    isPlaying.value = playing
                }

                override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                    index.intValue = created.currentMediaItemIndex
                    problem.value = null
                }

                override fun onPlaybackStateChanged(state: Int) {
                    buffering.value = state == Player.STATE_BUFFERING
                }

                override fun onEvents(player: Player, events: Player.Events) {
                    val state = player.playbackState
                    BackgroundMusic.setHold(
                        BackgroundMusic.Hold.THEME,
                        player.playWhenReady && state != Player.STATE_ENDED && state != Player.STATE_IDLE,
                    )
                }

                override fun onPlayerError(error: PlaybackException) {
                    // A missing file shouldn't end the queue: note it and move on.
                    problem.value = "Couldn't play ${current?.title ?: "that theme"}."
                    if (created.hasNextMediaItem()) {
                        created.seekToNextMediaItem()
                        created.prepare()
                        created.play()
                    }
                }
            })
            player = created
        }

    /** Starts [songs] at [start] (songs without audio are skipped). */
    fun play(context: Context, songs: List<ThemeSong>, start: Int = 0, label: String? = null) {
        val playable = songs.filter { it.audioUrl != null }
        if (playable.isEmpty()) return
        val wanted = songs.getOrNull(start)?.key
        val startAt = playable.indexOfFirst { it.key == wanted }.coerceAtLeast(0)
        PlayerHolder.peek()?.pause() // One thing playing at a time.
        // Before this player asks for audio focus, so the background music steps aside rather than losing it.
        BackgroundMusic.setHold(BackgroundMusic.Hold.THEME, true)
        val exo = ensure(context)
        queue.clear()
        queue.addAll(playable)
        this.label.value = label
        problem.value = null
        exo.setMediaItems(
            playable.map { song ->
                MediaItem.Builder()
                    .setUri(song.audioUrl)
                    .setMediaId(song.key)
                    .setMediaMetadata(
                        MediaMetadata.Builder()
                            .setTitle(song.title)
                            .setArtist(song.artistLine)
                            .setAlbumTitle(song.animeTitle)
                            .build(),
                    )
                    .build()
            },
            startAt,
            0L,
        )
        exo.prepare()
        exo.play()
        index.intValue = startAt
    }

    fun isCurrent(song: ThemeSong) = current?.key == song.key

    fun toggle() {
        val exo = player ?: return
        if (exo.isPlaying) {
            exo.pause()
        } else {
            PlayerHolder.peek()?.pause()
            BackgroundMusic.setHold(BackgroundMusic.Hold.THEME, true)
            if (exo.playbackState == Player.STATE_ENDED) exo.seekTo(0, 0L)
            exo.play()
        }
    }

    fun pause() {
        player?.pause()
    }

    fun next() {
        player?.takeIf { it.hasNextMediaItem() }?.seekToNextMediaItem()
    }

    fun previous() {
        val exo = player ?: return
        if (exo.currentPosition > 3_000 || !exo.hasPreviousMediaItem()) exo.seekTo(0) else exo.seekToPreviousMediaItem()
    }

    /** Playback position as a 0–1 fraction of the current song. */
    fun progress(): Float {
        val exo = player ?: return 0f
        val duration = exo.duration.takeIf { it > 0 } ?: return 0f
        return (exo.currentPosition.toFloat() / duration).coerceIn(0f, 1f)
    }

    fun stop() {
        player?.release()
        player = null
        BackgroundMusic.setHold(BackgroundMusic.Hold.THEME, false)
        queue.clear()
        index.intValue = -1
        isPlaying.value = false
        buffering.value = false
        label.value = null
        problem.value = null
    }
}
