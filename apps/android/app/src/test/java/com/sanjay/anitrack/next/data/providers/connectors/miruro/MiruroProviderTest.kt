package com.sanjay.anitrack.next.data.providers.connectors.miruro

import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.PlaybackPreferences
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.connectors.MiruroProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class MiruroProviderTest {
    private fun fixture() = JSONObject(generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
        .map { File(it, "tests/fixtures/miruro-v1.json") }.first { it.isFile }.readText(Charsets.UTF_8))

    private fun provider(data: JSONObject, calls: MutableList<MiruroV1ReadRequest>) = MiruroProvider({ request ->
        calls.add(request)
        when (request) {
            is MiruroV1ReadRequest.Lookup -> data.getJSONObject("lookup")
            is MiruroV1ReadRequest.Episodes -> data.getJSONObject("episodes")
            is MiruroV1ReadRequest.Play -> JSONObject(data.getJSONObject("play").toString()).put("episode_number", request.episode)
        }
    }, { "test session identity" })

    @Test fun loadsVerifiedEpisodeNumbersWithoutResolvingAnyMedia() = runBlocking {
        val calls = mutableListOf<MiruroV1ReadRequest>()
        val adapter = provider(fixture(), calls)
        val series = requireNotNull(adapter.resume("miruro:sub:1"))
        assertEquals(listOf(1f, 1.5f, 2f), series.episodes.map { it.number })
        assertEquals("miruro:sub:1", series.resumeKey)
        assertTrue(series.verified)
        assertFalse(adapter.descriptor.capabilities.downloads)
        assertEquals(listOf(MiruroV1ReadRequest.Lookup(1), MiruroV1ReadRequest.Episodes("synthetic-show")), calls)
        assertEquals(listOf("ssub:anikoto:HD-1:0", "sub:aniwaves:Vidplay:0"), series.episodes.first().variants().map { it.id })
        assertEquals(3, calls.size) // One /play catalogue read, no embed/server probes.
        Unit
    }

    @Test fun exactSelectedServerResolvesFreshWithHeadersCaptionsAndSkipRanges() = runBlocking {
        val data = fixture()
        val calls = mutableListOf<MiruroV1ReadRequest>()
        val episode = requireNotNull(provider(data, calls).resume("miruro:sub:1")).episodes.first()
        val result = episode.resolve(variantId = "ssub:anikoto:HD-1:0")
        assertEquals(MiruroV1ReadRequest.Play("synthetic-show", 1.0), calls.last())
        data.getJSONObject("play").getJSONArray("tracks").getJSONObject(0).getJSONArray("providers")
            .getJSONObject(0).getJSONArray("servers").getJSONObject(0).getJSONArray("streams").getJSONObject(0)
            .put("url", "https://media.example.net/show/fresh.m3u8")
        assertTrue(episode.resolve(variantId = "ssub:anikoto:HD-1:0").url.endsWith("fresh.m3u8"))
        assertEquals(2, calls.count { it is MiruroV1ReadRequest.Play })
        assertEquals(PlaybackBackend.NATIVE, result.backend)
        assertEquals("test session identity", result.userAgent)
        assertEquals(mapOf("Referer" to "https://player.example.net/", "Origin" to "https://player.example.net"), result.requestHeaders)
        assertEquals("en", result.subtitles.single().language)
        assertEquals("text/vtt", result.subtitles.single().mimeType)
        assertEquals(10L, result.intro?.startSeconds)
        assertEquals(50L, result.intro?.endSeconds)
        assertFalse(result.downloadable)
        assertTrue(result.conservativeNetwork)
    }

    @Test fun fractionalEpisodeAndCrossEpisodeServerIdentityStayStable() = runBlocking {
        val calls = mutableListOf<MiruroV1ReadRequest>()
        val series = requireNotNull(provider(fixture(), calls).resume("miruro:sub:1"))
        val variant = series.episodes.first().variants().first().id
        assertEquals(variant, series.episodes[1].variants().first().id)
        series.episodes[1].resolve(variantId = variant)
        assertEquals(MiruroV1ReadRequest.Play("synthetic-show", 1.5), calls.last())
        assertEquals(1.5f, series.episodes[1].number)
    }

    @Test fun softSubDefaultHardSubPreferenceAndDubRemainDistinct() = runBlocking {
        val calls = mutableListOf<MiruroV1ReadRequest>()
        val adapter = provider(fixture(), calls)
        val episode = requireNotNull(adapter.resume("miruro:sub:1")).episodes.first()
        assertTrue(episode.resolve().url.endsWith("episode.m3u8"))
        val hard = episode.resolve(PlaybackPreferences(preferHardSub = true))
        assertTrue(hard.url.endsWith("hard.mp4"))
        assertEquals(SeekMode.EXACT, hard.seekMode)
        val dubbed = requireNotNull(adapter.resume("miruro:dub:1"))
        assertEquals("miruro:dub:1", dubbed.resumeKey)
        assertEquals(listOf("dub:anikoto:HD-1:0"), dubbed.episodes.first().variants().map { it.id })
        assertTrue(dubbed.episodes.first().resolve().url.endsWith("dub.m3u8"))
    }

    @Test fun rejectsBadResumeKeysWithoutNetwork() = runBlocking {
        val calls = mutableListOf<MiruroV1ReadRequest>()
        val adapter = provider(fixture(), calls)
        listOf("miruro:sub:0", "miruro:sub:01", "miruro:sub:-1", "miruro:sub:2147483648",
            "miruro:sub:1\n", "miruro:other:1", "anikoto:sub:1", "miruro:sub:1/extra").forEach {
            assertFalse(it, adapter.acceptsResumeKey(it))
            assertNull(adapter.resume(it))
        }
        assertTrue(calls.isEmpty())
        Unit
    }

    @Test fun removedSelectedServerDoesNotFallBackToAnotherTrackOrArrayIndex() = runBlocking {
        val data = fixture()
        val calls = mutableListOf<MiruroV1ReadRequest>()
        val episode = requireNotNull(provider(data, calls).resume("miruro:sub:1")).episodes.first()
        val selected = episode.variants().first().id
        data.getJSONObject("play").getJSONArray("tracks").getJSONObject(0).getJSONArray("providers")
            .getJSONObject(0).getJSONArray("servers").remove(0)
        try { episode.resolve(variantId = selected); fail("Missing variant must fail") }
        catch (_: MiruroProtocolException) { }
        assertEquals(4, calls.size)
    }

    @Test fun rejectsWrongAmbiguousOrIncompleteShowIdentity() = runBlocking {
        for (kind in listOf("wrong", "ambiguous", "incomplete")) {
            val data = fixture()
            val lookup = data.getJSONObject("lookup")
            when (kind) {
                "wrong" -> lookup.getJSONArray("data").getJSONObject(0).getJSONObject("external_ids").getJSONArray("anilist").put(0, "2")
                "ambiguous" -> lookup.getJSONArray("data").put(JSONObject(lookup.getJSONArray("data").getJSONObject(0).toString()))
                "incomplete" -> lookup.put("has_more", true)
            }
            val calls = mutableListOf<MiruroV1ReadRequest>()
            try { provider(data, calls).resume("miruro:sub:1"); fail("Unverified show must fail") }
            catch (_: MiruroProtocolException) { }
            assertEquals(1, calls.size)
        }
    }

    @Test fun emptyDubDoesNotSubstituteJapaneseAudio() = runBlocking {
        val data = fixture()
        data.getJSONObject("play").getJSONArray("tracks").remove(2)
        val episode = requireNotNull(provider(data, mutableListOf()).resume("miruro:dub:1")).episodes.first()
        assertTrue(episode.variants().isEmpty())
        try { episode.resolve(); fail("No dub must fail") } catch (_: MiruroProtocolException) { }
    }

    @Test fun errorsAndCancellationPropagateWithoutAlternativeResolution() = runBlocking {
        for (failure in listOf(MiruroProtocolException(failure = MiruroFailure.SECURITY_CHECK), CancellationException("cancelled"))) {
            var requests = 0
            val adapter = MiruroProvider({ requests++; throw failure }, { "test" })
            val episode = requireNotNull(adapter.series(1, "sub", "synthetic-show", fixture().getJSONObject("episodes"))).episodes.first()
            try { episode.resolve(); fail("Resolution must stop") }
            catch (error: Exception) { assertSame(failure, error) }
            assertEquals(1, requests)
        }
    }
}
