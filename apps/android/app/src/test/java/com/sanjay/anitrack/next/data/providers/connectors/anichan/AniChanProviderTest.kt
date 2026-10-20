package com.sanjay.anitrack.next.data.providers.connectors.anichan

import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.ProviderRuntimeConfig
import com.sanjay.anitrack.next.data.RuntimeFeatures
import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import com.sanjay.anitrack.next.data.providers.connectors.AniChanProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AniChanProviderTest {
    private fun title() = JSONObject("""{"id":1,"title":"Bebop","episodes":26,"selfhost":{"cached_sub":[1,2],"cached_dub":[1]}}""")
    private fun stream(category: String, suffix: String = "first") = JSONObject().put("servers", JSONArray().put(JSONObject()
        .put("name", "mirror").put("label", "Mirror").put("type", "hls").put("rank", 1)
        .put("stream", "https://c.toroplay.cymru/api/watch/m3u8?fixture=$category-$suffix")
        .put("subtitles", JSONArray().put(JSONObject().put("lang", "English").put("url", "/api/watch/vtt?fixture=english").put("default", true)))))
    private fun runtime(providers: Map<String, ProviderRuntimeConfig>) = AndroidRuntimeConfig(
        1, "fixture", listOf("shonen"), providers, RuntimeFeatures(true, true, true, true, true), null,
    )

    @Test fun catalogueIsVerifiedAndDoesNotResolveSources() = runBlocking {
        val calls = mutableListOf<String>()
        val provider = AniChanProvider({ calls += "metadata:$it"; title() }, { calls += "count:$it"; JSONObject() },
            { id, ep, category, tier -> calls += "$id:$ep:$category:$tier"; stream(category) }, { "session agent" })
        val series = requireNotNull(provider.resume("anichan:1"))
        assertEquals(listOf("metadata:1"), calls)
        assertEquals(listOf(1f, 2f), series.episodes.map { it.number })
        assertEquals("anichan:1", series.resumeKey)
        assertTrue(series.verified)
        assertEquals(listOf("SUB", "DUB"), series.badges)
        assertTrue(provider.descriptor.capabilities.downloads)
        assertEquals(listOf("[\"sub\",\"fast\",\"mirror\",0]", "[\"dub\",\"fast\",\"mirror\",0]"), series.episodes.first().variants().map { it.id })
        assertEquals(listOf("metadata:1", "1:1:sub:fast", "1:1:dub:fast"), calls)
        calls.clear()
        assertEquals(listOf("[\"sub\",\"fast\",\"mirror\",0]"), series.episodes[1].variants().map { it.id })
        assertEquals(listOf("1:2:sub:fast"), calls)
    }

    @Test fun selectedServerIsResolvedFreshWithNativeMediaAndCaptions() = runBlocking {
        var reads = 0
        val calls = mutableListOf<String>()
        val provider = AniChanProvider({ title() }, { JSONObject() },
            { _, _, category, tier -> calls += "$category:$tier"; stream(category, (++reads).toString()) }, { "verified web agent" })
        val episode = requireNotNull(provider.resume("anichan:1")).episodes.first()
        val selected = "[\"dub\",\"fast\",\"mirror\",0]"
        val first = episode.resolve(variantId = selected)
        val second = episode.resolve(variantId = selected)
        assertNotEquals(first.url, second.url)
        assertEquals(listOf("dub:fast", "dub:fast"), calls)
        assertEquals(selected, first.variantId)
        assertEquals(PlaybackBackend.NATIVE, first.backend)
        assertEquals(SeekMode.EXACT, first.seekMode)
        assertEquals("application/x-mpegURL", first.mimeType)
        assertEquals(StreamAuthorizationScope.DIRECTORY, first.authorizationScope)
        assertEquals("verified web agent", first.userAgent)
        assertEquals("", first.referer) // the signed proxy already carries upstream hotlink data
        assertEquals("en", first.subtitles.single().language)
        assertTrue(first.subtitles.single().default)
        assertTrue(first.downloadable)
        assertTrue(first.conservativeNetwork)
    }

    @Test fun restTierIsReadOnlyWhenFastHasNoSupportedDirectStream() = runBlocking {
        val calls = mutableListOf<String>()
        val metadata = title().apply { getJSONObject("selfhost").put("cached_dub", JSONArray()) }
        val provider = AniChanProvider({ metadata }, { JSONObject() }, { _, _, category, tier ->
            calls += "$category:$tier"
            if (tier == "fast") JSONObject("""{"servers":[{"name":"embed","type":"embed","stream":"https://anichan.to/embed"}]}""") else stream(category)
        }, { "agent" })
        val variants = requireNotNull(provider.resume("anichan:1")).episodes.first().variants()
        assertEquals(listOf("sub:fast", "sub:rest"), calls)
        assertEquals("[\"sub\",\"rest\",\"mirror\",0]", variants.single().id)
    }

    @Test fun invalidOrRemovedSelectionNeverSilentlyChangesLanguageOrServer() = runBlocking {
        var calls = 0
        val provider = AniChanProvider({ title() }, { JSONObject() }, { _, _, category, _ -> calls++; stream(category) }, { "agent" })
        val episode = requireNotNull(provider.resume("anichan:1")).episodes[1]
        try { episode.resolve(variantId = "[\"dub\",\"fast\",\"mirror\",0]"); fail("Unavailable dub must stop") } catch (_: AniChanException) { }
        assertEquals(0, calls)
        try { episode.resolve(variantId = "[\"sub\",\"fast\",\"missing\",0]"); fail("Removed server must stop") } catch (_: AniChanException) { }
        assertEquals(1, calls)
    }

    @Test fun malformedResumeKeysAndFailuresDoNotTriggerAlternativeRequests() = runBlocking {
        var reads = 0
        val failure = CancellationException("cancelled")
        val provider = AniChanProvider({ title() }, { JSONObject() }, { _, _, _, _ -> reads++; throw failure }, { "agent" })
        for (key in listOf("anichan:0", "anichan:01", "anichan:-1", "anichan:2147483648", "anichan:1\n", "other:1")) {
            assertFalse(provider.acceptsResumeKey(key))
            assertNull(provider.resume(key))
        }
        assertEquals(0, reads)
        try { requireNotNull(provider.resume("anichan:1")).episodes.first().variants(); fail("Cancellation must propagate") }
        catch (error: CancellationException) { assertSame(failure, error) }
        assertEquals(1, reads)
    }

    @Test fun newlyCompiledProviderSurvivesOldRulesButExplicitDisableWins() {
        val provider = AniChanProvider({ title() }, { JSONObject() }, { _, _, category, _ -> stream(category) }, { "agent" })
        assertTrue(provider.isEnabled(runtime(emptyMap())))
        val disabled = ProviderRuntimeConfig(false, emptyList(), emptyList(), emptyList(), emptyMap(), emptyMap())
        assertFalse(provider.isEnabled(runtime(mapOf("anichan" to disabled))))
    }
}
