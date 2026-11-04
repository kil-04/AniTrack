package com.sanjay.anitrack.next.data.manga.weebcentral

import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaTitles
import com.sanjay.anitrack.next.data.manga.SourceLatest
import java.net.URI
import java.net.URLEncoder
import java.time.Instant
import kotlin.math.abs

/**
 * Weeb Central (weebcentral.com) pages, read the same way as packages/shared/weebcentral.ts:
 * keep the two identical. A series page links AniList; the full chapter list is one HTML
 * fragment; a chapter's images come from its *.planeptune.us / *.lastation.us / *.lowee.us
 * hosts, which need no Referer.
 */
object WeebCentralParser {
    const val ORIGIN = "https://weebcentral.com"
    val HOSTS = setOf("weebcentral.com")
    const val MAX_CHAPTERS = 20_000
    const val MAX_PAGES = 500

    /** Series and chapter ids are ULIDs: 26 Crockford base32 characters. */
    private val ULID = Regex("^[0-9A-HJKMNP-TV-Z]{26}$")
    private val IMAGE_HOST = Regex("^(?:[a-z0-9-]{1,40}\\.)?(?:planeptune|lastation|lowee|leanbox)\\.us$")
    private val COUNTRIES = mapOf("manga" to "JP", "manhwa" to "KR", "manhua" to "CN")
    private val CHAPTER_ENTRY = Regex("<a href=\"/chapters/([0-9A-HJKMNP-TV-Z]{26})\"[^>]*>([\\s\\S]{0,4000}?)</a>")

    data class Detail(
        val id: String,
        val title: String,
        val anilistId: Int?,
        val malId: Int?,
        val year: Int?,
        val country: String?,
        val adult: Boolean,
        val latestChapter: Float?,
        val latestAt: Long?,
    )

    fun isId(value: String) = ULID.matches(value)

    fun searchUrl(query: String) =
        "$ORIGIN/search/data?author=&text=" + URLEncoder.encode(query.trim().take(120), "UTF-8").replace("+", "%20") +
            "&sort=Best+Match&order=Descending&official=Any&anime=Any&adult=Any&display_mode=Full+Display"
    fun seriesUrl(id: String) = "$ORIGIN/series/$id"
    fun chapterListUrl(id: String) = "$ORIGIN/series/$id/full-chapter-list"
    fun imagesUrl(chapterId: String) = "$ORIGIN/chapters/$chapterId/images?is_prev=False&current_page=1&reading_style=long_strip"

    /** A Weeb Central page image AniTrack may load: https on one of its image hosts, under /manga/. */
    fun isImage(raw: String): Boolean = runCatching {
        val uri = URI(raw)
        uri.scheme == "https" && uri.rawUserInfo == null && (uri.port == -1 || uri.port == 443) &&
            IMAGE_HOST.matches(uri.host.orEmpty()) && uri.path.startsWith("/manga/") && !uri.path.contains("..")
    }.getOrDefault(false)

    private val ENTITIES = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "#39" to "'", "nbsp" to " ")
    private fun safeChar(code: Int) = if (code in 1..0x10FFFF && code !in 0xD800..0xDFFF) String(Character.toChars(code)) else ""
    private fun decode(text: String) = text
        .replace(Regex("&#x([0-9a-fA-F]{1,6});")) { safeChar(it.groupValues[1].toInt(16)) }
        .replace(Regex("&#([0-9]{1,7});")) { safeChar(it.groupValues[1].toInt()) }
        .replace(Regex("&([a-zA-Z]+|#39);")) { ENTITIES[it.groupValues[1].lowercase()] ?: it.value }
    private fun strip(html: String) = decode(html.replace(Regex("<[^>]*>"), " ")).replace(Regex("\\s+"), " ").trim()

    /** Series ids on a search page, in the site's order. */
    fun searchIds(html: String, max: Int = 5): List<String> {
        val ids = ArrayList<String>()
        for (m in Regex("href=\"https://weebcentral\\.com/series/([0-9A-HJKMNP-TV-Z]{26})(?:/[^\"]*)?\"").findAll(html)) {
            if (m.groupValues[1] !in ids) ids += m.groupValues[1]
            if (ids.size >= max) break
        }
        return ids
    }

    /**
     * A chapter label's number: "Chapter 1197", "Chapter 12.5", "Episode 40". Berserk's
     * "Prologue 1" to "Prologue 16" file before chapter 1, as 0.01 to 0.16.
     */
    fun chapterNumber(label: String): Float? {
        val m = Regex("^\\s*(chapter|episode|prologue)\\s+([0-9]{1,5}(?:\\.[0-9]{1,2})?)\\s*$", RegexOption.IGNORE_CASE).find(label) ?: return null
        val n = m.groupValues[2].toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 } ?: return null
        if (!m.groupValues[1].equals("prologue", ignoreCase = true)) return n.toFloat()
        return if (n == Math.floor(n) && n in 1.0..99.0) (n / 100).toFloat() else null
    }

    /** The value of one "Label: value" row in a series page's facts list. */
    private fun fact(html: String, label: String): String? {
        val at = html.indexOf("<strong>$label:")
        if (at < 0) return null
        val end = html.indexOf("</li>", at)
        val row = html.substring(at, if (end < 0) minOf(html.length, at + 600) else minOf(end, at + 2000))
        return strip(row.replaceFirst(Regex("<strong>[\\s\\S]*?</strong>"), "")).ifEmpty { null }
    }

    private fun entryChapter(id: String, body: String): MangaChapter? {
        val label = Regex("<span class=\"\">([^<]{1,80})</span>").find(body) ?: return null
        val number = chapterNumber(decode(label.groupValues[1])) ?: return null
        val at = Regex("<time\\b[^>]*datetime=\"([^\"]{10,40})\"").find(body)?.groupValues?.get(1)
            ?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        return MangaChapter(id, number, null, null, null, at)
    }

    private fun latestEntry(html: String): MangaChapter? =
        CHAPTER_ENTRY.findAll(html).firstNotNullOfOrNull { entryChapter(it.groupValues[1], it.groupValues[2]) }

    /** A series page: its AniList link decides matches. */
    fun detail(html: String, id: String): Detail? {
        if (!isId(id)) return null
        val heading = strip(Regex("<h1\\b[^>]*>([\\s\\S]{1,400}?)</h1>").find(html)?.groupValues?.get(1) ?: "")
        if (heading.isEmpty()) return null
        val anilist = Regex("anilist\\.co/manga/(\\d{1,9})").find(html)?.groupValues?.get(1)?.toIntOrNull()
        val year = fact(html, "Released")?.toIntOrNull()?.takeIf { it in 1901..2099 }
        val latest = latestEntry(html)
        return Detail(
            id = id,
            title = heading.take(300),
            anilistId = anilist,
            malId = Regex("myanimelist\\.net/manga/(\\d{1,9})").find(html)?.groupValues?.get(1)?.toIntOrNull(),
            year = year,
            country = COUNTRIES[fact(html, "Type")?.lowercase()],
            // The site's "Adult Content" also marks violent seinen (Berserk). AniTrack only lists
            // AniList titles that aren't adult, so with an AniList link that rating decides.
            adult = anilist == null && fact(html, "Adult Content")?.lowercase() == "yes",
            latestChapter = latest?.number,
            latestAt = latest?.uploadedAt,
        )
    }

    /** As desktop's sourceMatches: a tracker link decides; unlinked needs name, year and country. */
    fun matches(detail: Detail, manga: Manga): Boolean {
        if (detail.adult) return false
        if (detail.anilistId != null) return detail.anilistId == manga.id
        if (detail.malId != null && manga.malId != null) return detail.malId == manga.malId
        if (MangaTitles.normalize(detail.title) !in MangaTitles.names(manga)) return false
        if (detail.year == null || manga.year == null || abs(detail.year - manga.year) > 1) return false
        return detail.country == null || manga.country == null || detail.country.equals(manga.country, ignoreCase = true)
    }

    /** The newest chapter a series page lists. */
    fun latest(html: String): SourceLatest? = latestEntry(html)?.let { SourceLatest(it.number, it.uploadedAt) }

    /** Every chapter in a full chapter list (newest first), skipping labels without a number. */
    fun chapters(html: String): List<MangaChapter> {
        val out = ArrayList<MangaChapter>()
        val seen = HashSet<String>()
        for (m in CHAPTER_ENTRY.findAll(html)) {
            if (!seen.add(m.groupValues[1])) continue
            entryChapter(m.groupValues[1], m.groupValues[2])?.let { out += it }
            if (out.size >= MAX_CHAPTERS) break
        }
        return out
    }

    /** A chapter's page images, in reading order. */
    fun pages(html: String): List<String> {
        val urls = ArrayList<String>()
        for (m in Regex("<img\\b[^>]*?\\ssrc=\"(https://[^\"\\s]{10,400})\"").findAll(html)) {
            val url = decode(m.groupValues[1])
            if (isImage(url) && url !in urls) urls += url
            if (urls.size >= MAX_PAGES) break
        }
        return urls
    }

    /**
     * The pages the reader, tall-page slicer and downloads fetch. They carry AniTrack's own
     * user agent: the image CDN refuses OkHttp's default one (HTTP 403), which is what the
     * image loader sends otherwise. The desktop app already sends AniTrack's agent.
     */
    fun pageList(html: String, userAgent: String): List<MangaPage> =
        pages(html).map { MangaPage(url = it, headers = mapOf("User-Agent" to userAgent)) }
}
