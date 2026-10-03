package com.sanjay.anitrack.next.data.manga.mangapill

import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.Html
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaTitles
import com.sanjay.anitrack.next.data.manga.MangaUrlPolicy

/** Bounded parsing of MangaPill's public HTML. No page script is executed. */
internal object MangaPillParser {
    const val ORIGIN = "https://mangapill.com"
    const val MAX_CARDS = 40
    const val MAX_CHAPTERS = 5000
    const val MAX_PAGES = 500

    data class Card(
        val id: String,
        val slug: String,
        val title: String,
        val altNames: List<String>,
        val type: String?,
        val year: Int?,
    ) {
        /** SourceTitle id: "{numeric id}/{slug}". */
        val path: String get() = "$id/$slug"
    }

    private val CARD_START = Regex("""<a href="/manga/(\d{1,9})/([A-Za-z0-9._~-]{1,200})" class="mb-2">""")
    private val CARD_TITLE = Regex("""font-black[^"]*">([^<]{1,300})<""")
    private val CARD_ALT = Regex("""<div class="[^"]*text-secondary[^"]*">([^<]{1,2000})<""")
    private val CARD_TYPE = Regex("""bg-purple-500[^"]*">([^<]{1,40})<""")
    private val CARD_YEAR = Regex("""bg-orange-500[^"]*">\s*(\d{4})\s*<""")
    private val CHAPTER_LINK = Regex("""<a\b[^>]*\bhref="/chapters/(\d{1,9})-(\d{1,12})/([A-Za-z0-9._~-]{1,200})"[^>]*>\s*([^<]{0,200})</a>""")
    private val CHAPTER_NUMBER = Regex("""(?i)chapter\s+(\d{1,5}(?:\.\d{1,3})?)""")
    private val PAGE_IMAGE = Regex("""<img\b[^>]*\bclass="[^"]*\bjs-page\b[^"]*"[^>]*>""")
    private val DATA_SRC = Regex("""\bdata-src="([^"]{1,2048})"""")
    private val WIDTH = Regex("""\bwidth="(\d{1,5})"""")
    private val HEIGHT = Regex("""\bheight="(\d{1,5})"""")

    fun cards(html: String): List<Card> {
        val starts = CARD_START.findAll(html).take(MAX_CARDS).toList()
        return starts.mapIndexedNotNull { i, start ->
            val end = starts.getOrNull(i + 1)?.range?.first ?: minOf(html.length, start.range.first + 6000)
            val block = html.substring(start.range.first, end)
            // Title and alternative names live inside the result link itself.
            val anchor = block.substring(0, block.indexOf("</a>").takeIf { it >= 0 } ?: block.length)
            val title = CARD_TITLE.find(anchor)?.groupValues?.get(1)?.let(Html::decode)?.trim()
                ?.takeIf { it.isNotEmpty() } ?: return@mapIndexedNotNull null
            val alt = CARD_ALT.find(anchor)?.groupValues?.get(1)?.let(Html::decode)
                ?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.take(20).orEmpty()
            Card(
                id = start.groupValues[1],
                slug = start.groupValues[2],
                title = title,
                altNames = alt,
                type = CARD_TYPE.find(block)?.groupValues?.get(1)?.trim()?.lowercase(),
                year = CARD_YEAR.find(block)?.groupValues?.get(1)?.toIntOrNull(),
            )
        }.distinctBy { it.id }
    }

    /** Chapters listed on a title page, restricted to that title's own links. */
    fun chapters(html: String, mangaId: String): List<MangaChapter> {
        val seen = HashSet<String>()
        val out = ArrayList<MangaChapter>()
        for (match in CHAPTER_LINK.findAll(html)) {
            if (match.groupValues[1] != mangaId) continue
            val code = match.groupValues[2]
            val id = "$mangaId-$code/${match.groupValues[3]}"
            if (!seen.add(id)) continue
            val number = CHAPTER_NUMBER.find(Html.decode(match.groupValues[4]))?.groupValues?.get(1)?.toFloatOrNull()
                ?: decodeNumber(code)
                ?: continue
            out += MangaChapter(id = id, number = number)
            if (out.size >= MAX_CHAPTERS) break
        }
        return out
    }

    /** MangaPill encodes chapter N as 10_000_000 + N * 1000 (140.5 -> 10140500). */
    fun decodeNumber(code: String): Float? {
        val value = code.toLongOrNull() ?: return null
        if (value < 10_000_000L || value > 19_999_999L) return null
        return (value - 10_000_000L) / 1000f
    }

    fun pages(html: String): List<MangaPage> =
        PAGE_IMAGE.findAll(html).mapNotNull { tag ->
            val src = DATA_SRC.find(tag.value)?.groupValues?.get(1)?.let(Html::decode) ?: return@mapNotNull null
            val uri = MangaUrlPolicy.publicHttps(src) ?: return@mapNotNull null
            MangaPage(
                url = uri.toASCIIString(),
                width = WIDTH.find(tag.value)?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it in 1..20_000 },
                height = HEIGHT.find(tag.value)?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it in 1..60_000 },
                // MangaPill's image host refuses requests without the reader page as Referer.
                headers = mapOf("Referer" to "$ORIGIN/"),
            )
        }.take(MAX_PAGES).toList()

    /** The AniList format/country expressed as a MangaPill type label. */
    fun expectedType(manga: Manga): String = when {
        manga.format == "NOVEL" -> "novel"
        manga.format == "ONE_SHOT" -> "one-shot"
        manga.country == "KR" -> "manhwa"
        manga.country == "CN" -> "manhua"
        else -> "manga"
    }

    /**
     * Confidence that [card] is [manga]: a name must match exactly after
     * normalization (title 3, alternative name 2), then year and type adjust it.
     * Comics never match novels. Returns null when the card is not a candidate.
     */
    fun score(manga: Manga, card: Card): Int? {
        val names = MangaTitles.names(manga)
        var score = when {
            MangaTitles.normalize(card.title) in names -> 3
            card.altNames.any { MangaTitles.normalize(it) in names } -> 2
            else -> return null
        }
        if (card.year != null && manga.year != null) {
            val gap = kotlin.math.abs(card.year - manga.year)
            score += when (gap) { 0 -> 2; 1 -> 1; else -> -4 }
        }
        val type = card.type
        if (type != null) {
            val want = expectedType(manga)
            score += when {
                type == want || (want == "one-shot" && type == "manga") -> 1
                want == "novel" || "novel" in type -> -10
                else -> -1 // manga/manhwa/manhua labels are applied loosely
            }
        }
        return score
    }

    /** The single best card scoring at least [MIN_SCORE]; null when none or tied. */
    fun bestMatch(manga: Manga, cards: List<Card>): Card? {
        val ranked = cards.mapNotNull { card -> score(manga, card)?.let { card to it } }
            .filter { it.second >= MIN_SCORE }
            .sortedByDescending { it.second }
        if (ranked.isEmpty()) return null
        if (ranked.size > 1 && ranked[0].second == ranked[1].second) return null
        return ranked[0].first
    }

    const val MIN_SCORE = 3
}
