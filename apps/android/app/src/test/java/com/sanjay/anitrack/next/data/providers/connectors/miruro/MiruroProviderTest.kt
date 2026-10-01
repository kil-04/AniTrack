package com.sanjay.anitrack.next.data.providers.connectors.miruro

import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.PlaybackPreferences
import com.sanjay.anitrack.next.data.providers.connectors.MiruroProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class MiruroProviderTest {
    private fun fixture() = JSONObject(generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
        .map { File(it, "tests/fixtures/miruro-catalogue.json") }.first { it.isFile }.readText(Charsets.UTF_8))

    private fun provider(data: JSONObject, calls: MutableList<MiruroReadRequest>) = MiruroProvider({ request ->
        calls.add(request)
        data.getJSONObject(when (request) {
            MiruroReadRequest.Config -> "config"
            is MiruroReadRequest.Info -> "info"
            is MiruroReadRequest.Episodes -> "episodes"
            is MiruroReadRequest.Sources -> "source"
        })
    }, { "test session identity" })

    @Test fun normalizesAndListsVariantsWithoutResolvingEveryServer() = runBlocking {
        val calls = mutableListOf<MiruroReadRequest>()
        val adapter = provider(fixture(), calls)
        val series = requireNotNull(adapter.resume("miruro:sub:1"))
        assertEquals(listOf(1f, 1.5f, 2f), series.episodes.map { it.number })
        assertEquals("miruro:sub:1", series.resumeKey)
        assertTrue(series.verified)
        assertFalse(adapter.descriptor.capabilities.downloads)
        assertEquals(listOf("bee:ssub", "hop:sub"), series.episodes.first().variants().map { it.id })
        assertEquals(3, calls.size)
        assertFalse(calls.any { it is MiruroReadRequest.Sources })
        Unit
    }

    @Test fun selectedServerKeepsEpisodeCoordinatesAndResolvesFreshEveryTime() = runBlocking {
        val calls = mutableListOf<MiruroReadRequest>()
        val episode = requireNotNull(provider(fixture(), calls).resume("miruro:sub:1")).episodes.last()
        val result = episode.resolve(variantId = "hop:sub")
        assertEquals(MiruroReadRequest.Sources(1, "synthetic-hop-2", "hop", "sub"), calls.last())
        episode.resolve(variantId = "hop:sub")
        assertEquals(2, calls.count { it is MiruroReadRequest.Sources })
        assertEquals(PlaybackBackend.NATIVE, result.backend)
        assertEquals("test session identity", result.userAgent)
        assertFalse(result.downloadable)
    }

    @Test fun softSubDefaultHardSubPreferenceAndDubResumeRemainDistinct() = runBlocking {
        val calls = mutableListOf<MiruroReadRequest>()
        val adapter = provider(fixture(), calls)
        val episode = requireNotNull(adapter.resume("miruro:sub:1")).episodes.first()
        episode.resolve()
        assertEquals(MiruroReadRequest.Sources(1, "synthetic-bee-1", "bee", "ssub"), calls.last())
        episode.resolve(PlaybackPreferences(preferHardSub = true))
        assertEquals(MiruroReadRequest.Sources(1, "synthetic-hop-1", "hop", "sub"), calls.last())
        val dubbed = requireNotNull(adapter.resume("miruro:dub:1"))
        assertEquals("miruro:dub:1", dubbed.resumeKey)
        dubbed.episodes.first().resolve()
        assertEquals(MiruroReadRequest.Sources(1, "synthetic-bee-dub-1", "bee", "dub"), calls.last())
    }

    @Test fun rejectsBadResumeKeysWithoutNetwork() = runBlocking {
        val calls = mutableListOf<MiruroReadRequest>()
        val adapter = provider(fixture(), calls)
        listOf("miruro:sub:0", "miruro:sub:01", "miruro:sub:-1", "miruro:sub:2147483648",
            "miruro:sub:1\n", "miruro:other:1", "anikoto:sub:1", "miruro:sub:1/extra").forEach {
            assertFalse(it, adapter.acceptsResumeKey(it))
            assertNull(adapter.resume(it))
        }
        assertTrue(calls.isEmpty())
        Unit
    }

    @Test fun unavailableVariantDoesNotSilentlySwitchServer() = runBlocking {
        val calls = mutableListOf<MiruroReadRequest>()
        val episode = requireNotNull(provider(fixture(), calls).resume("miruro:sub:1")).episodes[1]
        try { episode.resolve(variantId = "hop:sub"); fail("Missing variant must fail") }
        catch (_: MiruroProtocolException) { }
        assertEquals(3, calls.size)
    }

    @Test fun rejectsWrongShowAndMalformedEpisodeIdentities() = runBlocking {
        val data = fixture()
        val calls = mutableListOf<MiruroReadRequest>()
        data.getJSONObject("info").getJSONObject("media").put("id", 2)
        try { provider(data, calls).resume("miruro:sub:1"); fail("Wrong show must fail") }
        catch (_: MiruroProtocolException) { }
        assertEquals(1, calls.size)
        val episodes = data.getJSONObject("episodes")
        episodes.getJSONObject("mappings").put("aniId", 2)
        assertThrows(MiruroProtocolException::class.java) { MiruroCatalogue.choices(1, "sub", data.getJSONObject("config"), episodes) }
        episodes.getJSONObject("mappings").put("aniId", 1)
        val sub = episodes.getJSONObject("providers").getJSONObject("bee").getJSONObject("episodes").getJSONArray("sub")
        sub.put(JSONObject().put("number", -1).put("id", "invalid"))
        sub.put(JSONObject().put("number", 77).put("id", "bad\nid"))
        sub.put(JSONObject().put("number", 1).put("id", "duplicate"))
        sub.put(JSONObject().put("number", "special").put("id", "non-numeric"))
        val choices = MiruroCatalogue.choices(1, "sub", data.getJSONObject("config"), episodes)
        assertEquals(5, choices.size)
        assertFalse(choices.joinToString().contains("synthetic"))
    }

    @Test fun emptyDubDoesNotFallBackToSub() = runBlocking {
        val data = fixture()
        data.getJSONObject("episodes").getJSONObject("providers").getJSONObject("bee").getJSONObject("episodes").remove("dub")
        assertNull(provider(data, mutableListOf()).resume("miruro:dub:1"))
    }

    @Test fun errorsAndCancellationPropagateWithoutAlternateResolution() = runBlocking {
        for (failure in listOf(MiruroProtocolException(failure = MiruroFailure.SECURITY_CHECK), CancellationException("cancelled"))) {
            val data = fixture()
            var requests = 0
            val adapter = MiruroProvider({ requests++; throw failure }, { "test" })
            val episode = requireNotNull(adapter.series(1, "sub", data.getJSONObject("config"), data.getJSONObject("episodes"))).episodes.first()
            try { episode.resolve(); fail("Resolution must stop") }
            catch (error: Exception) { assertSame(failure, error) }
            assertEquals(1, requests)
        }
    }
}
