package com.sanjay.anitrack.next.data.manga.mangapill

import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaHttp
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaSource
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.manga.MangaTitles
import com.sanjay.anitrack.next.data.manga.SourceTitle
import java.net.URLEncoder

/** MangaPill: public HTML catalogue, page images need MangaPill as Referer. */
object MangaPillSource : MangaSource {
    override val id = "mangapill"
    override val label = "MangaPill"

    private const val ORIGIN = MangaPillParser.ORIGIN
    private const val MAX_HTML = 4 * 1024 * 1024
    private const val MATCH_TTL_MS = 6 * 60 * 60 * 1000L
    private const val MISS_TTL_MS = 10 * 60 * 1000L
    private const val CHAPTERS_TTL_MS = 5 * 60 * 1000L
    private val TITLE_PATH = Regex("""^(\d{1,9})/([A-Za-z0-9._~-]{1,200})$""")
    private val CHAPTER_PATH = Regex("""^\d{1,9}-\d{1,12}/[A-Za-z0-9._~-]{1,200}$""")

    private val http = MangaHttp(label, setOf("mangapill.com"), { MangaHttp.USER_AGENT }, spacingMs = 300)
    private val matches = lru<Int, Pair<Long, SourceTitle?>>(200)
    private val chapterCache = lru<String, Pair<Long, List<MangaChapter>>>(20)

    override suspend fun find(manga: Manga): SourceTitle? {
        synchronized(matches) { matches[manga.id] }?.let { (at, title) ->
            val ttl = if (title != null) MATCH_TTL_MS else MISS_TTL_MS
            if (System.currentTimeMillis() - at < ttl) return title
        }
        val queries = listOfNotNull(manga.title, manga.titleRomaji)
            .map { it.trim().take(120) }
            .filter { it.length >= 2 }
            .distinctBy(MangaTitles::normalize)
        var card: MangaPillParser.Card? = null
        for (query in queries) {
            val html = http.get("$ORIGIN/search?q=${URLEncoder.encode(query, "UTF-8")}", "text/html", MAX_HTML)
            card = MangaPillParser.bestMatch(manga, MangaPillParser.cards(html))
            if (card != null) break
        }
        val title = card?.let { SourceTitle(id, it.path, it.title) }
        synchronized(matches) { matches[manga.id] = System.currentTimeMillis() to title }
        return title
    }

    override suspend fun chapters(title: SourceTitle): List<MangaChapter> {
        require(title.sourceId == id)
        val path = TITLE_PATH.matchEntire(title.id) ?: throw MangaSourceException("Unrecognised MangaPill title.")
        synchronized(chapterCache) { chapterCache[title.id] }?.let { (at, list) ->
            if (System.currentTimeMillis() - at < CHAPTERS_TTL_MS) return list
        }
        val html = http.get("$ORIGIN/manga/${title.id}", "text/html", MAX_HTML)
        val chapters = MangaPillParser.chapters(html, path.groupValues[1])
        if (chapters.isNotEmpty()) synchronized(chapterCache) { chapterCache[title.id] = System.currentTimeMillis() to chapters }
        return chapters
    }

    override suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage> {
        require(title.sourceId == id)
        if (!CHAPTER_PATH.matches(chapter.id)) throw MangaSourceException("Unrecognised MangaPill chapter.")
        val html = http.get("$ORIGIN/chapters/${chapter.id}", "text/html", MAX_HTML)
        return MangaPillParser.pages(html).ifEmpty {
            throw MangaSourceException("MangaPill has no pages for this chapter.")
        }
    }

    private fun <K, V> lru(max: Int) = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>) = size > max
    }
}
