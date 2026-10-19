package com.sanjay.anitrack.next.data.manga

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MangaSourcesTest {
    /** Loading the registry initializes every source object (catches init-order cycles). */
    @Test fun registersExistingSourcesThenXComic() {
        assertEquals(listOf("mangadot", "mangaball", "xcomic", "toonkotsu"), MangaSources.all.map { it.id })
        assertEquals("mangaball", MangaSources.byId("mangaball")?.id)
        assertEquals("xcomic", MangaSources.byId("xcomic")?.id)
        // Removed at the user's request (Comix, 19 Oct 2026) or never registered.
        assertEquals(null, MangaSources.byId("comix"))
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
