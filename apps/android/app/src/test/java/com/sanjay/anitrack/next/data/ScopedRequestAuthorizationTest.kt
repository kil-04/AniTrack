package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScopedRequestAuthorizationTest {
    private val headers = mapOf("Cookie" to "episode=1", "Referer" to "https://mkissa.to/")

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
