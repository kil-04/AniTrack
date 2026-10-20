package com.sanjay.anitrack.next.data.providers.connectors.anichan

import org.junit.Assert.*
import org.junit.Test

class AniChanPagePolicyTest {
    @Test fun watchAndCanonicalSlugStayOnThePreparedShowAndFirstEpisode() {
        val target = "https://anichan.to/anime/212888/watch/1"
        assertTrue(AniChanPagePolicy.allowed(target, true, 212888))
        assertTrue(AniChanPagePolicy.allowed("https://anichan.to/anime/212888/overgeared/1", true, 212888))
        assertTrue(AniChanPagePolicy.loaded("https://anichan.to/anime/212888/overgeared/1", target, 212888))
        for (url in listOf("https://anichan.to/anime/1/overgeared/1", "https://anichan.to/anime/212888/overgeared/2",
            "https://anichan.to/anime/212888/watch/1/extra", "https://anichan.to/anime/212888/../account/1",
            "https://anichan.to/anime/212888/over_geared/1", "https://anichan.to/account", "https://evil.example/anime/212888/overgeared/1")) {
            assertFalse(url, AniChanPagePolicy.allowed(url, true, 212888))
            assertFalse(url, AniChanPagePolicy.loaded(url, target, 212888))
        }
        assertFalse(AniChanPagePolicy.loaded("https://anichan.to/", target, 212888))
        assertFalse(AniChanPagePolicy.loaded(target, "https://anichan.to/", 212888))
    }

    @Test fun resourcesStayOnSourceOrHumanCheckHost() {
        assertTrue(AniChanPagePolicy.allowed("https://anichan.to/_next/static/chunks/watch.js", false, 212888))
        assertTrue(AniChanPagePolicy.allowed("https://challenges.cloudflare.com/turnstile/v0/api.js", false, 212888))
        assertTrue(AniChanPagePolicy.allowed("https://anichan.to/cdn-cgi/challenge-platform/flow", true, 212888))
        for (url in listOf("https://c.toroplay.cymru/api/watch/m3u8", "https://ads.example/banner.js", "http://anichan.to/",
            "https://user:pass@anichan.to/", "https://anichan.to:444/", "https://127.0.0.1/", "file:///app/secret", "content://app/data")) {
            assertFalse(url, AniChanPagePolicy.allowed(url, false, 212888))
        }
    }
}
