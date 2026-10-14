package com.sanjay.anitrack.next.diagnostics

import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroFailure
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroProtocolException
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaChallengeKind
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaProtocolException
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaRateLimitedException
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaUnsupportedSourceException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProviderProbeFailureSubtypeTest {
    private val privateMessage = "https://media.example/video?token=private-fixture CAPTCHA RATE_LIMIT body=private"

    @Test fun mkissaDistinguishesReviewedChallengeEnumsWithoutReadingTheMessage() {
        assertEquals("CAPTCHA_REQUIRED", ProviderProbeFailureSubtype.classify(
            MkissaRateLimitedException(MkissaChallengeKind.CAPTCHA, privateMessage)))
        assertEquals("RATE_LIMIT", ProviderProbeFailureSubtype.classify(
            MkissaRateLimitedException(MkissaChallengeKind.RATE_LIMIT, privateMessage)))
        assertEquals("RATE_LIMIT", ProviderProbeFailureSubtype.classify(MkissaRateLimitedException()))
        assertNull(ProviderProbeFailureSubtype.classify(IllegalStateException(privateMessage)))
    }

    @Test fun miruroReportsOnlyTheReviewedProtocolFailureEnum() {
        for (kind in MiruroFailure.entries) {
            assertEquals(kind.name, ProviderProbeFailureSubtype.classify(MiruroProtocolException(privateMessage, kind)))
        }
    }

    @Test fun boundedWrappersPreserveSecurityDenialsAndOrdinaryProtocolTypes() {
        val challenge = MkissaRateLimitedException(MkissaChallengeKind.CAPTCHA, privateMessage)
        assertEquals("CAPTCHA_REQUIRED", ProviderProbeFailureSubtype.classify(
            MkissaProtocolException(privateMessage, IllegalStateException(privateMessage, challenge))))
        assertEquals("INVALID_RESPONSE", ProviderProbeFailureSubtype.classify(MkissaProtocolException(privateMessage)))
        assertEquals("UNSUPPORTED_SOURCE", ProviderProbeFailureSubtype.classify(MkissaUnsupportedSourceException(privateMessage)))
    }

    @Test fun deepAndCyclicCauseChainsAreBoundedAndDoNotInspectExceptionText() {
        var deep: Throwable = MkissaRateLimitedException(MkissaChallengeKind.CAPTCHA, privateMessage)
        repeat(8) { deep = IllegalStateException(privateMessage, deep) }
        assertNull(ProviderProbeFailureSubtype.classify(deep))
        val first = IllegalStateException(privateMessage)
        val second = IllegalStateException(privateMessage, first)
        first.initCause(second)
        assertNull(ProviderProbeFailureSubtype.classify(first))
        val textMustNotBeRead = object : Exception() {
            override val message: String get() = error("Diagnostic must not inspect message")
            override fun toString(): String = error("Diagnostic must not stringify error")
        }
        assertNull(ProviderProbeFailureSubtype.classify(textMustNotBeRead))
    }
}
