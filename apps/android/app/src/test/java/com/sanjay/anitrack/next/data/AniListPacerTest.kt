package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** Same cases as desktop's tests/anilist-pacing.test.mjs. */
class AniListPacerTest {
    private var t = 1_000_000L
    private fun pacer() = AniListPacer { t }

    @Test
    fun burstThenHoldsThe31stStartForTheWindow() {
        val pacer = pacer()
        repeat(30) {
            assertEquals(0L, pacer.waitMs())
            pacer.noteStart()
            t += 100
        }
        // The first start was 3 s ago, so a slot frees 57 s from now.
        assertEquals(57_000L, pacer.waitMs())
        t += 57_000
        assertEquals(0L, pacer.waitMs())
    }

    @Test
    fun followsTheServersOwnLimitHeader() {
        val pacer = pacer()
        pacer.noteReply(200, AniListRateHeaders(limit = "90", remaining = "89"))
        repeat(60) { pacer.noteStart() }
        assertEquals(0L, pacer.waitMs())
    }

    @Test
    fun a429PausesForRetryAfterBoundedToTheWindow() {
        val pacer = pacer()
        pacer.noteReply(429, AniListRateHeaders(retryAfter = "42"))
        assertEquals(42_000L, pacer.waitMs())
        val long = pacer()
        long.noteReply(429, AniListRateHeaders(retryAfter = "3600"))
        assertEquals(AniListPacer.MAX_COOLDOWN_MS, long.waitMs())
    }

    @Test
    fun a429WithoutRetryAfterWaitsForResetElseAFullWindow() {
        t = 1_700_000_000_000L
        val pacer = pacer()
        pacer.noteReply(429, AniListRateHeaders(reset = (1_700_000_000L + 20).toString()))
        assertEquals(20_000L, pacer.waitMs())
        val bare = pacer()
        bare.noteReply(429, AniListRateHeaders())
        assertEquals(60_000L, bare.waitMs())
    }

    @Test
    fun aSpentBudgetPausesBeforeTheNextRequest() {
        val pacer = pacer()
        pacer.noteStart()
        t += 10_000
        pacer.noteReply(200, AniListRateHeaders(remaining = "0"))
        // No reset header: the oldest start ages out of the window in 50 s.
        assertEquals(50_000L, pacer.waitMs())
        val healthy = pacer()
        healthy.noteReply(200, AniListRateHeaders(remaining = "12"))
        healthy.noteReply(200, AniListRateHeaders(remaining = ""))
        assertEquals(0L, healthy.waitMs())
    }
}
