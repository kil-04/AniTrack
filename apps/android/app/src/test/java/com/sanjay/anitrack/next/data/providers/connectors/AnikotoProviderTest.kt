package com.sanjay.anitrack.next.data.providers.connectors

import org.junit.Assert.assertEquals
import org.junit.Test

class AnikotoProviderTest {
    @Test
    fun playbackHeadersMatchRotatingPlayerOrigin() {
        val headers = AnikotoProvider.playbackHeaders("https://player.example/")

        assertEquals("https://player.example/", headers["Referer"])
        assertEquals("https://player.example", headers["Origin"])
    }
}
