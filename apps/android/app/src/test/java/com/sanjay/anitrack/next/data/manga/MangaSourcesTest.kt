package com.sanjay.anitrack.next.data.manga

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MangaSourcesTest {
    /** Loading the registry initializes every source object (catches init-order cycles). */
    @Test fun registersOnlyMangaDotForNow() {
        assertEquals(listOf("mangadot"), MangaSources.all.map { it.id })
        assertEquals("mangadot", MangaSources.byId("mangadot")?.id)
        assertEquals(null, MangaSources.byId("mangapill"))
    }

    @Test fun identifiesHonestlyWithoutABrowserUserAgent() {
        assertTrue(MangaHttp.USER_AGENT.startsWith("AniTrack/"))
        assertTrue("Mozilla" !in MangaHttp.USER_AGENT)
    }
}
