package com.sanjay.anitrack.next.data.providers.connectors.shonen

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as tests/shonen.test.mjs (shapes from shonen.to, 19 Oct 2026). */
class ShonenTest {
    private val searchHtml = """<div class="grid"><a class="card" href="/anime/154587" title="Frieren: Beyond Journey&#39;s End"><div class="poster" style="--c:#bbf1a1"><img loading="lazy" decoding="async" width="230" height="326" src="/media/catalogue/07/070a.jpg" alt="poster"><span class="pill ep">EP 28</span><span class="pill score">9.1</span></div><div class="ct">Frieren: Beyond Journey’s End</div><div class="cm">TV / 2023</div></a><a class="card" href="/anime/182255" title="Frieren: Beyond Journey’s End Season 2"><div class="poster"><img src="/media/catalogue/54/5417.jpg"><span class="pill ep">EP 10</span><span class="pill score">8.7</span></div><div class="ct">x</div><div class="cm">TV / 2026</div></a><a class="card" href="/anime/154587" title="duplicate"></a><a class="card" href="/anime/abc" title="bad id"></a></div>"""

    @Test fun searchCards() {
        val results = Shonen.search(searchHtml)
        assertEquals(2, results.size)
        assertEquals(
            Shonen.SearchResult(154587, "Frieren: Beyond Journey's End", "https://shonen.to/media/catalogue/07/070a.jpg", 28, 9.1, "TV", 2023),
            results[0],
        )
        assertEquals(182255, results[1].anilistId)
        assertEquals(10, results[1].episodes)
    }

    @Test fun episodeCount() {
        assertEquals(1180, Shonen.episodeCount("""<button class="btn fbtn big" data-id="21" data-t="ONE PIECE" data-eps="1180">Follow</button>"""))
        assertEquals(12, Shonen.episodeCount("<dl><dt>Format</dt><dd>TV</dd><dt>Episodes</dt><dd>12</dd></dl>"))
        assertNull(Shonen.episodeCount("<p>nothing</p>"))
        assertEquals("ONE PIECE", Shonen.titlePage("""<h1>ONE PIECE</h1><button data-eps="1180">""").title)
    }

    @Test fun sources() {
        val stream = Shonen.sources(JSONObject("""{"data":{"provider":"shonen","source":"https://vidcloud.sbs/api/proxy/m3u8?t=A",
            "sources":[{"file":"https://vidcloud.sbs/api/proxy/m3u8?t=A","type":"hls","label":"Primary","tracks":[]}],
            "tracks":[{"file":"https://vidcloud.sbs/api/proxy/vtt?t=B","label":"English","kind":"subtitles","default":true},
              {"file":"http://insecure.example/x.vtt","label":"Bad","kind":"subtitles"},
              {"file":"https://vidcloud.sbs/thumbs.vtt","label":"Thumbs","kind":"thumbnails"}],
            "intro":{"start":11,"end":101},"outro":null,"expiresAt":"2026-10-18T22:05:27.279Z"}}"""))
        assertEquals("https://vidcloud.sbs/api/proxy/m3u8?t=A", stream.url)
        assertEquals(listOf(Shonen.Subtitle("https://vidcloud.sbs/api/proxy/vtt?t=B", "English", "subtitles", true)), stream.subtitles)
        assertEquals(Shonen.Skip(11.0, 101.0), stream.intro)
        assertNull(stream.outro)
    }

    @Test fun missingEpisodeIsNotFound() {
        val missing = assertThrows(ShonenException::class.java) {
            Shonen.sources(JSONObject("""{"error":{"code":"SOURCE_NOT_FOUND","message":"No compatible Shonen stream is available."}}"""))
        }
        assertTrue(missing.notFound)
        assertTrue(missing.message!!.contains("no stream for this episode"))
        val other = assertThrows(ShonenException::class.java) { Shonen.sources(JSONObject("""{"error":{"code":"UPSTREAM","message":"<script>"}}""")) }
        assertFalse(other.notFound)
        assertThrows(ShonenException::class.java) { Shonen.sources(JSONObject("""{"data":{"sources":[{"file":"javascript:alert(1)","type":"hls"}]}}""")) }
    }

    @Test fun sourceUrls() {
        assertEquals("https://shonen.to/sources/shonen?id=21&episode=1150&language=dub", Shonen.sourcesUrl(21, 1150, "dub"))
        assertThrows(ShonenException::class.java) { Shonen.sourcesUrl(0, 1, "sub") }
    }
}
