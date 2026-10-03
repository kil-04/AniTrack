package com.sanjay.anitrack.next.data.manga.mangadot

import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaTitles
import com.sanjay.anitrack.next.data.manga.MangaUrlPolicy
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

/** Parsing of mangadot.net's public JSON API (inspected 2026-10-02). */
internal object MangaDotParser {
    const val ORIGIN = "https://mangadot.net"
    const val MAX_CANDIDATES = 5
    const val MAX_CHAPTERS = 20_000
    const val MAX_PAGES = 500
    private val SOURCES = setOf("user", "scraper")
    private val CHAPTER_REF = Regex("^(user|scraper):(\\d{1,12})$")
    private val PAGE_PATH = Regex("^/(?:chapters|uploads)/[A-Za-z0-9/_.-]{1,300}$")
    private val BARE_TITLE = Regex("(?i)^\\s*(?:ch(?:apter)?\\.?\\s*)?[\\d.]+\\s*$")
    private val TITLE_PREFIX = Regex("(?i)^\\s*ch(?:apter)?\\.?\\s*[\\d.]+\\s*[:\\-–—]?\\s*")

    /** `/api/search/suggestions` → MangaDot title ids, best first. */
    fun suggestions(json: JSONObject): List<Int> {
        val list = json.optJSONArray("suggestions") ?: return emptyList()
        return (0 until list.length()).mapNotNull { i ->
            list.optJSONObject(i)?.optInt("id", 0)?.takeIf { it > 0 }
        }.distinct().take(MAX_CANDIDATES)
    }

    data class Detail(
        val id: Int,
        val title: String,
        val anilistId: Int?,
        val malId: Int?,
        val year: Int?,
        val country: String?,
        val altTitles: List<String>,
        val latestChapter: Float? = null,
        val lastChapterAt: Long? = null,
    )

    /** `/api/manga/{id}` → identity fields. */
    fun detail(json: JSONObject): Detail? {
        val m = json.optJSONObject("manga") ?: return null
        val id = m.optInt("id", 0).takeIf { it > 0 } ?: return null
        fun int(key: String) = if (m.isNull(key)) null else m.optInt(key, 0).takeIf { it > 0 }
        val alt = m.optJSONArray("alt_titles")
        return Detail(
            id = id,
            title = m.optString("title").trim(),
            anilistId = int("anilist_id"),
            malId = int("mal_id"),
            year = int("year"),
            country = if (m.isNull("country_of_origin")) null else m.optString("country_of_origin").ifBlank { null },
            altTitles = if (alt == null) emptyList() else (0 until minOf(alt.length(), 60)).map { alt.optString(it) }.filter { it.isNotBlank() },
            latestChapter = if (m.isNull("latest_chapter_number")) null else m.optString("latest_chapter_number").trim().toFloatOrNull()
                ?.takeIf { it.isFinite() && it >= 0f },
            lastChapterAt = if (m.isNull("last_chapter_date")) null else timestamp(m.optString("last_chapter_date")),
        )
    }

    /**
     * Whether MangaDot's [detail] is this AniList [manga]. A tracker link decides
     * on its own (a conflicting link is a rejection). Unlinked titles need an
     * exact normalized name plus matching year and country.
     */
    fun matches(detail: Detail, manga: Manga): Boolean {
        if (detail.anilistId != null) return detail.anilistId == manga.id
        if (detail.malId != null && manga.malId != null) return detail.malId == manga.malId
        val names = MangaTitles.names(manga)
        val named = (listOf(detail.title) + detail.altTitles).any { MangaTitles.normalize(it) in names }
        if (!named || detail.year == null || manga.year == null || abs(detail.year - manga.year) > 1) return false
        return detail.country == null || manga.country == null || detail.country.equals(manga.country, ignoreCase = true)
    }

    /** `/api/manga/{id}/chapters/list` → English uploads. Ids carry their source ("user:25424"). */
    fun chapters(list: JSONArray): List<MangaChapter> {
        val out = ArrayList<MangaChapter>()
        for (i in 0 until minOf(list.length(), MAX_CHAPTERS)) {
            val c = list.optJSONObject(i) ?: continue
            val language = c.optString("language", "en")
            if (language.isNotEmpty() && language != "en") continue
            val source = c.optString("source", "user").takeIf { it in SOURCES } ?: continue
            val id = c.optLong("id", 0).takeIf { it > 0 } ?: continue
            if (c.optInt("page_count", 1) <= 0) continue
            val number = when (val raw = c.opt("chapter_number")) {
                is Number -> raw.toFloat()
                is String -> raw.trim().toFloatOrNull()
                else -> null
            }?.takeIf { it.isFinite() && it >= 0f && it < 100_000f } ?: continue
            val rawTitle = if (c.isNull("chapter_title")) "" else c.optString("chapter_title").trim()
            val title = rawTitle.takeUnless { BARE_TITLE.matches(it) }
                ?.replace(TITLE_PREFIX, "")?.trim()?.take(200)?.ifEmpty { null }
            val group = listOf("group_name", "scanlator_name")
                .firstNotNullOfOrNull { key -> if (c.isNull(key)) null else c.optString(key).trim().take(80).ifEmpty { null } }
            out += MangaChapter(
                id = "$source:$id",
                number = number,
                title = title,
                group = group,
                pageCount = c.optInt("page_count", 0).takeIf { it > 0 },
                uploadedAt = if (c.isNull("date_added")) null else timestamp(c.optString("date_added")),
            )
        }
        return out
    }

    /** "2026-04-29 20:49:55+00" (optionally with fractions) → epoch milliseconds. */
    fun timestamp(value: String): Long? {
        val match = TIMESTAMP.matchEntire(value.trim()) ?: return null
        val (date, time, fraction, offset) = match.destructured
        val zone = if (offset.length == 3) "$offset:00" else offset
        return runCatching {
            java.time.OffsetDateTime.parse("${date}T$time$fraction$zone").toInstant().toEpochMilli()
        }.getOrNull()
    }

    private val TIMESTAMP = Regex("""^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,9})?([+-]\d{2}(?::?\d{2})?|Z)$""")

    /** "user:25424" → ("user", 25424); null for anything else. */
    fun chapterRef(id: String): Pair<String, Long>? =
        CHAPTER_REF.matchEntire(id)?.let { it.groupValues[1] to it.groupValues[2].toLong() }

    /** API path holding a chapter's page list for its source. */
    fun imagesPath(source: String, id: Long): String =
        if (source == "user") "/api/uploads/$id/images" else "/api/chapters/$id/images"

    /** `…/images` → same-origin page images (served without a session). */
    fun pages(json: JSONObject): List<MangaPage> {
        val images = json.optJSONArray("images") ?: return emptyList()
        return (0 until minOf(images.length(), MAX_PAGES)).mapNotNull { i ->
            val image = images.optJSONObject(i) ?: return@mapNotNull null
            val path = image.optString("url")
            if (!PAGE_PATH.matches(path) || ".." in path || "//" in path) return@mapNotNull null
            val url = "$ORIGIN$path"
            if (MangaUrlPolicy.publicHttps(url) == null) return@mapNotNull null
            MangaPage(
                url = url,
                width = image.optInt("w", 0).takeIf { it in 1..20_000 },
                height = image.optInt("h", 0).takeIf { it in 1..60_000 },
            )
        }
    }
}
