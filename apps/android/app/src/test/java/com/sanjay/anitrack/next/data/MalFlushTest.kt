package com.sanjay.anitrack.next.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.UnknownHostException

class MalFlushTest {
    private val waits = mutableListOf<Long>()

    @Test fun offlineFlushWaitsAndTriesAgainInsteadOfClosingTheApp() = runBlocking {
        // A status changed with no internet: every upload fails until the tablet is back online.
        var attempts = 0
        flushUntilDelivered({ true }, {
            attempts++
            if (attempts <= 8) throw UnknownHostException("Unable to resolve host \"api.myanimelist.net\"")
            true
        }, wait = { waits += it })
        assertEquals(9, attempts)
        assertEquals(listOf(30_000L, 60_000L, 120_000L, 240_000L, 480_000L, 960_000L, 1_800_000L, 1_800_000L), waits)
    }

    @Test fun signingOutEndsTheRetries() = runBlocking {
        var signedIn = true
        var attempts = 0
        flushUntilDelivered({ signedIn }, {
            attempts++
            signedIn = false // MAL refused the sign-in during this attempt
            false
        }, wait = { waits += it })
        assertEquals(1, attempts)
        assertTrue(waits.isEmpty())
    }

    @Test fun cancellationIsNotMistakenForBeingOffline() = runBlocking {
        val failure = runCatching {
            flushUntilDelivered({ true }, { throw CancellationException("a newer flush replaced this one") }, wait = { waits += it })
        }.exceptionOrNull()
        assertTrue(failure is CancellationException)
        assertTrue(waits.isEmpty())
    }
}
