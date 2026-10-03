package com.sanjay.anitrack.next.data.manga.mangapill

import com.sanjay.anitrack.next.data.Manga
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Synthetic markup shaped like MangaPill's public pages (no saved site content). */
class MangaPillParserTest {
    private fun card(id: Int, slug: String, title: String, alt: String?, type: String, year: Int) = """
        <div>
          <a href="/manga/$id/$slug" class="relative block"><figure><img data-src="https://img.example.test/$id.jpeg"/></figure></a>
          <div class="flex flex-col justify-end">
            <a href="/manga/$id/$slug" class="mb-2">
              <div class="mt-3 font-black leading-tight line-clamp-2">$title</div>
              ${alt?.let { "<div class=\"line-clamp-2 text-xs text-secondary mt-1\">$it</div>" } ?: ""}
            </a>
            <div class="flex flex-wrap gap-1 mt-1">
              <div class="text-xs leading-5 bg-purple-500 text-black rounded px-1">$type</div>
              <div class="text-xs leading-5 bg-orange-500 text-black rounded px-1">$year</div>
              <div class="text-xs leading-5 bg-green-500 text-black rounded px-1">publishing</div>
            </div>
            <div class="flex flex-wrap gap-1 mt-1"><div class="text-xs leading-5 bg-card rounded px-1.5">Action</div></div>
          </div>
        </div>
    """.trimIndent()

    private val footer = """<div class="text-sm text-center text-secondary">example footer</div>"""

    private fun manga(
        english: String?,
        romaji: String?,
        year: Int?,
        format: String = "MANGA",
        country: String = "JP",
        synonyms: List<String> = emptyList(),
    ) = Manga(
        id = 1, malId = null, title = english ?: romaji ?: "x", titleRomaji = romaji, cover = null, banner = null,
        chapters = null, volumes = null, status = null, format = format, year = year, score = null, synopsis = null,
        genres = emptyList(), country = country, synonyms = synonyms,
    )

    @Test fun parsesSearchCardsWithAltNamesTypesAndEntities() {
        val html = card(11, "example-saga", "Example Saga", null, "manga", 2001) +
            card(12, "sample-san-wa", "Sample-san wa, Hanasenai.", "Sample Can&#39;t Talk, Sample &amp; Co", "manhwa", 2016) + footer
        val cards = MangaPillParser.cards(html)
        assertEquals(listOf("11", "12"), cards.map { it.id })
        assertEquals("11/example-saga", cards[0].path)
        assertEquals(emptyList<String>(), cards[0].altNames)
        assertEquals(listOf("Sample Can't Talk", "Sample & Co"), cards[1].altNames)
        assertEquals("manhwa", cards[1].type)
        assertEquals(2016, cards[1].year)
    }

    @Test fun lastCardDoesNotReadTheFooterAsAnAltName() {
        val cards = MangaPillParser.cards(card(21, "solo", "Solo Title", null, "manga", 2010) + footer)
        assertEquals(emptyList<String>(), cards.single().altNames)
    }

    @Test fun matchesNormalizedTitlesAndAltNames() {
        val cards = MangaPillParser.cards(
            card(1, "gintama-x", "Gintama", null, "manga", 2003) +
                card(2, "kimetsu", "Kimetsu Example", "Slayer: Kimetsu Example", "manga", 2016) +
                card(3, "kimetsu-gaiden", "Kimetsu Example Gaiden", null, "manga", 2019),
        )
        assertEquals("1", MangaPillParser.bestMatch(manga("Gin Tama", "Gintama", 2003), cards)?.id)
        assertEquals("2", MangaPillParser.bestMatch(manga("Slayer: Kimetsu Example", "Kimetsu Example", 2016), cards)?.id)
        val spy = MangaPillParser.cards(card(5, "spy", "Spy X Family", null, "manga", 2019))
        assertEquals("5", MangaPillParser.bestMatch(manga("SPY x FAMILY", "SPY×FAMILY", 2019), spy)?.id)
    }

    @Test fun neverMatchesANovelToItsComicAdaptation() {
        val cards = MangaPillParser.cards(card(7, "inn", "Spirit Inn Story", null, "manga", 2016))
        assertNull(MangaPillParser.bestMatch(manga(null, "Spirit Inn Story", 2015, format = "NOVEL"), cards))
    }

    @Test fun rejectsYearConflictsAndTies() {
        val remake = MangaPillParser.cards(card(8, "monster", "Monster", null, "manga", 2022))
        assertNull(MangaPillParser.bestMatch(manga("Monster", "MONSTER", 1994), remake))
        val tie = MangaPillParser.cards(
            card(9, "twin-a", "Twin Name", null, "manga", 2010) + card(10, "twin-b", "Twin Name", null, "manga", 2010),
        )
        assertNull(MangaPillParser.bestMatch(manga("Twin Name", null, 2010), tie))
    }

    @Test fun usesSynonymsAndPrefersTheExactYear() {
        val cards = MangaPillParser.cards(
            card(30, "old", "Alt Title", null, "manga", 2011) + card(31, "new", "Alt Title", null, "manga", 2012),
        )
        val picked = MangaPillParser.bestMatch(manga("Main Title", null, 2012, synonyms = listOf("Alt Title")), cards)
        assertEquals("31", picked?.id)
    }

    @Test fun parsesOnlyThisTitlesChaptersIncludingHalfChapters() {
        val html = """
            <a class="border p-1" href="/chapters/4100-10012500/example-chapter-12.5" title=" Chapter 12.5">Chapter 12.5</a>
            <a class="border p-1" href="/chapters/4100-10012000/example-chapter-12" title=" Chapter 12">Chapter 12</a>
            <a class="border p-1" href="/chapters/4100-10012000/example-chapter-12">Chapter 12</a>
            <a class="border p-1" href="/chapters/4100-10003000/example-chapter-3">Bonus</a>
            <a class="border p-1" href="/chapters/9999-10001000/other-chapter-1">Chapter 1</a>
            <a href="/chapters/193033/report">Report</a>
        """.trimIndent()
        val chapters = MangaPillParser.chapters(html, "4100")
        assertEquals(listOf(12.5f, 12f, 3f), chapters.map { it.number })
        assertEquals("4100-10012500/example-chapter-12.5", chapters[0].id)
    }

    @Test fun decodesChapterCodes() {
        assertEquals(140.5f, MangaPillParser.decodeNumber("10140500"))
        assertEquals(1f, MangaPillParser.decodeNumber("10001000"))
        assertNull(MangaPillParser.decodeNumber("193033"))
    }

    @Test fun parsesPageImagesWithSizesAndExactReferer() {
        val html = """
            <img src="https://img.example.test/logo.png" alt="logo"/>
            <img class="js-page" data-src="https://cdn.example.test/file/x/4100/10001000/1.jpeg" alt="Page 1" loading="lazy" width="1067" height="1600"/>
            <img class="js-page" data-src="https://cdn.example.test/file/x/4100/10001000/2.jpeg?a=1&amp;b=2" alt="Page 2"/>
            <img class="js-page" data-src="http://cdn.example.test/insecure.jpeg"/>
            <img class="js-page" data-src="https://192.168.1.10/lan.jpeg"/>
            <img class="js-page" data-src="https://localhost/local.jpeg"/>
        """.trimIndent()
        val pages = MangaPillParser.pages(html)
        assertEquals(2, pages.size)
        assertEquals(1067, pages[0].width)
        assertEquals(1600, pages[0].height)
        assertEquals("https://cdn.example.test/file/x/4100/10001000/2.jpeg?a=1&b=2", pages[1].url)
        assertNull(pages[1].width)
        assertTrue(pages.all { it.headers == mapOf("Referer" to "https://mangapill.com/") })
    }
}
