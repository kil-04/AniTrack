package com.sanjay.anitrack.next.data

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.OpenableColumns
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.sanjay.anitrack.next.data.BackgroundMusicRules.Mode
import com.sanjay.anitrack.next.data.BackgroundMusicRules.Track
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.zip.ZipFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Background music while browsing: the built-in piano track (assets/music) and the
 * user's imported tracks (filesDir/music), one at a time on a private ExoPlayer.
 * It steps aside for anything else that makes sound (the player screen, an episode
 * in the mini player, theme songs) and while the app is in the background.
 * Settings are per device. Main thread only, apart from [import]'s file work.
 */
internal object BackgroundMusic {
    /** What can pause the music: the player screen, an episode playing, theme songs and videos, the app in the background. */
    enum class Hold { PLAYER, EPISODE, THEME, VIDEO, BACKGROUND }

    val tracks = mutableStateOf<List<Track>>(emptyList())
    /** Background music is on: it plays whenever nothing holds it and it is not paused. */
    val enabled = mutableStateOf(false)
    /** Paused with the Pause button, for this session; the music stays on. */
    val paused = mutableStateOf(false)
    val mode = mutableStateOf(Mode.ALL)
    val trackId = mutableStateOf<String?>(null)
    /** The starred track the app opens with (null: carry on from the last one). */
    val defaultId = mutableStateOf<String?>(BackgroundMusicRules.BUNDLED_DEFAULT)
    val volume = mutableFloatStateOf(0.5f)
    val isPlaying = mutableStateOf(false)
    val holds = mutableStateOf(setOf(Hold.BACKGROUND))

    private const val PREFS = "anitrack_next"
    private const val ASSET_DIR = "music"
    private const val FADE_MS = 450L
    private const val HISTORY_LIMIT = 100
    private const val PART_PREFIX = ".import-"

    private var appContext: Context? = null
    private var prefs: SharedPreferences? = null
    private var player: ExoPlayer? = null
    /** The track the player holds. */
    private var loadedId: String? = null
    private var failures = 0
    /** Tracks played before the current one, for Previous in Shuffle. */
    private val history = ArrayDeque<String>()
    private val main = Handler(Looper.getMainLooper())
    private var fadeStep: Runnable? = null

    val current: Track? get() = tracks.value.firstOrNull { it.id == trackId.value } ?: tracks.value.firstOrNull()

    /** Music is meant to be playing (it may still be held by the player or a theme song). */
    val on: Boolean get() = enabled.value && !paused.value

    fun init(context: Context) {
        if (appContext != null) return
        val app = context.applicationContext
        appContext = app
        val p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).also { prefs = it }
        enabled.value = p.getBoolean("bgm_enabled", false)
        mode.value = Mode.of(p.getString("bgm_mode", null))
        volume.floatValue = p.getFloat("bgm_volume", 0.5f).coerceIn(0f, 1f)
        // "" means no star; a missing key means the built-in track.
        defaultId.value = if (p.contains("bgm_default")) p.getString("bgm_default", "")?.ifEmpty { null } else BackgroundMusicRules.BUNDLED_DEFAULT
        tracks.value = listTracks()
        trackId.value = BackgroundMusicRules.startTrackId(tracks.value, p.getString("bgm_track", null), defaultId.value)
        apply()
    }

    private fun musicDir(ctx: Context) = File(ctx.filesDir, "music").apply { mkdirs() }

    private fun hiddenBundled(): Set<String> = prefs?.getStringSet("bgm_hidden_bundled", null) ?: emptySet()

    /** Imported tracks plus the built-in ones (an imported file with the same name stands in for it). */
    private fun listTracks(): List<Track> {
        val ctx = appContext ?: return emptyList()
        val own = musicDir(ctx).listFiles().orEmpty().filter { it.isFile }.mapNotNull { BackgroundMusicRules.trackFromFile(it.name) }
        val ownIds = own.mapTo(HashSet()) { it.id }
        val hidden = hiddenBundled()
        val bundled = runCatching { ctx.assets.list(ASSET_DIR) }.getOrNull().orEmpty()
            .filter { it !in ownIds && it !in hidden }
            .mapNotNull { BackgroundMusicRules.trackFromFile(it, bundled = true) }
        return BackgroundMusicRules.sortTracks(own + bundled)
    }

    private fun uriFor(ctx: Context, track: Track): Uri =
        if (track.bundled) Uri.parse("asset:///$ASSET_DIR/${Uri.encode(track.id)}") else Uri.fromFile(File(musicDir(ctx), track.id))

    private fun save() {
        prefs?.edit()
            ?.putBoolean("bgm_enabled", enabled.value)
            ?.putString("bgm_mode", mode.value.key)
            ?.putString("bgm_track", trackId.value)
            ?.putFloat("bgm_volume", volume.floatValue)
            ?.apply()
    }

    private fun ensure(ctx: Context): ExoPlayer = player ?: ExoPlayer.Builder(ctx)
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
                    if (playing) failures = 0
                }

                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED) moveTo(ended = true)
                }

                override fun onPlayerError(error: PlaybackException) {
                    // A missing or unplayable file moves on, but never loops through a broken list.
                    loadedId = null
                    failures++
                    if (failures < tracks.value.size) moveTo(ended = false) else isPlaying.value = false
                }

                override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                    // Another app took the audio (or headphones came out): treat it as Pause.
                    val external = reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS ||
                        reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY
                    if (!playWhenReady && external && holds.value.isEmpty()) paused.value = true
                }
            })
            player = created
        }

    /** Ramps the volume to [target], then runs [done]. */
    private fun fade(target: Float, done: (() -> Unit)? = null) {
        val p = player ?: return
        fadeStep?.let { main.removeCallbacks(it) }
        val start = p.volume
        val began = SystemClock.uptimeMillis()
        val step = object : Runnable {
            override fun run() {
                val t = ((SystemClock.uptimeMillis() - began).toFloat() / FADE_MS).coerceAtMost(1f)
                p.volume = (start + (target - start) * t).coerceIn(0f, 1f)
                if (t >= 1f) {
                    fadeStep = null
                    done?.invoke()
                } else {
                    main.postDelayed(this, 30)
                }
            }
        }
        fadeStep = step
        main.post(step)
    }

    /** Loop in place (gaplessly) for Repeat one, and for a lone track rather than reloading it. */
    private fun repeatModeFor(value: Mode) =
        if (value == Mode.ONE || tracks.value.size == 1) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF

    /** Plays or pauses to match the settings and holds. [restart] reloads the current track. */
    private fun apply(restart: Boolean = false) {
        val ctx = appContext ?: return
        val track = current
        if (!on || track == null || holds.value.isNotEmpty()) {
            val p = player
            if (p != null && p.playWhenReady) fade(0f) { p.pause() }
            return
        }
        val p = ensure(ctx)
        p.repeatMode = repeatModeFor(mode.value)
        if (restart || loadedId != track.id || p.playbackState == Player.STATE_IDLE) {
            p.setMediaItem(MediaItem.Builder().setUri(uriFor(ctx, track)).setMediaId(track.id).build())
            p.prepare()
            loadedId = track.id
            p.volume = 0f
        }
        if (trackId.value != track.id) {
            trackId.value = track.id
            save()
        }
        if (!p.playWhenReady) p.play()
        fade(volume.floatValue)
    }

    fun setHold(hold: Hold, on: Boolean) {
        val now = holds.value
        if (on == (hold in now)) return
        holds.value = if (on) now + hold else now - hold
        apply()
    }

    fun setEnabled(on: Boolean) {
        enabled.value = on
        paused.value = false
        failures = 0
        save()
        apply()
    }

    fun toggle() = setEnabled(!enabled.value)

    /** Play (turning the music on) or Pause. */
    fun togglePlay() {
        if (on) {
            paused.value = true
            apply()
        } else {
            setEnabled(true)
        }
    }

    /** Picks a track and plays it (turning the music on). */
    fun select(id: String) {
        enabled.value = true
        paused.value = false
        failures = 0
        playTrack(id)
    }

    fun next() = moveTo(ended = false)

    /** Back to the start of this track, or to the one before it. */
    fun previous() {
        val p = player
        if (p != null && loadedId != null && loadedId == trackId.value && p.currentPosition > BackgroundMusicRules.RESTART_AFTER_MS) {
            p.seekTo(0)
            return
        }
        val list = tracks.value
        var target: String? = null
        while (mode.value == Mode.SHUFFLE && target == null && history.isNotEmpty()) {
            val id = history.removeLast()
            if (list.any { it.id == id }) target = id
        }
        if (target == null) {
            val index = BackgroundMusicRules.previousTrackIndex(list.indexOfFirst { it.id == trackId.value }, list.size)
            if (index < 0) return
            target = list[index].id
        }
        trackId.value = target
        save()
        apply(restart = true)
    }

    fun setMode(value: Mode) {
        mode.value = value
        save()
        player?.repeatMode = repeatModeFor(value)
    }

    /** The Repeat button: Play all → Repeat one → Shuffle. */
    fun cycleMode() = setMode(BackgroundMusicRules.nextMode(mode.value))

    fun setVolume(value: Float) {
        volume.floatValue = value.coerceIn(0f, 1f)
        save()
        val p = player ?: return
        if (p.playWhenReady) {
            fadeStep?.let { main.removeCallbacks(it) }
            fadeStep = null
            p.volume = volume.floatValue
        }
    }

    /** Stars [id] as the track to open with, or clears the star (null). */
    fun setDefault(id: String?) {
        defaultId.value = id
        prefs?.edit()?.putString("bgm_default", id ?: "")?.apply()
    }

    /** Deletes an imported track; a built-in one is only taken off the list. */
    fun remove(id: String) {
        val ctx = appContext ?: return
        val track = tracks.value.firstOrNull { it.id == id } ?: return
        if (loadedId == id) {
            player?.stop()
            player?.clearMediaItems()
            loadedId = null
        }
        if (track.bundled) {
            prefs?.edit()?.putStringSet("bgm_hidden_bundled", hiddenBundled() + id)?.apply()
        } else {
            File(musicDir(ctx), id).delete()
        }
        tracks.value = listTracks()
        if (trackId.value == id) trackId.value = null
        if (defaultId.value == id) setDefault(null)
        save()
        apply()
    }

    /** Switches to [id] (remembering the one before it) and starts it if music should play. */
    private fun playTrack(id: String) {
        val now = trackId.value
        if (now != null && now != id) {
            history.addLast(now)
            if (history.size > HISTORY_LIMIT) history.removeFirst()
        }
        trackId.value = id
        save()
        apply(restart = true)
    }

    /** The next track: by the mode when one ends, and always a different one when skipped. */
    private fun moveTo(ended: Boolean) {
        val list = tracks.value
        val index = list.indexOfFirst { it.id == trackId.value }
        val next = if (ended) {
            BackgroundMusicRules.nextTrackIndex(mode.value, index, list.size)
        } else {
            BackgroundMusicRules.skipTrackIndex(mode.value, index, list.size)
        }
        if (next >= 0) playTrack(list[next].id)
    }

    data class ImportResult(val added: Int, val skipped: Int)

    /** Copies audio files, or the audio inside .zip files, into the app; names already there are skipped. */
    suspend fun import(uris: List<Uri>): ImportResult {
        val ctx = appContext ?: return ImportResult(0, 0)
        val result = withContext(Dispatchers.IO) {
            val dir = musicDir(ctx)
            dir.listFiles().orEmpty().filter { it.name.startsWith(PART_PREFIX) }.forEach { it.delete() }
            var added = 0
            var skipped = 0
            for (uri in uris) {
                val name = displayName(ctx, uri) ?: "track.mp3"
                val type = ctx.contentResolver.getType(uri)
                if (name.lowercase().endsWith(".zip") || type == "application/zip" || type == "application/x-zip-compressed") {
                    val zipped = importZip(ctx, uri, dir)
                    added += zipped.added
                    skipped += zipped.skipped
                    continue
                }
                val safe = BackgroundMusicRules.safeTrackName(name)
                val copied = BackgroundMusicRules.isMusicFile(safe) &&
                    (runCatching { ctx.contentResolver.openInputStream(uri) }.getOrNull()?.use { copyIn(dir, safe, it) } ?: false)
                if (copied) added++ else skipped++
            }
            ImportResult(added, skipped)
        }
        tracks.value = listTracks()
        apply()
        return result
    }

    /** Reads the zip from a temporary copy: the central directory handles every way zips store entries. */
    private fun importZip(ctx: Context, uri: Uri, dir: File): ImportResult {
        val temp = File(ctx.cacheDir, "music-import.zip")
        try {
            val copied = runCatching {
                ctx.contentResolver.openInputStream(uri)?.use { input -> temp.outputStream().use { input.copyTo(it) } }
            }.getOrNull()
            if (copied == null) return ImportResult(0, 1)
            var added = 0
            var skipped = 0
            ZipFile(temp).use { zip ->
                for (entry in zip.entries()) {
                    if (entry.isDirectory) continue
                    val base = entry.name.replace('\\', '/').substringAfterLast('/')
                    if (entry.name.startsWith("__MACOSX/") || base.startsWith("._")) continue
                    val safe = BackgroundMusicRules.safeTrackName(base)
                    if (!BackgroundMusicRules.isMusicFile(safe)) continue
                    val ok = runCatching { zip.getInputStream(entry).use { copyIn(dir, safe, it) } }.getOrDefault(false)
                    if (ok) added++ else skipped++
                }
            }
            return ImportResult(added, skipped)
        } catch (e: IOException) {
            return ImportResult(0, 1)
        } finally {
            temp.delete()
        }
    }

    /** Writes [input] to [dir]/[name] through a partial file; false when it is already there, empty or too large. */
    private fun copyIn(dir: File, name: String, input: InputStream): Boolean {
        val target = File(dir, name)
        if (target.exists()) return false
        val part = File(dir, "$PART_PREFIX${System.nanoTime()}.part")
        return try {
            var total = 0L
            part.outputStream().use { out ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    total += n
                    if (total > BackgroundMusicRules.MAX_BYTES) throw IOException("Track is larger than the import limit")
                    out.write(buffer, 0, n)
                }
            }
            total > 0 && !target.exists() && part.renameTo(target)
        } catch (e: IOException) {
            false
        } finally {
            part.delete()
        }
    }

    private fun displayName(ctx: Context, uri: Uri): String? = runCatching {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }.getOrNull() ?: uri.lastPathSegment?.substringAfterLast('/')

    /** Frees the player when the app's activity finishes for good. */
    fun release() {
        fadeStep?.let { main.removeCallbacks(it) }
        fadeStep = null
        player?.release()
        player = null
        loadedId = null
        isPlaying.value = false
    }
}
