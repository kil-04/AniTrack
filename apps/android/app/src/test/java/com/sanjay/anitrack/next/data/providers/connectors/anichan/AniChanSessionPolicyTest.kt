package com.sanjay.anitrack.next.data.providers.connectors.anichan

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.junit.Assert.*
import org.junit.Test

class AniChanSessionPolicyTest {
    @Test fun cancelledReadFinishesOnlyItsAbortBeforeQueuedSuccessorRuns() = runBlocking {
        val mutex = Mutex()
        val started = CompletableDeferred<Unit>()
        val events = mutableListOf<String>()
        val first = launch {
            mutex.withLock {
                try {
                    started.complete(Unit)
                    CompletableDeferred<Unit>().await()
                } finally {
                    AniChanSessionPolicy.finishRequest {
                        delay(10) // This must still finish while the original caller is cancelled.
                        events += "abort:first-request"
                    }
                }
            }
        }
        started.await()
        val next = launch { mutex.withLock { events += "start:second-request" } }
        first.cancel()
        first.join()
        next.join()
        assertEquals(listOf("abort:first-request", "start:second-request"), events)
    }

    @Test fun ownedTimeoutIsAnOrdinaryFailureSoLoadingStateCanFinish() = runBlocking {
        try {
            AniChanSessionPolicy.timed(20, "source timeout") { CompletableDeferred<Unit>().await() }
            fail("Pending request must time out")
        } catch (failure: AniChanException) {
            assertEquals("source timeout", failure.message)
        }
        Unit
    }

    @Test fun outsideCancellationStillCancelsTheOperation() = runBlocking {
        try {
            withTimeout(20) { AniChanSessionPolicy.timed(10_000, "source timeout") { CompletableDeferred<Unit>().await() } }
            fail("External cancellation must propagate")
        } catch (_: CancellationException) { }
        assertEquals("ready", AniChanSessionPolicy.timed(1_000, "source timeout") { "ready" })
    }

    @Test fun sourceRetryAfterIsBoundedAndNeverShortenedByFractionTruncation() {
        assertEquals(60L, AniChanSessionPolicy.retryAfterSeconds(null))
        assertEquals(60L, AniChanSessionPolicy.retryAfterSeconds("300"))
        assertEquals(60L, AniChanSessionPolicy.retryAfterSeconds(Double.NaN))
        assertEquals(1L, AniChanSessionPolicy.retryAfterSeconds(0))
        assertEquals(2L, AniChanSessionPolicy.retryAfterSeconds(1.5))
        assertEquals(180L, AniChanSessionPolicy.retryAfterSeconds(180))
        assertEquals(300L, AniChanSessionPolicy.retryAfterSeconds(999))
    }
}
