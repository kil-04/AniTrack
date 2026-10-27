package com.sanjay.anitrack.next.data.manga.mangaball

import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaTitles
import com.sanjay.anitrack.next.data.manga.MangaUrlPolicy
import com.sanjay.anitrack.next.data.manga.SourceLatest
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs

/** Parsing of mangaball.com's public JSON API, api.mangaball.com/api/v1 (inspected 2026-10-11). */
internal object MangaBallParser {
    const val API = "https://api.mangaball.com/api/v1"
    const val SITE = "https://mangaball.com"
    const val MAX_CANDIDATES = 5
    const val MAX_CHAPTERS = 20_000
    const val MAX_PAGES = 500
    private val ID = Regex("^[a-f0-9]{24}$")
    private val BARE_TITLE = Regex("(?i)^\\s*(?:ch(?:apter)?\\.?\\s*)?[\\d.]+\\s*$")
    private val TITLE_PREFIX = Regex("(?i)^\\s*ch(?:apter)?\\.?\\s*[\\d.]+\\s*[:\\-–—]?\\s*")

    /** MangaBall's original language → AniList's country of origin. */
    private val COUNTRIES = mapOf("ja" to "JP", "jp" to "JP", "ko" to "KR", "kr" to "KR", "zh" to "CN", "cn" to "CN", "zh-hk" to "CN")

    fun isId(value: String) = ID.matches(value)

    data class Hit(val id: String, val name: String, val adult: Boolean)

    /** `/title/search-advanced` → candidate titles, best first. */
    fun search(json: JSONObject): List<Hit> {
        val list = json.optJSONArray("data") ?: return emptyList()
        return (0 until list.length()).mapNotNull { i ->
            val item = list.optJSONObject(i) ?: return@mapNotNull null
            val id = item.optString("id").ifBlank { item.optString("_id") }.takeIf(::isId) ?: return@mapNotNull null
            Hit(id, item.str("name").orEmpty(), item.optBoolean("is18plus", false))
        }.distinctBy { it.id }
    }

    data class Detail(
        val id: String,
        val title: String,
        val altTitles: List<String>,
        val malId: Int?,
        val year: Int?,
        val country: String?,
        val adult: Boolean,
        val latestChapter: Float? = null,
        val updatedAt: Long? = null,
    )

    /** `/title/detail/{id}` → identity fields. */
    fun detail(json: JSONObject): Detail? {
        val d = json.optJSONObject("data") ?: return null
        val id = d.optString("id").ifBlank { d.optString("_id") }.takeIf(::isId) ?: return null
        val links = d.optJSONObject("links")
        val alt = d.optJSONArray("alternateName")
        return Detail(
            id = id,
            title = d.str("name").orEmpty(),
            altTitles = if (alt == null) emptyList() else (0 until minOf(alt.length(), 60)).map { alt.optString(it).trim() }.filter { it.isNotBlank() && it != "null" },
            malId = links?.str("myanimelist")?.toIntOrNull()?.takeIf { it > 0 },
            year = d.str("date_published")?.take(4)?.toIntOrNull()?.takeIf { it in 1900..2100 },
            country = d.str("originalLanguage")?.lowercase()?.let(COUNTRIES::get),
            adult = d.optBoolean("is18plus", false),
            latestChapter = if (d.isNull("latest_chapter_number")) null else d.optDouble("latest_chapter_number", Double.NaN).toFloat()
                .takeIf { it.isFinite() && it >= 0f },
            updatedAt = d.str("updated_at")?.let(::timestamp),
        )
    }

    /**
     * Whether MangaBall's [detail] is this AniList [manga]. Its MyAnimeList link
     * decides on its own (a conflicting link is a rejection). Unlinked titles need
     * an exact normalized name plus matching year and country.
     */
    fun matches(detail: Detail, manga: Manga): Boolean {
        if (detail.adult) return false
        if (detail.malId != null && manga.malId != null) return detail.malId == manga.malId
        val names = MangaTitles.names(manga)
        val named = (listOf(detail.title) + detail.altTitles).any { MangaTitles.normalize(it) in names }
        if (!named || detail.year == null || manga.year == null || abs(detail.year - manga.year) > 1) return false
        return detail.country == null || manga.country == null || detail.country.equals(manga.country, ignoreCase = true)
    }

    data class ChapterPage(val chapters: List<MangaChapter>, val totalPages: Int)

    /** `/title/chapter-listing` (flat) → English uploads on this page. */
    fun chapters(json: JSONObject): ChapterPage {
        val list = json.optJSONArray("data") ?: JSONArray()
        val out = ArrayList<MangaChapter>()
        for (i in 0 until minOf(list.length(), MAX_CHAPTERS)) {
            val item = list.optJSONObject(i) ?: continue
            if (!item.optString("lang").equals("en", ignoreCase = true)) continue
            if (item.has("status") && item.optString("status") !in setOf("published", "")) continue
            val id = item.optString("id").ifBlank { item.optString("_id") }.takeIf(::isId) ?: continue
            val number = item.optDouble("number", item.optDouble("chapter_number", Double.NaN)).toFloat()
            if (!number.isFinite() || number < 0f) continue
            val group = item.optJSONObject("group")?.str("name") ?: item.str("group_name")
            out += MangaChapter(
                id = id,
                number = number,
                title = chapterTitle(item.str("name").orEmpty()),
                group = group,
                uploadedAt = item.str("created_at")?.let(::timestamp),
            )
        }
        val totalPages = json.optJSONObject("pagination")?.optInt("total_pages", 1)?.coerceAtLeast(1) ?: 1
        return ChapterPage(out, totalPages)
    }

    /**
     * Rows asked for in each page of the chapter listing. Up to 100 come back in a few
     * seconds, bigger pages far more slowly (27 Oct 2026, Solo Leveling's 728 uploads: 200
     * rows took 33 s, 500 took 68 s, and the one-call listing 105 s), past the 25 s a
     * request may take.
     */
    const val LIST_PAGE = 100

    /** Listing pages read at most: 10,000 uploads. */
    const val MAX_LIST_PAGES = 100

    /** One page of a title's English uploads, oldest first (a path under [API]). */
    fun listingPath(titleId: String, page: Int): String =
        "/title/chapter-listing?title_id=$titleId&page=$page&limit=$LIST_PAGE&group_by=flat&sort_order=asc&language=en&search="

    /**
     * A newest-first `/title/chapter-listing` page → the newest English chapter and
     * when it was uploaded. The title's own `updated_at` lags (Kagurabachi: 24 Oct
     * 2025 while chapter 134 went up on 11 Oct 2026), so Updates reads uploads.
     */
    fun latest(json: JSONObject): SourceLatest? {
        val uploads = chapters(json).chapters
        val newest = uploads.maxOfOrNull { it.number } ?: return null
        return SourceLatest(newest, uploads.filter { it.number == newest }.mapNotNull { it.uploadedAt }.maxOrNull())
    }

    /**
     * `/chapter-detail` → page images on MangaBall's CDN (it wants the site as Referer).
     * MangaBall rotates its CDN host (bulbasaur.poke-black-and-white.net, then
     * chikorita.red-and-blue.net for new chapters in Oct 2026), but one chapter's pages
     * share a host: only pages on the chapter's most common public HTTPS host are kept.
     */
    fun pages(json: JSONObject): List<MangaPage> {
        val chapter = json.optJSONObject("data")?.optJSONObject("chapter") ?: return emptyList()
        val images = chapter.optJSONArray("pages") ?: return emptyList()
        val uris = (0 until minOf(images.length(), MAX_PAGES)).mapNotNull { i ->
            MangaUrlPolicy.publicHttps(images.optString(i).trim())
        }
        val host = uris.groupingBy { it.host.lowercase() }.eachCount().entries
            .fold(null as Map.Entry<String, Int>?) { best, e -> if (best == null || e.value > best.value) e else best }?.key
            ?: return emptyList()
        return uris.filter { it.host.equals(host, ignoreCase = true) }
            .map { MangaPage(url = it.toASCIIString(), headers = mapOf("Referer" to "$SITE/")) }
    }

    /** A chapter's own name, without a bare "Chapter 12" label. */
    private fun chapterTitle(raw: String): String? {
        val name = raw.trim()
        if (name.isEmpty() || BARE_TITLE.matches(name)) return null
        return name.replace(TITLE_PREFIX, "").trim().ifEmpty { null }
    }

    /** "2025-10-02T13:07:48.357000" (UTC, no zone) → epoch milliseconds. */
    fun timestamp(value: String): Long? {
        val text = value.trim().takeIf { it.length >= 19 } ?: return null
        return runCatching {
            val withZone = if (text.endsWith("Z") || text.contains('+')) text else text + "Z"
            java.time.OffsetDateTime.parse(withZone).toInstant().toEpochMilli()
        }.getOrNull()
    }

    /** A string field, or null when missing, JSON null or blank (optString turns null into "null"). */
    private fun org.json.JSONObject.str(key: String): String? =
        if (isNull(key)) null else optString(key).trim().takeIf { it.isNotEmpty() && it != "null" }
}
