package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaTitles
import com.sanjay.anitrack.next.data.manga.SourceTitle
import java.net.URI
import java.util.Locale
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

internal object ComixProtocol {
    const val ORIGIN = "https://comix.to"
    const val MAX_RESPONSE = 200_000
    /**
     * Comix rate-limits by rows served: on 2026-10-14 a sixth 20-row chapter page within
     * ~2 s (or a second 100-row page) got HTTP 502 with Retry-After: 60, while 20-row
     * pages ~1.9 s apart passed 60 times in a row. Chapter pages are paced to that.
     */
    const val CHAPTER_PAGE_INTERVAL_MS = 2_000L
    /** A whole paced traversal: the 200-page cap at the interval, plus the reads. */
    const val CHAPTER_LIST_DEADLINE_MS = 480_000L
    /** Pause used when a rate-limit status arrives without a readable Retry-After. */
    const val DEFAULT_COOLDOWN_MS = 60_000L
    private val rateLimitStatuses = setOf(429, 502, 503)
    private val chapterListPath = Regex("/manga/[a-zA-Z0-9]{1,32}/chapters")
    private val retryAfterSeconds = Regex("\\d{1,6}")

    fun isChapterList(path: String) = chapterListPath.matches(path)
    fun isRateLimit(status: Int) = status in rateLimitStatuses

    /** How long to stop asking after a rate-limit answer, or null when it isn't one. Bounded to 1 s–5 min. */
    fun retryAfterMillis(status: Int, header: String?, nowMs: Long = System.currentTimeMillis()): Long? {
        if (status !in rateLimitStatuses || header.isNullOrBlank()) return null
        val value = header.trim()
        val ms = if (retryAfterSeconds.matches(value)) value.toLong() * 1000
            else runCatching { java.time.ZonedDateTime.parse(value, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() - nowMs }.getOrNull() ?: return null
        return ms.coerceIn(1_000L, 300_000L)
    }

    // This is AniTrack's local policy rejection, never a response from Comix.
    // The website treats a non-JSON 403 as a WAF failure and reloads itself.
    const val BLOCKED_MIME = "application/json"
    const val BLOCKED_BODY = "{\"message\":\"Unavailable in the public catalogue session.\"}"
    private val hid = Regex("[a-zA-Z0-9]{1,32}")
    private val chapterId = Regex("[0-9]{1,15}")
    private val publicTitlePage = Regex("/title/[a-zA-Z0-9]{1,32}(?:-[a-zA-Z0-9-]{1,200})?")
    private val languageCountries = mapOf("ja" to "JP", "jp" to "JP", "ko" to "KR", "kr" to "KR",
        "zh" to "CN", "cn" to "CN", "zh-cn" to "CN", "zh-hk" to "CN", "zh-tw" to "TW")

    fun validRequest(path: String, params: JSONObject): Boolean {
        val keys = params.keys().asSequence().toSet()
        return when {
            path == "/manga" -> keys == setOf("keyword", "page", "limit", "order[relevance]") &&
                params.optString("keyword").length in 1..200 && params.optInt("page") == 1 &&
                params.optInt("limit") == 20 && params.optString("order[relevance]") == "desc"
            Regex("/manga/[a-zA-Z0-9]{1,32}/chapters").matches(path) ->
                keys == setOf("page", "limit", "order[number]") && params.optInt("page") in 1..200 &&
                    params.optInt("limit") == 100 && params.optString("order[number]") == "asc"
            Regex("/manga/[a-zA-Z0-9]{1,32}").matches(path) ||
                Regex("/chapters/[0-9]{1,15}").matches(path) -> keys.isEmpty()
            else -> false
        }
    }

    /** Normal catalogue pages may be browsed manually, not account or reader routes. */
    fun isPublicConnectionPage(rawUrl: String): Boolean {
        val uri = websiteUri(rawUrl) ?: return false
        return uri.host.equals("comix.to", ignoreCase = true) && uri.rawPath == uri.path && publicPagePath(uri.path)
    }

    /** Pure network policy shared by navigation and resource interception.
     * WAF access permits the reviewed manual page and its observed generate/
     * verify endpoints, never a solver or automatic challenge action. Cloudflare subresources
     * stay confined to the visible, user-operated connection.
     */
    fun allowedWebsiteRequest(rawUrl: String, method: String, isMainFrame: Boolean,
        connecting: Boolean, rejected: Boolean = false): Boolean {
        val uri = websiteUri(rawUrl) ?: return false
        if (uri.host.equals("challenges.cloudflare.com", ignoreCase = true)) {
            return connecting && !isMainFrame && method in setOf("GET","POST")
        }
        if (!uri.host.equals("comix.to", ignoreCase = true) || uri.rawPath != uri.path) return false
        val path = uri.path
        // The website may return from a user-completed check with a document
        // POST to its homepage. Permit only that visible connection navigation;
        // this never submits a check or permits catalogue/account POST calls.
        if (connecting && isMainFrame && method == "POST" && path == "/") return true
        // These exact endpoints were observed in the ordinary website's manual
        // image-captcha page. Only that visible page may issue its own requests.
        if (connecting && !isMainFrame && method == "POST" && path == "/@waf/verify") return true
        if (connecting && !isMainFrame && method == "POST" && path.startsWith("/cdn-cgi/challenge-platform/")) return true
        if (method != "GET") return false
        if (path == "/@waf/challenge") return connecting // May be a same-origin verification iframe.
        if (path == "/@waf/generate") return connecting && !isMainFrame
        // Comix's reviewed anchor handler performs fetch(href), parses the HTML
        // and updates history. Public manual navigation is therefore also a GET
        // subresource, not always a main-frame document load.
        if (connecting && publicPagePath(path)) return true
        if (isMainFrame) return if (connecting) publicPagePath(path) || path.startsWith("/cdn-cgi/")
            else !rejected && path == "/"
        // The ordinary title page needs its public group filters. This is a
        // visible connection-only read, not an additional native operation.
        if (Regex("/api/v1/manga/[a-zA-Z0-9]{1,32}/groups").matches(path)) return connecting && uri.rawQuery == null
        if (path.startsWith("/api/v1/")) return (connecting || !rejected) && (
            path == "/api/v1/manga" || Regex("/api/v1/manga/[a-zA-Z0-9]{1,32}(/chapters)?").matches(path) ||
                Regex("/api/v1/chapters/[0-9]{1,15}").matches(path))
        return path.startsWith("/assets/") || path == "/favicon.ico" || (connecting && path.startsWith("/cdn-cgi/"))
    }

    private fun publicPagePath(path: String): Boolean = path == "/" || path == "/browse" || publicTitlePage.matches(path)

    private fun websiteUri(rawUrl: String): URI? {
        if (rawUrl.length !in 1..8192 || rawUrl.any { it <= ' ' || it == '\u007f' || it == '\\' }) return null
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return null
        if (uri.scheme != "https" || uri.host == null || uri.userInfo != null || uri.port !in listOf(-1,443) || uri.fragment != null) return null
        val path = uri.path ?: return null
        if (!path.startsWith('/') || "//" in path || path.split('/').any { it == "." || it == ".." }) return null
        return uri
    }

    fun titleId(value: String): String {
        require(hid.matches(value)) { "Invalid Comix title." }
        return value
    }

    fun chapterId(value: String): String {
        require(chapterId.matches(value)) { "Invalid Comix chapter." }
        return value
    }

    fun items(value: JSONObject): JSONArray = value.optJSONArray("items")
        ?: throw IllegalStateException("Comix changed its catalogue format.")

    fun title(value: JSONObject): SourceTitle? {
        val id = value.optString("hid")
        val name = value.optString("title").takeIf { it.isNotBlank() && it != "null" } ?: return null
        return if (hid.matches(id)) SourceTitle("comix", id, name.take(300)) else null
    }

    /** Tracker precedence matches the other readers; unlinked names need real year/country evidence. */
    fun matches(value: JSONObject, manga: Manga, expectedHid: String? = null): Boolean {
        if (expectedHid != null && (!hid.matches(expectedHid) || value.opt("hid") != expectedHid)) return false
        if (value.optBoolean("is18plus", false)) return false
        val links = value.optJSONObject("links")
        val al = tracker(links?.optString("al"), "anilist.co")
        val mal = tracker(links?.optString("mal"), "myanimelist.net")
        // A valid conflicting primary tracker is a rejection, never a name fallback.
        if (al != null) return al == manga.id
        if (mal != null && manga.malId != null) return mal == manga.malId
        val wanted = MangaTitles.names(manga)
        val names = mutableListOf(value.optString("title"))
        value.optJSONArray("altTitles")?.let { a ->
            for (i in 0 until minOf(a.length(), 100)) names += a.optString(i)
        }
        if (names.none { MangaTitles.normalize(it) in wanted }) return false
        val rawYear = (value.opt("year") as? Number)?.toDouble() ?: return false
        if (!rawYear.isFinite() || rawYear < 1000 || rawYear > 2100 || rawYear != rawYear.toInt().toDouble()) return false
        val year = manga.year ?: return false
        if (abs(rawYear.toInt() - year) > 1) return false
        val languageCountry = languageCountries[value.optString("originalLanguage").trim().lowercase(Locale.ROOT)]
        val country = value.optString("country").trim().uppercase(Locale.ROOT).takeIf { Regex("[A-Z]{2}").matches(it) }
        if (languageCountry != null && country != null && languageCountry != country) return false
        val actualCountry = country ?: languageCountry
        return actualCountry == null || manga.country == null || actualCountry.equals(manga.country, ignoreCase = true)
    }

    private fun tracker(value: String?, host: String): Int? = runCatching {
        if (value == null || value.length > 2048 || value.any { it <= ' ' }) return null
        val u = URI(value)
        if (u.scheme != "https" || !u.host.equals(host, ignoreCase = true) || u.userInfo != null || u.port !in listOf(-1,443)) return null
        Regex("^/manga/([0-9]+)(?:/.*)?$").find(u.normalize().path)?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it > 0 }
    }.getOrNull()

    fun chapters(value: JSONObject): List<MangaChapter> {
        val a = items(value)
        require(a.length() <= 100) { "Comix returned too many chapters in one page." }
        return buildList {
            for (i in 0 until a.length()) {
                val row = a.optJSONObject(i) ?: continue
                val id = row.optString("id")
                val number = row.optDouble("number", Double.NaN).toFloat()
                if (!chapterId.matches(id) || !number.isFinite() || number < 0f) continue
                add(MangaChapter(id, number, row.optString("name").takeIf { it.isNotBlank() && it != "null" }?.take(300),
                    row.optJSONObject("group")?.optString("name")?.takeIf { it.isNotBlank() && it != "null" }?.take(120)))
            }
        }
    }

    fun hasNext(value: JSONObject, page: Int): Boolean {
        val pagination = value.optJSONObject("pagination") ?: value.optJSONObject("meta")
            ?: throw IllegalStateException("Comix omitted chapter pagination; refusing a partial list.")
        val current = pagination.optInt("page", page)
        require(current == page) { "Comix repeated a chapter page." }
        val last = pagination.optInt("lastPage", pagination.optInt("last_page", -1))
        if (last >= 1) return page < last
        if (pagination.has("hasNext")) return pagination.getBoolean("hasNext")
        throw IllegalStateException("Comix changed its chapter pagination.")
    }

    fun pages(value: JSONObject): List<MangaPage> {
        val raw = value.opt("pages") ?: throw IllegalStateException("Comix omitted chapter images.")
        val a = if (raw is JSONArray) raw else (raw as? JSONObject)?.optJSONArray("items")
            ?: throw IllegalStateException("Comix changed its chapter image format.")
        val base = (raw as? JSONObject)?.optString("baseUrl")?.takeIf { it != "null" }.orEmpty()
        require(a.length() in 1..500) { "Comix returned an invalid page count." }
        return (0 until a.length()).map { i ->
            val row = a.getJSONObject(i)
            val url = pageImageUrl(base, row.getString("url"), row.optInt("s") == 1)
            MangaPage(url, row.optInt("width").takeIf { it in 1..20000 },
                row.optInt("height").takeIf { it in 1..20000 })
        }
    }

    private fun pageImageUrl(base: String, raw: String, isV3: Boolean): String {
        val path = try { URI(raw) } catch (_: Exception) { throw IllegalArgumentException("Invalid Comix image URL.") }
        // The public image format uses baseUrl as a directory, even when an
        // item starts with '/'. Absolute targets must be validated on their own.
        val joined = if (path.isAbsolute) raw else "${base.trimEnd('/')}/${raw.trimStart('/')}"
        val validated = imageUrl(joined)
        val url = validated.toHttpUrl()
        // s=1 requests grid-scramble metadata from the image server. Losing the
        // flag can return a scrambled page without the headers needed to decode it.
        return if (isV3 && "v3" !in url.queryParameterNames) {
            imageUrl(url.newBuilder().addQueryParameter("v3", null).build().toString())
        } else validated
    }

    fun imageUrl(raw: String): String {
        require(raw.length <= 4096 && raw.none { it <= ' ' }) { "Invalid Comix image URL." }
        val u = try { URI(raw) } catch (_: Exception) { throw IllegalArgumentException("Invalid Comix image URL.") }
        val host = u.host?.lowercase() ?: throw IllegalArgumentException("Invalid Comix image host.")
        require(u.scheme == "https" && u.userInfo == null && u.port in listOf(-1,443) && u.fragment == null &&
            host.contains('.') && host != "localhost" && !host.endsWith(".local") &&
            !host.endsWith(".internal") && !host.matches(Regex("[0-9.]+")) && ':' !in host) { "Unsafe Comix image URL." }
        return raw
    }
}
