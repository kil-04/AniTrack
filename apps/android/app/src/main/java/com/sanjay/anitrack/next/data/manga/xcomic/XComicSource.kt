package com.sanjay.anitrack.next.data.manga.xcomic

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

/**
 * XComic (xcomic.me): a very large aggregator with public HTML and no browser check.
 * A title page links AniList, so a match is confirmed by that id. AniTrack reads the
 * English edition with the most chapters (~200 chapters per list page, newest first).
 * Page images load from rotating iNN.imgNN.org hosts without a Referer.
 * Mirrors the desktop source in apps/desktop/main/services/manga/sources.ts.
 */
object XComicSource : MangaSource {
    override val id = "xcomic"
    override val label = "XComic"

    private const val PAGE_BYTES = 6 * 1024 * 1024
    private const val MATCH_TTL_MS = 6 * 60 * 60 * 1000L
    private const val MISS_TTL_MS = 10 * 60 * 1000L
    private const val CHAPTERS_TTL_MS = 5 * 60 * 1000L

    @Volatile private var appContext: Context? = null

    // Title pages run to ~2 MB, so requests are spaced out.
    private val http = MangaHttp(label = label, hosts = XComicParser.HOSTS, userAgent = { MangaHttp.USER_AGENT }, spacingMs = 700)
    private val matches = lru<Int, Pair<Long, SourceTitle?>>(200)
    private val chapterCache = lru<String, Pair<Long, List<MangaChapter>>>(10)

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    private fun prefs() = appContext?.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)

    override fun knownTitle(anilistId: Int): SourceTitle? {
        val saved = prefs()?.getString("xcomic_match_$anilistId", null) ?: return null
        val ref = saved.substringBefore('\t').takeIf { XComicParser.parseTitleRef(it) != null } ?: return null
        return SourceTitle(id, ref, saved.substringAfter('\t', ""))
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
        val queries = listOfNotNull(manga.title, manga.titleRomaji)
            .map { it.trim().take(120) }
            .filter { it.length >= 2 }
            .distinctBy(MangaTitles::normalize)
        val checked = HashSet<String>()
        var found: XComicParser.Detail? = null
        search@ for (query in queries) {
            val ids = parse { XComicParser.searchIds(get(XComicParser.searchUrl(query))) }
            for (titleId in ids) {
                if (!checked.add(titleId)) continue
                val detail = XComicParser.detail(get(XComicParser.titleUrl(titleId)), titleId) ?: continue
                if (matches(detail, manga)) {
                    found = detail
                    break@search
                }
            }
        }
        val title = found?.let { SourceTitle(id, it.ref, it.title) }
        synchronized(matches) { matches[manga.id] = System.currentTimeMillis() to title }
        if (title != null) prefs()?.edit()?.putString("xcomic_match_${manga.id}", "${title.id}\t${title.title.take(200)}")?.apply()
        return title
    }

    /**
     * Its AniList link decides (a different id is a rejection); unlinked, its MAL link
     * does. XComic pages give no year or country, so a title with neither link never
     * matches by name alone (as desktop's sourceMatches).
     */
    private fun matches(detail: XComicParser.Detail, manga: Manga): Boolean {
        if (detail.anilistId != null) return detail.anilistId == manga.id
        if (detail.malId != null && manga.malId != null) return detail.malId == manga.malId
        return false
    }

    override suspend fun chapters(title: SourceTitle): List<MangaChapter> {
        require(title.sourceId == id)
        val (_, editionId) = XComicParser.parseTitleRef(title.id) ?: throw MangaSourceException("Unrecognised XComic title.")
        synchronized(chapterCache) { chapterCache[title.id] }?.let { (at, list) ->
            if (System.currentTimeMillis() - at < CHAPTERS_TTL_MS) return list
        }
        // ~200 chapters per page, newest first: One Piece is 6 pages.
        val first = parse { XComicParser.chapters(get(XComicParser.editionUrl(editionId))) }
        val all = ArrayList(first.chapters)
        var page = 2
        while (page <= first.lastPage && all.size < XComicParser.MAX_CHAPTERS) {
            all += parse { XComicParser.chapters(get(XComicParser.editionUrl(editionId, page))) }.chapters
            page++
        }
        val list = all.distinctBy { it.id }
        if (list.isNotEmpty()) synchronized(chapterCache) { chapterCache[title.id] = System.currentTimeMillis() to list }
        return list
    }

    override suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage> {
        require(title.sourceId == id)
        if (!XComicParser.isId(chapter.id)) throw MangaSourceException("Unrecognised XComic chapter.")
        return parse { XComicParser.pages(get(XComicParser.chapterUrl(chapter.id))) }
            .map { MangaPage(it) }
            .ifEmpty { throw MangaSourceException("XComic has no pages for this chapter.") }
    }

    override suspend fun latest(title: SourceTitle): SourceLatest? {
        require(title.sourceId == id)
        val (_, editionId) = XComicParser.parseTitleRef(title.id) ?: return null
        return parse { XComicParser.latest(get(XComicParser.editionUrl(editionId))) }
    }

    private suspend fun get(url: String): String = http.get(url, "text/html", PAGE_BYTES)

    private suspend fun <T> parse(block: suspend () -> T): T = withContext(Dispatchers.Default) { block() }

    private fun <K, V> lru(max: Int) = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>) = size > max
    }
}
