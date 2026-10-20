package com.sanjay.anitrack.next.data.providers.connectors.anichan

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Same captured fixtures and important rejection cases as tests/anichan.test.mjs. */
class AniChanTest {
    private fun fixture(name: String): JSONObject = JSONObject(generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
        .map { File(it, "tests/fixtures/anichan-$name.json") }.first { it.isFile }.readText(Charsets.UTF_8))
    private fun server(extra: String = "{}"): JSONObject = JSONObject("""{"name":"mirror","label":"Mirror","rank":2,"type":"hls","stream":"https://c.toroplay.cymru/api/watch/m3u8?token=fixture"}""")
        .apply { val fields = JSONObject(extra); fields.keys().forEach { put(it, fields.get(it)) } }
    private fun payload(vararg rows: JSONObject) = JSONObject().put("servers", JSONArray(rows.toList()))

    @Test fun publicUrlsPreserveAniListIdentityAndEncodeSearch() {
        assertEquals("https://anichan.to/anime/212888/watch/1", AniChan.titleUrl(212888))
        assertEquals("https://anichan.to/api/catalog/anime/1", AniChan.metadataUrl(1))
        assertEquals("https://anichan.to/api/suggest?q=Cowboy%20%26%20Bebop", AniChan.searchUrl("  Cowboy & Bebop  "))
        listOf(0, -1, 1.5, "1", 2_147_483_648L, Double.POSITIVE_INFINITY, Double.NaN, null).forEach { assertNull(AniChan.id(it)) }
        assertThrows(AniChanException::class.java) { AniChan.titleUrl(0) }
        assertEquals(5_000, AniChan.MAX_EPISODES)
    }

    @Test fun searchKeepsTrackerIdentityAndBoundsNames() {
        val parsed = AniChan.parseSearch(fixture("search"))
        assertEquals(listOf(AniChan.SearchResult(212888, 64340, "Overgeared", "https://anichan.to/media/catalogue/overgeared.jpg", 12, 2026, "ONA")), parsed)
        val row = fixture("search").getJSONArray("results").getJSONObject(0)
        val duplicates = JSONObject().put("results", JSONArray().put(JSONObject.NULL).put(JSONObject(row.toString()).put("id", "1")).put(row).put(row))
        assertEquals(1, AniChan.parseSearch(duplicates).size)
        val unsafe = JSONObject("""{"results":[{"id":1,"titleRomaji":" Cowboy\nBebop ","poster":"https://127.0.0.1/p.jpg"}]}""")
        assertEquals("Cowboy Bebop", AniChan.parseSearch(unsafe).single().title)
        assertNull(AniChan.parseSearch(unsafe).single().poster)
        val many = JSONObject().put("results", JSONArray((1..50).map { JSONObject().put("id", it).put("title", "x".repeat(500)) }))
        assertEquals(40, AniChan.parseSearch(many).size)
        assertEquals(300, AniChan.parseSearch(many).first().title.length)
        assertThrows(AniChanException::class.java) { AniChan.parseSearch(JSONObject()) }
    }

    @Test fun airingTitlesOnlyListAvailableEpisodes() {
        val parsed = AniChan.parseTitle(fixture("title"), 212888, JSONObject("""{"episodes":12,"dubAvailable":true}"""))
        assertEquals(212888, parsed.anilistId)
        assertEquals(64340, parsed.malId)
        assertEquals("Overgeared", parsed.title)
        assertEquals(2026, parsed.year)
        assertEquals(listOf(1, 2, 3, 4), parsed.episodes.map { it.number })
        assertEquals(AniChan.Episode(1, "Legendary Class", "https://anichan.to/media/episodes/1.jpg", true, true), parsed.episodes.first())
        assertThrows(AniChanException::class.java) { AniChan.parseTitle(fixture("title"), 1) }
    }

    @Test fun sparseLanguageAvailabilityIsUnionedSortedAndValidated() {
        val parsed = AniChan.parseTitle(JSONObject("""{"id":1,"title":"Bebop","episodes":26,
          "selfhost":{"cached_sub":[3,1,1,0,1.5,"2",5001],"cached_dub":[2,3],"ep_titles":{"2":"Fallback title"}},
          "available_eps":{"sub":[5],"hsub":[4],"dub":[6]}}"""), 1)
        assertEquals(listOf(Triple(1, true, false), Triple(2, false, true), Triple(3, true, true), Triple(4, true, false), Triple(5, true, false), Triple(6, false, true)),
            parsed.episodes.map { Triple(it.number, it.sub, it.dub) })
        assertEquals("Fallback title", parsed.episodes[1].title)
    }

    @Test fun explicitEmptyAvailabilityNeverRevivesFutureEpisodes() {
        assertTrue(AniChan.parseTitle(JSONObject("""{"id":1,"title":"Bebop","episodes":26,"selfhost":{"cached_eps":[]}}"""), 1, JSONObject("""{"episodes":26}""")).episodes.isEmpty())
        assertTrue(AniChan.parseTitle(JSONObject("""{"id":1,"title":"Bebop","episodes":26}"""), 1).episodes.isEmpty())
        val fallback = AniChan.parseTitle(JSONObject("""{"id":1,"title":"Bebop"}"""), 1, JSONObject("""{"episodes":2,"sources":[{"sub":true,"dub":true}],"dubAvailable":true}"""))
        assertEquals(listOf(AniChan.Episode(1, null, null, true, true), AniChan.Episode(2, null, null, true, true)), fallback.episodes)
        assertTrue(AniChan.parseTitle(JSONObject("""{"id":1,"title":"Bebop"}"""), 1, JSONObject("""{"episodes":5001}""")).episodes.isEmpty())
    }

    @Test fun decodedFixturesRetainCaptionsSubDubAndSkipRanges() {
        val sub = AniChan.parseServers(fixture("servers-overgeared-sub"), "sub", "fast")
        assertEquals(5, sub.size)
        assertEquals("anikoto", sub.first().name)
        assertEquals("vidstream · Sub", sub.first().label)
        assertEquals("[\"sub\",\"fast\",\"anikoto\",0]", sub.first().id)
        assertTrue(sub.first().hls)
        assertEquals(10, sub.first().subtitles.size)
        assertEquals("English", sub.first().subtitles.first().label)
        assertTrue(sub.first().subtitles.first().default)
        assertEquals("subtitles", sub.first().subtitles.first().kind)
        val bebop = AniChan.parseServers(fixture("servers-bebop-sub"), "sub", "fast")
        assertEquals("echovideo · Hard sub", bebop.last().label)
        assertEquals(AniChan.Skip(49.0, 144.0), bebop.first().intro)
        assertEquals(AniChan.Skip(1357.0, 1451.0), bebop.first().outro)
        val dub = AniChan.parseServers(fixture("servers-bebop-dub"), "dub", "fast")
        assertEquals(4, dub.size)
        assertEquals("vidstream · Dub", dub.first().label)
        assertEquals("[\"dub\",\"fast\",\"anikoto\",0]", dub.first().id)
    }

    @Test fun duplicateIdentityRemainsTiedToRawOrder() {
        val result = AniChan.parseServers(payload(server("""{"type":"embed","rank":0}"""), server("""{"rank":8}"""),
            server("""{"rank":1,"type":"mp4","stream":"/media/episode.mp4"}"""), server("""{"name":"tie","rank":1}""")), "sub", "rest")
        assertEquals(listOf(Triple("mirror", 2, 1.0), Triple("tie", 0, 1.0), Triple("mirror", 1, 8.0)), result.map { Triple(it.name, it.occurrence, it.rank) })
        assertEquals("[\"sub\",\"rest\",\"mirror\",2]", result.first().id)
        assertEquals("https://anichan.to/media/episode.mp4", result.first().url)
        assertFalse(result.first().hls)
    }

    @Test fun excludesEmbedsAndUnsafeMediaDestinations() {
        val bad = listOf("", "http://anichan.to/media.m3u8", "https://anichan.to.evil.example/media.m3u8", "https://user:pass@anichan.to/media.m3u8",
            "https://anichan.to:444/media.m3u8", "https://c.toroplay.cymru/media.m3u8#secret", "https://127.0.0.1/media.m3u8", "https://192.168.0.1/media.m3u8",
            "https://[::1]/media.m3u8", "https://localhost/media.m3u8", "//evil.example/media.m3u8", "javascript:alert(1)", "file:///video.mp4",
            "https://anichan.to/with space.m3u8", "https://anichan.to\\@evil.example/media.m3u8")
        assertTrue(AniChan.parseServers(JSONObject().put("servers", JSONArray(bad.map { server().put("stream", it) })), "sub", "fast").isEmpty())
        assertTrue(AniChan.parseServers(payload(server("""{"type":"embed"}""")), "sub", "fast").isEmpty())
        assertEquals("https://anichan.to/video.m3u8", AniChan.parseServers(payload(server("""{"stream":"https://anichan.to:443/video.m3u8"}""")), "sub", "fast").single().url)
    }

    @Test fun captionsOnlyAcceptAllowedWebVttAndSafeSkips() {
        val row = server("""{"subtitles":[{"lang":" English ","default":true,"url":"/api/watch/vtt?fixture=1","ass":"/media/extra.ass"},
          {"lang":"Duplicate","url":"/api/watch/vtt?fixture=1"},{"lang":"French","url":"https://c.toroplay.cymru/subs/fr.VTT"},
          {"lang":"ASS only","ass":"/media/english.ass"},{"lang":"ASS URL","url":"/media/english.ass"},
          {"lang":"Untrusted","url":"https://captions.example/english.vtt"},{"lang":"Chapters","url":"/api/watch/chapters"}],
          "intro":{"start":"0","end":90},"outro":{"start":1400,"end":86400}}""")
        val result = AniChan.parseServers(payload(row), "sub", "fast").single()
        assertEquals(listOf(AniChan.Subtitle("https://anichan.to/api/watch/vtt?fixture=1", "English", true), AniChan.Subtitle("https://c.toroplay.cymru/subs/fr.VTT", "French", false)), result.subtitles)
        assertNull(result.intro)
        assertNull(result.outro)
    }

    @Test fun resultAndTextLimitsBoundUntrustedResponses() {
        val rows = JSONArray((0 until 50).map { n -> server().put("name", "server-$n").put("rank", 50 - n)
            .put("subtitles", JSONArray((0 until 40).map { JSONObject().put("lang", "x".repeat(100)).put("url", "/captions/$it.vtt") })) })
        val result = AniChan.parseServers(JSONObject().put("servers", rows), "sub", "fast")
        assertEquals(32, result.size)
        assertEquals("server-49", result.first().name)
        assertEquals(32, result.first().subtitles.size)
        assertEquals(60, result.first().subtitles.first().label.length)
    }

    @Test fun missingSessionsAndMalformedListsFailClearly() {
        assertTrue(AniChan.parseServers(JSONObject("""{"servers":[]}"""), "sub", "fast").isEmpty())
        assertThrows(AniChanException::class.java) { AniChan.parseServers(JSONObject("""{"detail":"session"}"""), "sub", "fast") }
        for (json in listOf("{}", "{\"servers\":\"encoded\"}")) assertThrows(AniChanException::class.java) { AniChan.parseServers(JSONObject(json), "sub", "fast") }
        assertThrows(AniChanException::class.java) { AniChan.parseServers(JSONObject("""{"servers":[]}"""), "hsub", "fast") }
        assertThrows(AniChanException::class.java) { AniChan.parseServers(JSONObject("""{"servers":[]}"""), "sub", "all") }
    }
}
