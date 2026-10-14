package com.sanjay.anitrack.next.data.manga.comix

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class ComixCatalogueTimeoutTest {
    @Test fun completedReadKeepsItsValue() = runBlocking {
        assertEquals("catalogue", comixCatalogueDeadline { "catalogue" })
    }

    @Test fun ownDeadlineBecomesCatalogueFailure() = runBlocking {
        val failure = runCatching {
            comixCatalogueDeadline(10) { awaitCancellation() }
        }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertEquals("Comix catalogue timed out. Retry manually.", failure?.message)
    }

    @Test fun enclosingChapterDeadlineIsNotMisreportedAsCatalogueTimeout() = runBlocking {
        val result = withTimeoutOrNull(10) {
            comixCatalogueDeadline(10_000) { awaitCancellation() }
        }
        assertNull(result)
    }

    @Test fun leavingReaderCancelsTheRequestInsteadOfShowingAnError() = runBlocking {
        val started = CompletableDeferred<Unit>()
        var reported = false
        val request = launch {
            try {
                comixCatalogueDeadline {
                    started.complete(Unit)
                    awaitCancellation()
                }
            } catch (e: CancellationException) { throw e }
            catch (_: Exception) { reported = true }
        }
        started.await()
        request.cancelAndJoin()
        assertFalse(reported)
        assertTrue(request.isCancelled)
    }
}
