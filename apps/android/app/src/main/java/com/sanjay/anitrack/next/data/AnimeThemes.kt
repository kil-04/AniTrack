package com.sanjay.anitrack.next.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/** One opening or ending, with its song and the AnimeThemes media to play. */
data class ThemeSong(
    val animeId: Int,
    val animeTitle: String,
    val cover: String?,
    /** "OP1", "ED2", "ED1-TV"… */
    val slug: String,
    /** "OP" or "ED". */
    val type: String,
    val title: String,
    val artists: List<String>,
    /** Episodes it plays over, as AnimeThemes writes them ("1-16, 18"). */
    val episodes: String?,
    val spoiler: Boolean,
    val nsfw: Boolean,
    val audioUrl: String?,
    val videoUrl: String?,
) {
    val key: String get() = "$animeId:$slug"
    val artistLine: String? get() = artists.takeIf { it.isNotEmpty() }?.joinToString(", ")
    val isOpening: Boolean get() = type == "OP"
}

/**
 * Openings and endings from AnimeThemes.moe (a public, community-run catalogue),
 * matched by AniList id. Answers are kept for a few days: theme lists rarely change,
 * and the API asks clients to stay under 90 requests a minute.
 */
object AnimeThemes {
    private const val ENDPOINT = "https://api.animethemes.moe/anime"
    private const val INCLUDE = "animethemes.animethemeentries.videos.audio,animethemes.song.artists,resources"
    private const val BATCH = 25
    private val TTL_MS = TimeUnit.DAYS.toMillis(3)

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val memory = object : LinkedHashMap<Int, Pair<Long, List<ThemeSong>>>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Pair<Long, List<ThemeSong>>>) = size > 200
    }
    private var cacheDir: File? = null

    fun init(context: Context) {
        if (cacheDir == null) cacheDir = File(context.applicationContext.cacheDir, "animethemes").apply { mkdirs() }
    }

    /** Themes for one show, openings first. Empty when AnimeThemes doesn't list it. */
    suspend fun forAnime(anime: Anime): List<ThemeSong> = forAnime(listOf(anime))[anime.id].orEmpty()

    /** Themes for several shows (the radio), in batches of [BATCH]. */
    suspend fun forAnime(shows: List<Anime>): Map<Int, List<ThemeSong>> = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val out = mutableMapOf<Int, List<ThemeSong>>()
        val missing = mutableListOf<Anime>()
        for (show in shows.distinctBy { it.id }) {
            val cached = synchronized(memory) { memory[show.id] }?.takeIf { now - it.first < TTL_MS }?.second
                ?: readDisk(show, now)
            if (cached != null) out[show.id] = cached else missing += show
        }
        for (chunk in missing.chunked(BATCH)) {
            val fetched = fetch(chunk)
            for (show in chunk) {
                val songs = fetched[show.id].orEmpty()
                out[show.id] = songs
                remember(show.id, songs, now)
            }
        }
        out
    }

    private fun fetch(shows: List<Anime>): Map<Int, List<ThemeSong>> {
        val url = "$ENDPOINT?filter[has]=resources&filter[site]=AniList" +
            "&filter[external_id]=${shows.joinToString(",") { it.id.toString() }}" +
            "&include=$INCLUDE&page[size]=$BATCH"
        val request = Request.Builder().url(url)
            .header("Accept", "application/json")
            .header("User-Agent", "AniTrack/8 (anime tracker; theme songs)")
            .build()
        val body = http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("AnimeThemes ${response.code}")
            response.body?.string() ?: throw IllegalStateException("AnimeThemes sent nothing")
        }
        val byId = shows.associateBy { it.id }
        val out = mutableMapOf<Int, List<ThemeSong>>()
        val list = JSONObject(body).optJSONArray("anime") ?: JSONArray()
        for (i in 0 until list.length()) {
            val entry = list.getJSONObject(i)
            val resources = entry.optJSONArray("resources") ?: JSONArray()
            val anilistIds = (0 until resources.length()).map { resources.getJSONObject(it) }
                .filter { it.optString("site") == "AniList" }
                .mapNotNull { it.optInt("external_id").takeIf { id -> id > 0 } }
            for (id in anilistIds) {
                val show = byId[id] ?: continue
                out[id] = parseThemes(show, entry.optJSONArray("animethemes"))
            }
        }
        return out
    }

    internal fun parseThemes(show: Anime, themes: JSONArray?): List<ThemeSong> {
        if (themes == null) return emptyList()
        val songs = (0 until themes.length()).mapNotNull { i ->
            val theme = themes.getJSONObject(i)
            val type = theme.optString("type").takeIf { it == "OP" || it == "ED" } ?: return@mapNotNull null
            val entries = theme.optJSONArray("animethemeentries") ?: return@mapNotNull null
            val entry = (0 until entries.length()).map { entries.getJSONObject(it) }.firstOrNull() ?: return@mapNotNull null
            val video = pickVideo(entry.optJSONArray("videos"))
            val song = theme.optJSONObject("song")
            val artists = song?.optJSONArray("artists")?.let { array ->
                (0 until array.length()).mapNotNull { array.getJSONObject(it).str("name") }
            }.orEmpty()
            ThemeSong(
                animeId = show.id,
                animeTitle = show.title,
                cover = show.cover,
                slug = theme.str("slug") ?: "$type${theme.optInt("sequence", 1)}",
                type = type,
                title = song?.str("title") ?: "Untitled",
                artists = artists,
                episodes = entry.str("episodes"),
                spoiler = entry.optBoolean("spoiler"),
                nsfw = entry.optBoolean("nsfw"),
                audioUrl = video?.optJSONObject("audio")?.str("link")?.takeIf(::isThemeMedia),
                videoUrl = video?.str("link")?.takeIf(::isThemeMedia),
            )
        }
        return songs.filter { it.audioUrl != null || it.videoUrl != null }
            .sortedWith(compareBy({ if (it.isOpening) 0 else 1 }, { themeNumber(it.slug) }))
    }

    private fun themeNumber(slug: String): Int = Regex("\\d+").find(slug)?.value?.toIntOrNull() ?: 0

    /** A creditless, unannotated video at up to 1080p, else the first one. */
    private fun pickVideo(videos: JSONArray?): JSONObject? {
        if (videos == null || videos.length() == 0) return null
        val all = (0 until videos.length()).map { videos.getJSONObject(it) }
        return all.minByOrNull { video ->
            val resolution = video.optInt("resolution", 720)
            (if (video.optBoolean("nc")) 0 else 8) +
                (if (video.optString("overlap") == "None") 0 else 4) +
                (if (video.optBoolean("lyrics") || video.optBoolean("subbed")) 2 else 0) +
                (if (resolution > 1080) 3 else 0) +
                (1080 - resolution.coerceAtMost(1080)) / 360
        }
    }

    /** Only AnimeThemes' own HTTPS media hosts are played. */
    private fun isThemeMedia(url: String): Boolean = runCatching {
        val uri = java.net.URI(url)
        uri.scheme == "https" && (uri.host == "a.animethemes.moe" || uri.host == "v.animethemes.moe")
    }.getOrDefault(false)

    private fun JSONObject.str(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }

    // ── cache ────────────────────────────────────────────────────────────────

    private fun remember(id: Int, songs: List<ThemeSong>, at: Long) {
        synchronized(memory) { memory[id] = at to songs }
        val dir = cacheDir ?: return
        runCatching {
            val array = JSONArray()
            songs.forEach { song ->
                array.put(
                    JSONObject().put("slug", song.slug).put("type", song.type).put("title", song.title)
                        .put("artists", JSONArray(song.artists)).put("episodes", song.episodes ?: JSONObject.NULL)
                        .put("spoiler", song.spoiler).put("nsfw", song.nsfw)
                        .put("audio", song.audioUrl ?: JSONObject.NULL).put("video", song.videoUrl ?: JSONObject.NULL),
                )
            }
            File(dir, "$id.json").writeText(JSONObject().put("at", at).put("songs", array).toString())
        }
    }

    private fun readDisk(show: Anime, now: Long): List<ThemeSong>? {
        val file = cacheDir?.let { File(it, "${show.id}.json") }?.takeIf { it.isFile } ?: return null
        return runCatching {
            val root = JSONObject(file.readText())
            val at = root.getLong("at")
            if (now - at !in 0..TTL_MS) return null
            val array = root.getJSONArray("songs")
            val songs = (0 until array.length()).map { i ->
                val o = array.getJSONObject(i)
                val artists = o.optJSONArray("artists") ?: JSONArray()
                ThemeSong(
                    animeId = show.id, animeTitle = show.title, cover = show.cover,
                    slug = o.getString("slug"), type = o.getString("type"), title = o.getString("title"),
                    artists = (0 until artists.length()).map { artists.getString(it) },
                    episodes = o.str("episodes"), spoiler = o.optBoolean("spoiler"), nsfw = o.optBoolean("nsfw"),
                    audioUrl = o.str("audio")?.takeIf(::isThemeMedia), videoUrl = o.str("video")?.takeIf(::isThemeMedia),
                )
            }
            synchronized(memory) { memory[show.id] = at to songs }
            songs
        }.getOrNull()
    }
}
