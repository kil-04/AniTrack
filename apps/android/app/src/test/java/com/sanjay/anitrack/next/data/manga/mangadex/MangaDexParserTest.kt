package com.sanjay.anitrack.next.data.manga.mangadex

import com.sanjay.anitrack.next.data.manga.MangaSourceException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Synthetic responses shaped like the official MangaDex API. */
class MangaDexParserTest {
    private val a = "11111111-2222-3333-4444-555555555555"
    private val b = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    private val hash = "0123456789abcdef0123456789abcdef"

    @Test fun picksOnlyTheResultLinkedToTheAniListOrMalEntry() {
        val json = JSONObject(
            """{"data":[
                {"id":"$a","attributes":{"title":{"en":"Same Name"},"links":{"al":"999"}}},
                {"id":"$b","attributes":{"title":{"ja-ro":"Same Name"},"links":{"al":"123","mal":"77"}}}
            ]}""",
        )
        assertEquals(b, MangaDexParser.linkedId(json, anilistId = 123, malId = null))
        assertEquals(b, MangaDexParser.linkedId(json, anilistId = 5, malId = 77))
        assertNull(MangaDexParser.linkedId(json, anilistId = 5, malId = null))
        assertEquals("Same Name", MangaDexParser.titleOf(json, b))
    }

    @Test fun keepsReadableEnglishChaptersWithGroups() {
        fun chapter(id: String, number: String?, lang: String = "en", external: String? = null, pages: Int = 20, gone: Boolean = false) =
            """{"id":"$id","attributes":{"chapter":${number?.let { "\"$it\"" } ?: "null"},"title":"T","translatedLanguage":"$lang",
               "externalUrl":${external?.let { "\"$it\"" } ?: "null"},"pages":$pages,"isUnavailable":$gone},
               "relationships":[{"type":"scanlation_group","attributes":{"name":"Group A"}}]}"""
        val ids = (0..5).map { "00000000-0000-0000-0000-00000000000$it" }
        val json = JSONObject(
            """{"total":6,"data":[${chapter(ids[0], "1")},${chapter(ids[1], "1.5")},${chapter(ids[2], "2", lang = "es")},
               ${chapter(ids[3], "3", external = "https://example.test/read")},${chapter(ids[4], "4", pages = 0)},
               ${chapter(ids[5], "5", gone = true)}]}""",
        )
        val page = MangaDexParser.feed(json)
        assertEquals(6, page.received)
        assertEquals(listOf(1f, 1.5f), page.chapters.map { it.number })
        assertEquals("Group A", page.chapters[0].group)
    }

    @Test fun numbersUnnumberedOneShotsInFeedOrder() {
        val oneShot = listOf(MangaDexParser.FeedChapter(a, null, "Oneshot", null))
        assertEquals(1f, MangaDexParser.toChapters(oneShot).single().number)
        val mixed = listOf(MangaDexParser.FeedChapter(a, null, "Extra", null), MangaDexParser.FeedChapter(b, 1f, null, null))
        assertEquals(listOf(b), MangaDexParser.toChapters(mixed).map { it.id })
    }

    @Test fun validatesAtHomeServersAndRebuildsPageUrls() {
        val ok = JSONObject("""{"baseUrl":"https://node1.example.mangadex.network:44300","chapter":{"hash":"$hash","data":["1-abc.png","2-def.jpg"]}}""")
        val server = MangaDexParser.server(ok)
        val url = MangaDexParser.pageUrl(server.baseUrl, server.hash, server.files[1])
        assertEquals("https://node1.example.mangadex.network:44300/data/$hash/2-def.jpg", url)
        assertEquals(Triple(server.baseUrl, hash, "2-def.jpg"), MangaDexParser.splitPageUrl(url))

        for (bad in listOf(
            """{"baseUrl":"http://node.mangadex.network","chapter":{"hash":"$hash","data":["1.png"]}}""",
            """{"baseUrl":"https://10.0.0.5","chapter":{"hash":"$hash","data":["1.png"]}}""",
            """{"baseUrl":"https://node.mangadex.network","chapter":{"hash":"not-a-hash","data":["1.png"]}}""",
            """{"baseUrl":"https://node.mangadex.network","chapter":{"hash":"$hash","data":["../../x.png"]}}""",
            """{"baseUrl":"https://node.mangadex.network","chapter":{"hash":"$hash","data":[]}}""",
        )) {
            val rejected = runCatching { MangaDexParser.server(JSONObject(bad)) }.exceptionOrNull()
            assertTrue(bad, rejected is MangaSourceException)
        }
    }

    @Test fun reportsOnlyMangaDexAtHomeNodes() {
        assertTrue(MangaDexParser.reportable("abc.xyz.mangadex.network"))
        assertFalse(MangaDexParser.reportable("uploads.mangadex.org"))
        assertFalse(MangaDexParser.reportable("cdn.example.test"))
        val body = JSONObject(MangaDexParser.report("https://n.mangadex.network/data/$hash/1.png", true, 1234, 56, false))
        assertEquals(true, body.getBoolean("success"))
        assertEquals(1234, body.getLong("bytes"))
        assertEquals(56, body.getLong("duration"))
        assertEquals(false, body.getBoolean("cached"))
    }
}
