package com.sanjay.anitrack.next.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

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

    private val http = OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    private val lock = Mutex()
    private var lastCallAt = 0L

    private val cache = object : LinkedHashMap<String, Pair<Long, JSONObject>>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Long, JSONObject>>) = size > 200
    }

    const val MEDIA_FIELDS = """
        id idMal title { romaji english } coverImage { large } bannerImage
        episodes status format seasonYear averageScore genres description(asHtml: false)
    """

    private suspend fun gql(query: String, variables: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val key = query + variables.toString()
        synchronized(cache) {
            cache[key]?.let { (at, v) -> if (System.currentTimeMillis() - at < CACHE_TTL_MS) return@withContext v }
        }
        lock.withLock {
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

    private fun mediaList(data: JSONObject): List<Anime> {
        val arr: JSONArray = data.getJSONObject("Page").getJSONArray("media")
        return (0 until arr.length()).map { Anime.fromMedia(arr.getJSONObject(it)) }
    }

    suspend fun trending(): List<Anime> = mediaList(
        gql(
            """query { Page(perPage: 20) {
                media(type: ANIME, sort: TRENDING_DESC, status_in: [RELEASING, NOT_YET_RELEASED]) { $MEDIA_FIELDS }
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

    suspend fun byId(id: Int): Anime? = try {
        val data = gql(
            """query(${'$'}id: Int) { Media(id: ${'$'}id, type: ANIME) { $MEDIA_FIELDS } }""",
            JSONObject().put("id", id),
        )
        Anime.fromMedia(data.getJSONObject("Media"))
    } catch (e: Exception) {
        null
    }
}
