package com.sanjay.anitrack.next.data.manga

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MangaSourcesTest {
    /** Loading the registry initializes every source object (catches init-order cycles). */
    @Test fun registersExistingSourcesThenComix() {
        assertEquals(listOf("mangadot", "mangaball", "comix"), MangaSources.all.map { it.id })
        assertEquals("mangaball", MangaSources.byId("mangaball")?.id)
        assertEquals("comix", MangaSources.byId("comix")?.id)
        assertEquals(null, MangaSources.byId("mangapill"))
    }

    @Test fun identifiesHonestlyWithoutABrowserUserAgent() {
        assertTrue(MangaHttp.USER_AGENT.startsWith("AniTrack/"))
        assertTrue("Mozilla" !in MangaHttp.USER_AGENT)
    }

    /** MangaBall answers 400 "Missing title_id" when the JSON type carries a charset. */
    @Test fun postsJsonTypedExactlyApplicationJson() {
        val body = MangaHttp.jsonBody("""{"title_id":"68515540702284f8341784c8","lang":"en"}""")
        assertEquals("application/json", body.contentType().toString())
        val sent = okio.Buffer().also { body.writeTo(it) }.readUtf8()
        assertEquals("""{"title_id":"68515540702284f8341784c8","lang":"en"}""", sent)
    }
}
