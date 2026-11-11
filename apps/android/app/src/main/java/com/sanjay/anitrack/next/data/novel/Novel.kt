package com.sanjay.anitrack.next.data.novel

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder

/*
 * Novels mode: models and the reading-source parsers (NovelBuddy's and
 * NovelArchive's JSON APIs, Novel Phoenix's pages). Mirrors the desktop app's
 * packages/shared/novel.ts.
 *
 * Novels are source-first: many web novels have no AniList entry, so a title is
 * identified by its source and that source's id. Chapter ids are the source's own
 * request locators; the printed label and the position in the list are kept apart
 * (labels like "769.5" or a missing number are never turned into a request).
 */

enum class NovelSourceId(val key: String, val label: String, val blurb: String) {
    NovelBuddy("novelbuddy", "NovelBuddy", "Large translated web-novel library, complete chapter lists"),
    NovelArchive("novelarchive", "NovelArchive", "110k+ titles; chapter labels can skip or repeat numbers"),
    NovelPhoenix("novelphoenix", "Novel Phoenix", "NovelFire's library: quick with new chapters; long chapter lists load in pages");

    companion object {
        fun of(key: String?): NovelSourceId? = entries.firstOrNull { it.key == key }
    }
}

/** A title as a source lists it (search results, home rows). */
data class NovelCard(
    val source: NovelSourceId,
    val id: String,
    val title: String,
    val cover: String?,
    /** "ongoing", "completed" or null. */
    val status: String?,
    val chapters: Int?,
    /** 0–5 as the source rates it; null when nobody rated it. */
    val rating: Double?,
    val genres: List<String>,
    /** Machine translation; hidden from the home rows. */
    val mtl: Boolean,
    /** A short plain-text blurb from lists (the title page has the full one). */
    val synopsis: String? = null,
)

/** The newest chapter a source has for a title, from its details (one small request). */
data class NovelLatest(val count: Int, val label: String?, val at: Long?)

data class NovelDetail(
    val card: NovelCard,
    val author: String?,
    val altNames: List<String>,
    val synopsis: String?,
    /** The title's page on the source's website. */
    val url: String,
    val latest: NovelLatest? = null,
)

/** One chapter: [id] is the source's request locator, [order] its 0-based position. */
data class NovelChapter(val id: String, val order: Int, val label: String, val updatedAt: Long?)

data class NovelChapterText(val id: String, val label: String, val paragraphs: List<String>)

data class NovelHome(
    val trending: List<NovelCard>,
    val popular: List<NovelCard>,
    val latest: List<NovelCard>,
    val completed: List<NovelCard>,
    /** Most bookmarked: the readers' favourites. */
    val favourites: List<NovelCard> = emptyList(),
    /** Set when this isn't NovelBuddy's live feed (a source is down): why, shown above the rows. */
    val notice: String? = null,
)

/**
 * NovelArchive only sorts by recent, popular, rating or chapters (anything else falls back
 * to recent); Novel Phoenix by popular, new or latest release (anything else falls back to new).
 */
enum class NovelSort(val label: String, val buddy: String, val archive: String, val phoenix: String) {
    Popular("Popular", "views", "popular", "popular"),
    Favourites("Fan favourites", "bookmarks", "popular", "popular"),
    Rating("Top rated", "rating", "rating", "popular"),
    Latest("Recently updated", "latest", "recent", "latest-release"),
    Newest("Newly added", "newest", "recent", "new"),
}

data class NovelFilters(
    val query: String = "",
    val genre: String? = null,
    /** "ongoing" or "completed". */
    val status: String? = null,
    val sort: NovelSort = NovelSort.Popular,
    val page: Int = 1,
)

data class NovelPage(val items: List<NovelCard>, val hasNext: Boolean)

/** Where a chapter stands, and on which source copy it was read. */
data class NovelProgress(
    val source: NovelSourceId,
    val chapterId: String,
    val chapterLabel: String,
    val chapterOrder: Int,
    val paragraph: Int,
    val paragraphCount: Int,
    val updatedAt: Long,
) {
    /** Read once its last paragraphs were on screen. */
    val finished: Boolean get() = paragraphCount > 0 && paragraph >= maxOf(0, paragraphCount - 3)
}

/** Where Continue lands: an exact paragraph on the same copy, or a fraction through when the place came from another source. */
data class NovelResume(
    val chapter: NovelChapter,
    val paragraph: Int,
    val fraction: Float?,
    /** "same", "label", "nearest" or "start". */
    val via: String,
)

class NovelParseException(message: String) : Exception(message)

object NovelGenres {
    val all = listOf(
        "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Harem", "Historical", "Horror", "Martial Arts",
        "Mature", "Mecha", "Mystery", "Psychological", "Romance", "School Life", "Sci-fi", "Seinen", "Shoujo",
        "Shounen", "Slice of Life", "Supernatural", "Tragedy", "Wuxia", "Xianxia", "Xuanhuan",
    )
}

object Novels {
    const val MAX_CHAPTERS = 20_000
    const val MAX_PARAGRAPHS = 5_000

    /** Where a request goes when its own source is down: NovelBuddy, or NovelArchive for NovelBuddy itself. */
    fun otherSource(source: NovelSourceId) = if (source == NovelSourceId.NovelBuddy) NovelSourceId.NovelArchive else NovelSourceId.NovelBuddy

    /** What Home says when it isn't showing NovelBuddy's live feed. */
    const val HOME_FALLBACK_NOTICE = "NovelBuddy isn't responding right now, so Home shows NovelArchive's lists. Your reading and lists are untouched."
    const val HOME_SAVED_NOTICE = "The novel sources aren't responding right now, so this is the Home saved earlier. Your reading and lists are untouched."

    /** What search says when its source didn't answer and the other one did. */
    fun fallbackNotice(failed: NovelSourceId, used: NovelSourceId) =
        "${failed.label} isn't responding right now, so these results are from ${used.label}."

    private val NB_ID = Regex("^[A-Za-z0-9]{4,24}$")
    private val NA_ID = Regex("^[a-f0-9]{24}$")
    private val NA_CHAPTER = Regex("^[1-9][0-9]{0,5}$")
    /** Novel Phoenix ids are the lower-case slugs of its addresses; its chapters are requested by position. */
    private val NP_ID = Regex("^[a-z0-9][a-z0-9-]{0,119}$")

    fun isTitleId(source: NovelSourceId, id: String) = when (source) {
        NovelSourceId.NovelBuddy -> NB_ID.matches(id)
        NovelSourceId.NovelArchive -> NA_ID.matches(id)
        NovelSourceId.NovelPhoenix -> NP_ID.matches(id)
    }

    fun isChapterId(source: NovelSourceId, id: String) = when (source) {
        NovelSourceId.NovelBuddy -> NB_ID.matches(id)
        NovelSourceId.NovelArchive, NovelSourceId.NovelPhoenix -> NA_CHAPTER.matches(id)
    }

    /**
     * Where Continue lands on [source]'s list: the newest chapter read on any linked
     * source ([progress] is keyed by [chapterKey]), found here by id (same copy) or
     * label, or the one after it once finished. A chapter this source lacks
     * continues after its nearest earlier chapter. Mirrors novelResumeTarget on desktop.
     */
    fun resumeTarget(chapters: List<NovelChapter>, progress: Map<String, NovelProgress>, source: NovelSourceId): NovelResume? {
        if (chapters.isEmpty()) return null
        val start = NovelResume(chapters[0], 0, null, "start")
        val newest = progress.values.maxByOrNull { it.updatedAt } ?: return start
        var index = if (newest.source == source) chapters.indexOfFirst { it.id == newest.chapterId } else -1
        var via = "same"
        val key = chapterKey(newest.chapterLabel)
        if (index < 0) {
            index = chapters.indexOfFirst { chapterKey(it.label) == key }
            via = "label"
        }
        if (index >= 0) {
            if (newest.finished && index < chapters.lastIndex) return NovelResume(chapters[index + 1], 0, null, via)
            if (via == "same") return NovelResume(chapters[index], newest.paragraph, null, via)
            val fraction = if (newest.paragraphCount > 0) newest.paragraph.toFloat() / newest.paragraphCount else 0f
            return NovelResume(chapters[index], 0, fraction, via)
        }
        val target = keyParts(key) ?: return start
        var best = -1
        var bestParts: KeyParts? = null
        chapters.forEachIndexed { i, c ->
            val parts = keyParts(chapterKey(c.label)) ?: return@forEachIndexed
            if (compare(parts, target) < 0 && (bestParts == null || compare(parts, bestParts!!) >= 0)) {
                best = i
                bestParts = parts
            }
        }
        if (best < 0) return start
        return NovelResume(chapters[minOf(best + 1, chapters.lastIndex)], 0, null, "nearest")
    }

    private val CHAPTER = Regex("\\b(?:chapter|chap|ch)\\.?\\s*(\\d+(?:\\.\\d+)?)")
    private val EPISODE = Regex("^(?:episode|ep)\\.?\\s*(\\d+(?:\\.\\d+)?)")
    private val LEADING = Regex("^#?\\s*(\\d+(?:\\.\\d+)?)(?!\\d|\\.\\d)")
    private val VOLUME = Regex("\\b(?:volume|vol)\\.?\\s*(\\d+)\\b")
    private val BRACKETS = Regex("[(\\[]([^)\\]]{1,40})[)\\]]")
    private val PART = Regex("^(?:part|pt)\\s*(\\d+)$")
    private val OF = Regex("^(\\d+)\\s*/\\s*\\d+$")
    private val DIGITS = Regex("^(\\d+)$")
    private val LOOSE_PART = Regex("\\b(?:part|pt)\\.?\\s*(\\d+)\\b")
    private val DASHES = Regex("[\\u2010-\\u2015]")
    private val SPACES = Regex("\\s+")
    private val NOT_WORD = Regex("[^\\p{L}\\p{N}]+")
    private val NOT_QUALIFIER = Regex("[^a-z0-9/]+")

    private fun integer(digits: String) = digits.trimStart('0').ifEmpty { "0" }

    /**
     * A chapter's identity across sources, from its label: the (volume and) number,
     * plus "part N" or "teaser" when the entry is a separate piece — never its
     * position, which drifts between sources (NovelArchive's Overgeared has a
     * "Chapter 1733 (Teaser)" entry and no Chapter 2009). Same as desktop's chapterKey.
     */
    fun chapterKey(label: String): String {
        val s = java.text.Normalizer.normalize(label, java.text.Normalizer.Form.NFKC).lowercase()
            .replace(DASHES, "-").replace(SPACES, " ").trim()
        val chapter = CHAPTER.find(s) ?: EPISODE.find(s) ?: LEADING.find(s)
            ?: return "~" + s.replace(NOT_WORD, " ").trim()
        val number = java.math.BigDecimal(chapter.groupValues[1]).stripTrailingZeros().toPlainString()
        val volume = VOLUME.find(s)?.groupValues?.get(1)?.let(::integer)
        var part: String? = null
        var teaser = false
        for (m in BRACKETS.findAll(s)) {
            val q = m.groupValues[1].replace(NOT_QUALIFIER, " ").trim()
            if (q == "teaser" || q == "preview") teaser = true
            val p = PART.find(q) ?: OF.find(q) ?: DIGITS.find(q)
            if (p != null) part = integer(p.groupValues[1])
        }
        if (part == null) LOOSE_PART.find(s)?.let { part = integer(it.groupValues[1]) }
        return listOfNotNull(volume?.let { "v$it" }, number, part?.let { "p$it" }, if (teaser) "teaser" else null).joinToString(" ")
    }

    private data class KeyParts(val volume: Double, val number: Double, val part: Double, val teaser: Boolean)

    private fun keyParts(key: String): KeyParts? {
        if (key.startsWith("~")) return null
        var volume = 0.0
        var number = Double.NaN
        var part = 0.0
        var teaser = false
        for (token in key.split(" ")) {
            when {
                token == "teaser" -> teaser = true
                token.startsWith("v") -> volume = token.drop(1).toDoubleOrNull() ?: 0.0
                token.startsWith("p") -> part = token.drop(1).toDoubleOrNull() ?: 0.0
                else -> number = token.toDoubleOrNull() ?: Double.NaN
            }
        }
        return if (number.isFinite()) KeyParts(volume, number, part, teaser) else null
    }

    private fun compare(a: KeyParts, b: KeyParts): Int =
        compareValuesBy(a, b, { it.volume }, { it.number }, { it.part }, { !it.teaser })

    /** The progress shown for one chapter of a source's list (matched by label across sources). */
    fun progressFor(progress: Map<String, NovelProgress>, chapter: NovelChapter): NovelProgress? = progress[chapterKey(chapter.label)]

    /** Whether two author lines name the same person; null when either is missing. */
    fun authorsMatch(a: String?, b: String?): Boolean? {
        if (a.isNullOrBlank() || b.isNullOrBlank()) return null
        fun parts(s: String) = s.split(Regex("[/,&;|]|\\band\\b", RegexOption.IGNORE_CASE)).map(::normal).filter { it.length >= 2 }
        val pa = parts(a)
        val pb = parts(b)
        return pa.any { x -> pb.any { y -> x == y || (x.length >= 4 && y.length >= 4 && (x.contains(y) || y.contains(x))) } }
    }

    /**
     * Whether two source copies are the same novel: "yes" needs a shared name and the
     * same author; "maybe" is the same main title where one source names no author.
     */
    fun sameNovel(aTitle: String, aAlt: List<String>, aAuthor: String?, bTitle: String, bAlt: List<String>, bAuthor: String?): String {
        val na = (listOf(aTitle) + aAlt).map(::normal).filter { it.length >= 2 }.toSet()
        val nb = (listOf(bTitle) + bAlt).map(::normal).filter { it.length >= 2 }.toSet()
        val strong = normal(bTitle) in na || normal(aTitle) in nb
        val weak = !strong && na.any { it.length >= 3 && it in nb }
        if (!strong && !weak) return "no"
        val authors = authorsMatch(aAuthor, bAuthor)
        if (authors == true) return "yes"
        return if (authors == null && strong) "maybe" else "no"
    }

    /** Candidates on another source for [title], best first: exact names, then the source's order. */
    fun rankMatches(title: String, altNames: List<String>, candidates: List<NovelCard>): List<NovelCard> {
        val names = (listOf(title) + altNames).map(::normal).filter { it.isNotEmpty() }.toSet()
        val wanted = normal(title)
        return candidates.filter { !it.mtl }
            .withIndex()
            .sortedWith(compareByDescending<IndexedValue<NovelCard>> {
                val n = normal(it.value.title)
                when { n in names -> 2; wanted.isNotEmpty() && n.contains(wanted) -> 1; else -> 0 }
            }.thenBy { it.index })
            .map { it.value }
    }

    private fun normal(s: String) = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFKC).lowercase()
        .replace(Regex("\\(web novel\\)|\\(wn\\)|\\(ln\\)|\\(light novel\\)"), "")
        .replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim()
}

// ── Text ──────────────────────────────────────────────────────────────────────

object NovelText {
    private val ENTITIES = mapOf(
        "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ", "hellip" to "…",
        "mdash" to "—", "ndash" to "–", "lsquo" to "‘", "rsquo" to "’", "ldquo" to "“", "rdquo" to "”",
        "laquo" to "«", "raquo" to "»", "middot" to "·", "bull" to "•", "copy" to "©", "reg" to "®",
        "trade" to "™", "deg" to "°", "times" to "×", "eacute" to "é", "egrave" to "è", "iexcl" to "¡", "iquest" to "¿",
    )
    private val ENTITY = Regex("&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});")
    private val DROP_BLOCKS = Regex("<(script|style|noscript|iframe|template|svg)\\b[\\s\\S]*?</\\1\\s*>", RegexOption.IGNORE_CASE)
    private val COMMENT = Regex("<!--[\\s\\S]*?-->")
    private val BR = Regex("<br\\s*/?>", RegexOption.IGNORE_CASE)
    private val BLOCK_END = Regex("</(p|div|h[1-6]|li|blockquote|section|article|tr)\\s*>", RegexOption.IGNORE_CASE)
    private val HR = Regex("<hr\\b[^>]*>", RegexOption.IGNORE_CASE)
    private val TAG = Regex("<[^>]*>")
    private val CONTROL = Regex("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u200b\\ufeff]")
    private val SPACES = Regex("[ \\t\\u00a0]+")
    private val MARKUP = Regex("</?(p|br|div)\\b", RegexOption.IGNORE_CASE)

    fun decode(text: String): String = ENTITY.replace(text) { m ->
        val name = m.groupValues[1]
        if (name.startsWith("#")) {
            val code = if (name.length > 1 && (name[1] == 'x' || name[1] == 'X')) name.drop(2).toIntOrNull(16) else name.drop(1).toIntOrNull()
            if (code != null && code in 1..0x10FFFF && code !in 0xD800..0xDFFF) String(Character.toChars(code)) else ""
        } else {
            ENTITIES[name.lowercase()] ?: m.value
        }
    }

    /** Chapter HTML as plain paragraphs: every tag is removed, never rendered. */
    fun htmlToParagraphs(html: String): List<String> {
        val text = html.replace(DROP_BLOCKS, "").replace(COMMENT, "")
            .replace(BR, "\n").replace(BLOCK_END, "\n").replace(HR, "\n* * *\n")
            .replace(TAG, "")
        return textToParagraphs(decode(text))
    }

    /** Collapses runs of spaces and drops control characters, keeping the text itself. */
    fun cleanLine(line: String): String = line.replace(CONTROL, "").replace(SPACES, " ").trim()

    /** A fragment's text: tags dropped, entities decoded, spaces collapsed; null when nothing is left. */
    fun fragment(html: String?, max: Int = 300): String? =
        html?.let { cleanLine(decode(it.replace(TAG, " "))) }?.takeIf { it.isNotEmpty() }?.take(max)

    fun textToParagraphs(text: String): List<String> {
        val out = ArrayList<String>()
        for (raw in text.split('\n')) {
            val line = cleanLine(raw)
            if (line.isNotEmpty()) out += line
            if (out.size >= Novels.MAX_PARAGRAPHS) break
        }
        return out
    }

    fun auto(content: String): List<String> =
        if (MARKUP.containsMatchIn(content)) htmlToParagraphs(content) else textToParagraphs(decode(content))

    /** Drops a leading heading that only repeats the label ("Chapter 12"). */
    fun dropRepeatedHeading(paragraphs: List<String>, label: String): List<String> {
        fun norm(s: String) = s.lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()
        return if (paragraphs.size > 1 && norm(paragraphs[0]) == norm(label)) paragraphs.drop(1) else paragraphs
    }
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

private fun JSONObject.text(key: String, max: Int = 500): String? =
    (opt(key) as? String)?.trim()?.takeIf { it.isNotEmpty() }?.take(max)

private fun JSONObject.number(key: String): Double? = when (val v = opt(key)) {
    is Number -> v.toDouble().takeIf { it.isFinite() }
    is String -> v.toDoubleOrNull()?.takeIf { it.isFinite() }
    else -> null
}

private fun JSONObject.time(key: String): Long? =
    text(key)?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

private fun status(value: String?): String? = when (value?.lowercase()?.replace(Regex("[^a-z]"), "")) {
    "ongoing", "releasing", "publishing" -> "ongoing"
    "completed", "complete", "finished" -> "completed"
    else -> null
}

private fun image(value: String?, base: String): String? {
    if (value.isNullOrBlank() || value.length > 2048) return null
    return runCatching {
        val uri = URI(base).resolve(value.trim())
        if (uri.scheme.equals("https", true) && uri.userInfo == null && uri.host != null) uri.toString() else null
    }.getOrNull()
}

private fun unique(values: List<String?>, max: Int): List<String> {
    val seen = HashSet<String>()
    val out = ArrayList<String>()
    for (v in values) {
        if (v.isNullOrBlank()) continue
        if (!seen.add(v.lowercase())) continue
        out += v
        if (out.size >= max) break
    }
    return out
}

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

/** A blurb as plain text (sources send HTML or text), cut to [max] characters. */
private fun plainText(value: String?, max: Int): String? {
    if (value.isNullOrBlank()) return null
    val text = NovelText.htmlToParagraphs(value.take(20_000)).joinToString("\n").trim()
    if (text.isEmpty()) return null
    return if (text.length > max) text.take(max - 1).trimEnd() + "…" else text
}

// ── NovelBuddy (api.novelbuddy.me) ────────────────────────────────────────────

object NovelBuddyParser {
    const val API = "https://api.novelbuddy.me"
    const val SITE = "https://novelbuddy.me"
    val HOSTS = setOf("api.novelbuddy.me")
    private val ID = Regex("^[A-Za-z0-9]{4,24}$")
    private val MTL = Regex("(?i)^mtl\\s*-")

    fun searchUrl(f: NovelFilters, limit: Int = 24): String {
        val p = ArrayList<String>()
        val q = f.query.trim()
        if (q.isNotEmpty()) p += "q=${enc(q.take(120))}"
        f.genre?.let { p += "genres=${enc(it.lowercase().replace(Regex("[^a-z0-9]+"), "-"))}" }
        f.status?.let { p += "status=${enc(it)}" }
        if (q.isEmpty()) p += "sort=${f.sort.buddy}"
        p += "page=${f.page.coerceIn(1, 500)}"
        p += "limit=$limit"
        return "$API/titles/search?${p.joinToString("&")}"
    }

    fun homeUrl() = "$API/titles/home"
    fun titleUrl(id: String) = "$API/titles/${enc(id)}"
    fun chaptersUrl(id: String) = "$API/titles/${enc(id)}/chapters"
    fun chapterUrl(titleId: String, chapterId: String) = "$API/titles/${enc(titleId)}/chapters/${enc(chapterId)}"

    private fun data(json: JSONObject): JSONObject {
        if (json.optBoolean("success", true) == false) throw NovelParseException(json.optString("message").take(200).ifBlank { "NovelBuddy sent an error." })
        return json.optJSONObject("data") ?: JSONObject()
    }

    fun card(o: JSONObject): NovelCard? {
        val id = o.text("id", 40)?.takeIf(ID::matches) ?: return null
        val title = o.text("name", 300) ?: return null
        val rating = (o.number("rating_avg") ?: o.number("rating"))?.takeIf { it > 0 }?.coerceAtMost(5.0)
        return NovelCard(
            source = NovelSourceId.NovelBuddy,
            id = id,
            title = title,
            cover = image(o.text("cover", 2048), SITE),
            status = status(o.text("status")),
            chapters = o.optJSONObject("stats")?.number("chapters_count")?.toInt(),
            rating = rating,
            genres = unique(genres(o), 12),
            mtl = o.optBoolean("is_mtl", false) || MTL.containsMatchIn(title),
            synopsis = plainText(o.text("summary", 20_000), 600),
        )
    }

    /** Genre names, or (trending rows) "fantasy,martial-arts" slugs made readable. */
    private fun genres(o: JSONObject): List<String?> {
        val named = o.optJSONArray("genres").objects().map { it.text("name", 40) }
        if (named.isNotEmpty()) return named
        val slugs = when (val g = o.opt("genre_slugs")) {
            is String -> g.split(',')
            is JSONArray -> (0 until g.length()).map { g.optString(it) }
            else -> emptyList()
        }
        return slugs.map { it.trim().take(40) }.filter { it.isNotEmpty() }.map { it.replaceFirstChar(Char::uppercaseChar).replace('-', ' ') }
    }

    fun search(json: JSONObject): NovelPage {
        val d = data(json)
        return NovelPage(d.optJSONArray("items").objects().mapNotNull(::card), d.optJSONObject("pagination")?.optBoolean("has_next", false) == true)
    }

    /** Home rows (machine translations dropped); [NovelHome.completed] is filled by a search. */
    fun home(json: JSONObject): NovelHome {
        val d = data(json)
        fun human(list: List<NovelCard>) = list.filter { !it.mtl }
        return NovelHome(
            trending = human(d.optJSONArray("trending").objects().mapNotNull(::card)),
            popular = human(d.optJSONArray("popular").objects().mapNotNull(::card)),
            latest = human(d.optJSONObject("latest")?.optJSONArray("items").objects().mapNotNull(::card)),
            completed = emptyList(),
            favourites = emptyList(),
        )
    }

    fun detail(json: JSONObject): NovelDetail {
        val d = data(json)
        val t = d.optJSONObject("title") ?: d
        val card = card(t) ?: throw NovelParseException("NovelBuddy doesn't have this title.")
        val alt = t.optJSONArray("alt_names").objects().flatMap { (it.text("name", 300) ?: "").split(',').map(String::trim) }
        val slug = t.text("slug", 200)
        // The detail embeds only the newest chapters: the count comes from its stats.
        val newest = t.optJSONArray("latest_chapters")?.optJSONObject(0) ?: t.optJSONArray("chapters")?.optJSONObject(0)
        val count = card.chapters ?: t.optJSONArray("chapters")?.optJSONObject(0)?.number("number")?.toInt()
        return NovelDetail(
            card = card,
            author = unique(t.optJSONArray("authors").objects().map { it.text("name", 120) }, 4).joinToString(", ").ifBlank { null },
            altNames = unique(alt, 8).filter { !it.equals(card.title, ignoreCase = true) },
            synopsis = plainText(t.text("summary", 20_000), 6000),
            url = if (slug != null) "$SITE/${enc(slug)}" else SITE,
            latest = count?.takeIf { it > 0 }?.let { NovelLatest(it, newest?.text("name", 200), newest?.time("updated_at") ?: t.time("updated_at")) },
        )
    }

    /** The full chapter list (sent newest first) in reading order. */
    fun chapters(json: JSONObject): List<NovelChapter> {
        data class Row(val id: String, val position: Double?, val label: String, val at: Long?)
        val rows = data(json).optJSONArray("chapters").objects().mapNotNull { o ->
            val id = o.text("id", 40)?.takeIf(ID::matches) ?: return@mapNotNull null
            Row(id, o.number("number"), o.text("name", 200) ?: "Chapter", o.time("updated_at"))
        }.take(Novels.MAX_CHAPTERS)
        // The API's "number" is a position, not the printed chapter number.
        val ordered = if (rows.all { it.position != null }) rows.sortedBy { it.position } else rows.asReversed()
        val seen = HashSet<String>()
        val out = ArrayList<NovelChapter>()
        for (r in ordered) if (seen.add(r.id)) out += NovelChapter(r.id, out.size, r.label, r.at)
        return out
    }

    fun chapterText(json: JSONObject): NovelChapterText {
        val c = data(json).optJSONObject("chapter") ?: throw NovelParseException("NovelBuddy sent this chapter without its text.")
        val id = c.text("id", 40) ?: throw NovelParseException("NovelBuddy sent this chapter without its text.")
        val content = c.opt("content") as? String ?: throw NovelParseException("NovelBuddy sent this chapter without its text.")
        val label = c.text("name", 200) ?: "Chapter"
        return NovelChapterText(id, label, NovelText.dropRepeatedHeading(NovelText.htmlToParagraphs(content), label))
    }
}

// ── NovelArchive (novelarchive.cc) ────────────────────────────────────────────

object NovelArchiveParser {
    const val ORIGIN = "https://novelarchive.cc"
    val HOSTS = setOf("novelarchive.cc")
    private val ID = Regex("^[a-f0-9]{24}$")
    private val MTL = Regex("(?i)^mtl\\s*-")

    fun searchUrl(f: NovelFilters, limit: Int = 24): String {
        val p = ArrayList<String>()
        val q = f.query.trim()
        if (q.isNotEmpty()) { p += "search=${enc(q.take(120))}"; p += "fuzzy=1" }
        f.genre?.let { p += "genres_include=${enc(it)}" }
        f.status?.let { p += "status=${enc(it)}" }
        if (q.isEmpty()) p += "sort=${f.sort.archive}"
        p += "ai_generated=exclude"
        p += "page=${f.page.coerceIn(1, 500)}"
        p += "limit=$limit"
        return "$ORIGIN/api/novels?${p.joinToString("&")}"
    }

    /** Listings that stand in for NovelBuddy's Home while it's down (filters and page size). */
    val HOME_POPULAR = NovelFilters(sort = NovelSort.Popular) to 40
    val HOME_LATEST = NovelFilters(sort = NovelSort.Latest) to 40
    val HOME_COMPLETED = NovelFilters(sort = NovelSort.Popular, status = "completed") to 30
    val HOME_FAVOURITES = NovelFilters(sort = NovelSort.Rating) to 30
    private const val HOME_TRENDING = 12

    /** Home rows from those listings (machine translations dropped); null when they're all empty. */
    fun home(popular: List<NovelCard>, latest: List<NovelCard>, completed: List<NovelCard>, favourites: List<NovelCard>): NovelHome? {
        val ranked = popular.filter { !it.mtl }
        val home = NovelHome(
            trending = ranked.take(HOME_TRENDING),
            popular = ranked.drop(HOME_TRENDING),
            latest = latest.filter { !it.mtl },
            completed = completed.filter { !it.mtl },
            favourites = favourites.filter { !it.mtl },
            notice = Novels.HOME_FALLBACK_NOTICE,
        )
        return home.takeIf { it.trending.isNotEmpty() || it.latest.isNotEmpty() || it.completed.isNotEmpty() || it.favourites.isNotEmpty() }
    }

    fun titleUrl(id: String) = "$ORIGIN/api/novels/${enc(id)}"
    fun chapterUrl(titleId: String, position: String) = "$ORIGIN/api/novels/${enc(titleId)}/chapters/${enc(position)}?prefetch=1"

    fun card(o: JSONObject): NovelCard? {
        val id = o.text("id", 40)?.takeIf(ID::matches) ?: return null
        val title = o.text("title", 300) ?: return null
        val genres = when (val g = o.opt("genres")) {
            is String -> g.split(',').map(String::trim)
            is JSONArray -> (0 until g.length()).map { g.optString(it) }
            else -> emptyList()
        }
        val rating = o.number("rating")?.takeIf { it > 0 && (o.number("rating_count") ?: 0.0) > 0 }?.coerceAtMost(5.0)
        return NovelCard(
            source = NovelSourceId.NovelArchive,
            id = id,
            title = title,
            cover = image(o.text("cover_url", 2048) ?: o.text("novel_image", 2048) ?: o.text("image_url", 2048), ORIGIN),
            status = status(o.text("release_status") ?: o.text("ongoing")),
            chapters = o.number("total_chapters")?.toInt(),
            rating = rating,
            genres = unique(genres.map { it.take(40) }, 12),
            mtl = MTL.containsMatchIn(title),
            synopsis = plainText(o.text("description", 20_000), 600),
        )
    }

    fun search(json: JSONObject): NovelPage {
        val list = json.optJSONArray("novels") ?: throw NovelParseException("NovelArchive sent a response AniTrack couldn't read.")
        return NovelPage(list.objects().mapNotNull(::card), json.optJSONObject("pagination")?.optBoolean("has_next", false) == true)
    }

    fun detail(json: JSONObject): NovelDetail {
        val n = json.optJSONObject("novel") ?: throw NovelParseException("NovelArchive doesn't have this title.")
        val card = card(n) ?: throw NovelParseException("NovelArchive doesn't have this title.")
        val list = n.optJSONArray("chapter_names")
        val names = list?.length() ?: 0
        val count = if (names > 0) names else card.chapters
        val alt = n.optJSONArray("associated_names")
        return NovelDetail(
            card = card.copy(chapters = count),
            author = n.text("author", 200),
            altNames = unique(if (alt == null) emptyList() else (0 until alt.length()).map { alt.optString(it).take(300) }, 8),
            synopsis = plainText(n.text("description", 20_000), 6000),
            url = "$ORIGIN/novel?id=${enc(card.id)}",
            latest = count?.takeIf { it > 0 }?.let { NovelLatest(it, list?.optString(names - 1)?.trim()?.take(200)?.ifBlank { null }, n.time("updated_at")) },
        )
    }

    /** A chapter is requested by its 1-based position in `chapter_names`; the label is only shown. */
    fun chapters(json: JSONObject): List<NovelChapter> {
        val names = json.optJSONObject("novel")?.optJSONArray("chapter_names") ?: throw NovelParseException("NovelArchive doesn't have this title.")
        return (0 until minOf(names.length(), Novels.MAX_CHAPTERS)).map { i ->
            NovelChapter((i + 1).toString(), i, names.optString(i).trim().take(200).ifBlank { "Chapter ${i + 1}" }, null)
        }
    }

    fun chapterText(json: JSONObject, position: String): NovelChapterText {
        val c = json.optJSONObject("chapter") ?: throw NovelParseException("NovelArchive sent this chapter without its text.")
        val content = c.opt("content") as? String ?: throw NovelParseException("NovelArchive sent this chapter without its text.")
        val label = c.text("name", 200) ?: "Chapter $position"
        return NovelChapterText(position, label, NovelText.dropRepeatedHeading(NovelText.auto(content), label))
    }
}

// ── Novel Phoenix (novelphoenix.com, NovelFire's library) ─────────────────────

/*
 * Novel Phoenix has no JSON API: search, browse, title, chapter-list and chapter
 * pages are server-rendered HTML, read here with small patterns (no markup is
 * ever rendered). A title's id is the slug of its address; a chapter is requested
 * by its 1-based position (`/chapter-<n>`), and its label is only shown. Chapter
 * lists come 100 to a page. Mirrors the Novel Phoenix section of novel.ts.
 */
object NovelPhoenixParser {
    const val ORIGIN = "https://novelphoenix.com"
    val HOSTS = setOf("novelphoenix.com")
    const val CHAPTERS_PER_PAGE = 100
    private val ID = Regex("^[a-z0-9][a-z0-9-]{0,119}$")
    private val IC = RegexOption.IGNORE_CASE

    /** A search by name, or (without a query) a browse by genre, status and sort. */
    fun searchUrl(f: NovelFilters): String {
        val page = f.page.coerceIn(1, 500)
        val q = f.query.trim()
        if (q.isNotEmpty()) return "$ORIGIN/search?keyword=${enc(q.take(120))}&page=$page"
        val genre = f.genre?.lowercase()?.replace(Regex("[^a-z0-9]+"), "-")?.trim('-').orEmpty()
        return "$ORIGIN/genre-${genre.ifEmpty { "all" }}/sort-${f.sort.phoenix}/status-${f.status ?: "all"}/all-novel?page=$page"
    }

    fun titleUrl(id: String) = "$ORIGIN/novel/${enc(id)}"
    fun chaptersUrl(id: String, page: Int) = "$ORIGIN/novel/${enc(id)}/chapters?page=${maxOf(1, page)}"
    fun chapterUrl(titleId: String, position: String) = "$ORIGIN/novel/${enc(titleId)}/chapter-${enc(position)}"

    private fun wholeNumber(value: String?): Int? = value?.replace(",", "")?.toIntOrNull()?.takeIf { it >= 0 }

    private val AGO = Regex("\\b(\\d{1,4}|an?)\\s+(second|minute|hour|day|week|month|year)s?\\s+ago\\b")
    private val YEAR = Regex("\\d{4}")
    private val UNITS = mapOf(
        "second" to 1000L, "minute" to 60_000L, "hour" to 3_600_000L, "day" to 86_400_000L,
        "week" to 7 * 86_400_000L, "month" to 30 * 86_400_000L, "year" to 365 * 86_400_000L,
    )

    /** "13 hours ago" (or a date like "Nov 9, 2026") as a time, counted back from [now]; null when it isn't one. */
    fun relativeTime(text: String?, now: Long): Long? {
        if (text.isNullOrEmpty()) return null
        AGO.find(text.lowercase())?.let { m ->
            val n = if (m.groupValues[1].startsWith("a")) 1L else m.groupValues[1].toLong()
            return now - n * UNITS.getValue(m.groupValues[2])
        }
        if (!YEAR.containsMatchIn(text)) return null
        return runCatching { java.text.SimpleDateFormat("MMM d, yyyy", java.util.Locale.US).apply { isLenient = false }.parse(text.trim())?.time }.getOrNull()
            ?: runCatching { java.time.Instant.parse(text.trim()).toEpochMilli() }.getOrNull()
    }

    private val CARD_HREF = Regex("href=\"(?:https://novelphoenix\\.com)?/novel/([a-z0-9][a-z0-9-]*)\"")
    private val CARD_TITLE = Regex("<h[1-6] class=\"(?:novel-)?title[^\"]*\">([\\s\\S]*?)</h[1-6]>")
    private val CARD_TITLE_ATTR = Regex("<a title=\"([^\"]*)\"")
    private val CARD_RATING = Regex("icon-star\"></i>\\s*([0-5](?:\\.\\d+)?)")
    private val LAZY_IMG = Regex("<img[^>]*\\sdata-src=\"([^\"]+)\"")
    private val IMG = Regex("<img[^>]*\\ssrc=\"(?!data:)([^\"]+)\"")
    private val CARD_STATUS = Regex("(?:·|&middot;)\\s*(Ongoing|Completed)\\b", IC)
    private val CARD_CH = Regex("\\bCh\\.\\s*([\\d,]+)")
    private val CARD_CHAPTERS = Regex("([\\d,]+)\\s*Chapters\\b", IC)

    private fun first(re: Regex, text: String): String? = re.find(text)?.groupValues?.get(1)

    private fun card(chunk: String): NovelCard? {
        val id = first(CARD_HREF, chunk)?.takeIf(ID::matches) ?: return null
        val title = NovelText.fragment(first(CARD_TITLE, chunk)) ?: NovelText.fragment(first(CARD_TITLE_ATTR, chunk)) ?: return null
        val rating = first(CARD_RATING, chunk)?.toDoubleOrNull()?.takeIf { it > 0 }?.coerceAtMost(5.0)
        return NovelCard(
            source = NovelSourceId.NovelPhoenix,
            id = id,
            title = title,
            // Covers are lazy-loaded: the real address is in data-src, with a blank image in src.
            cover = image(first(LAZY_IMG, chunk) ?: first(IMG, chunk), ORIGIN),
            // "Ch. 3242 · Ongoing" (search results); browse cards don't say.
            status = status(first(CARD_STATUS, chunk)),
            chapters = wholeNumber(first(CARD_CH, chunk) ?: first(CARD_CHAPTERS, chunk)),
            rating = rating,
            genres = emptyList(),
            mtl = false,
        )
    }

    /** A search or browse page: its first list holds the results (later ones are suggestions). */
    fun search(html: String, page: Int = 1): NovelPage {
        val start = html.indexOf("<ul class=\"novel-list")
        if (start < 0) throw NovelParseException("Novel Phoenix sent a page AniTrack couldn't read.")
        val end = html.indexOf("</ul>", start)
        val items = html.substring(start, if (end < 0) html.length else end).split("<li class=\"novel-item\"").drop(1).mapNotNull(::card)
        return NovelPage(items, Regex("[?&](?:amp;)?page=${page + 1}\"").containsMatchIn(html))
    }

    private val H1 = Regex("<h1 class=\"novel-title[^\"]*\">([\\s\\S]*?)</h1>")
    private val AUTHORS = Regex("<div class=\"author\">([\\s\\S]*?)</div>")
    private val AUTHOR = Regex("itemprop=\"author\">([^<]*)<")
    private val GENRES = Regex("<div class=\"categories\">([\\s\\S]*?)</ul>")
    private val GENRE = Regex("class=\"property-item\">([^<]*)</a>")
    private val SUMMARY = Regex("<div class=\"summary\">[\\s\\S]*?<div class=\"content[^\"]*\">([\\s\\S]*?)(?:<div class=\"expand\">|</div>\\s*</div>)")
    private val RATING = Regex("class=\"my-rating\" data-rating=\"([0-5](?:\\.\\d+)?)\"")
    private val COUNT = Regex("icon-book-open\"></i>\\s*([\\d,]+)")
    private val LATEST = Regex("chapter-latest-container[\\s\\S]*?<p class=\"latest[^\"]*\">([\\s\\S]*?)</p>\\s*<p class=\"update\">([\\s\\S]*?)</p>")
    private val COVER = Regex("<figure class=\"cover\">\\s*<img[^>]*\\s(?:data-)?src=\"(?!data:)([^\"]+)\"")
    private val STATUS = Regex("<strong class=\"(ongoing|completed)\">", IC)

    fun detail(html: String, id: String, now: Long): NovelDetail {
        val title = NovelText.fragment(first(H1, html))
        if (title == null || !ID.matches(id)) throw NovelParseException("Novel Phoenix doesn't have this title.")
        val authors = first(AUTHORS, html).orEmpty()
        val genres = first(GENRES, html).orEmpty()
        val chapters = wholeNumber(first(COUNT, html))
        val latest = LATEST.find(html)
        return NovelDetail(
            card = NovelCard(
                source = NovelSourceId.NovelPhoenix,
                id = id,
                title = title,
                cover = image(first(COVER, html), ORIGIN),
                status = status(first(STATUS, html)),
                chapters = chapters,
                rating = first(RATING, html)?.toDoubleOrNull()?.takeIf { it > 0 }?.coerceAtMost(5.0),
                genres = unique(GENRE.findAll(genres).map { NovelText.fragment(it.groupValues[1], 40) }.toList(), 12),
                mtl = false,
            ),
            author = unique(AUTHOR.findAll(authors).map { NovelText.fragment(it.groupValues[1], 120) }.toList(), 4).joinToString(", ").ifBlank { null },
            altNames = emptyList(),
            synopsis = plainText(first(SUMMARY, html), 6000),
            url = titleUrl(id),
            latest = chapters?.takeIf { it > 0 }?.let {
                NovelLatest(it, NovelText.fragment(latest?.groupValues?.get(1), 200), relativeTime(NovelText.fragment(latest?.groupValues?.get(2), 80), now))
            },
        )
    }

    private val LABEL_PREFIX = Regex("^ch(?:apter)?\\.?\\s*", IC)
    private val NAMES_CHAPTER = Regex("^(?:chapter|chap|ch)\\b\\.?\\s*\\d", IC)

    /** A chapter's label: the site's number with its title, or the title alone when it already says "Chapter N". */
    private fun chapterLabel(position: String, numberText: String?, title: String?): String {
        val number = numberText?.replace(LABEL_PREFIX, "")?.trim().orEmpty().ifEmpty { position }
        if (title == null) return "Chapter $number"
        return (if (NAMES_CHAPTER.containsMatchIn(title)) title else "Chapter $number: $title").take(200)
    }

    /** One chapter of a list page; [id] is the position the site requests. */
    data class Row(val id: String, val label: String, val updatedAt: Long?)

    /** One page (100 chapters) of a title's list: its chapters in reading order, how many pages there are, and the title's chapter count when the page says. */
    data class ChapterPage(val chapters: List<Row>, val pages: Int, val total: Int?)

    private val CHAPTER_LINK = Regex("<a href=\"[^\"]*/chapter-([1-9][0-9]{0,5})\"[^>]*>([\\s\\S]*?)</a>")
    private val CH_NO = Regex("class=\"chapter-no\">([^<]*)<")
    private val CH_TITLE = Regex("class=\"chapter-title\">([\\s\\S]*?)</strong>")
    private val CH_TIME = Regex("class=\"chapter-update\"[^>]*>([^<]*)<")
    private val PAGE_LINK = Regex("/chapters\\?page=(\\d{1,4})\\b")
    private val TOTAL_INPUT = Regex("id=\"gotochapno\"[^>]*\\smax=\"(\\d{1,6})\"")
    private val TOTAL_TEXT = Regex("A total of ([\\d,]+) chapters")

    fun chapterPage(html: String, now: Long): ChapterPage {
        val start = html.indexOf("<ul class=\"chapter-list")
        if (start < 0) throw NovelParseException("Novel Phoenix doesn't have this title's chapters.")
        val end = html.indexOf("</ul>", start)
        val chapters = CHAPTER_LINK.findAll(html.substring(start, if (end < 0) html.length else end)).map { m ->
            val body = m.groupValues[2]
            val label = chapterLabel(m.groupValues[1], NovelText.fragment(first(CH_NO, body), 40), NovelText.fragment(first(CH_TITLE, body), 200))
            Row(m.groupValues[1], label, relativeTime(NovelText.fragment(first(CH_TIME, body), 80), now))
        }.toList()
        val pages = PAGE_LINK.findAll(html).maxOfOrNull { it.groupValues[1].toInt() } ?: 1
        val total = wholeNumber(first(TOTAL_INPUT, html) ?: first(TOTAL_TEXT, html))
        return ChapterPage(chapters, minOf(maxOf(1, pages), (Novels.MAX_CHAPTERS + CHAPTERS_PER_PAGE - 1) / CHAPTERS_PER_PAGE), total)
    }

    /** A title's chapter-list pages (in page order) as one list in reading order. */
    fun chapters(pages: List<List<Row>>): List<NovelChapter> {
        val seen = HashSet<String>()
        val out = ArrayList<NovelChapter>()
        for (row in pages.flatten()) {
            if (out.size >= Novels.MAX_CHAPTERS || !seen.add(row.id)) continue
            out += NovelChapter(row.id, out.size, row.label, row.updatedAt)
        }
        return out
    }

    /**
     * The whole list while some of its pages are still unread: a chapter on an unread
     * page stands in as "Chapter N". Chapters are requested by position, so every one
     * can be opened already; only its name is missing.
     */
    fun provisional(total: Int, pages: Collection<List<Row>>): List<NovelChapter> {
        val known = HashMap<String, Row>()
        for (rows in pages) for (row in rows) known[row.id] = row
        return (0 until total.coerceIn(0, Novels.MAX_CHAPTERS)).map { i ->
            val row = known[(i + 1).toString()]
            NovelChapter((i + 1).toString(), i, row?.label ?: "Chapter ${i + 1}", row?.updatedAt)
        }
    }

    private val CONTENT_OPEN = Regex("<div id=\"content\"[^>]*\\sdata-chapter-id=\"\\d+\"[^>]*>")
    private val NOT_FOUND = Regex("<title>[^<]*Not Found", IC)
    private val DIV = Regex("<(/?)div\\b", IC)
    private val CHAPTER_TITLE = Regex("<span class=\"chapter-title\">([\\s\\S]*?)</span>")

    /** Where the `<div>` opened just before [from] closes (nested ones skipped); the end of the text when it never does. */
    private fun closingDiv(html: String, from: Int): Int {
        var depth = 1
        for (m in DIV.findAll(html, from)) {
            depth += if (m.groupValues[1].isEmpty()) 1 else -1
            if (depth == 0) return m.range.first
        }
        return html.length
    }

    fun chapterText(html: String, position: String): NovelChapterText {
        // The "chapter not found" page has a #content block too (its layout's), without a chapter id.
        val open = CONTENT_OPEN.find(html) ?: throw NovelParseException(
            if (NOT_FOUND.containsMatchIn(html)) "Novel Phoenix doesn't have this chapter." else "Novel Phoenix sent this chapter without its text.",
        )
        val from = open.range.last + 1
        val label = NovelText.fragment(first(CHAPTER_TITLE, html), 200) ?: "Chapter $position"
        return NovelChapterText(position, label, NovelText.dropRepeatedHeading(NovelText.htmlToParagraphs(html.substring(from, closingDiv(html, from))), label))
    }
}
