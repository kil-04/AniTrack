package com.sanjay.anitrack.next.data.manga.weebcentral

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
 * Weeb Central (weebcentral.com): public HTML, no browser check, official translations
 * where they exist. A series page links AniList, so a match is confirmed by that id.
 * One request lists every chapter; page images load from its own hosts without a
 * Referer, so downloads fetch them like any other page.
 * Mirrors the desktop source in apps/desktop/main/services/manga/sources.ts.
 */
object WeebCentralSource : MangaSource {
    override val id = "weebcentral"
    override val label = "Weeb Central"

    private const val PAGE_BYTES = 6 * 1024 * 1024
    private const val MATCH_TTL_MS = 6 * 60 * 60 * 1000L
    private const val MISS_TTL_MS = 10 * 60 * 1000L
    private const val CHAPTERS_TTL_MS = 5 * 60 * 1000L

    @Volatile private var appContext: Context? = null

    // One Piece's full chapter list is ~2 MB, so requests are spaced out like XComic's.
    private val http = MangaHttp(label = label, hosts = WeebCentralParser.HOSTS, userAgent = { MangaHttp.USER_AGENT }, spacingMs = 700)
    private val matches = lru<Int, Pair<Long, SourceTitle?>>(200)
    private val chapterCache = lru<String, Pair<Long, List<MangaChapter>>>(10)

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    private fun prefs() = appContext?.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)

    override fun knownTitle(anilistId: Int): SourceTitle? {
        val saved = prefs()?.getString("weebcentral_match_$anilistId", null) ?: return null
        val ref = saved.substringBefore('\t').takeIf(WeebCentralParser::isId) ?: return null
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
        var found: WeebCentralParser.Detail? = null
        search@ for (query in queries) {
            val ids = parse { WeebCentralParser.searchIds(get(WeebCentralParser.searchUrl(query))) }
            for (seriesId in ids) {
                if (!checked.add(seriesId)) continue
                val detail = WeebCentralParser.detail(get(WeebCentralParser.seriesUrl(seriesId)), seriesId) ?: continue
                if (WeebCentralParser.matches(detail, manga)) {
                    found = detail
                    break@search
                }
            }
        }
        val title = found?.let { SourceTitle(id, it.id, it.title) }
        synchronized(matches) { matches[manga.id] = System.currentTimeMillis() to title }
        if (title != null) prefs()?.edit()?.putString("weebcentral_match_${manga.id}", "${title.id}\t${title.title.take(200)}")?.apply()
        return title
    }

    override suspend fun chapters(title: SourceTitle): List<MangaChapter> {
        require(title.sourceId == id)
        if (!WeebCentralParser.isId(title.id)) throw MangaSourceException("Unrecognised Weeb Central title.")
        synchronized(chapterCache) { chapterCache[title.id] }?.let { (at, list) ->
            if (System.currentTimeMillis() - at < CHAPTERS_TTL_MS) return list
        }
        val list = parse { WeebCentralParser.chapters(get(WeebCentralParser.chapterListUrl(title.id))) }
        if (list.isNotEmpty()) synchronized(chapterCache) { chapterCache[title.id] = System.currentTimeMillis() to list }
        return list
    }

    override suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage> {
        require(title.sourceId == id)
        if (!WeebCentralParser.isId(chapter.id)) throw MangaSourceException("Unrecognised Weeb Central chapter.")
        return parse { WeebCentralParser.pages(get(WeebCentralParser.imagesUrl(chapter.id))) }
            .map { MangaPage(it) }
            .ifEmpty { throw MangaSourceException("Weeb Central has no pages for this chapter.") }
    }

    override suspend fun latest(title: SourceTitle): SourceLatest? {
        require(title.sourceId == id)
        if (!WeebCentralParser.isId(title.id)) return null
        return parse { WeebCentralParser.latest(get(WeebCentralParser.seriesUrl(title.id))) }
    }

    private suspend fun get(url: String): String = http.get(url, "text/html", PAGE_BYTES)

    private suspend fun <T> parse(block: suspend () -> T): T = withContext(Dispatchers.Default) { block() }

    private fun <K, V> lru(max: Int) = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>) = size > max
    }
}
