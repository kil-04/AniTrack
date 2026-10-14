package com.sanjay.anitrack.next.ui

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerRequestPolicyTest {
    @Test fun returningToLoadedPlayerDoesNotRestartPlayback() {
        assertTrue(canReusePlayerStream(0, null, "episode", "episode", 1))
    }

    @Test fun explicitRetryAlwaysResolvesFreshEvenWhenOldMediaRemainsLoaded() {
        assertFalse(canReusePlayerStream(1, null, "episode", "episode", 1))
        assertFalse(canReusePlayerStream(2, 0, "episode", "episode", 1))
    }

    @Test fun serverSwitchOrDifferentEpisodeNeverReusesOutgoingMedia() {
        assertFalse(canReusePlayerStream(0, 30_000, "episode", "episode", 1))
        assertFalse(canReusePlayerStream(0, null, "episode", "next", 1))
        assertFalse(canReusePlayerStream(0, null, "episode", "episode", 0))
    }
}
