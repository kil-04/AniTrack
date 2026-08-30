package com.sanjay.anitrack.next.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.log2

/**
 * AniList GraphQL client. Lessons inherited from the production app baked in
 * from day one: ONE request in flight at a time with spacing (AniList 429s
 * hard under bursts), bounded TTL cache, 429 retry with backoff, and a
 * hard timeout so nothing can wedge the queue.
 */
object AniList {
    private const val ENDPOINT = "https://graphql.anilist.co"
    private const val SPACING_MS = 350L
    private const val CACHE_TTL_MS = 5 * 60 * 1000L
    private const val HOME_STALE_MS = 24 * 60 * 60 * 1000L

    private lateinit var homeCacheFile: File

    fun init(context: Context) {
        if (::homeCacheFile.isInitialized) return
        homeCacheFile = File(context.applicationContext.cacheDir, "anilist-home-v1.json")
    }

    private val http = OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .build()
    private val backgroundScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val lock = Mutex()
    private var lastCallAt = 0L

    private val cache = object : LinkedHashMap<String, Pair<Long, JSONObject>>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Long, JSONObject>>) = size > 200
    }
    private val animeCache = object : LinkedHashMap<Int, Anime>(128, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Anime>) = size > 500
    }

    const val MEDIA_FIELDS = """
        id idMal isAdult title { romaji english } coverImage { large } bannerImage
        episodes duration status format seasonYear averageScore popularity genres
        studios(isMain: true) { nodes { name } }
        description(asHtml: false)
    """

    private suspend fun gql(query: String, variables: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val key = query + variables.toString()
        synchronized(cache) {
            cache[key]?.let { (at, v) -> if (System.currentTimeMillis() - at < CACHE_TTL_MS) return@withContext v }
        }
        lock.withLock {
            // Another caller may have populated the cache while this request
            // waited for the serial rate-limit lock.
            synchronized(cache) {
                cache[key]?.let { (at, value) ->
                    if (System.currentTimeMillis() - at < CACHE_TTL_MS) return@withLock value
                }
            }
            val wait = SPACING_MS - (System.currentTimeMillis() - lastCallAt)
            if (wait > 0) delay(wait)
            try {
                var lastErr: Exception? = null
                for (attempt in 1..3) {
                    val body = JSONObject().put("query", query).put("variables", variables)
                        .toString().toRequestBody("application/json".toMediaType())
                    val req = Request.Builder().url(ENDPOINT).post(body)
                        .header("Accept", "application/json").build()
                    try {
                        http.newCall(req).execute().use { res ->
                            if (res.code == 429) {
                                val ra = res.header("Retry-After")?.toLongOrNull()
                                delay(((ra ?: (attempt * 2L)) * 1000).coerceAtMost(5000))
                                return@use
                            }
                            val text = res.body?.string() ?: throw Exception("empty body")
                            if (!res.isSuccessful) throw Exception("AniList ${res.code}")
                            val json = JSONObject(text)
                            if (json.has("errors")) throw Exception(json.getJSONArray("errors").toString())
                            val data = json.getJSONObject("data")
                            synchronized(cache) { cache[key] = System.currentTimeMillis() to data }
                            return@withLock data
                        }
                    } catch (e: Exception) {
                        lastErr = e
                        if (attempt == 3) throw e
                    }
                }
                throw lastErr ?: Exception("AniList: exhausted retries")
            } finally {
                lastCallAt = System.currentTimeMillis()
            }
        }
    }

    private fun rememberAnime(media: JSONObject): Anime {
        val anime = Anime.fromMedia(media)
        synchronized(animeCache) { animeCache[anime.id] = anime }
        return anime
    }

    fun cachedAnime(id: Int): Anime? = synchronized(animeCache) { animeCache[id] }

    private fun mediaList(data: JSONObject): List<Anime> {
        val arr: JSONArray = data.getJSONObject("Page").getJSONArray("media")
        return (0 until arr.length()).map { rememberAnime(arr.getJSONObject(it)) }
    }

    suspend fun trending(): List<Anime> = mediaList(
        gql(
            """query { Page(perPage: 30) {
                media(type: ANIME, sort: TRENDING_DESC) { $MEDIA_FIELDS }
            } }""",
            JSONObject(),
        )
    )

    suspend fun popularByGenre(genre: String): List<Anime> = mediaList(
        gql(
            """query(${'$'}g: String) { Page(perPage: 15) {
                media(type: ANIME, genre: ${'$'}g, sort: POPULARITY_DESC, isAdult: false) { $MEDIA_FIELDS }
            } }""",
            JSONObject().put("g", genre),
        )
    )

    suspend fun search(q: String): List<Anime> = mediaList(
        gql(
            """query(${'$'}q: String) { Page(perPage: 30) {
                media(type: ANIME, search: ${'$'}q, sort: SEARCH_MATCH, isAdult: false) { $MEDIA_FIELDS }
            } }""",
            JSONObject().put("q", q),
        )
    )

    data class Airing(val anime: Anime, val episode: Int, val airingAt: Long)
    data class Recommendation(val anime: Anime, val reason: String, val score: Double)
    data class HomeFeed(
        val trending: List<Anime>,
        val latest: List<Airing>,
        val topAiring: List<Anime>,
        val popular: List<Anime>,
    )

    @Volatile private var homeFeedCache: Pair<Long, HomeFeed>? = null

    private fun parseHomeFeed(data: JSONObject): HomeFeed {
        fun media(alias: String): List<Anime> {
            val items = data.getJSONObject(alias).getJSONArray("media")
            return (0 until items.length()).map { rememberAnime(items.getJSONObject(it)) }
        }

        val latestItems = data.getJSONObject("latest").getJSONArray("airingSchedules")
        val seen = HashSet<Int>()
        val latest = (0 until latestItems.length()).mapNotNull { index ->
            val item = latestItems.getJSONObject(index)
            val animeJson = item.optJSONObject("media") ?: return@mapNotNull null
            val id = animeJson.optInt("id")
            if (animeJson.optBoolean("isAdult", false) || !seen.add(id)) return@mapNotNull null
            Airing(rememberAnime(animeJson), item.optInt("episode"), item.optLong("airingAt"))
        }
        return HomeFeed(
            trending = media("trending"),
            latest = latest,
            topAiring = media("topAiring"),
            popular = media("popular"),
        )
    }

    /** A complete previous Home response can paint immediately after a process
     * restart. It is then refreshed normally when older than the network TTL. */
    suspend fun cachedHomeFeed(): HomeFeed? {
        val now = System.currentTimeMillis()
        homeFeedCache?.let { (at, feed) ->
            if (now - at in 0..HOME_STALE_MS) return feed
        }
        if (!::homeCacheFile.isInitialized) return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val envelope = JSONObject(homeCacheFile.readText())
                val savedAt = envelope.getLong("savedAt")
                require(now - savedAt in 0..HOME_STALE_MS)
                val feed = parseHomeFeed(envelope.getJSONObject("data"))
                homeFeedCache = savedAt to feed
                feed
            }.getOrElse {
                runCatching { homeCacheFile.delete() }
                null
            }
        }
    }

    private fun persistHomeFeed(savedAt: Long, data: JSONObject) {
        if (!::homeCacheFile.isInitialized) return
        backgroundScope.launch {
            runCatching {
                val envelope = JSONObject().put("savedAt", savedAt).put("data", data).toString()
                val temporary = File(homeCacheFile.parentFile, "${homeCacheFile.name}.tmp")
                temporary.writeText(envelope)
                if (!temporary.renameTo(homeCacheFile)) {
                    homeCacheFile.writeText(envelope)
                    temporary.delete()
                }
            }
        }
    }

    /** All core Home network rows in one GraphQL round trip. AniList requests
     * are intentionally serialized, so four separate calls created a visible
     * row-by-row waterfall even on fast connections. */
    suspend fun homeFeed(): HomeFeed {
        val nowMs = System.currentTimeMillis()
        homeFeedCache?.let { (at, feed) ->
            if (nowMs - at < CACHE_TTL_MS) return feed
        }
        val now = nowMs / 1000
        val data = gql(
            """query(${'$'}to: Int) {
                trending: Page(perPage: 30) {
                    media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { $MEDIA_FIELDS }
                }
                latest: Page(perPage: 30) {
                    airingSchedules(airingAt_lesser: ${'$'}to, sort: TIME_DESC) {
                        airingAt episode
                        media { $MEDIA_FIELDS }
                    }
                }
                topAiring: Page(perPage: 20) {
                    media(type: ANIME, status: RELEASING, sort: POPULARITY_DESC, isAdult: false) { $MEDIA_FIELDS }
                }
                popular: Page(perPage: 20) {
                    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { $MEDIA_FIELDS }
                }
            }""",
            JSONObject().put("to", now),
        )

        val result = parseHomeFeed(data)
        homeFeedCache = nowMs to result
        persistHomeFeed(nowMs, data)
        return result
    }

    /** Airing schedule for the next 7 days (sorted by time). */
    suspend fun airingWeek(): List<Airing> {
        val now = System.currentTimeMillis() / 1000
        val week = now + 7 * 24 * 3600
        val data = gql(
            """query(${'$'}from: Int, ${'$'}to: Int) {
                Page(perPage: 50) {
                    airingSchedules(airingAt_greater: ${'$'}from, airingAt_lesser: ${'$'}to, sort: TIME) {
                        airingAt episode
                        media { $MEDIA_FIELDS }
                    }
                }
            }""",
            JSONObject().put("from", now).put("to", week),
        )
        val arr = data.getJSONObject("Page").getJSONArray("airingSchedules")
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.getJSONObject(i)
            val m = o.optJSONObject("media") ?: return@mapNotNull null
            if (m.optBoolean("isAdult", false)) return@mapNotNull null
            Airing(rememberAnime(m), o.optInt("episode"), o.optLong("airingAt"))
        }
    }

    /** Filtered search (the desktop app's Filter page). Any arg may be null. */
    suspend fun advancedSearch(
        query: String?, genre: String?, year: Int?, season: String?,
        format: String?, status: String?, sort: String, page: Int,
        source: String? = null, epMin: Int? = null, epMax: Int? = null,
    ): Pair<List<Anime>, Boolean> {
        val args = mutableListOf("\$page: Int", "\$sort: [MediaSort]")
        val mArgs = mutableListOf("type: ANIME", "isAdult: false", "sort: \$sort")
        val vars = JSONObject().put("page", page).put("sort", org.json.JSONArray().put(sort))
        query?.takeIf { it.isNotBlank() }?.let { args += "\$q: String"; mArgs += "search: \$q"; vars.put("q", it) }
        genre?.let { args += "\$genre: String"; mArgs += "genre: \$genre"; vars.put("genre", it) }
        year?.let { args += "\$year: Int"; mArgs += "seasonYear: \$year"; vars.put("year", it) }
        season?.let { args += "\$season: MediaSeason"; mArgs += "season: \$season"; vars.put("season", it) }
        format?.let { args += "\$format: MediaFormat"; mArgs += "format: \$format"; vars.put("format", it) }
        status?.let { args += "\$status: MediaStatus"; mArgs += "status: \$status"; vars.put("status", it) }
        source?.let { args += "\$src: MediaSource"; mArgs += "source: \$src"; vars.put("src", it) }
        epMin?.let { args += "\$epMin: Int"; mArgs += "episodes_greater: \$epMin"; vars.put("epMin", it - 1) }
        epMax?.let { args += "\$epMax: Int"; mArgs += "episodes_lesser: \$epMax"; vars.put("epMax", it + 1) }
        val data = gql(
            """query(${args.joinToString(", ")}) {
                Page(page: ${'$'}page, perPage: 30) {
                    pageInfo { hasNextPage }
                    media(${mArgs.joinToString(", ")}) { $MEDIA_FIELDS }
                }
            }""",
            vars,
        )
        val page1 = data.getJSONObject("Page")
        val arr = page1.getJSONArray("media")
        val list = (0 until arr.length()).map { rememberAnime(arr.getJSONObject(it)) }
        return list to page1.getJSONObject("pageInfo").optBoolean("hasNextPage", false)
    }

    suspend fun topRated(): List<Anime> = mediaList(
        gql(
            """query { Page(perPage: 12) {
                media(type: ANIME, sort: SCORE_DESC, isAdult: false) { $MEDIA_FIELDS }
            } }""",
            JSONObject(),
        )
    )

    /** Recently aired episodes (the desktop app's "Latest Episodes"), paginated.
     *  Returns the items and whether another page exists. */
    suspend fun recentEpisodes(page: Int = 1): Pair<List<Airing>, Boolean> {
        val now = System.currentTimeMillis() / 1000
        val data = gql(
            """query(${'$'}to: Int, ${'$'}page: Int) {
                Page(page: ${'$'}page, perPage: 30) {
                    pageInfo { hasNextPage }
                    airingSchedules(airingAt_lesser: ${'$'}to, sort: TIME_DESC) {
                        airingAt episode
                        media { $MEDIA_FIELDS }
                    }
                }
            }""",
            JSONObject().put("to", now).put("page", page),
        )
        val pg = data.getJSONObject("Page")
        val arr = pg.getJSONArray("airingSchedules")
        val seen = HashSet<Int>()
        val list = (0 until arr.length()).mapNotNull { i ->
            val o = arr.getJSONObject(i)
            val m = o.optJSONObject("media") ?: return@mapNotNull null
            if (m.optBoolean("isAdult", false)) return@mapNotNull null
            if (!seen.add(m.optInt("id"))) return@mapNotNull null
            Airing(rememberAnime(m), o.optInt("episode"), o.optLong("airingAt"))
        }
        return list to pg.getJSONObject("pageInfo").optBoolean("hasNextPage", false)
    }

    /** Collaborative AniList recommendations personalized from the user's
     * completed/watching titles. Already tracked and adult titles are removed. */
    suspend fun recommendations(seedIds: List<Int>, excludedIds: List<Int>): List<Recommendation> {
        val seeds = seedIds.filter { it > 0 }.distinct().take(8)
        if (seeds.isEmpty()) return emptyList()
        val excluded = (excludedIds.filter { it > 0 } + seeds).toHashSet()
        val data = gql(
            """query(${'$'}ids: [Int]) {
                Page(perPage: 8) {
                    media(id_in: ${'$'}ids, type: ANIME) {
                        id
                        title { romaji english }
                        recommendations(sort: RATING_DESC, perPage: 12) {
                            nodes {
                                rating
                                mediaRecommendation { $MEDIA_FIELDS }
                            }
                        }
                    }
                }
            }""",
            JSONObject().put("ids", JSONArray(seeds)),
        )

        data class Ranked(
            val anime: Anime,
            var score: Double,
            var bestRating: Int,
            var reason: String,
            val sources: MutableSet<Int>,
        )

        val ranked = mutableMapOf<Int, Ranked>()
        val media = data.getJSONObject("Page").getJSONArray("media")
        for (i in 0 until media.length()) {
            val seed = media.getJSONObject(i)
            val seedId = seed.getInt("id")
            val titles = seed.optJSONObject("title")
            val seedTitle = titles?.optString("english")?.takeUnless { it.isBlank() || it == "null" }
                ?: titles?.optString("romaji")?.takeUnless { it.isBlank() || it == "null" }
                ?: "a show in your list"
            val nodes = seed.optJSONObject("recommendations")?.optJSONArray("nodes") ?: continue
            for (j in 0 until nodes.length()) {
                val node = nodes.getJSONObject(j)
                val rating = node.optInt("rating")
                val candidate = node.optJSONObject("mediaRecommendation") ?: continue
                val id = candidate.optInt("id")
                if (rating <= 0 || id in excluded || candidate.optBoolean("isAdult", false)) continue
                val edgeScore = log2(rating + 1.0)
                val existing = ranked[id]
                if (existing == null) {
                    ranked[id] = Ranked(
                        anime = rememberAnime(candidate),
                        score = edgeScore,
                        bestRating = rating,
                        reason = "Because you liked $seedTitle",
                        sources = mutableSetOf(seedId),
                    )
                } else {
                    existing.score += edgeScore
                    existing.sources += seedId
                    if (rating > existing.bestRating) {
                        existing.bestRating = rating
                        existing.reason = "Because you liked $seedTitle"
                    }
                }
            }
        }
        return ranked.values
            .map {
                val graphReason = if (it.sources.size > 1) {
                    "${it.reason} and ${it.sources.size - 1} more from your list"
                } else it.reason
                val classicLabel = RecommendationRanking.classicEraLabel(it.anime.year)
                Recommendation(
                    anime = it.anime,
                    reason = if (classicLabel != null) "$classicLabel · $graphReason" else graphReason,
                    score = it.score + (it.sources.size - 1) * 2 +
                        RecommendationRanking.classicEraBoost(it.anime.year),
                )
            }
            .sortedWith(compareByDescending<Recommendation> { it.score }
                .thenByDescending { it.anime.score ?: 0 })
            .take(20)
    }

    /** Top 10 by trending (the desktop app's Top 10 rail). */
    suspend fun top10(): List<Anime> = mediaList(
        gql(
            """query { Page(perPage: 10) {
                media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { $MEDIA_FIELDS }
            } }""",
            JSONObject(),
        )
    )

    /** Popular currently-airing shows (the "Top Airing" row). */
    suspend fun topAiring(): List<Anime> = mediaList(
        gql(
            """query { Page(perPage: 20) {
                media(type: ANIME, status: RELEASING, sort: POPULARITY_DESC, isAdult: false) { $MEDIA_FIELDS }
            } }""",
            JSONObject(),
        )
    )

    /** All-time most popular (the "Most Popular" row). */
    suspend fun mostPopular(): List<Anime> = mediaList(
        gql(
            """query { Page(perPage: 20) {
                media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { $MEDIA_FIELDS }
            } }""",
            JSONObject(),
        )
    )

    /** Episodes available per show for the CW "EP N ▲/✓" badge — one batched
     *  query. Airing shows use aired-so-far (nextAiringEpisode - 1). */
    suspend fun episodeTotals(ids: List<Int>): Map<Int, Int> {
        val valid = ids.filter { it > 0 }.distinct().take(50)
        if (valid.isEmpty()) return emptyMap()
        val data = gql(
            """query(${'$'}ids: [Int]) {
                Page(perPage: 50) {
                    media(id_in: ${'$'}ids, type: ANIME) {
                        id episodes nextAiringEpisode { episode }
                    }
                }
            }""",
            JSONObject().put("ids", org.json.JSONArray(valid)),
        )
        val arr = data.getJSONObject("Page").getJSONArray("media")
        val out = mutableMapOf<Int, Int>()
        for (i in 0 until arr.length()) {
            val m = arr.getJSONObject(i)
            val aired = m.optJSONObject("nextAiringEpisode")?.optInt("episode")?.minus(1)
            val total = aired ?: (if (m.isNull("episodes")) null else m.getInt("episodes"))
            if (total != null && total > 0) out[m.getInt("id")] = total
        }
        return out
    }

    /** Map MAL ids → AniList entries in batches (for the MAL list import). */
    suspend fun byMalIds(malIds: List<Int>): List<Anime> {
        val out = mutableListOf<Anime>()
        for (chunk in malIds.distinct().chunked(50)) {
            runCatching {
                val data = gql(
                    """query(${'$'}ids: [Int]) {
                        Page(perPage: 50) { media(idMal_in: ${'$'}ids, type: ANIME) { $MEDIA_FIELDS } }
                    }""",
                    JSONObject().put("ids", org.json.JSONArray(chunk)),
                )
                val arr = data.getJSONObject("Page").getJSONArray("media")
                for (i in 0 until arr.length()) out += rememberAnime(arr.getJSONObject(i))
            }
        }
        return out
    }

    data class Relation(val type: String, val anime: Anime)

    /** Relation edges for the Watch Order chain (PREQUEL/SEQUEL hops). */
    suspend fun relations(id: Int): List<Relation> = try {
        val data = gql(
            """query(${'$'}id: Int) {
                Media(id: ${'$'}id, type: ANIME) {
                    relations { edges { relationType node { type $MEDIA_FIELDS } } }
                }
            }""",
            JSONObject().put("id", id),
        )
        val edges = data.getJSONObject("Media").getJSONObject("relations").getJSONArray("edges")
        (0 until edges.length()).mapNotNull { i ->
            val e = edges.getJSONObject(i)
            val node = e.optJSONObject("node") ?: return@mapNotNull null
            if (node.optString("type") != "ANIME") return@mapNotNull null   // skip manga nodes
            Relation(e.optString("relationType"), rememberAnime(node))
        }
    } catch (e: Exception) {
        emptyList()
    }

    suspend fun byId(id: Int): Anime? {
        cachedAnime(id)?.let { return it }
        return try {
            val data = gql(
                """query(${'$'}id: Int) { Media(id: ${'$'}id, type: ANIME) { $MEDIA_FIELDS } }""",
                JSONObject().put("id", id),
            )
            rememberAnime(data.getJSONObject("Media"))
        } catch (e: Exception) {
            null
        }
    }
}
