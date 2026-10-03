package com.sanjay.anitrack.next.data.manga.mangadot

import com.sanjay.anitrack.next.data.Manga
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Synthetic responses shaped like mangadot.net's JSON API (no saved site content). */
class MangaDotParserTest {
    private fun manga(id: Int = 500, english: String? = "Example Saga", romaji: String? = "Rei no Saga", year: Int? = 2015, mal: Int? = null, country: String = "JP") = Manga(
        id = id, malId = mal, title = english ?: romaji ?: "x", titleRomaji = romaji, cover = null, banner = null,
        chapters = null, volumes = null, status = null, format = "MANGA", year = year, score = null, synopsis = null,
        genres = emptyList(), country = country,
    )

    private fun detail(anilist: Any? = null, mal: Any? = null, title: String = "Example Saga", year: Any? = 2015, country: Any? = "JP", alt: String = "[]") =
        JSONObject("""{"manga":{"id":99,"title":"$title","anilist_id":${anilist ?: "null"},"mal_id":${mal ?: "null"},
            "year":${year ?: "null"},"country_of_origin":${country?.let { "\"$it\"" } ?: "null"},"alt_titles":$alt}}""")

    @Test fun readsSuggestionIdsInOrder() {
        val json = JSONObject("""{"suggestions":[{"id":152,"title":"A"},{"id":31021,"title":"B"},{"id":152,"title":"A"},{"id":0}]}""")
        assertEquals(listOf(152, 31021), MangaDotParser.suggestions(json))
    }

    @Test fun matchesByTrackerLinkAndRejectsConflictingLinks() {
        assertTrue(MangaDotParser.matches(MangaDotParser.detail(detail(anilist = 500))!!, manga()))
        assertFalse(MangaDotParser.matches(MangaDotParser.detail(detail(anilist = 501))!!, manga()))
        assertTrue(MangaDotParser.matches(MangaDotParser.detail(detail(mal = 77))!!, manga(mal = 77)))
        assertFalse(MangaDotParser.matches(MangaDotParser.detail(detail(mal = 78))!!, manga(mal = 77)))
    }

    @Test fun unlinkedTitlesNeedExactNameYearAndCountry() {
        assertTrue(MangaDotParser.matches(MangaDotParser.detail(detail(title = "Rei no Saga!"))!!, manga()))
        assertTrue(MangaDotParser.matches(MangaDotParser.detail(detail(title = "Other", alt = """["Example  SAGA"]"""))!!, manga()))
        assertFalse(MangaDotParser.matches(MangaDotParser.detail(detail(year = 2021))!!, manga()))
        assertFalse(MangaDotParser.matches(MangaDotParser.detail(detail(year = null))!!, manga()))
        assertFalse(MangaDotParser.matches(MangaDotParser.detail(detail(country = "KR"))!!, manga()))
        assertFalse(MangaDotParser.matches(MangaDotParser.detail(detail(title = "Example Saga Gaiden"))!!, manga()))
    }

    @Test fun keepsEnglishChaptersWithSourceTaggedIds() {
        val list = JSONArray(
            """[
              {"id":25424,"chapter_number":1,"chapter_title":"Chapter 1.0","language":"en","group_name":"Group A","page_count":14,"source":"user"},
              {"id":25425,"chapter_number":"1.5","chapter_title":"Ch. 1.5: Rebirth","language":"en","group_name":null,"scanlator_name":"Scan B","page_count":9,"source":"user"},
              {"id":327776,"chapter_number":2,"chapter_title":"The Second","language":"en","page_count":20,"source":"scraper"},
              {"id":9,"chapter_number":3,"language":"es","page_count":20,"source":"user"},
              {"id":10,"chapter_number":4,"language":"en","page_count":0,"source":"user"},
              {"id":11,"chapter_number":5,"language":"en","page_count":5,"source":"elsewhere"},
              {"id":12,"chapter_number":null,"language":"en","page_count":5,"source":"user"}
            ]""",
        )
        val chapters = MangaDotParser.chapters(list)
        assertEquals(listOf("user:25424", "user:25425", "scraper:327776"), chapters.map { it.id })
        assertEquals(listOf(1f, 1.5f, 2f), chapters.map { it.number })
        assertNull(chapters[0].title)
        assertEquals("Rebirth", chapters[1].title)
        assertEquals("Scan B", chapters[1].group)
        assertEquals("The Second", chapters[2].title)
        assertEquals(listOf(14, 9, 20), chapters.map { it.pageCount })
    }

    @Test fun readsTheLatestChapterForUpdates() {
        val json = JSONObject("""{"manga":{"id":47,"title":"Example","anilist_id":500,"latest_chapter_number":"341.00",
            "last_chapter_date":"2026-09-26 10:00:00+00"}}""")
        val detail = MangaDotParser.detail(json)!!
        assertEquals(341f, detail.latestChapter)
        assertEquals(java.time.Instant.parse("2026-09-26T10:00:00Z").toEpochMilli(), detail.lastChapterAt)
        val bare = MangaDotParser.detail(JSONObject("""{"manga":{"id":47,"title":"Example","latest_chapter_number":null}}"""))!!
        assertNull(bare.latestChapter)
        assertNull(bare.lastChapterAt)
    }

    @Test fun parsesUploadTimestamps() {
        assertEquals(java.time.Instant.parse("2026-04-29T20:49:55Z").toEpochMilli(), MangaDotParser.timestamp("2026-04-29 20:49:55+00"))
        assertEquals(java.time.Instant.parse("2026-10-02T17:40:12.364Z").toEpochMilli(), MangaDotParser.timestamp("2026-10-02 17:40:12.364446+00"))
        assertEquals(java.time.Instant.parse("2026-04-29T15:19:55Z").toEpochMilli(), MangaDotParser.timestamp("2026-04-29 20:49:55+05:30"))
        assertNull(MangaDotParser.timestamp("yesterday"))
        val list = JSONArray("""[{"id":1,"chapter_number":1,"language":"en","page_count":3,"source":"user","date_added":"2026-04-29 20:49:55+00"}]""")
        assertEquals(MangaDotParser.timestamp("2026-04-29 20:49:55+00"), MangaDotParser.chapters(list).single().uploadedAt)
    }

    @Test fun routesPageListsBySource() {
        assertEquals("user" to 25424L, MangaDotParser.chapterRef("user:25424"))
        assertEquals("/api/uploads/25424/images", MangaDotParser.imagesPath("user", 25424))
        assertEquals("/api/chapters/327776/images", MangaDotParser.imagesPath("scraper", 327776))
        assertNull(MangaDotParser.chapterRef("25424"))
        assertNull(MangaDotParser.chapterRef("other:1"))
        assertNull(MangaDotParser.chapterRef("user:../1"))
    }

    @Test fun buildsSameOriginPageUrlsAndDropsUnsafePaths() {
        val json = JSONObject(
            """{"images":[
                {"url":"/chapters/manga_99/chapter_1_g0/001.webp","w":850,"h":1201},
                {"url":"/chapters/manga_99/chapter_1_g0/002.webp","w":0,"h":0},
                {"url":"https://elsewhere.example/x.webp"},
                {"url":"//elsewhere.example/x.webp"},
                {"url":"/chapters/../secret"},
                {"url":"/api/admin"}
            ]}""",
        )
        val pages = MangaDotParser.pages(json)
        assertEquals(2, pages.size)
        assertEquals("https://mangadot.net/chapters/manga_99/chapter_1_g0/001.webp", pages[0].url)
        assertEquals(850, pages[0].width)
        assertNull(pages[1].width)
        assertTrue(pages.all { it.headers.isEmpty() })
    }
}
