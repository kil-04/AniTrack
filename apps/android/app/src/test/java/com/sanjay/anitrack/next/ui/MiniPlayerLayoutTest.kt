package com.sanjay.anitrack.next.ui

import androidx.media3.common.C
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MiniPlayerLayoutTest {
    @Test fun phonesDockTheMiniPlayerUnderThePage() {
        assertTrue(miniPlayerDocked(360))
        assertTrue(miniPlayerDocked(384)) // Galaxy A54 held upright
        assertTrue(miniPlayerDocked(599))
    }

    @Test fun tabletsAndWideLayoutsKeepTheFloatingMiniPlayer() {
        assertFalse(miniPlayerDocked(600))
        assertFalse(miniPlayerDocked(700)) // portrait tablet: bottom tabs, floating mini player
        assertFalse(miniPlayerDocked(832)) // a phone turned sideways gets the wide layout
        assertFalse(miniPlayerDocked(1280))
    }

    @Test fun progressWaitsForTheDuration() {
        assertEquals(0f, miniPlayerProgress(12_000, C.TIME_UNSET), 0f)
        assertEquals(0f, miniPlayerProgress(12_000, 0), 0f)
    }

    @Test fun progressIsTheShareOfTheEpisodePlayed() {
        assertEquals(0.5f, miniPlayerProgress(720_000, 1_440_000), 1e-6f)
        assertEquals(1f, miniPlayerProgress(1_500_000, 1_440_000), 0f)
        assertEquals(0f, miniPlayerProgress(-1, 1_440_000), 0f)
    }
}
