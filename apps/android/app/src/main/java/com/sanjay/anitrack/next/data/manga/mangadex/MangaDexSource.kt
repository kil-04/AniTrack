package com.sanjay.anitrack.next.data.manga.mangadex

import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaHttp
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaSource
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.manga.MangaTitles
import com.sanjay.anitrack.next.data.manga.SourceTitle
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.net.URLEncoder

/**
 * MangaDex through its official API. Titles are matched only by MangaDex's own
 * AniList/MAL link, so a same-named series can never be picked by mistake.
 * Follows the API rules: honest User-Agent, about 4 requests per second, at most
 * 40 page-server lookups per minute and reports for MangaDex@Home image loads.
 */
object MangaDexSource : MangaSource {
    override val id = "mangadex"
    override val label = "MangaDex"

    private const val API = "https://api.mangadex.org"
    private const val MAX_JSON = 4 * 1024 * 1024
    private const val FEED_LIMIT = 500
    private const val MAX_FEED_PAGES = 10
    private const val MATCH_TTL_MS = 6 * 60 * 60 * 1000L
    private const val MISS_TTL_MS = 10 * 60 * 1000L
    private const val CHAPTERS_TTL_MS = 5 * 60 * 1000L
    /** MangaDex guarantees an at-home base URL for 15 minutes. */
    private const val SERVER_TTL_MS = 13 * 60 * 1000L
    private const val SERVER_LOOKUPS_PER_MINUTE = 35
    private const val RATINGS = "contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica"

    private val http = MangaHttp(label, setOf("api.mangadex.org"), { MangaHttp.USER_AGENT }, spacingMs = 250)
    private val matches = lru<Int, Pair<Long, SourceTitle?>>(200)
    private val chapterCache = lru<String, Pair<Long, List<MangaChapter>>>(20)
    private val servers = lru<String, Pair<Long, MangaDexParser.Server>>(40) // chapter id -> node
    private val chapterByHash = lru<String, String>(40)
    private val serverLock = Mutex()
    private val lookups = ArrayDeque<Long>()

    override suspend fun find(manga: Manga): SourceTitle? {
        synchronized(matches) { matches[manga.id] }?.let { (at, title) ->
            val ttl = if (title != null) MATCH_TTL_MS else MISS_TTL_MS
            if (System.currentTimeMillis() - at < ttl) return title
        }
        val queries = listOfNotNull(manga.title, manga.titleRomaji)
            .map { it.trim().take(120) }
            .filter { it.length >= 2 }
            .distinctBy(MangaTitles::normalize)
        var title: SourceTitle? = null
        for (query in queries) {
            val json = JSONObject(
                http.get(
                    "$API/manga?limit=20&title=${URLEncoder.encode(query, "UTF-8")}&$RATINGS&order[relevance]=desc",
                    "application/json",
                    MAX_JSON,
                ),
            )
            val linked = MangaDexParser.linkedId(json, manga.id, manga.malId) ?: continue
            title = SourceTitle(id, linked, MangaDexParser.titleOf(json, linked) ?: manga.title)
            break
        }
        synchronized(matches) { matches[manga.id] = System.currentTimeMillis() to title }
        return title
    }

    override suspend fun chapters(title: SourceTitle): List<MangaChapter> {
        require(title.sourceId == id)
        if (!MangaDexParser.isUuid(title.id)) throw MangaSourceException("Unrecognised MangaDex title.")
        synchronized(chapterCache) { chapterCache[title.id] }?.let { (at, list) ->
            if (System.currentTimeMillis() - at < CHAPTERS_TTL_MS) return list
        }
        val feed = ArrayList<MangaDexParser.FeedChapter>()
        var offset = 0
        for (page in 0 until MAX_FEED_PAGES) {
            val json = JSONObject(
                http.get(
                    "$API/manga/${title.id}/feed?translatedLanguage[]=en&limit=$FEED_LIMIT&offset=$offset" +
                        "&order[chapter]=asc&order[volume]=asc&includes[]=scanlation_group&$RATINGS" +
                        "&includeExternalUrl=0&includeEmptyPages=0&includeFuturePublishAt=0",
                    "application/json",
                    MAX_JSON,
                ),
            )
            val result = MangaDexParser.feed(json)
            feed += result.chapters
            offset += result.received
            if (result.received == 0 || offset >= result.total) break
        }
        val chapters = MangaDexParser.toChapters(feed)
        if (chapters.isNotEmpty()) synchronized(chapterCache) { chapterCache[title.id] = System.currentTimeMillis() to chapters }
        return chapters
    }

    override suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage> {
        require(title.sourceId == id)
        val server = server(chapter.id, refresh = false)
        return server.files.map { file ->
            MangaPage(
                url = MangaDexParser.pageUrl(server.baseUrl, server.hash, file),
                headers = mapOf("User-Agent" to MangaHttp.USER_AGENT),
            )
        }
    }

    /**
     * Swaps in a fresh image node when the page's node is older than its
     * guaranteed lifetime or failed since it was assigned (MangaDex asks clients
     * to request a new node after reporting a failure).
     */
    override suspend fun resolvePage(page: MangaPage): MangaPage {
        val (base, hash, file) = MangaDexParser.splitPageUrl(page.url) ?: return page
        val chapterId = synchronized(chapterByHash) { chapterByHash[hash] } ?: return page
        val (assignedAt, current) = synchronized(servers) { servers[chapterId] } ?: return page
        val stale = System.currentTimeMillis() - assignedAt > SERVER_TTL_MS ||
            MangaDexHomeReporter.failedSince(current.baseUrl, assignedAt)
        val server = if (stale) server(chapterId, refresh = true) else current
        if (server.baseUrl == base) return page
        return page.copy(url = MangaDexParser.pageUrl(server.baseUrl, server.hash, file))
    }

    private suspend fun server(chapterId: String, refresh: Boolean): MangaDexParser.Server = serverLock.withLock {
        if (!MangaDexParser.isUuid(chapterId)) throw MangaSourceException("Unrecognised MangaDex chapter.")
        val now = System.currentTimeMillis()
        synchronized(servers) { servers[chapterId] }?.let { (at, server) ->
            val fresh = now - at < SERVER_TTL_MS && !MangaDexHomeReporter.failedSince(server.baseUrl, at)
            // Another page may already have refreshed this node.
            if (fresh && (!refresh || now - at < 5_000)) return@withLock server
        }
        while (lookups.isNotEmpty() && now - lookups.first() > 60_000) lookups.removeFirst()
        if (lookups.size >= SERVER_LOOKUPS_PER_MINUTE) {
            throw MangaSourceException("MangaDex needs a moment. Retry in a minute.")
        }
        lookups.addLast(now)
        val server = try {
            MangaDexParser.server(JSONObject(http.get("$API/at-home/server/$chapterId", "application/json", 256 * 1024)))
        } catch (e: MangaSourceException) {
            if (e.status == 404) {
                throw MangaSourceException("This chapter is no longer available on MangaDex.")
            }
            throw e
        }
        synchronized(servers) { servers[chapterId] = now to server }
        synchronized(chapterByHash) { chapterByHash[server.hash] = chapterId }
        server
    }

    private fun <K, V> lru(max: Int) = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>) = size > max
    }
}
