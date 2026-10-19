package com.sanjay.anitrack.next.data.manga.xcomic

import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.SourceLatest
import java.net.URI
import java.net.URLEncoder

/**
 * XComic (xcomic.me) pages, read the same way as packages/shared/xcomic.ts: keep the
 * two identical. A title page links AniList/MAL and lists editions (each language or
 * upload group's copy); AniTrack reads the English edition with the most chapters.
 */
object XComicParser {
    const val ORIGIN = "https://xcomic.me"
    val HOSTS = setOf("xcomic.me")
    const val MAX_LIST_PAGES = 40
    const val MAX_CHAPTERS = 20_000

    private val ID = Regex("^[a-z0-9]{3,16}$")
    private val TITLE_REF = Regex("^([a-z0-9]{3,16})\\.([a-z0-9]{3,16})$")
    private val IMAGE_HOST = Regex("^i\\d{1,3}\\.img\\d{1,3}\\.org$")
    private val ENGLISH_FLAGS = setOf("🇬🇧", "🇺🇸")

    data class Edition(
        val id: String,
        val name: String,
        val flag: String,
        val chapters: Int?,
        val follows: Int?,
        val latestChapter: Float?,
        val latestAt: Long?,
        val group: String?,
    )

    data class Detail(
        /** "<title id>.<edition id>". */
        val ref: String,
        val title: String,
        val anilistId: Int?,
        val malId: Int?,
        val latestChapter: Float?,
        val latestAt: Long?,
    )

    data class ChapterPage(val chapters: List<MangaChapter>, val lastPage: Int)

    fun isId(value: String) = ID.matches(value)
    fun titleRef(titleId: String, editionId: String) = "$titleId.$editionId"
    fun parseTitleRef(ref: String): Pair<String, String>? =
        TITLE_REF.matchEntire(ref)?.let { it.groupValues[1] to it.groupValues[2] }

    fun searchUrl(query: String) = "$ORIGIN/search?word=" + URLEncoder.encode(query.trim().take(120), "UTF-8").replace("+", "%20")
    fun titleUrl(titleId: String) = "$ORIGIN/title/$titleId"
    fun editionUrl(editionId: String, page: Int = 1) =
        "$ORIGIN/source/$editionId" + if (page > 1) "?page=${minOf(MAX_LIST_PAGES, page)}" else ""
    fun chapterUrl(chapterId: String) = "$ORIGIN/chapter/$chapterId"

    /** An XComic page image AniTrack may load: https on one of its numbered image hosts. */
    fun isImage(raw: String): Boolean = runCatching {
        val uri = URI(raw)
        uri.scheme == "https" && uri.rawUserInfo == null && IMAGE_HOST.matches(uri.host.orEmpty()) &&
            uri.path.startsWith("/_f/") && !uri.path.contains("..")
    }.getOrDefault(false)

    private val ENTITIES = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "#39" to "'", "nbsp" to " ")
    private fun safeChar(code: Int) = if (code in 1..0x10FFFF && code !in 0xD800..0xDFFF) String(Character.toChars(code)) else ""
    private fun decode(text: String) = text
        .replace(Regex("&#x([0-9a-fA-F]{1,6});")) { safeChar(it.groupValues[1].toInt(16)) }
        .replace(Regex("&#([0-9]{1,7});")) { safeChar(it.groupValues[1].toInt()) }
        .replace(Regex("&([a-zA-Z]+|#39);")) { ENTITIES[it.groupValues[1].lowercase()] ?: it.value }
    private fun strip(html: String) = decode(html.replace(Regex("<[^>]*>"), " ")).replace(Regex("\\s+"), " ").trim()
    private fun count(text: String?) = text?.replace(",", "")?.toIntOrNull()?.takeIf { it >= 0 }

    /** Title ids on a search page, in the site's order. */
    fun searchIds(html: String, max: Int = 5): List<String> {
        val ids = ArrayList<String>()
        for (m in Regex("href=\"/title/([a-z0-9]{3,16})\"").findAll(html)) {
            if (m.groupValues[1] !in ids) ids += m.groupValues[1]
            if (ids.size >= max) break
        }
        return ids
    }

    /** A chapter label's number: "Chapter 1171", "Vol.TBE Ch.1170", "Volume 105 Chapter 1065.5". */
    fun chapterNumber(label: String): Float? {
        val m = Regex("\\bch(?:apter)?\\.?\\s*([0-9]{1,5}(?:\\.[0-9]{1,2})?)", RegexOption.IGNORE_CASE).find(label)
            ?: Regex("^\\s*([0-9]{1,5}(?:\\.[0-9]{1,2})?)\\s*$").find(label)
        return m?.groupValues?.get(1)?.toFloatOrNull()?.takeIf { it.isFinite() && it >= 0f }
    }

    /** Each edition card on a title page. */
    fun editions(html: String): List<Edition> {
        val cards = html.split(Regex("<div\\b[^>]*class=\"border border-base-300 hover:bg-base-200 relative\"")).drop(1)
        val out = ArrayList<Edition>()
        val seen = HashSet<String>()
        for (card in cards.take(600)) {
            val link = Regex("href=\"/source/([a-z0-9]{3,16})\"[^>]*>([\\s\\S]{0,300}?)</a>").find(card) ?: continue
            if (!seen.add(link.groupValues[1])) continue
            val stats = Regex("([\\d,]{1,9}) chapters? · ([\\d,]{1,12}) follows?").find(card)
            val latest = Regex("href=\"/chapter/[a-z0-9]{3,16}\"[^>]*>([\\s\\S]{0,200}?)</a>").find(card)
            val time = Regex("data-time=\"(\\d{10,14})\"").find(card)
            val badge = Regex("<span\\b[^>]*rounded-box[^>]*>([^<]{1,80})</span>").findAll(card).lastOrNull()
            out += Edition(
                id = link.groupValues[1],
                name = strip(link.groupValues[2]).take(200),
                flag = Regex("NotoColorEmoji[^>]*>([^<]{1,16})<").find(card)?.groupValues?.get(1)?.trim().orEmpty(),
                chapters = count(stats?.groupValues?.get(1)),
                follows = count(stats?.groupValues?.get(2)),
                latestChapter = latest?.let { chapterNumber(strip(it.groupValues[1])) },
                latestAt = time?.groupValues?.get(1)?.toLongOrNull(),
                group = badge?.let { decode(it.groupValues[1]).trim().take(80).ifEmpty { null } },
            )
        }
        return out
    }

    /** The English edition AniTrack reads: the most chapters, then the most follows, then the newest. */
    fun bestEdition(editions: List<Edition>): Edition? =
        editions.filter { it.flag in ENGLISH_FLAGS && (it.chapters ?: 0) > 0 }
            .sortedWith(
                compareByDescending<Edition> { it.chapters ?: 0 }
                    .thenByDescending { it.follows ?: 0 }
                    .thenByDescending { it.latestAt ?: 0L },
            )
            .firstOrNull()

    /** A title page: its tracker ids and the edition AniTrack reads; null without an English edition. */
    fun detail(html: String, titleId: String): Detail? {
        if (!isId(titleId)) return null
        val edition = bestEdition(editions(html)) ?: return null
        val heading = strip(
            Regex("<h3[^>]*>([\\s\\S]{1,400}?)</h3>").find(html)?.groupValues?.get(1)
                ?: Regex("<h1[^>]*>([\\s\\S]{1,400}?)</h1>").find(html)?.groupValues?.get(1) ?: "",
        )
        return Detail(
            ref = titleRef(titleId, edition.id),
            title = heading.take(300).ifEmpty { edition.name },
            anilistId = Regex("anilist\\.co/manga/(\\d{1,9})").find(html)?.groupValues?.get(1)?.toIntOrNull(),
            malId = Regex("myanimelist\\.net/manga/(\\d{1,9})").find(html)?.groupValues?.get(1)?.toIntOrNull(),
            latestChapter = edition.latestChapter,
            latestAt = edition.latestAt,
        )
    }

    /** One page of an edition's chapter list (newest first), and its last page number. */
    fun chapters(html: String, groupName: String? = null): ChapterPage {
        val out = ArrayList<MangaChapter>()
        val parts = html.split(Regex("<div\\b[^>]*class=\"break-inside-avoid "))
        val rows = parts.drop(1)
        // The edition's upload group, from its badge above the list ("TCB Scans"), when it shows one.
        val group = groupName ?: Regex("<span\\b[^>]*rounded-box[^>]*>([^<]{1,80})</span>").find(parts[0])
            ?.let { decode(it.groupValues[1]).trim().take(80).ifEmpty { null } }
        for (row in rows.take(1000)) {
            val link = Regex("href=\"/chapter/([a-z0-9]{3,16})\"[^>]*>([\\s\\S]{0,200}?)</a>").find(row) ?: continue
            val number = chapterNumber(strip(link.groupValues[2])) ?: continue
            val name = strip(Regex("<span\\b[^>]*class=\"opacity-80\"[^>]*>([\\s\\S]{0,300}?)</span>").find(row)?.groupValues?.get(1) ?: "")
                .removePrefix(":").trim()
            val time = Regex("data-time=\"(\\d{10,14})\"").find(row)?.groupValues?.get(1)?.toLongOrNull()
            out += MangaChapter(link.groupValues[1], number, name.take(200).ifEmpty { null }, group, null, time)
        }
        val pages = Regex("href=\"/source/[a-z0-9]{3,16}\\?page=(\\d{1,3})\"").findAll(html).map { it.groupValues[1].toInt() }.toList()
        return ChapterPage(out, minOf(MAX_LIST_PAGES, maxOf(1, pages.maxOrNull() ?: 1)))
    }

    /** The newest chapter on an edition's first list page. */
    fun latest(html: String): SourceLatest? = chapters(html).chapters.firstOrNull()?.let { SourceLatest(it.number, it.uploadedAt) }

    /** A chapter's page images, in reading order, from its page state's "imageUrls". */
    fun pages(html: String): List<String> {
        val at = html.indexOf("\"imageUrls\"")
        if (at < 0) return emptyList()
        val end = html.indexOf(']', at)
        val block = html.substring(at, if (end < 0) minOf(html.length, at + 200_000) else end)
        val urls = ArrayList<String>()
        for (m in Regex("\"(https://[^\"\\s\\\\]{10,400})\"").findAll(block)) {
            val url = m.groupValues[1]
            if (isImage(url) && url !in urls) urls += url
            if (urls.size >= 500) break
        }
        return urls
    }
}
