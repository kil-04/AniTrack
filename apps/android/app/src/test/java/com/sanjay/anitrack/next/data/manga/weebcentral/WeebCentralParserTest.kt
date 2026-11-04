package com.sanjay.anitrack.next.data.manga.weebcentral

import com.sanjay.anitrack.next.data.Manga
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Same cases as tests/weebcentral.test.mjs (pages from weebcentral.com, 3 Nov 2026). */
class WeebCentralParserTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource("weebcentral/$name")!!.readText()
    private val frieren = Manga(
        id = 118586, malId = 126287, title = "Frieren", titleRomaji = "Sousou no Frieren", cover = null, banner = null,
        chapters = null, volumes = null, status = null, format = null, year = 2020, score = null, synopsis = null,
        genres = emptyList(), country = "JP",
    )

    @Test fun searchListsSeriesIdsInOrderOnce() {
        assertEquals(
            listOf("01J76XY7EF75DJNQCV04HTPDZK", "01J76XYCHM8SEKG7J7Z594YCKD", "01M02S1JJEE1AB149Y5RP577RG"),
            WeebCentralParser.searchIds(fixture("search.html")),
        )
        assertTrue(WeebCentralParser.searchUrl("  Sousou no Frieren ").contains("/search/data?author=&text=Sousou%20no%20Frieren&sort=Best+Match"))
    }

    @Test fun seriesPageGivesAniListYearCountryAndNewestChapter() {
        val detail = WeebCentralParser.detail(fixture("series.html"), "01J76XYDGDQERFSK333582BNBZ")!!
        assertEquals("Frieren - Beyond Journey's End", detail.title)
        assertEquals(118586, detail.anilistId)
        assertEquals(2020, detail.year)
        assertEquals("JP", detail.country)
        assertFalse(detail.adult)
        assertEquals(147f, detail.latestChapter)
        assertEquals(Instant.parse("2025-10-15T01:02:34.107Z").toEpochMilli(), detail.latestAt)
        assertEquals(147f, WeebCentralParser.latest(fixture("series.html"))?.chapter)

        assertTrue(WeebCentralParser.matches(detail, frieren))
        assertFalse("a different AniList id is a rejection", WeebCentralParser.matches(detail, frieren.copy(id = 1)))
        assertNull(WeebCentralParser.detail(fixture("series.html"), "not-a-ulid"))

        val flagged = fixture("series.html").replace(
            "search?adult=False\" class=\"link link-info link-hover\">No",
            "search?adult=True\" class=\"link link-info link-hover\">Yes",
        )
        assertFalse(WeebCentralParser.detail(flagged, "01J76XYDGDQERFSK333582BNBZ")!!.adult)
        assertTrue(WeebCentralParser.detail(flagged.replace(Regex("anilist\\.co/manga/\\d+"), ""), "01J76XYDGDQERFSK333582BNBZ")!!.adult)
    }

    @Test fun fullChapterListKeepsEveryChapterAndFilesProloguesFirst() {
        val list = WeebCentralParser.chapters(fixture("chapter-list.html"))
        assertEquals(listOf(386f, 385f, 0.02f, 0.01f), list.map { it.number })
        assertEquals("01KX4BFP5E3FEZ50TRS752CT9V", list.first().id)
        assertTrue(list.all { WeebCentralParser.isId(it.id) && it.uploadedAt != null })
        // Prologues are titled by name, so a row reads "Prologue 1", not "Chapter 0.01".
        assertEquals(listOf(null, null, "Prologue 2", "Prologue 1"), list.map { it.title })
        // The tenth keeps its name too, though its number (0.1) prints like a tenth.
        val tenth = WeebCentralParser.chapters(fixture("chapter-list.html").replaceFirst("Prologue 2<", "Prologue 10<"))
        assertEquals(0.1f to "Prologue 10", tenth[2].number to tenth[2].title)
    }

    @Test fun chapterLabels() {
        assertEquals(1197f, WeebCentralParser.chapterNumber("Chapter 1197"))
        assertEquals(12.5f, WeebCentralParser.chapterNumber("Chapter 12.5"))
        assertEquals(40f, WeebCentralParser.chapterNumber("Episode 40"))
        assertEquals(0.16f, WeebCentralParser.chapterNumber("Prologue 16"))
        assertNull(WeebCentralParser.chapterNumber("Special"))
        assertNull(WeebCentralParser.chapterNumber("Volume 3 Extra"))
        assertEquals("Prologue 1", WeebCentralParser.chapterTitle("Prologue 1"))
        assertEquals("Prologue 10", WeebCentralParser.chapterTitle("Prologue 10"))
        assertEquals("Prologue 16", WeebCentralParser.chapterTitle("prologue  16 "))
        assertNull(WeebCentralParser.chapterTitle("Chapter 12.5"))
        assertNull(WeebCentralParser.chapterTitle("Prologue 0"))
        assertNull(WeebCentralParser.chapterTitle("Special"))
    }

    @Test fun chapterPagesComeInOrderOnlyFromItsImageHosts() {
        val pages = WeebCentralParser.pages(fixture("chapter-images.html"))
        assertEquals(19, pages.size)
        assertEquals("https://hot.planeptune.us/manga/Berserk/Part2/0188-001.png", pages.first())
        assertEquals("https://hot.planeptune.us/manga/Berserk/Part2/0188-019.png", pages.last())
        assertEquals(
            listOf("https://scans.lastation.us/manga/A/1-001.png"),
            WeebCentralParser.pages("<img src=\"https://evil.example/manga/a.png\"><img src=\"https://scans.lastation.us/manga/A/1-001.png\">"),
        )
    }

    @Test fun everyPageCarriesAniTracksUserAgent() {
        // The image CDN answers OkHttp's default user agent with HTTP 403.
        val pages = WeebCentralParser.pageList(fixture("chapter-images.html"), "AniTrack/9.9.9 (Android)")
        assertEquals(19, pages.size)
        assertEquals(WeebCentralParser.pages(fixture("chapter-images.html")), pages.map { it.url })
        assertTrue(pages.all { it.headers == mapOf("User-Agent" to "AniTrack/9.9.9 (Android)") })
    }

    @Test fun imageHostRules() {
        listOf(
            "https://scans-hot.planeptune.us/manga/One-Piece/1197-001.png",
            "https://official.lowee.us/manga/X/1-001.png",
            "https://scans.lastation.us/manga/X/1-001.png",
        ).forEach { assertTrue(it, WeebCentralParser.isImage(it)) }
        listOf(
            "http://scans.lastation.us/manga/X/1.png",
            "https://scans.lastation.us/cover/X.png",
            "https://planeptune.us.evil.com/manga/x.png",
            "https://a.b.planeptune.us/manga/x.png",
            "https://scans.lastation.us:8443/manga/x.png",
        ).forEach { assertFalse(it, WeebCentralParser.isImage(it)) }
    }
}
