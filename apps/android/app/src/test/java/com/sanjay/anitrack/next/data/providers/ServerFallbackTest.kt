package com.sanjay.anitrack.next.data.providers

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A failed server hands over to the next one in the same language, never Sub to Dub. */
class ServerFallbackTest {
    private val servers = listOf(
        ProviderStreamVariant("sub:0", "Sub · Primary", "sub"),
        ProviderStreamVariant("dub:0", "Dub · Primary", "dub"),
        ProviderStreamVariant("sub:1", "Sub · Anivexa fallback", "sub"),
        ProviderStreamVariant("sub:2", "Sub · Backup 2", "sub"),
    )

    @Test fun nextSubServerSkipsDub() {
        assertEquals("sub:1", nextSameLanguageVariant(servers, "sub:0", emptySet())?.id)
    }

    @Test fun wrapsAndSkipsFailedServers() {
        assertEquals("sub:0", nextSameLanguageVariant(servers, "sub:2", emptySet())?.id)
        assertEquals("sub:2", nextSameLanguageVariant(servers, "sub:0", setOf("sub:0", "sub:1"))?.id)
    }

    @Test fun noSubLeftNeverMeansDub() {
        assertNull(nextSameLanguageVariant(servers, "sub:0", setOf("sub:1", "sub:2")))
        assertNull(nextSameLanguageVariant(servers, "dub:0", emptySet()))
    }

    @Test fun unknownLanguageOrServerHasNoHandOver() {
        val unlabelled = listOf(ProviderStreamVariant("a", "A"), ProviderStreamVariant("b", "B"))
        assertNull(nextSameLanguageVariant(unlabelled, "a", emptySet()))
        assertNull(nextSameLanguageVariant(servers, "missing", emptySet()))
    }
}
