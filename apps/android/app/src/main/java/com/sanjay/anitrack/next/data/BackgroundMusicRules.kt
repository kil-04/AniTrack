package com.sanjay.anitrack.next.data

import java.text.Collator
import java.util.Locale
import kotlin.random.Random

/**
 * Background-music rules: the Kotlin twin of packages/shared/bg-music.ts, so the
 * desktop and Android apps name, order and step through tracks alike.
 */
internal object BackgroundMusicRules {
    enum class Mode(val key: String) {
        ALL("all"), ONE("one"), SHUFFLE("shuffle");

        companion object {
            fun of(key: String?): Mode = entries.firstOrNull { it.key == key } ?: ALL
        }
    }

    /** [id] is the file name; [bundled] tracks ship in the APK's assets/music. */
    data class Track(val id: String, val title: String, val number: Int?, val bundled: Boolean = false)

    val EXTENSIONS = listOf(".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac")

    /** Largest single file accepted on import. */
    const val MAX_BYTES = 200L * 1024 * 1024

    /** The built-in track, the user's own piano recording: the default until another is starred. */
    const val BUNDLED_DEFAULT = "Because I Will Protect You.mp3"

    /** Previous restarts the current track once it has played this long. */
    const val RESTART_AFTER_MS = 3_000L

    fun isMusicFile(name: String): Boolean {
        val lower = name.lowercase(Locale.ROOT)
        return EXTENSIONS.any { lower.endsWith(it) } && !lower.startsWith(".")
    }

    private val NUMBERED = Regex("""(\d{1,3})(?:\s*[-._)]\s*|\s+)(.+)""")

    /** "57 I Will Protect You -Reload-.mp3" → number 57, title "I Will Protect You -Reload-". */
    fun trackFromFile(name: String, bundled: Boolean = false): Track? {
        if (!isMusicFile(name)) return null
        val base = name.substring(0, name.lastIndexOf('.')).trim()
        val match = NUMBERED.matchEntire(base)
        val title = (match?.groupValues?.get(2) ?: base).trim().ifEmpty { base }
        return Track(name, title, match?.groupValues?.get(1)?.toInt(), bundled)
    }

    private val titleOrder: Collator = Collator.getInstance(Locale.ROOT).apply { strength = Collator.PRIMARY }

    /** Numbered tracks first, in number order, then the rest by title. */
    fun sortTracks(tracks: List<Track>): List<Track> = tracks.sortedWith { a, b ->
        when {
            a.number != null && b.number != null && a.number != b.number -> a.number.compareTo(b.number)
            (a.number == null) != (b.number == null) -> if (a.number == null) 1 else -1
            else -> titleOrder.compare(a.title, b.title).takeIf { it != 0 } ?: a.id.compareTo(b.id)
        }
    }

    /**
     * The track to play after track [current] (of [count]) ends. Repeat one plays it
     * again; Play all goes on in order and wraps; Shuffle picks another track, never the
     * one that just played (unless it is the only one). -1 when there is nothing to play.
     */
    fun nextTrackIndex(mode: Mode, current: Int, count: Int, random: () -> Double = { Random.nextDouble() }): Int {
        if (count <= 0) return -1
        if (current < 0 || current >= count) return 0
        if (mode == Mode.ONE) return current
        if (mode == Mode.ALL) return (current + 1) % count
        if (count == 1) return 0
        val pick = (random() * (count - 1)).toInt()
        return if (pick >= current) pick + 1 else pick
    }

    /** A track skipped with Next: Repeat one moves on in list order; the other modes as usual. */
    fun skipTrackIndex(mode: Mode, current: Int, count: Int, random: () -> Double = { Random.nextDouble() }): Int =
        nextTrackIndex(if (mode == Mode.ONE) Mode.ALL else mode, current, count, random)

    /** The track before [current] in list order, wrapping (Previous outside Shuffle history). */
    fun previousTrackIndex(current: Int, count: Int): Int {
        if (count <= 0) return -1
        if (current < 0 || current >= count) return 0
        return (current - 1 + count) % count
    }

    /** The Repeat button's cycle: Play all, then Repeat one, then Shuffle. */
    fun nextMode(mode: Mode): Mode = when (mode) {
        Mode.ALL -> Mode.ONE
        Mode.ONE -> Mode.SHUFFLE
        Mode.SHUFFLE -> Mode.ALL
    }

    /** The track AniTrack opens with: the starred default, else the last one played, else the first. */
    fun startTrackId(tracks: List<Track>, lastId: String?, defaultId: String?): String? {
        if (defaultId != null && tracks.any { it.id == defaultId }) return defaultId
        if (lastId != null && tracks.any { it.id == lastId }) return lastId
        return tracks.firstOrNull()?.id
    }

    private val UNSAFE = Regex("[<>:\"|?*\\u0000-\\u001f]")

    /** A safe file name for an imported track: no folders, no characters Windows refuses. */
    fun safeTrackName(name: String): String =
        name.substringAfterLast('/').substringAfterLast('\\')
            .replace(UNSAFE, "_")
            .trimStart('.')
            .take(180)
            .ifEmpty { "track.mp3" }

    /** JavaScript's \s, so names collapse exactly as on desktop (Java's \s is ASCII only). */
    private val SPACES = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")

    /**
     * The file name a theme song from Songs is saved under: "Title — Artist, Artist (Show OP1)"
     * cut to 120 characters, with the URL's audio extension (else .ogg), made safe. Same as
     * themeTrackFileName in bg-music.ts.
     */
    fun themeTrackFileName(title: String, artists: List<String>, anime: String, slug: String, url: String): String {
        var base = title
        if (artists.isNotEmpty()) base += " — " + artists.joinToString(", ")
        if (anime.isNotEmpty()) base += " (" + anime + (if (slug.isNotEmpty()) " $slug" else "") + ")"
        // A slash would read as a folder ("Fate/Zero" kept only "Zero …"): it becomes a dash.
        base = base.replace('/', '-').replace('\\', '-').replace(SPACES, " ").trim { it == ' ' }.take(120).trim { it == ' ' }
        val file = url.substringBefore('#').substringBefore('?').substringAfter("://", "")
            .let { rest -> if ('/' in rest) rest.substring(rest.indexOf('/')) else "" }
            .substringAfterLast('/')
        val ext = if ('.' in file) "." + file.substringAfterLast('.').lowercase(Locale.ROOT) else ""
        return safeTrackName(base + if (ext in EXTENSIONS) ext else ".ogg")
    }

    /**
     * Whether a song's audio may be downloaded into the music folder (Add to music): https on
     * AnimeThemes (animethemes.moe or any *.animethemes.moe) or AnisongDB's media hosts, which the
     * Songs section's charts play from, and nowhere else. Each redirect hop must pass it too.
     * Same as isMusicDownloadUrl in bg-music.ts.
     */
    fun isMusicDownloadUrl(url: String?): Boolean = url != null && runCatching {
        val uri = java.net.URI(url)
        val host = uri.host?.lowercase(Locale.ROOT) ?: return false
        uri.scheme.equals("https", ignoreCase = true) && uri.rawUserInfo == null &&
            (host == "animethemes.moe" || host.endsWith(".animethemes.moe") || host in AniSongs.HOSTS)
    }.getOrDefault(false)

    /** Redirects followed when downloading a song into the music folder. */
    const val MAX_REDIRECTS = 3
}
