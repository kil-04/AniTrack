package com.sanjay.anitrack.next.data.manga.mangadot

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebSettings
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaHttp
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaSource
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.manga.MangaTitles
import com.sanjay.anitrack.next.data.manga.MangaVerificationRequired
import com.sanjay.anitrack.next.data.manga.SourceTitle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/**
 * MangaDot (mangadot.net): a large catalogue with a plain JSON API behind
 * Cloudflare. Like AnimePahe, the user passes Cloudflare's check themselves on
 * [MangaDotConnectActivity]; the API is then called with that WebView session's
 * own cookies and genuine user agent. Page images are served without a session.
 * Titles match only through MangaDot's own AniList/MAL link, or an exact name
 * with the same year and country when it has none.
 */
object MangaDotSource : MangaSource {
    override val id = "mangadot"
    override val label = "MangaDot"
    override val connectionActivity get() = MangaDotConnectActivity::class.java

    private const val ORIGIN = MangaDotParser.ORIGIN
    private const val MAX_JSON = 16 * 1024 * 1024
    private const val MATCH_TTL_MS = 6 * 60 * 60 * 1000L
    private const val MISS_TTL_MS = 10 * 60 * 1000L
    private const val CHAPTERS_TTL_MS = 5 * 60 * 1000L

    @Volatile private var appContext: Context? = null
    @Volatile private var webUserAgent: String? = null

    private val http = MangaHttp(
        label = label,
        hosts = setOf("mangadot.net"),
        userAgent = { webUserAgent ?: MangaHttp.USER_AGENT },
        spacingMs = 300,
        headers = ::sessionCookies,
        verifiable = true,
    )
    private val matches = lru<Int, Pair<Long, SourceTitle?>>(200)
    private val chapterCache = lru<String, Pair<Long, List<MangaChapter>>>(10)

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    /** The WebView's genuine user agent: Cloudflare ties the session cookie to it. */
    private suspend fun ensureUserAgent() {
        if (webUserAgent != null) return
        val context = appContext ?: throw MangaSourceException("MangaDot isn't ready yet. Reopen AniTrack.")
        webUserAgent = withContext(Dispatchers.Main) { WebSettings.getDefaultUserAgent(context) }
    }

    /** First-party cookies of the user-verified WebView session for mangadot.net only. */
    private fun sessionCookies(): Map<String, String> =
        CookieManager.getInstance().getCookie(ORIGIN)?.takeIf { it.isNotBlank() }
            ?.let { mapOf("Cookie" to it) } ?: emptyMap()

    /** Whether the current session reaches the API (used by the connection screen). */
    internal suspend fun sessionWorks(): Boolean = try {
        ensureUserAgent()
        MangaDotParser.suggestions(JSONObject(http.get("$ORIGIN/api/search/suggestions?q=one&limit=1", "application/json", 256 * 1024)))
        true
    } catch (e: MangaVerificationRequired) {
        false
    } catch (e: MangaSourceException) {
        false
    }

    private fun prefs() = appContext?.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)

    /** A MangaDot match confirmed earlier (kept across restarts so titles open without a search). */
    fun knownTitle(anilistId: Int): SourceTitle? {
        val saved = prefs()?.getString("mangadot_match_$anilistId", null) ?: return null
        val id = saved.substringBefore('\t').toIntOrNull()?.takeIf { it > 0 } ?: return null
        return SourceTitle(this.id, id.toString(), saved.substringAfter('\t', ""))
    }

    data class Latest(val chapter: Float?, val at: Long?)

    /** Newest chapter of a matched title (one small API request). */
    suspend fun latest(title: SourceTitle): Latest? {
        require(title.sourceId == id)
        val mangaId = title.id.toIntOrNull()?.takeIf { it > 0 } ?: return null
        ensureUserAgent()
        val body = http.get("$ORIGIN/api/manga/$mangaId", "application/json", 1024 * 1024)
        val detail = parse { MangaDotParser.detail(JSONObject(body)) } ?: return null
        return Latest(detail.latestChapter, detail.lastChapterAt)
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
        ensureUserAgent()
        val queries = listOfNotNull(manga.title, manga.titleRomaji)
            .map { it.trim().take(120) }
            .filter { it.length >= 2 }
            .distinctBy(MangaTitles::normalize)
        val checked = HashSet<Int>()
        var found: MangaDotParser.Detail? = null
        search@ for (query in queries) {
            val suggestions = http.get("$ORIGIN/api/search/suggestions?q=${URLEncoder.encode(query, "UTF-8")}&limit=8", "application/json", 256 * 1024)
            val ids = parse { MangaDotParser.suggestions(JSONObject(suggestions)) }
            for (candidate in ids) {
                if (!checked.add(candidate)) continue
                val body = http.get("$ORIGIN/api/manga/$candidate", "application/json", 1024 * 1024)
                val detail = parse { MangaDotParser.detail(JSONObject(body)) } ?: continue
                if (MangaDotParser.matches(detail, manga)) {
                    found = detail
                    break@search
                }
            }
        }
        val title = found?.let { SourceTitle(id, it.id.toString(), it.title) }
        synchronized(matches) { matches[manga.id] = System.currentTimeMillis() to title }
        if (title != null) prefs()?.edit()?.putString("mangadot_match_${manga.id}", "${title.id}\t${title.title.take(200)}")?.apply()
        return title
    }

    override suspend fun chapters(title: SourceTitle): List<MangaChapter> {
        require(title.sourceId == id)
        val mangaId = title.id.toIntOrNull()?.takeIf { it > 0 } ?: throw MangaSourceException("Unrecognised MangaDot title.")
        synchronized(chapterCache) { chapterCache[title.id] }?.let { (at, list) ->
            if (System.currentTimeMillis() - at < CHAPTERS_TTL_MS) return list
        }
        ensureUserAgent()
        val body = http.get("$ORIGIN/api/manga/$mangaId/chapters/list", "application/json", MAX_JSON)
        // Long series list thousands of uploads (megabytes): parse off the UI thread.
        val chapters = parse { MangaDotParser.chapters(JSONArray(body)) }
        if (chapters.isNotEmpty()) synchronized(chapterCache) { chapterCache[title.id] = System.currentTimeMillis() to chapters }
        return chapters
    }

    override suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage> {
        require(title.sourceId == id)
        val (source, chapterId) = MangaDotParser.chapterRef(chapter.id) ?: throw MangaSourceException("Unrecognised MangaDot chapter.")
        ensureUserAgent()
        val body = http.get("$ORIGIN${MangaDotParser.imagesPath(source, chapterId)}", "application/json", 1024 * 1024)
        return parse { MangaDotParser.pages(JSONObject(body)) }
            .ifEmpty { throw MangaSourceException("MangaDot has no pages for this chapter.") }
    }

    private suspend fun <T> parse(block: () -> T): T = withContext(Dispatchers.Default) { block() }

    private fun <K, V> lru(max: Int) = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>) = size > max
    }
}
