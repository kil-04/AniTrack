package com.sanjay.anitrack.next.data.providers.connectors.miruro

import com.sanjay.anitrack.next.data.ScopedRequestAuthorization
import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MiruroMediaTest {
    private fun source(vararg streams: JSONObject) = JSONObject().put("streams", JSONArray(streams.toList()))
    private fun stream(url: String, type: String = "hls", default: Boolean = false) =
        JSONObject().put("url", url).put("type", type).put("default", default)
            .put("referer", "https://player.example.net/watch")

    @Test fun parsesObservedShapeAndPrefersDefaultDirectMedia() {
        val source = source(stream("https://media.example.net/one.mp4", "mp4"),
            stream("https://media.example.net/two.m3u8?token=synthetic", default = true),
            stream("https://player.example.net/embed", "embed"))
            .put("subtitles", JSONArray().put(JSONObject().put("file", "https://media.example.net/en.vtt")
                .put("format", "vtt").put("label", "English")))
        val media = MiruroMediaParser.directMedia(source)
        assertEquals(2, media.size)
        assertTrue(media.first().hls)
        assertEquals(1, media.first().subtitles.size)
        val resolved = media.first().resolved("test identity")
        assertEquals(StreamAuthorizationScope.PUBLIC_HLS, resolved.authorizationScope)
        assertEquals("https://player.example.net/watch", resolved.requestHeaders["Referer"])
        val authorization = ScopedRequestAuthorization.create(
            resolved.url,
            requireNotNull(resolved.authorizationScope),
            resolved.requestHeaders,
        )!!
        assertEquals(
            resolved.requestHeaders,
            authorization.headersFor("https://rotating.example.org/video/segment-12.ts"),
        )
        assertTrue(authorization.headersFor("https://rotating.example.org/player.html").isEmpty())
        assertFalse(resolved.downloadable)
        assertTrue(resolved.conservativeNetwork)
        assertEquals("application/x-mpegURL", resolved.mimeType)
        assertFalse(media.first().toString().contains("synthetic"))
        assertEquals(StreamAuthorizationScope.EXACT, media.last().resolved("test").authorizationScope)
    }

    @Test fun rejectsEmbedsUnknownFormatsLocalTargetsAndHeaderInjection() {
        val bad = listOf("http://media.example.net/a.m3u8", "https://localhost/a.m3u8",
            "https://192.168.1.1/a.m3u8", "https://2130706433/a.m3u8", "https://[::1]/a.m3u8",
            "https://router.local/a.m3u8", "https://user@media.example.net/a.m3u8", "file:///a.m3u8",
            "https://media.example.net:444/a.m3u8", "https://media.example.net/a.m3u8\n")
        bad.forEach { assertTrue(it, MiruroMediaParser.directMedia(source(stream(it))).isEmpty()) }
        assertTrue(MiruroMediaParser.directMedia(source(stream("https://media.example.net/a", "embed"))).isEmpty())
        assertTrue(MiruroMediaParser.directMedia(source(stream("https://media.example.net/a", "unknown"))).isEmpty())
        assertTrue(MiruroMediaParser.directMedia(source(stream("https://media.example.net/a.m3u8")
            .put("referer", "https://player.example.net/\r\nCookie: bad"))).isEmpty())
    }

    @Test fun assSubtitlesKeepTheirOwnMimeType() {
        val source = source(stream("https://media.example.net/a.m3u8"))
            .put("subtitles", JSONArray().put(JSONObject().put("file", "https://media.example.net/en.ass").put("format", "ass")))
        assertEquals("text/x-ssa", MiruroMediaParser.directMedia(source).single().subtitles.single().mimeType)
    }

    @Test fun excludesThumbnailTracksAndPrefersEnglishWithCorrectFormat() {
        val subtitles = JSONArray()
            .put(JSONObject().put("file", "https://media.example.net/thumbs.vtt").put("kind", "thumbnails").put("default", true))
            .put(JSONObject().put("file", "https://media.example.net/es.vtt").put("language", "es").put("default", true))
            .put(JSONObject().put("file", "https://media.example.net/EN.SRT?token=synthetic").put("language", "English").put("label", "English"))
        val result = MiruroMediaParser.directMedia(source(stream("https://media.example.net/a.m3u8")).put("subtitles", subtitles)).single().subtitles
        assertEquals(2, result.size)
        assertEquals("en", result.first().language)
        assertEquals("application/x-subrip", result.first().mimeType)
        assertEquals("es", result.last().language)
        assertTrue(result.last().default)
    }

    @Test fun explicitUnknownFormatIsNotGuessedFromExtension() {
        val subtitles = JSONArray().put(JSONObject().put("file", "https://media.example.net/en.vtt").put("format", "encrypted"))
        assertTrue(MiruroMediaParser.directMedia(source(stream("https://media.example.net/a.m3u8")).put("subtitles", subtitles)).single().subtitles.isEmpty())
    }

    @Test fun declaredVttWithoutAnExtensionIsAcceptedAndNullLanguageStaysUnknown() {
        val subtitles = JSONArray().put(JSONObject().put("file", "https://media.example.net/track?id=synthetic")
            .put("format", "webvtt").put("language", JSONObject.NULL))
        val result = MiruroMediaParser.directMedia(source(stream("https://media.example.net/a.m3u8")).put("subtitles", subtitles)).single().subtitles.single()
        assertEquals("text/vtt", result.mimeType)
        assertNull(result.language)
    }
}
