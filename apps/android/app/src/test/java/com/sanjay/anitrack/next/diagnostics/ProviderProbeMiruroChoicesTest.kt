package com.sanjay.anitrack.next.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProviderProbeMiruroChoicesTest {
    @Test fun reportsOnlyTheOfferedKnownProviderServerAndTrackCoordinates() {
        assertEquals("ANIKOTO · HD-1 · Soft sub", ProviderProbeMiruroChoices.label("ssub:anikoto:HD-1:0"))
        assertEquals("ANIKOTO · HD-2 · Sub", ProviderProbeMiruroChoices.label("sub:anikoto:HD-2:0"))
        assertEquals("KICKASSANIME · Vid · Dub", ProviderProbeMiruroChoices.label("dub:kickassanime:Vid:2"))
        assertEquals("ANIWAVES · Vidplay · Sub", ProviderProbeMiruroChoices.label("sub:aniwaves:Vidplay:0"))
    }

    @Test fun arbitraryProviderServerTrackAndTokenValuesAreNeverReported() {
        for (id in listOf("ssub:private-provider:HD-1:0", "ssub:anikoto:private-token:0",
            "private-track:anikoto:HD-1:0", "ssub:anikoto:HD-1:private-token",
            "ssub:anikoto:HD-1:-1", "ssub:anikoto:HD-1:32", "ssub:anikoto:HD-1:0:extra",
            "ssub:anikoto:HD-1:0\nprivate", "x".repeat(201))) {
            assertNull(ProviderProbeMiruroChoices.label(id))
        }
    }
}
