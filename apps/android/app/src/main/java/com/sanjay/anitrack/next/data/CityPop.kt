package com.sanjay.anitrack.next.data

import android.content.Context
import java.text.Normalizer
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

data class CityPopTrack(
    val id: String,
    val title: String,
    val artist: String,
    val year: Int?,
    val videoId: String,
    val channel: String,
    val moods: List<String>,
    val note: String,
    val sourceUrl: String,
)

data class CityPopStation(val id: String, val title: String, val description: String)

/** Pure catalog and selection rules mirror packages/shared/city-pop.ts. */
object CityPop {
    const val ENABLED_PREF = "city_pop_enabled"
    const val FAVORITES_PREF = "city_pop_favorites"
    const val SAVED_TRACKS_PREF = "city_pop_saved_tracks"
    private const val MAX_SEARCH_BYTES = 4 * 1024 * 1024
    private val searchHttp by lazy { OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).retryOnConnectionFailure(false).build() }
    val stations = listOf(
        CityPopStation("night-drive", "Night Drive", "Neon lights and a road with no hurry."),
        CityPopStation("sunset", "Sunset Coast", "Warm grooves for the last light of the day."),
        CityPopStation("after-hours", "After Hours", "Slow down when the city goes quiet."),
    )
    private val moodIds = stations.map { it.id }.toSet()
    private val slug = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$")
    private val video = Regex("^[A-Za-z0-9_-]{11}$")

    fun parseCatalog(text: String): List<CityPopTrack> {
        val rows = JSONArray(text)
        require(rows.length() in 1..100) { "City Pop catalog must contain between 1 and 100 tracks." }
        val ids = HashSet<String>()
        val videos = HashSet<String>()
        return List(rows.length()) { index ->
            val row = rows.getJSONObject(index)
            fun string(key: String): String = (row.get(key) as? String)?.trim()
                ?.takeIf { it.isNotEmpty() } ?: error("Invalid City Pop $key at row $index")
            val id = string("id")
            val videoId = string("videoId")
            require(id.length <= 80 && slug.matches(id)) { "Invalid City Pop id" }
            require(video.matches(videoId)) { "Invalid City Pop video id" }
            require(ids.add(id) && videos.add(videoId)) { "Duplicate City Pop track" }
            val yearValue = row.get("year")
            val year = if (yearValue == JSONObject.NULL) null else {
                require(yearValue is Number && yearValue.toDouble().isFinite() &&
                    yearValue.toDouble() == yearValue.toInt().toDouble() && yearValue.toInt() in 1900..2100) { "Invalid City Pop year" }
                yearValue.toInt()
            }
            val moodArray = row.getJSONArray("moods")
            val moods = List(moodArray.length()) { i ->
                (moodArray.get(i) as? String)?.takeIf { it in moodIds } ?: error("Invalid City Pop mood")
            }
            require(moods.isNotEmpty() && moods.distinct().size == moods.size) { "Invalid City Pop moods" }
            val sourceUrl = string("sourceUrl")
            require(sourceUrl == "https://www.youtube.com/watch?v=$videoId") { "Invalid City Pop source URL" }
            CityPopTrack(id, string("title"), string("artist"), year, videoId, string("channel"), moods, string("note"), sourceUrl)
        }
    }

    fun load(context: Context): List<CityPopTrack> = context.assets.open("city-pop.json").bufferedReader().use { parseCatalog(it.readText()) }

    private fun normalize(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKD)
        .replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT).replace(Regex("\\s+"), " ").trim()

    fun filter(
        tracks: List<CityPopTrack>,
        query: String = "",
        mood: String = "all",
        favorites: Set<String>? = null,
    ): List<CityPopTrack> {
        val words = normalize(query).split(" ").filter { it.isNotEmpty() }
        return tracks.filter { track ->
            (mood == "all" || mood in track.moods) &&
                (favorites == null || track.id in favorites) &&
                words.all { normalize("${track.title} ${track.artist} ${track.channel} ${track.note}").contains(it) }
        }
    }

    /**
     * Unknown/deleted catalog IDs are ignored; order follows the catalog. A `youtube-<id>`
     * favorite of a curated video becomes its catalog id (mirrors cityPopFavorites).
     */
    fun parseFavorites(text: String?, tracks: List<CityPopTrack>): Set<String> {
        if (text == null) return emptySet()
        val array = runCatching { JSONArray(text) }.getOrNull() ?: return emptySet()
        val curatedIds = tracks.filterNot { it.id.startsWith("youtube-") }.associateBy({ "youtube-${it.videoId}" }, { it.id })
        val selected = (0 until array.length()).mapNotNull { array.opt(it) as? String }.map { curatedIds[it] ?: it }.toSet()
        return tracks.mapNotNull { it.id.takeIf(selected::contains) }.toSet()
    }

    /** A search result for a curated video is that curated track: one favorite per song (mirrors cityPopCanonical). */
    fun canonical(track: CityPopTrack, catalog: List<CityPopTrack>): CityPopTrack =
        catalog.firstOrNull { it.videoId == track.videoId && !it.id.startsWith("youtube-") } ?: track

    /**
     * The order a queue plays in: from the chosen track to the end, then round to the ones before
     * it; each video once, at most 100 (mirrors cityPopPlayOrder).
     */
    fun playOrder(tracks: List<CityPopTrack>, start: Int): List<CityPopTrack> {
        val from = start.coerceIn(0, maxOf(0, tracks.size - 1))
        return (tracks.drop(from) + tracks.take(from)).distinctBy { it.videoId }.take(100)
    }

    fun serializeFavorites(ids: Set<String>, tracks: List<CityPopTrack>): String =
        JSONArray(tracks.filter { it.id in ids }.map { it.id }).toString()

    /** Only curated catalog entries can be opened or embedded. */
    fun sourceUrl(id: String, tracks: List<CityPopTrack>): String? = tracks.firstOrNull { it.id == id }?.sourceUrl

    internal fun searchUrl(query: String): okhttp3.HttpUrl {
        val q = query.trim()
        require(q.length in 2..200) { "Enter a song or artist, using 2–200 characters." }
        return okhttp3.HttpUrl.Builder().scheme("https").host("www.youtube.com").addPathSegment("results")
            .addQueryParameter("search_query", q).addQueryParameter("hl", "en").build()
    }

    suspend fun search(query: String): List<CityPopTrack> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(searchUrl(query)).header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36").build()
        val bytes = try {
            searchHttp.newCall(request).execute().use { response ->
                check(response.isSuccessful) { if (response.code == 429) "YouTube is busy. Try again later." else "YouTube search is unavailable (${response.code})." }
                val body = response.body ?: error("YouTube returned an empty page.")
                body.byteStream().use { stream ->
                    val out = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        val n = stream.read(buffer)
                        if (n < 0) break
                        check(out.size() + n <= MAX_SEARCH_BYTES) { "YouTube search returned too much data." }
                        out.write(buffer, 0, n)
                    }
                    out.toByteArray()
                }
            }
        } catch (e: java.io.IOException) {
            // Offline, DNS or a dropped connection: not OkHttp's internal wording.
            throw IllegalStateException("Couldn't reach YouTube. Check your connection and try again.", e)
        }
        parseSearchResponse(String(bytes, Charsets.UTF_8))
    }

    const val SEARCH_UNAVAILABLE = "YouTube search is unavailable right now. Try again later."

    /** A check/consent/error page must not look like a genuine empty search (parseSearch throws for it). */
    internal fun parseSearchResponse(html: String): List<CityPopTrack> = parseSearch(html)

    /**
     * Reads inert page JSON only. No page scripts, media URLs or signatures are executed. Anything
     * but a readable results page (a consent or check page, broken data, a layout this parser
     * doesn't know) throws, so it never reads as a search with no matches (mirrors parseCityPopSearch).
     */
    fun parseSearch(html: String): List<CityPopTrack> {
        check(html.length <= MAX_SEARCH_BYTES) { SEARCH_UNAVAILABLE }
        var root: JSONObject? = null
        val assignments = Regex("(?:\\b(?:var\\s+)?ytInitialData|window\\s*\\[\\s*[\"']ytInitialData[\"']\\s*\\])\\s*=\\s*")
        for (marker in assignments.findAll(html)) {
            val begin = marker.range.last + 1
            if (html.getOrNull(begin) != '{') continue
            var depth = 0
            var quote = false
            var escaped = false
            for (i in begin until html.length) {
                val c = html[i]
                if (quote) {
                    if (escaped) escaped = false else if (c == '\\') escaped = true else if (c == '"') quote = false
                } else when (c) {
                    '"' -> quote = true
                    '{' -> depth++
                    '}' -> if (--depth == 0) {
                        root = runCatching { JSONObject(html.substring(begin, i + 1)) }.getOrNull()
                        break
                    }
                }
            }
            if (root != null) break
        }
        val data = root ?: error(SEARCH_UNAVAILABLE)
        val contents = data.optJSONObject("contents")
        check(data.has("estimatedResults") || contents?.has("twoColumnSearchResultsRenderer") == true || contents?.has("sectionListRenderer") == true) { SEARCH_UNAVAILABLE }
        val found = ArrayList<CityPopTrack>()
        val seen = HashSet<String>()
        var visited = 0
        var videos = 0
        var lockups = 0
        fun text(value: JSONObject?): String = value?.optString("simpleText")?.takeIf { it.isNotEmpty() }
            ?: value?.optJSONArray("runs")?.let { runs -> (0 until runs.length()).joinToString("") { runs.optJSONObject(it)?.optString("text").orEmpty() } }.orEmpty()
        val stack = java.util.ArrayDeque<Any>()
        stack.push(data)
        while (stack.isNotEmpty() && found.size < 20 && visited++ < 100000) {
            val node = stack.pop()
            when (node) {
                is JSONObject -> {
                    node.optJSONObject("videoRenderer")?.let { renderer ->
                        videos++
                        val videoId = renderer.optString("videoId")
                        val title = text(renderer.optJSONObject("title")).trim()
                        val channel = listOf("ownerText", "longBylineText", "shortBylineText").firstNotNullOfOrNull { key ->
                            text(renderer.optJSONObject(key)).trim().takeIf { it.isNotEmpty() }
                        }.orEmpty()
                        val live = renderer.has("upcomingEventData") || renderer.optBoolean("isLiveNow") ||
                            renderer.optJSONArray("badges")?.toString()?.contains("LIVE") == true ||
                            renderer.optJSONArray("thumbnailOverlays")?.toString()?.let { "\"LIVE\"" in it || "\"UPCOMING\"" in it } == true
                        val short = renderer.optJSONObject("navigationEndpoint")?.optJSONObject("commandMetadata")
                            ?.optJSONObject("webCommandMetadata")?.optString("url")?.startsWith("/shorts/") == true
                        if (!live && !short && video.matches(videoId) && title.isNotEmpty() && title.length <= 200 && channel.isNotEmpty() && channel.length <= 200 && seen.add(videoId)) {
                            found += CityPopTrack("youtube-$videoId", title, channel, null, videoId, channel, emptyList(), "YouTube search result", "https://www.youtube.com/watch?v=$videoId")
                        }
                    }
                    if (!node.has("videoRenderer")) node.keys().asSequence().toList().asReversed().forEach {
                        if (it !in setOf("reelShelfRenderer", "reelItemRenderer", "shortsLockupViewModel")) {
                            if (it == "lockupViewModel") lockups++
                            val child = node.opt(it)
                            if (child is JSONObject || child is JSONArray) stack.push(child)
                        }
                    }
                }
                is JSONArray -> for (i in node.length() - 1 downTo 0) {
                    val child = node.opt(i)
                    if (child is JSONObject || child is JSONArray) stack.push(child)
                }
            }
        }
        // Results in a newer layout than videoRenderer: the search worked but couldn't be read.
        check(videos > 0 || lockups == 0) { SEARCH_UNAVAILABLE }
        return found
    }

    /** Saved online results are bounded records; curated tracks remain in the shipped catalog. */
    fun parseSavedTracks(text: String?): List<CityPopTrack> {
        if (text == null || text.length > 131072) return emptyList()
        val rows = runCatching { JSONArray(text) }.getOrNull() ?: return emptyList()
        val ids = HashSet<String>()
        return (0 until minOf(rows.length(), 100)).mapNotNull { index ->
            val row = rows.optJSONObject(index) ?: return@mapNotNull null
            val videoId = row.optString("videoId")
            val title = row.opt("title") as? String ?: return@mapNotNull null
            val artist = row.opt("artist") as? String ?: return@mapNotNull null
            val channel = row.opt("channel") as? String ?: return@mapNotNull null
            val note = row.opt("note") as? String ?: return@mapNotNull null
            val moods = row.optJSONArray("moods") ?: return@mapNotNull null
            if (row.optString("id") != "youtube-$videoId" || !video.matches(videoId) || row.opt("year") != JSONObject.NULL || moods.length() != 0 ||
                listOf(title, artist, channel).any { it.isBlank() || it.length > 200 } || note.isBlank() || note.length > 500 ||
                row.optString("sourceUrl") != "https://www.youtube.com/watch?v=$videoId" || !ids.add(videoId)) return@mapNotNull null
            CityPopTrack("youtube-$videoId", title.trim(), artist.trim(), null, videoId, channel.trim(), emptyList(), note.trim(), "https://www.youtube.com/watch?v=$videoId")
        }
    }

    fun serializeSavedTracks(tracks: List<CityPopTrack>): String = JSONArray(tracks.distinctBy { it.videoId }.take(100).map {
        JSONObject().put("id", it.id).put("title", it.title).put("artist", it.artist).put("year", JSONObject.NULL)
            .put("videoId", it.videoId).put("channel", it.channel).put("moods", JSONArray()).put("note", it.note).put("sourceUrl", it.sourceUrl)
    }).toString()
}
