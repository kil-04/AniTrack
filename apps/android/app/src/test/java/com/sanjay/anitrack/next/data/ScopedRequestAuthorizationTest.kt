package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScopedRequestAuthorizationTest {
    private val headers = mapOf("Cookie" to "episode=1", "Referer" to "https://mkissa.to/")

    @Test fun captionsReceiveExactPublicHeadersWithoutLeakingVideoCredentialsAcrossHosts() {
        val auth = ScopedRequestAuthorization.create("https://video.example/ep.mp4", StreamAuthorizationScope.EXACT,
            headers + ("Authorization" to "secret"), listOf("https://subs.example/en.srt?episode=1", "https://video.example/en.vtt"))!!
        assertEquals(mapOf("Referer" to "https://mkissa.to/"), auth.headersFor("https://subs.example/en.srt?episode=1"))
        assertEquals(headers + ("Authorization" to "secret"), auth.headersFor("https://video.example/en.vtt"))
        assertTrue(auth.headersFor("https://subs.example/en.srt?episode=2").isEmpty())
        assertTrue(auth.headersFor("https://subs.example/sibling.vtt").isEmpty())
    }

    @Test fun rotatingMediaAndCaptionScopesNeverAuthorizePrivateTargets() {
        val auth = ScopedRequestAuthorization.create("https://video.example/master.m3u8", StreamAuthorizationScope.PUBLIC_HLS,
            mapOf("Referer" to "https://player.example/"), listOf("https://127.0.0.1/subs.vtt", "https://localhost/subs.vtt"))!!
        for (url in listOf("https://127.0.0.1/seg.ts", "https://192.168.1.2/seg.ts", "https://[::1]/seg.ts", "https://localhost/subs.vtt")) {
            assertTrue(auth.headersFor(url).isEmpty())
        }
    }

    @Test fun publicLiteralMediaAndCaptionsRetainTheirNarrowAuthorization() {
        for (host in listOf("8.8.8.8", "1.1.1.1", "[2001:4860:4860::8888]", "[2606:4700:4700::1111]")) {
            val root = "https://$host/video/episode.mp4?token=one"
            val auth = ScopedRequestAuthorization.create(root, StreamAuthorizationScope.EXACT, headers,
                listOf("https://$host/subtitles/en.vtt", "https://9.9.9.9/en.vtt"))!!
            assertEquals(headers, auth.headersFor(root))
            assertEquals(headers, auth.headersFor("https://$host/subtitles/en.vtt"))
            assertEquals(mapOf("Referer" to "https://mkissa.to/"), auth.headersFor("https://9.9.9.9/en.vtt"))
            assertTrue(auth.headersFor("https://$host/video/episode.mp4?token=two").isEmpty())
            assertTrue(auth.headersFor("https://9.9.9.9/sibling.vtt").isEmpty())
        }
    }

    @Test fun reservedAndAmbiguousLiteralsNeverReceiveCredentialsOrPublicHotlinkHeaders() {
        val rejectedHosts = listOf(
            "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.2", "172.16.0.1",
            "192.168.1.2", "192.0.0.8", "192.0.2.1", "192.88.99.1", "198.18.0.1",
            "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
            "127.1", "2130706433", "0177.0.0.1", "0x7f000001", "[::]", "[::1]",
            "[fc00::1]", "[fe80::1]", "[ff02::1]", "[::ffff:127.0.0.1]",
            "[64:ff9b::a00:1]", "[2001::1]", "[2001:db8::1]", "[2002:a00:1::1]", "[3fff::1]",
        )
        val auth = ScopedRequestAuthorization.create("https://video.example/master.m3u8", StreamAuthorizationScope.PUBLIC_HLS,
            mapOf("Referer" to "https://player.example/"), rejectedHosts.map { "https://$it/subs.vtt" })!!
        for (host in rejectedHosts) {
            assertTrue("Root must reject $host", ScopedRequestAuthorization.create("https://$host/episode.mp4", StreamAuthorizationScope.EXACT, headers) == null)
            assertTrue("Media must reject $host", auth.headersFor("https://$host/segment.ts").isEmpty())
            assertTrue("Caption must reject $host", auth.headersFor("https://$host/subs.vtt").isEmpty())
        }
    }

    @Test
    fun exactScopeDoesNotAuthorizeSiblingMedia() {
        val authorization = ScopedRequestAuthorization.create(
            "https://video.example/media/episode.mp4?token=one#ignored",
            StreamAuthorizationScope.EXACT,
            headers,
        )!!

        assertEquals(headers, authorization.headersFor("https://video.example/media/episode.mp4?token=one"))
        assertTrue(authorization.headersFor("https://video.example/media/episode.mp4?token=two").isEmpty())
        assertTrue(authorization.headersFor("https://video.example/media/other.mp4?token=one").isEmpty())
    }

    @Test
    fun directoryScopeCoversSegmentsButNotOtherOriginsOrPaths() {
        val authorization = ScopedRequestAuthorization.create(
            "https://cdn.example/show/720/index.m3u8?token=one",
            StreamAuthorizationScope.DIRECTORY,
            headers,
        )!!

        assertEquals(headers, authorization.headersFor("https://cdn.example/show/720/segment-2.ts"))
        assertTrue(authorization.headersFor("https://cdn.example/show/1080/segment-2.ts").isEmpty())
        assertTrue(authorization.headersFor("https://subtitles.example/show/720/sub.vtt").isEmpty())
        assertTrue(authorization.headersFor("http://cdn.example/show/720/segment-2.ts").isEmpty())
        assertTrue(authorization.headersFor("https://cdn.example/show/720/../secret.key").isEmpty())
    }

    @Test
    fun publicHlsScopeFollowsRotatingMediaHostWithoutAllowingSecrets() {
        val publicHeaders = mapOf(
            "Referer" to "https://player.example/",
            "Origin" to "https://player.example",
        )
        val authorization = ScopedRequestAuthorization.create(
            "https://manifest.example/show/master.m3u8",
            StreamAuthorizationScope.PUBLIC_HLS,
            publicHeaders,
        )!!

        assertEquals(publicHeaders, authorization.headersFor("https://rotating.example/media/segment-1.jpg"))
        assertEquals(publicHeaders, authorization.headersFor("https://rotating.example/media/variant.m3u8"))
        assertEquals(publicHeaders, authorization.headersFor("https://rotating.example/media/seg-2-f1-v1-a1.html"))
        // Oct 2026 naming: variant first, disguised extensions (the 403 when unmatched).
        for (name in listOf("seg-f1-00273.html", "seg-f3-00335.ico", "seg-f2-00338.js", "seg-f1-00342.webp")) {
            assertEquals(name, publicHeaders, authorization.headersFor("https://7o819.rotating.example/$name"))
        }
        assertTrue(authorization.headersFor("https://rotating.example/media/seg-f1-page.html").isEmpty())
        assertTrue(authorization.headersFor("https://rotating.example/media/page.html").isEmpty())
        assertTrue(authorization.headersFor("http://rotating.example/media/segment-1.jpg").isEmpty())
        assertTrue(
            ScopedRequestAuthorization.create(
                "https://manifest.example/show/master.m3u8",
                StreamAuthorizationScope.PUBLIC_HLS,
                publicHeaders + ("Cookie" to "secret=1"),
            ) == null,
        )
    }
}
