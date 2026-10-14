package com.sanjay.anitrack.next.data.providers.connectors.miruro

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class MiruroV1CatalogueTest {
    private fun fixture() = JSONObject(generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
        .map { File(it, "tests/fixtures/miruro-v1.json") }.first { it.isFile }.readText(Charsets.UTF_8))
    private fun softServer(play: JSONObject) = play.getJSONArray("tracks").getJSONObject(0)
        .getJSONArray("providers").getJSONObject(0).getJSONArray("servers").getJSONObject(0)

    @Test fun directChoicesKeepTrackServerOccurrenceAndProviderSeparate() {
        val choices = MiruroV1Catalogue.choices(fixture().getJSONObject("play"), 1.0)
        assertEquals(listOf("ssub:anikoto:HD-1:0", "sub:aniwaves:Vidplay:0", "dub:anikoto:HD-1:0"), choices.map { it.variantId })
        assertEquals(3, choices.size)
        assertFalse(choices.any { it.server == "Embed-only" })
        assertFalse(choices.joinToString().contains("episode.m3u8"))
        assertTrue(choices.first().media.hls)
        assertFalse(choices[1].media.hls)
    }

    @Test fun duplicatesGetDistinctStableIdentitiesAndWrongEpisodeCannotResolve() {
        val play = fixture().getJSONObject("play")
        val servers = play.getJSONArray("tracks").getJSONObject(0).getJSONArray("providers").getJSONObject(0).getJSONArray("servers")
        servers.put(JSONObject(servers.getJSONObject(0).toString()))
        assertEquals(listOf("ssub:anikoto:HD-1:0", "ssub:anikoto:HD-1:1"),
            MiruroV1Catalogue.choices(play, 1.0).filter { it.track == "ssub" }.map { it.variantId })
        assertThrows(MiruroProtocolException::class.java) { MiruroV1Catalogue.choices(play, 2.0) }
    }

    @Test fun unsupportedHeadersPrivateMediaAndOriginPathsAreNotAuthorized() {
        for (kind in listOf("cookies", "private", "origin-path", "origin-private", "duplicate-header")) {
            val play = fixture().getJSONObject("play")
            val server = softServer(play)
            val headers = server.getJSONObject("headers")
            when (kind) {
                "cookies" -> { headers.remove("Origin"); headers.put("Cookie", "test=untrusted") }
                "private" -> server.getJSONArray("streams").getJSONObject(0).put("url", "https://127.0.0.1/video.m3u8")
                "origin-path" -> headers.put("Origin", "https://player.example.net/embed")
                "origin-private" -> headers.put("Origin", "https://router.internal/")
                "duplicate-header" -> { headers.remove("Referer"); headers.put("origin", "https://other.example.net") }
            }
            assertFalse(kind, MiruroV1Catalogue.choices(play, 1.0).any { it.track == "ssub" })
        }
    }

    @Test fun actualFileCaptionsRemainSupportedButMetadataAndUnknownFormatsAreExcluded() {
        val play = fixture().getJSONObject("play")
        val subtitles = play.getJSONArray("tracks").getJSONObject(0).getJSONArray("providers").getJSONObject(0).getJSONArray("subtitles")
        subtitles.getJSONObject(0).remove("url")
        subtitles.getJSONObject(0).put("file", "https://subs.example.net/en.vtt").put("default", true)
        subtitles.put(JSONObject().put("file", "https://subs.example.net/thumbnails.vtt").put("format", "vtt").put("kind", "thumbnails"))
        subtitles.put(JSONObject().put("file", "https://subs.example.net/unknown.bin").put("format", "binary"))
        val accepted = MiruroV1Catalogue.choices(play, 1.0).first().media.subtitles
        assertEquals(1, accepted.size)
        assertTrue(accepted.single().default)
        assertEquals("https://subs.example.net/en.vtt", accepted.single().url)
    }

    @Test fun incompleteEpisodePagesDuplicateNumbersAndExcessiveChoiceCountsFailClosed() {
        val episodes = fixture().getJSONObject("episodes")
        episodes.put("has_more", true)
        assertThrows(MiruroProtocolException::class.java) { MiruroV1Catalogue.episodes(episodes) }
        episodes.put("has_more", false)
        episodes.getJSONArray("data").put(JSONObject().put("episode_number", 1))
        assertThrows(MiruroProtocolException::class.java) { MiruroV1Catalogue.episodes(episodes) }
        val play = fixture().getJSONObject("play")
        play.getJSONArray("tracks").put(JSONObject().put("track", "sub").put("providers", JSONArray()))
        assertThrows(MiruroProtocolException::class.java) { MiruroV1Catalogue.choices(play, 1.0) }
    }
}
