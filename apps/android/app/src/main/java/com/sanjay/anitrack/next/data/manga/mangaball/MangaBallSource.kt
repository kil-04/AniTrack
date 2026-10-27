package com.sanjay.anitrack.next.data.manga.mangaball

import android.content.Context
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaHttp
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaSource
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.manga.MangaTitles
import com.sanjay.anitrack.next.data.manga.SourceLatest
import com.sanjay.anitrack.next.data.manga.SourceTitle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URLEncoder

/**
 * MangaBall (mangaball.com): a large multi-language aggregator with a public JSON
 * API and no browser check. Titles carry their MyAnimeList id, so a match is
 * confirmed by that link (or an exact name with the same year and country).
 * Only English uploads are listed; MangaBall names each upload's mirror as its
 * group. Page images come from its CDN, which wants the site as Referer.
 */
object MangaBallSource : MangaSource {
    override val id = "mangaball"
    override val label = "MangaBall"

    private const val API = MangaBallParser.API
    private const val MAX_JSON = 16 * 1024 * 1024
    private const val MATCH_TTL_MS = 6 * 60 * 60 * 1000L
    private const val MISS_TTL_MS = 10 * 60 * 1000L
    private const val CHAPTERS_TTL_MS = 5 * 60 * 1000L

    @Volatile private var appContext: Context? = null

    private val http = MangaHttp(
        label = label,
        hosts = setOf("api.mangaball.com"),
        userAgent = { MangaHttp.USER_AGENT },
        spacingMs = 250,
    )
    private val matches = lru<Int, Pair<Long, SourceTitle?>>(200)
    private val chapterCache = lru<String, Pair<Long, List<MangaChapter>>>(10)

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    private fun prefs() = appContext?.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)

    override fun knownTitle(anilistId: Int): SourceTitle? {
        val saved = prefs()?.getString("mangaball_match_$anilistId", null) ?: return null
        val titleId = saved.substringBefore('\t').takeIf(MangaBallParser::isId) ?: return null
        return SourceTitle(id, titleId, saved.substringAfter('\t', ""))
    }

    /** Newest English upload (one small request; the title detail's `updated_at` lags). */
    override suspend fun latest(title: SourceTitle): SourceLatest? {
        require(title.sourceId == id)
        if (!MangaBallParser.isId(title.id)) return null
        val body = get("/title/chapter-listing?title_id=${title.id}&page=1&limit=10&group_by=flat&sort_order=desc&language=en&search=", 1024 * 1024)
        return parse { MangaBallParser.latest(JSONObject(body)) }
    }

    override suspend fun find(manga: Manga): SourceTitle? {
        synchronized(matches) { matches[manga.id] }?.let { (at, title) ->
            val ttl = if (title != null) MATCH_TTL_MS else MISS_TTL_MS
            if (System.currentTimeMillis() - at < ttl) return title
        }
        knownTitle(manga.id)?.let { saved ->
            synchronized(matches) { matches[manga.id] = System.currentTimeMillis() to saved }
            return saved
        }
        val names = MangaTitles.names(manga)
        val queries = listOfNotNull(manga.title, manga.titleRomaji)
            .map { it.trim().take(120) }
            .filter { it.length >= 2 }
            .distinctBy(MangaTitles::normalize)
        val checked = HashSet<String>()
        var found: MangaBallParser.Detail? = null
        search@ for (query in queries) {
            val body = get("/title/search-advanced?keyword=${URLEncoder.encode(query, "UTF-8")}&page=1&limit=10&adult_mode=no_18", 4 * 1024 * 1024)
            // Exact names first: the search is fuzzy and ranks sequels and spin-offs highly.
            val hits = parse { MangaBallParser.search(JSONObject(body)) }
                .filter { !it.adult }
                .sortedBy { if (MangaTitles.normalize(it.name) in names) 0 else 1 }
                .take(MangaBallParser.MAX_CANDIDATES)
            for (hit in hits) {
                if (!checked.add(hit.id)) continue
                val detailBody = get("/title/detail/${hit.id}", 2 * 1024 * 1024)
                val detail = parse { MangaBallParser.detail(JSONObject(detailBody)) } ?: continue
                if (MangaBallParser.matches(detail, manga)) {
                    found = detail
                    break@search
                }
            }
        }
        val title = found?.let { SourceTitle(id, it.id, it.title) }
        synchronized(matches) { matches[manga.id] = System.currentTimeMillis() to title }
        if (title != null) prefs()?.edit()?.putString("mangaball_match_${manga.id}", "${title.id}\t${title.title.take(200)}")?.apply()
        return title
    }

    override suspend fun chapters(title: SourceTitle): List<MangaChapter> {
        require(title.sourceId == id)
        if (!MangaBallParser.isId(title.id)) throw MangaSourceException("Unrecognised MangaBall title.")
        synchronized(chapterCache) { chapterCache[title.id] }?.let { (at, list) ->
            if (System.currentTimeMillis() - at < CHAPTERS_TTL_MS) return list
        }
        val chapters = ArrayList<MangaChapter>()
        // Every English upload, a hundred to a page: bigger pages and the one-call listing
        // (`POST /chapter/chapter-listing-by-title-id`) now take longer than a request may
        // (MangaBallParser.LIST_PAGE).
        var page = 1
        while (page <= MangaBallParser.MAX_LIST_PAGES) {
            val body = get(MangaBallParser.listingPath(title.id, page), MAX_JSON)
            // Long series list thousands of uploads: parse off the UI thread.
            val result = parse { MangaBallParser.chapters(JSONObject(body)) }
            chapters += result.chapters
            if (page >= result.totalPages || chapters.size >= MangaBallParser.MAX_CHAPTERS) break
            page++
        }
        val list = chapters.distinctBy { it.id }
        if (list.isNotEmpty()) synchronized(chapterCache) { chapterCache[title.id] = System.currentTimeMillis() to list }
        return list
    }

    override suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage> {
        require(title.sourceId == id)
        if (!MangaBallParser.isId(chapter.id)) throw MangaSourceException("Unrecognised MangaBall chapter.")
        val body = get("/chapter-detail?chapter_id=${chapter.id}&user_id=demo_user", 2 * 1024 * 1024)
        return parse { MangaBallParser.pages(JSONObject(body)) }
            .ifEmpty { throw MangaSourceException("MangaBall has no pages for this chapter.") }
    }

    private suspend fun get(path: String, maxBytes: Int): String = http.get("$API$path", "application/json", maxBytes)

    private suspend fun <T> parse(block: () -> T): T = withContext(Dispatchers.Default) { block() }

    private fun <K, V> lru(max: Int) = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>) = size > max
    }
}
