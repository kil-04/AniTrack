package com.sanjay.anitrack.next.data.providers.connectors.miruro

import org.junit.Assert.*
import org.junit.Test

class MiruroRequestPolicyTest {
    @Test fun unverifiedRequestsDoNotContainSessionHeaders() {
        val request = MiruroRequestPolicy.request(MiruroProtocol.requestUrl(MiruroReadRequest.Config))
        assertNull(request.header("Cookie"))
        assertNull(request.header("User-Agent"))
    }

    @Test fun sessionAccessIsScopedBeforeTheCallbackIsInvoked() {
        var accesses = 0
        listOf("https://evil.example/api/secure/pipe", "http://www.miruro.ru/api/secure/pipe",
            "https://www.miruro.ru:444/env2.js", "https://user@www.miruro.ru/env2.js",
            "https://www.miruro.ru/watch/1", "https://www.miruro.ru/api/other")
            .forEach { url ->
                assertThrows(MiruroProtocolException::class.java) {
                    MiruroRequestPolicy.request(url) { accesses++; MiruroRequestSession("test", "test=dummy") }
                }
            }
        assertEquals(0, accesses)
    }

    @Test fun onlyTheSuppliedSameSessionHeadersAreAttached() {
        val session = MiruroRequestSession("Actual WebView test identity", "test=dummy")
        val request = MiruroRequestPolicy.request("${MiruroProtocol.ORIGIN}/env2.js") { session }
        assertEquals("Actual WebView test identity", request.header("User-Agent"))
        assertEquals("test=dummy", request.header("Cookie"))
        assertNull(request.header("Authorization"))
        assertNull(request.header("Sec-CH-UA"))
        assertFalse(session.toString().contains("dummy"))
    }

    @Test fun sessionHeadersRejectInjectionAndOversizedValues() {
        listOf(MiruroRequestSession("test\r\nX-Test: bad", null),
            MiruroRequestSession("test", "test=a\nX-Test: bad"),
            MiruroRequestSession("a".repeat(1025), null),
            MiruroRequestSession("test", "a".repeat(32_769)))
            .forEach { session -> assertThrows(MiruroProtocolException::class.java) {
                MiruroRequestPolicy.request("${MiruroProtocol.ORIGIN}/env2.js") { session }
            } }
    }
}
