package com.sanjay.anitrack.next.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.Calendar
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/** One anime opening or ending from AnisongDB. Same fields as AniSong in packages/shared/anisongs.ts. */
data class AniSong(
    val id: Int,
    val anilistId: Int?,
    val malId: Int?,
    val anime: String,
    val animeJp: String?,
    /** "Spring 1998". */
    val season: String?,
    val year: Int?,
    /** "TV", "Movie", "OVA", "ONA", "Special"… as AnisongDB lists the show. */
    val format: String?,
    /** "OP" or "ED". */
    val kind: String,
    val number: Int?,
    val title: String,
    val artist: String,
    /** Percentage of quiz players who recognise it (0–100), when known. */
    val recognition: Double?,
    val video: String?,
    /** "720p" or "480p". */
    val quality: String?,
    val audio: String?,
    val cover: String? = null,
    /** Last.fm listeners (people who play it as music), for chart files; null when Last.fm doesn't know it. */
    val listeners: Long? = null,
    /** YouTube views across everyone's uploads of it, for chart files; null when not looked up or none found. */
    val views: Long? = null,
    /** The show is tagged Kids on AniList (chart files only). */
    val kids: Boolean = false,
    /** A licensed non-anime song (its artist has no Japanese or anime tag on Last.fm). */
    val licensed: Boolean = false,
)

/** One chart scope: order ("best" / "known") → kind ("OP" / "ED" / "IN") → songs. */
typealias ChartSet = Map<String, Map<String, List<AniSong>>>

data class SongCharts(
    val generatedAt: String,
    /** Keyed by decade start (1990). */
    val decades: Map<Int, ChartSet>,
    /** Keyed by year (1998), from 1960 to the year the charts were built. */
    val years: Map<Int, ChartSet>,
    val allTime: ChartSet,
)

/**
 * Openings and endings from AnisongDB (anisongdb.com), the index of Anime Music Quiz's
 * library: every song has a video clip and a recognition score. Mirrors
 * packages/shared/anisongs.ts; keep the two identical. Charts ship in assets/song_charts.json
 * (scripts/build-song-charts.mjs); seasons and searches are fetched and kept for a day.
 */
object AniSongs {
    const val API = "https://anisongdb.com/api"
    const val MEDIA = "https://naedist.animemusicquiz.com"
    val HOSTS = setOf("naedist.animemusicquiz.com", "eudist.animemusicquiz.com", "files.catbox.moe")
    val DECADES = listOf(1960, 1970, 1980, 1990, 2000, 2010, 2020)
    const val FIRST_YEAR = 1960
    const val CHART_SIZE = 100
    /** Songs in each yearly chart, per kind. */
    const val YEAR_SIZE = 30
    val SEASONS = listOf("Winter", "Spring", "Summer", "Fall")

    private val FILE = Regex("^[a-z0-9]{4,16}\\.(?:webm|mp4|mp3)$", RegexOption.IGNORE_CASE)
    private val SEASON = Regex("^(Winter|Spring|Summer|Fall) (\\d{4})$")
    private val TYPE = Regex("^(Opening|Ending|Insert Song)\\s*(\\d+)?$", RegexOption.IGNORE_CASE)

    fun isSongFile(value: Any?): Boolean = value is String && FILE.matches(value)

    private fun JSONObject.text(key: String, max: Int = 300): String? =
        (opt(key) as? String)?.trim()?.takeIf { it.isNotEmpty() }?.take(max)
    private fun JSONObject.positive(key: String): Int? = (opt(key) as? Number)?.toDouble()
        ?.takeIf { it > 0 && it % 1.0 == 0.0 && it <= Int.MAX_VALUE }?.toInt()

    /**
     * One AnisongDB row as a song; null for dubs, rebroadcasts or rows without media. Insert
     * songs count only when "Standard" (not character songs, chants or instrumentals).
     */
    fun parseSong(row: JSONObject?): AniSong? {
        if (row == null || row.optBoolean("isDub") || row.optBoolean("isRebroadcast")) return null
        val type = TYPE.matchEntire(row.text("songType", 40) ?: "") ?: return null
        val insert = type.groupValues[1].startsWith("insert", ignoreCase = true)
        if (insert && row.optString("songCategory") != "Standard") return null
        val id = row.positive("annSongId") ?: return null
        val title = row.text("songName") ?: return null
        val anime = row.text("animeENName") ?: row.text("animeJPName") ?: return null
        val hq = row.opt("HQ").takeIf(::isSongFile) as String?
        val mq = row.opt("MQ").takeIf(::isSongFile) as String?
        val audio = row.opt("audio").takeIf(::isSongFile) as String?
        if (hq == null && mq == null && audio == null) return null
        val season = row.text("animeVintage", 20)?.takeIf { SEASON.matches(it) }
        val ids = row.optJSONObject("linked_ids")
        val difficulty = (row.opt("songDifficulty") as? Number)?.toDouble()?.takeIf { it.isFinite() }?.coerceIn(0.0, 100.0)
        return AniSong(
            id = id,
            anilistId = ids?.positive("anilist"),
            malId = ids?.positive("myanimelist"),
            anime = anime,
            animeJp = row.text("animeJPName"),
            season = season,
            year = season?.let { SEASON.matchEntire(it)!!.groupValues[2].toInt() },
            format = row.text("animeType", 20),
            kind = if (insert) "IN" else if (type.groupValues[1].equals("opening", true)) "OP" else "ED",
            number = if (insert) null else type.groupValues[2].toIntOrNull(),
            title = title,
            artist = row.text("songArtist") ?: "Unknown artist",
            recognition = difficulty,
            video = hq ?: mq,
            quality = if (hq != null) "720p" else if (mq != null) "480p" else null,
            audio = audio,
        )
    }

    /** An AnisongDB answer (a JSON array of rows) as songs, each song once. */
    fun parseSongs(array: JSONArray): List<AniSong> {
        val out = LinkedHashMap<Int, AniSong>()
        for (i in 0 until minOf(array.length(), 5000)) {
            val song = parseSong(array.optJSONObject(i)) ?: continue
            out.putIfAbsent(song.id, song)
        }
        return out.values.toList()
    }

    fun videoUrl(song: AniSong): String? = song.video?.let { "$MEDIA/$it" }
    fun audioUrl(song: AniSong): String? = song.audio?.let { "$MEDIA/$it" }

    fun isSongMedia(url: String?): Boolean = url != null && runCatching {
        val uri = URI(url)
        uri.scheme == "https" && uri.host in HOSTS && FILE.matches(uri.rawPath.removePrefix("/"))
    }.getOrDefault(false)

    fun slug(song: AniSong) = if (song.kind == "IN") "Insert" else "${song.kind}${song.number ?: ""}"

    /**
     * A title page's theme songs with AnisongDB's clips filling the gaps: an AnimeThemes song
     * without a video (or audio) takes the clip of the same kind and number, songs AnimeThemes
     * doesn't list come after its own, and a show AnimeThemes doesn't know is AnisongDB's alone. Same as withSongClips in anisongs.ts.
     */
    fun withClips(themes: List<ThemeSong>, clips: List<AniSong>): List<ThemeSong> {
        // Title pages list openings and endings; insert songs stay in the Songs section.
        val playable = clips.filter { it.kind != "IN" && (it.video != null || it.audio != null) }
        val covered = themes.mapNotNull { SLUG.find(it.slug) }.map { "${it.groupValues[1]}${it.groupValues[2].ifEmpty { "1" }}" }.toSet()
        // Songs AnimeThemes doesn't list at all (God Mars' endings), after its own.
        val extra = playable.filter { "${it.kind}${it.number ?: 1}" !in covered }.map(::toThemeSong)
        return themes.map { theme ->
            if ((theme.videoUrl != null || theme.nsfw) && theme.audioUrl != null) return@map theme
            val slug = SLUG.find(theme.slug) ?: return@map theme
            val number = slug.groupValues[2].toIntOrNull() ?: 1
            val clip = clips.firstOrNull { it.kind == slug.groupValues[1] && (it.number ?: 1) == number } ?: return@map theme
            theme.copy(
                videoUrl = theme.videoUrl ?: if (theme.nsfw) null else videoUrl(clip),
                audioUrl = theme.audioUrl ?: audioUrl(clip),
            )
        } + extra
    }

    /** "OP1", "ED2-TV" → kind and number. */
    private val SLUG = Regex("""^(OP|ED)(\d*)""")

    /** The song as both theme players and the video viewer take it. */
    fun toThemeSong(song: AniSong) = ThemeSong(
        animeId = song.anilistId ?: 0,
        animeTitle = song.anime,
        cover = song.cover,
        slug = slug(song),
        type = if (song.kind == "ED") "ED" else "OP",
        title = song.title,
        artists = listOf(song.artist),
        episodes = null,
        spoiler = false,
        nsfw = false,
        audioUrl = audioUrl(song),
        videoUrl = videoUrl(song),
    )

    private val VERSION_TAGS = Regex("""<[^>]*>|\[[^\]]*\]|[(~][^)~]*(?:ver|version|mix|remix|edit|size|cover|arrange)[^)~]*[)~]|\s-[^-]*(?:ver|version|mix|remix|edit|size)[^-]*-?\s*$""")
    private val MIX_SUFFIX = Regex("""[\s~-]*(?:\d+(?:st|nd|rd|th)?\s*)?(?:re)?mix\s*$""")
    private val VERSION_SUFFIX = Regex("""[\s~-]*(?:tv|full|short|long)?\s*(?:ver\.?|version)\s*$""")
    private val NOT_WORD = Regex("""[^\p{L}\p{N}]+""")

    /** A title without its version tags, so a song's versions count as one. Same as baseTitle in anisongs.ts. */
    fun baseTitle(title: String): String {
        val base = title.lowercase()
            .replace(VERSION_TAGS, " ")
            .replace(MIX_SUFFIX, " ")
            .replace(VERSION_SUFFIX, " ")
            .replace(NOT_WORD, " ")
            .trim()
        return base.ifEmpty { title.lowercase().trim() }
    }

    private fun earlier(a: AniSong, b: AniSong): Boolean = compareValuesBy(a, b,
        { it.year ?: 9999 }, { if (it.format == "TV") 0 else 1 }, { if (it.kind == "IN") 1 else 0 }, { it.id }) < 0

    /**
     * Each song once, under its original show: the earliest (a TV series before its films)
     * of the shows that use the same recording, scored by its best-known use. A remake by
     * another artist is another song. Same as originalSongs in anisongs.ts.
     */
    fun originals(songs: List<AniSong>): List<AniSong> {
        fun merge(list: List<AniSong>, keyOf: (AniSong) -> String): List<AniSong> {
            val best = LinkedHashMap<String, AniSong>()
            for (song in list) {
                val key = keyOf(song)
                val held = best[key]
                if (held == null) { best[key] = song; continue }
                val original = if (earlier(song, held)) song else held
                best[key] = original.copy(
                    recognition = listOfNotNull(song.recognition, held.recognition).maxOrNull(),
                    listeners = listOfNotNull(song.listeners, held.listeners).maxOrNull(),
                    views = listOfNotNull(song.views, held.views).maxOrNull(),
                )
            }
            return best.values.toList()
        }
        // The same recording across shows, then one song's versions within a show. Openings and
        // endings merge with each other, insert songs only with insert songs.
        fun group(song: AniSong) = if (song.kind == "IN") "in\u0000" else "theme\u0000"
        // An "insert" that's the same recording as an opening or ending somewhere is that theme
        // played again, not an insert song of its own.
        fun recording(song: AniSong) = baseTitle(song.title) + "\u0000" + song.artist.lowercase()
        val themes = songs.filter { it.kind != "IN" }.map(::recording).toSet()
        val own = songs.filter { it.kind != "IN" || recording(it) !in themes }
        return merge(
            merge(own) { group(it) + baseTitle(it.title) + "\u0000" + it.artist.lowercase() },
        ) { group(it) + (it.anilistId?.toString() ?: it.anime.lowercase()) + "\u0000" + baseTitle(it.title) }
    }

    /**
     * The plays a song is ranked on: its YouTube views; Last.fm listeners (at the median 384
     * views each) only when YouTube found nothing. Licensed songs have none. Same as plays in
     * anisongs.ts.
     */
    private fun plays(song: AniSong): Pair<Double, String>? {
        if (song.licensed) return null
        song.views?.takeIf { it > 0 }?.let { return it.toDouble() to "views" }
        return song.listeners?.takeIf { it > 0 }?.let { it * 384.0 to "listeners" }
    }

    /**
     * A song's "best" score (0–100) from its plays, on a log scale; a song neither YouTube nor
     * Last.fm knows gets half its quiz recognition, and a Kids show's song counts 60%. Same as
     * bestScore in anisongs.ts.
     */
    fun bestScore(song: AniSong): Double? {
        // 1M views ≈ 43, 10M ≈ 60, 100M ≈ 78, 2B = 100; else half the quiz recognition.
        val base = plays(song)?.let { minOf(100.0, kotlin.math.log10(it.first / 3000.0 + 1) * 17.17) }
            ?: song.recognition?.let { it * 0.5 }
            ?: return null
        return if (song.kids) base * 0.6 else base
    }

    /** Which number decided a song's "best" score: "views", "listeners" or (neither) "quiz". Same as bestSource in anisongs.ts. */
    fun bestSource(song: AniSong): String = plays(song)?.second ?: "quiz"

    private fun scoreOf(song: AniSong, order: String): Double? = if (order == "best") bestScore(song) else song.recognition

    /**
     * A chart: by the order's score ("best" or "known"), then the older show. Each song once,
     * under its original show ([originals]); songs without a video are left out; at most
     * [perShow] songs a show.
     */
    fun rank(songs: List<AniSong>, kind: String? = null, limit: Int = CHART_SIZE, perShow: Int = Int.MAX_VALUE, order: String = "known"): List<AniSong> {
        val counts = HashMap<String, Int>()
        return originals(songs.filter { it.video != null && (kind == null || it.kind == kind) })
            .mapNotNull { song -> scoreOf(song, order)?.let { song to it } }
            .sortedWith(compareByDescending<Pair<AniSong, Double>> { it.second }.thenBy { it.first.year ?: 9999 }.thenBy { it.first.id })
            .map { it.first }
            .filter { song ->
                val show = song.anilistId?.toString() ?: song.anime.lowercase()
                val seen = counts[show] ?: 0
                (seen < perShow).also { if (it) counts[show] = seen + 1 }
            }
            .take(limit)
    }

    /** Decade and all-time charts keep at most this many songs a show. */
    const val CHART_PER_SHOW = 4

    fun decadeOf(year: Int) = year / 10 * 10

    /** The season a time falls in, as anime seasons run (Winter = Jan–Mar). */
    fun seasonOf(millis: Long): Pair<String, Int> {
        val c = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { timeInMillis = millis }
        return SEASONS[c.get(Calendar.MONTH) / 3] to c.get(Calendar.YEAR)
    }

    fun previousSeason(season: String, year: Int): Pair<String, Int> {
        val i = SEASONS.indexOf(season)
        return if (i <= 0) "Fall" to year - 1 else SEASONS[i - 1] to year
    }

    /** The JSON body of an AnisongDB search_request; [by] is "song", "artist" or "anime". */
    /** AnisongDB's refusal in place of songs, said plainly (it pauses text search during AMQ ranked games). Same as anisongdbRefusal in anisongs.ts. */
    fun refusal(text: String): String? {
        val detail = runCatching { JSONObject(text).optString("detail") }.getOrNull()?.takeIf { it.isNotBlank() } ?: return null
        return if (detail.contains("ranked", ignoreCase = true)) "AnisongDB pauses song search while Anime Music Quiz runs its ranked games. Try again in a little while."
        else "AnisongDB couldn't search right now (${detail.take(120)})."
    }

    fun searchBody(query: String, by: String): JSONObject {
        val search = JSONObject().put("search", query.trim().take(100)).put("partial_match", true)
        return JSONObject().apply {
            when (by) {
                "anime" -> put("anime_search_filter", search)
                "artist" -> put("artist_search_filter", search.put("group_granularity", 0).put("max_other_artist", 99))
                else -> put("song_name_search_filter", search)
            }
            put("and_logic", false); put("ignore_duplicate", false)
            put("opening_filter", true); put("ending_filter", true); put("insert_filter", false)
        }
    }

    private fun chartSong(s: JSONObject): AniSong? {
        val id = s.positive("id") ?: return null
        val kind = s.optString("kind").takeIf { it == "OP" || it == "ED" || it == "IN" } ?: return null
        val title = s.text("title") ?: return null
        val anime = s.text("anime") ?: return null
        val video = s.opt("video").takeIf { it != null && it != JSONObject.NULL }
        val audio = s.opt("audio").takeIf { it != null && it != JSONObject.NULL }
        if ((video != null && !isSongFile(video)) || (audio != null && !isSongFile(audio))) return null
        return AniSong(
            id = id, anilistId = s.positive("anilistId"), malId = s.positive("malId"),
            anime = anime, animeJp = s.text("animeJp"),
            season = s.text("season", 20), year = s.positive("year"), format = s.text("format", 20),
            kind = kind, number = s.positive("number"),
            title = title, artist = s.text("artist") ?: "Unknown artist",
            recognition = (s.opt("recognition") as? Number)?.toDouble(),
            video = video as String?, quality = s.optString("quality").takeIf { it == "720p" || it == "480p" },
            audio = audio as String?,
            cover = s.text("cover", 500)?.takeIf { it.startsWith("https://") },
            listeners = (s.opt("listeners") as? Number)?.toLong()?.takeIf { it >= 0 },
            views = (s.opt("views") as? Number)?.toLong()?.takeIf { it >= 0 },
            kids = s.optBoolean("kids"),
            licensed = s.optBoolean("licensed"),
        )
    }

    /**
     * Reads a chart file: `songs` once each, and every chart as a list of their ids
     * (`{decades: {"1990": {best: {OP: [ids], ED: [ids]}, known: {…}}}, years, allTime}`).
     * Same as parseCharts in anisongs.ts.
     */
    fun parseCharts(root: JSONObject): SongCharts {
        val byId = HashMap<Int, AniSong>()
        val songs = root.optJSONArray("songs") ?: JSONArray()
        for (i in 0 until minOf(songs.length(), 50_000)) chartSong(songs.optJSONObject(i) ?: continue)?.let { byId[it.id] = it }
        fun list(array: JSONArray?): List<AniSong> =
            if (array == null) emptyList() else (0 until minOf(array.length(), CHART_SIZE)).mapNotNull { byId[array.optInt(it)] }
        fun pair(o: JSONObject?) = mapOf("OP" to list(o?.optJSONArray("OP")), "ED" to list(o?.optJSONArray("ED")), "IN" to list(o?.optJSONArray("IN")))
        fun set(o: JSONObject?): ChartSet = mapOf("best" to pair(o?.optJSONObject("best")), "known" to pair(o?.optJSONObject("known")))
        val decades = root.optJSONObject("decades")
        val rawYears = root.optJSONObject("years")
        val years = rawYears?.keys()?.asSequence()
            ?.filter { Regex("""\d{4}""").matches(it) && it.toInt() in FIRST_YEAR..2100 }
            ?.associate { it.toInt() to set(rawYears.optJSONObject(it)) }
            .orEmpty()
        return SongCharts(
            generatedAt = root.optString("generatedAt"),
            decades = DECADES.associateWith { set(decades?.optJSONObject(it.toString())) },
            years = years,
            allTime = set(root.optJSONObject("allTime")),
        )
    }

    // ── Network ─────────────────────────────────────────────────────────────

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()
    private val TTL_MS = TimeUnit.DAYS.toMillis(1)
    private val cache = object : LinkedHashMap<String, Pair<Long, List<AniSong>>>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Long, List<AniSong>>>) = size > 40
    }
    @Volatile private var charts: SongCharts? = null

    /** The charts shipped with the app. */
    suspend fun charts(context: Context): SongCharts = charts ?: withContext(Dispatchers.IO) {
        val text = context.applicationContext.assets.open("song_charts.json").bufferedReader().use { it.readText() }
        parseCharts(JSONObject(text)).also { charts = it }
    }

    /** Every opening and ending of one season ("Spring", 1998), best-known first. */
    suspend fun season(season: String, year: Int): List<AniSong> {
        require(season in SEASONS && year in FIRST_YEAR..(Calendar.getInstance().get(Calendar.YEAR) + 1)) { "Invalid season" }
        return post("season:$season $year", "season_request", JSONObject().put("season", "$season $year"))
    }

    /** A show's openings and endings, by its MyAnimeList id. */
    suspend fun forShow(malId: Int): List<AniSong> {
        if (malId <= 0) return emptyList()
        return post("show:$malId", "mal_ids_request", JSONObject().put("mal_ids", org.json.JSONArray().put(malId)))
    }

    /** Songs matching a song title, artist or anime name. */
    suspend fun search(query: String, by: String): List<AniSong> {
        val q = query.trim()
        if (q.length < 2) return emptyList()
        return post("search:$by:${q.lowercase()}", "search_request", searchBody(q, by))
    }

    private suspend fun post(key: String, path: String, body: JSONObject): List<AniSong> = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        synchronized(cache) { cache[key] }?.takeIf { now - it.first < TTL_MS }?.let { return@withContext it.second }
        val request = Request.Builder().url("$API/$path")
            .header("Accept", "application/json")
            .header("User-Agent", "AniTrack (anime tracker; songs)")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        val text = http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException("AnisongDB answered ${response.code}")
            val bytes = response.body?.bytes() ?: throw IllegalStateException("AnisongDB sent nothing")
            if (bytes.size > 16 * 1024 * 1024) throw IllegalStateException("AnisongDB sent too much")
            String(bytes)
        }
        refusal(text)?.let { throw IllegalStateException(it) }
        val songs = parseSongs(JSONArray(text))
        synchronized(cache) { cache[key] = now to songs }
        songs
    }
}
