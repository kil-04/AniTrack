package com.sanjay.anitrack.next.data.manga.mangaball

import com.sanjay.anitrack.next.data.Manga
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Synthetic responses shaped like api.mangaball.com's JSON (no saved site content). */
class MangaBallParserTest {
    private val titleId = "685158ff702284f834178c9b"

    private fun manga(english: String? = "Example Saga", romaji: String? = "Rei no Saga", year: Int? = 2018, mal: Int? = null, country: String = "KR") = Manga(
        id = 500, malId = mal, title = english ?: romaji ?: "x", titleRomaji = romaji, cover = null, banner = null,
        chapters = null, volumes = null, status = null, format = "MANGA", year = year, score = null, synopsis = null,
        genres = emptyList(), country = country,
    )

    private fun detail(mal: String? = null, name: String = "Example Saga", year: String? = "2018", language: String = "ko", adult: Boolean = false, alt: String = "[]") =
        JSONObject(
            """{"status":"success","data":{"id":"$titleId","name":"$name","alternateName":$alt,
            "links":{"mangadex":"x","myanimelist":${mal?.let { "\"$it\"" } ?: "null"}},
            "date_published":${year?.let { "\"$it\"" } ?: "null"},"originalLanguage":"$language","is18plus":$adult,
            "latest_chapter_number":202.0,"updated_at":"2025-10-24T01:35:19.879000"}}""",
        )

    @Test fun readsSearchHitsWithValidIds() {
        val json = JSONObject(
            """{"data":[{"id":"$titleId","name":"Example Saga","is18plus":false},
            {"id":"not-an-id","name":"Broken"},{"_id":"68515e13702284f834179e9e","name":"Adult One","is18plus":true},
            {"id":"$titleId","name":"Duplicate"}]}""",
        )
        val hits = MangaBallParser.search(json)
        assertEquals(listOf(titleId, "68515e13702284f834179e9e"), hits.map { it.id })
        assertEquals(listOf(false, true), hits.map { it.adult })
    }

    @Test fun readsIdentityFields() {
        val d = MangaBallParser.detail(detail(mal = "121496"))!!
        assertEquals(121496, d.malId)
        assertEquals(2018, d.year)
        assertEquals("KR", d.country)
        assertEquals(202f, d.latestChapter)
        assertEquals(1761269719879L, d.updatedAt)
    }

    @Test fun latestIsTheNewestEnglishUpload() {
        val json = JSONObject(
            """{"data":[
            {"id":"6acbae52a91bdf88681cd38e","lang":"en","number":134,"status":"published","created_at":"2026-10-11T15:42:10.401000","group":{"name":"Swampert"}},
            {"id":"6acbacbbf0fedfcd3333e992","lang":"en","number":134,"status":"published","created_at":"2026-10-11T15:35:23.147000","group":{"name":"Meganium"}},
            {"id":"6ac27255052042d762e1eed1","lang":"en","number":133,"status":"published","created_at":"2026-10-04T15:35:49.195000"},
            {"id":"6ac27255052042d762e1eed2","lang":"fr","number":135,"status":"published","created_at":"2026-10-12T00:00:00"}],
            "pagination":{"total_pages":122}}""",
        )
        val latest = MangaBallParser.latest(json)!!
        assertEquals(134f, latest.chapter)
        assertEquals(1791733330401L, latest.at)
        assertNull(MangaBallParser.latest(JSONObject("""{"data":[]}""")))
    }

    @Test fun listsChaptersAHundredToAPage() {
        // Bigger pages took 33 s (200 rows) and 68 s (500) on 27 Oct 2026, past the 25 s limit.
        assertEquals(
            "/title/chapter-listing?title_id=685158ff702284f834178c9b&page=3&limit=100&group_by=flat&sort_order=asc&language=en&search=",
            MangaBallParser.listingPath("685158ff702284f834178c9b", 3),
        )
        // Desktop's mangaBallListingUrl asks for the same (tests/manga.test.mjs); 10,000 uploads at most.
        assertEquals(10_000, MangaBallParser.LIST_PAGE * MangaBallParser.MAX_LIST_PAGES)
    }

    @Test fun matchesByMyAnimeListAndRejectsConflictsAndAdultTitles() {
        assertTrue(MangaBallParser.matches(MangaBallParser.detail(detail(mal = "77"))!!, manga(mal = 77)))
        assertFalse(MangaBallParser.matches(MangaBallParser.detail(detail(mal = "78"))!!, manga(mal = 77)))
        assertFalse(MangaBallParser.matches(MangaBallParser.detail(detail(mal = "77", adult = true))!!, manga(mal = 77)))
    }

    @Test fun unlinkedTitlesNeedExactNameYearAndCountry() {
        assertTrue(MangaBallParser.matches(MangaBallParser.detail(detail(name = "Rei no Saga!"))!!, manga()))
        assertTrue(MangaBallParser.matches(MangaBallParser.detail(detail(name = "Other", alt = """["Example  SAGA"]"""))!!, manga()))
        assertFalse(MangaBallParser.matches(MangaBallParser.detail(detail(year = "2022"))!!, manga()))
        assertFalse(MangaBallParser.matches(MangaBallParser.detail(detail(year = null))!!, manga()))
        assertFalse(MangaBallParser.matches(MangaBallParser.detail(detail(language = "ja"))!!, manga()))
        assertFalse(MangaBallParser.matches(MangaBallParser.detail(detail(name = "Example Saga: Ragnarok"))!!, manga()))
    }

    @Test fun keepsPublishedEnglishUploads() {
        val json = JSONObject(
            """{"data":[
              {"id":"68de79241ec6dc083a3051ee","lang":"en","name":"Chapter 202","number":202,"group":{"name":"Suicune"},"status":"published","created_at":"2025-10-02T13:07:48.357000"},
              {"id":"69ccf8a162f717a33a04b72b","lang":"en","name":"Ch. 201.5: The End","number":201.5,"group_name":"Swampert","status":"published","created_at":"2026-04-01T10:51:13.225000"},
              {"id":"69ccf8a162f717a33a04b72c","lang":"fr","name":"Chapitre 200","number":200,"group":{"name":"Entei"},"status":"published"},
              {"id":"69ccf8a162f717a33a04b72d","lang":"en","name":"Chapter 199","number":199,"group":{"name":"Entei"},"status":"pending"},
              {"id":"bad","lang":"en","number":198},
              {"id":"69ccf8a162f717a33a04b72e","lang":"en","number":null}
            ],"pagination":{"page":1,"limit":500,"total":728,"total_pages":2}}""",
        )
        val page = MangaBallParser.chapters(json)
        assertEquals(listOf("68de79241ec6dc083a3051ee", "69ccf8a162f717a33a04b72b"), page.chapters.map { it.id })
        assertEquals(listOf(202f, 201.5f), page.chapters.map { it.number })
        assertEquals(listOf("Suicune", "Swampert"), page.chapters.map { it.group })
        assertNull(page.chapters[0].title)
        assertEquals("The End", page.chapters[1].title)
        assertEquals(1759410468357L, page.chapters[0].uploadedAt)
        assertEquals(2, page.totalPages)
    }

    @Test fun treatsNullNamesAsMissing() {
        val json = JSONObject(
            """{"data":[
              {"id":"68de79241ec6dc083a3051ef","lang":"en","name":null,"number":327,"group":{"name":"Articuno"},"status":"published","created_at":null},
              {"id":"68de79241ec6dc083a3051f0","lang":"en","name":"Chapter 326","number":326,"group":null,"group_name":null,"status":"published"}
            ],"pagination":{"total_pages":1}}""",
        )
        val page = MangaBallParser.chapters(json)
        assertEquals(listOf(null, null), page.chapters.map { it.title })
        assertEquals(listOf("Articuno", null), page.chapters.map { it.group })
        assertNull(page.chapters[0].uploadedAt)
        val d = MangaBallParser.detail(detail(mal = null, alt = """[null, "Alt Name"]"""))!!
        assertEquals(listOf("Alt Name"), d.altTitles)
        assertNull(d.malId)
    }

    @Test fun keepsOnlyCdnPagesWithTheSiteAsReferer() {
        val json = JSONObject(
            """{"data":{"chapter":{"pages":[
              "https://bulbasaur.poke-black-and-white.net/storage/x/0/202/zinmanga/en/a-001.webp",
              "http://bulbasaur.poke-black-and-white.net/storage/x/a-002.webp",
              "https://elsewhere.example/a-003.webp",
              "https://bulbasaur.poke-black-and-white.net/storage/x/0/202/zinmanga/en/a-004.webp"
            ]}}}""",
        )
        val pages = MangaBallParser.pages(json)
        assertEquals(2, pages.size)
        assertTrue(pages.all { it.url.startsWith("https://bulbasaur.poke-black-and-white.net/") })
        assertEquals("https://mangaball.com/", pages[0].headers["Referer"])
    }

    @Test fun followsTheChaptersRotatedCdnHostAndDropsStrays() {
        val json = JSONObject(
            """{"data":{"chapter":{"pages":[
              "https://chikorita.red-and-blue.net/storage/y/b-001.webp",
              "https://chikorita.red-and-blue.net/storage/y/b-002.webp",
              "https://stray.example/b-003.webp",
              "https://user:pw@chikorita.red-and-blue.net/storage/y/b-004.webp",
              "https://10.0.0.1/b-005.webp"
            ]}}}""",
        )
        assertEquals(
            listOf("https://chikorita.red-and-blue.net/storage/y/b-001.webp", "https://chikorita.red-and-blue.net/storage/y/b-002.webp"),
            MangaBallParser.pages(json).map { it.url },
        )
        assertTrue(MangaBallParser.pages(JSONObject("""{"data":{"chapter":{"pages":[]}}}""")).isEmpty())
    }
}
