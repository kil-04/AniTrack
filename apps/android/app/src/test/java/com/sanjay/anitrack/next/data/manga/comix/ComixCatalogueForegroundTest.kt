package com.sanjay.anitrack.next.data.manga.comix

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class ComixCatalogueForegroundTest {
    @Test fun foregroundOwnerMayStartImmediately() = runBlocking {
        var calls = 0
        awaitComixForeground { calls++; true }
        assertEquals(1, calls)
    }

    @Test fun previousHostMayReturnFocus() = runBlocking {
        var calls = 0
        awaitComixForeground(2_000) { ++calls >= 2 }
        assertEquals(2, calls)
    }

    @Test fun backgroundOwnerFailsWithoutLaunchingAWindow() = runBlocking {
        var launched = false
        val failure = runCatching {
            awaitComixForeground(10) { false }
            launched = true
        }.exceptionOrNull()
        assertTrue(failure is IllegalStateException)
        assertEquals("Return to AniTrack and retry Comix.", failure?.message)
        assertFalse(launched)
    }

    @Test fun outerCancellationIsPreserved() = runBlocking {
        val result = withTimeoutOrNull(10) {
            awaitComixForeground(10_000) { false }
            true
        }
        assertNull(result)
    }
}
