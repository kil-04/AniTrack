package com.sanjay.anitrack.next.data.providers.connectors.anikoto

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AnikotoPolicyTest {
    @Test fun securityAndRateErrorsStopRequestsForOneMinute() {
        for ((status, code) in listOf(403 to AnikotoAccessError.Code.SECURITY_CHECK, 429 to AnikotoAccessError.Code.RATE_LIMITED)) {
            var now = 1000L
            val policy = AnikotoRequestPolicy { now }
            assertEquals(code, assertThrows(AnikotoAccessError::class.java) {
                policy.checkResponse("https://provider.example", status)
            }.code)
            assertEquals(AnikotoAccessError.Code.COOLDOWN, assertThrows(AnikotoAccessError::class.java) {
                policy.beforeRequest("https://provider.example")
            }.code)
            now += 60_000L
            policy.beforeRequest("https://provider.example")
        }
    }

    @Test fun successfulHttpChallengesAreNotParsedAsEmptyCatalogues() {
        for (body in listOf("<title>Just a moment...</title>", "<div id='challenge-form'>Check</div>", """{"code":"CAPTCHA_REQUIRED"}""")) {
            assertThrows(AnikotoAccessError::class.java) { AnikotoRequestPolicy().checkResponse("https://site.example", 200, body) }
        }
        AnikotoRequestPolicy().checkResponse("https://site.example", 200, "<a>Security Check</a><script src='/cdn-cgi/challenge-platform/loader.js'></script>")
        AnikotoRequestPolicy().checkResponse("https://site.example", 404, "Not found")
    }

    @Test fun subtitleChoiceDoesNotFallBackToDubOrTheOtherType() {
        val hard = AnikotoServerPolicy.Group("H-SUB", listOf("hard"))
        val soft = AnikotoServerPolicy.Group("SUB", listOf("soft"))
        val dub = AnikotoServerPolicy.Group("DUB", listOf("dub"))
        assertEquals(soft, AnikotoServerPolicy.select(listOf(hard, soft, dub), false))
        assertEquals(hard, AnikotoServerPolicy.select(listOf(soft, hard, dub), true))
        assertThrows(IllegalStateException::class.java) { AnikotoServerPolicy.select(listOf(hard, dub), false) }
        assertThrows(IllegalStateException::class.java) { AnikotoServerPolicy.select(listOf(soft, dub), true) }
        assertThrows(IllegalStateException::class.java) { AnikotoServerPolicy.select(listOf(soft.copy(ids = emptyList()), dub), false) }
        for (label in listOf("H SUB", "HSUB", "HARDSUB", "HARD SUB")) assertTrue(AnikotoServerPolicy.isHard(label))
    }

    @Test fun ordinaryServerFailureCanUseNextAdvertisedServer() = runBlocking {
        val calls = mutableListOf<String>()
        val result = AnikotoServerPolicy.resolve(listOf("dead", "working"), { _: String -> true }) { id ->
            calls += id
            if (id == "dead") error("Missing media") else "video"
        }
        assertEquals("video", result)
        assertEquals(listOf("dead", "working"), calls)
    }

    @Test fun rejectionAndCancellationNeverRotateToAnotherServer() = runBlocking {
        for (error in listOf(AnikotoAccessError(AnikotoAccessError.Code.SECURITY_CHECK), AnikotoAccessError(AnikotoAccessError.Code.RATE_LIMITED), CancellationException("Left player"))) {
            val calls = mutableListOf<String>()
            try {
                AnikotoServerPolicy.resolve(listOf("blocked", "unused"), { _: String -> true }) { id -> calls += id; throw error }
                fail("Terminal error was swallowed")
            } catch (caught: Exception) { assertSame(error, caught) }
            assertEquals(listOf("blocked"), calls)
        }
    }

    @Test fun captionPreferenceKeepsFallbackBoundedToFiveSameTypeServers() = runBlocking {
        val calls = mutableListOf<String>()
        val fallback = AnikotoServerPolicy.resolve((1..8).map(Int::toString), { _: String -> false }) { calls += it; it }
        assertEquals("1", fallback)
        assertEquals(listOf("1", "2", "3", "4", "5"), calls)
    }
}
