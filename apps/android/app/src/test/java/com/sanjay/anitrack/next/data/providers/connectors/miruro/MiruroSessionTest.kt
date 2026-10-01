package com.sanjay.anitrack.next.data.providers.connectors.miruro

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class MiruroSessionTest {
    @Test fun noRequestsBeforeExplicitAcceptanceOrAfterDisconnect() = runBlocking {
        var calls = 0
        val session = MiruroSession()
        suspend fun denied() {
            try { session.read(MiruroReadRequest.Config); fail("Must require connection") }
            catch (_: MiruroProtocolException) { }
        }
        denied()
        session.begin()
        denied()
        session.accept(MiruroTransport { _, _ -> calls++; MiruroHttpResponse(200, "{}") }, "test identity")
        session.read(MiruroReadRequest.Config)
        assertTrue(session.state.value.ready)
        assertEquals("test identity", session.userAgent)
        session.clear()
        denied()
        assertEquals(1, calls)
        assertEquals("AniTrack", session.userAgent)
    }

    @Test fun idleExpiryPreventsNewNetworkRequest() = runBlocking {
        var time = 1L
        var calls = 0
        val session = MiruroSession(now = { time })
        session.begin()
        session.accept(MiruroTransport { _, _ -> calls++; MiruroHttpResponse(200, "{}") }, "test")
        time += 30 * 60_000
        try { session.read(MiruroReadRequest.Config); fail("Expired session must fail") }
        catch (_: MiruroProtocolException) { }
        assertFalse(session.state.value.ready)
        assertEquals(0, calls)
    }

    @Test fun apiRejectionClosesSessionButAllowsImmediateManualReconnection() = runBlocking {
        listOf(403, 429).forEach { status ->
            var calls = 0
            val session = MiruroSession(now = { 1L })
            session.begin()
            session.accept(MiruroTransport { _, _ -> calls++; MiruroHttpResponse(status, "") }, "test")
            try { session.read(MiruroReadRequest.Config); fail("Rejection must stop") }
            catch (error: MiruroProtocolException) {
                assertEquals(if (status == 403) MiruroFailure.SECURITY_CHECK else MiruroFailure.RATE_LIMITED, error.failure)
            }
            assertFalse(session.state.value.ready)
            assertEquals(1, calls)
            session.begin()
            assertTrue(session.state.value.verifying)
            session.accept(MiruroTransport { _, _ -> calls++; MiruroHttpResponse(200, "{}") }, "test")
            session.read(MiruroReadRequest.Config)
            assertTrue(session.state.value.ready)
            assertEquals(2, calls)
        }
    }

    @Test fun staleResponseCannotReviveDisconnectedSession() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val session = MiruroSession()
        session.begin()
        session.accept(MiruroTransport { _, _ -> started.complete(Unit); release.await(); MiruroHttpResponse(200, "{}") }, "test")
        val read = async {
            try { session.read(MiruroReadRequest.Config); false }
            catch (_: MiruroProtocolException) { true }
        }
        started.await()
        session.clear()
        release.complete(Unit)
        assertTrue(read.await())
        assertFalse(session.state.value.ready)
    }

    @Test fun queuedReadDoesNotReachClosedTransport() = runBlocking {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var calls = 0
        val session = MiruroSession()
        session.begin()
        session.accept(MiruroTransport { _, _ -> calls++; started.complete(Unit); release.await(); MiruroHttpResponse(200, "{}") }, "test")
        val reads = List(2) { async {
            try { session.read(MiruroReadRequest.Config) } catch (_: MiruroProtocolException) { }
        } }
        started.await()
        session.clear()
        release.complete(Unit)
        reads.forEach { it.await() }
        assertEquals(1, calls)
    }

    @Test fun playbackRejectionKeepsCatalogueAvailableForManualServerSwitch() = runBlocking {
        var calls = 0
        val session = MiruroSession(now = { 1L })
        session.begin()
        session.accept(MiruroTransport { _, _ -> calls++; MiruroHttpResponse(200, "{}") }, "test")
        val generation = session.state.value.generation
        listOf(403, 429).forEach { status ->
            session.playbackRejected(status)
            assertTrue(session.state.value.ready)
            assertEquals(generation, session.state.value.generation)
            session.read(MiruroReadRequest.Config)
        }
        assertEquals(2, calls)
    }
}
