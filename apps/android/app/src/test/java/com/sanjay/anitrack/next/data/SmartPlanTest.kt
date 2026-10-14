package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.manga.ReadState
import org.junit.Assert.assertEquals
import org.junit.Test

class SmartPlanTest {
    private val twelve = (1..12).map { it.toFloat() }

    @Test fun keepsTheUnfinishedEpisodeAndTheOneAfterIt() {
        // Episode 4 stopped halfway: it and episode 5.
        assertEquals(listOf(4f, 5f), SmartPlan.nextEpisodes(twelve, 4f, mapOf(3f to 100, 4f to 40), 2))
    }

    @Test fun startsAfterAFinishedEpisodeAndSkipsWatchedOnes() {
        // Episode 4 done, 5 already seen elsewhere: 6, 7 and 8.
        assertEquals(listOf(6f, 7f, 8f), SmartPlan.nextEpisodes(twelve, 4f, mapOf(4f to 95, 5f to 90), 3))
    }

    @Test fun nothingAfterTheLatestAiredEpisode() {
        assertEquals(emptyList<Float>(), SmartPlan.nextEpisodes(twelve, 12f, mapOf(12f to 100), 2))
        // History beyond what the source lists (a different numbering) waits for new episodes.
        assertEquals(emptyList<Float>(), SmartPlan.nextEpisodes(twelve, 30f, mapOf(30f to 100), 2))
    }

    @Test fun noHistoryMeansNoPlan() {
        assertEquals(emptyList<Float>(), SmartPlan.nextEpisodes(twelve, null, emptyMap(), 2))
    }

    @Test fun chaptersContinueFromTheOneReadLast() {
        val chapters = (1..20).map { it.toFloat() } + 10.5f
        // Chapter 10 half read most recently.
        assertEquals(
            listOf(10f, 10.5f, 11f),
            SmartPlan.nextChapters(chapters, mapOf(9f to ReadState(19, 20, 1), 10f to ReadState(5, 20, 2)), 3),
        )
        // Chapter 10 finished most recently, 11 marked read earlier.
        assertEquals(
            listOf(10.5f, 12f),
            SmartPlan.nextChapters(chapters, mapOf(11f to ReadState(19, 20, 1), 10f to ReadState(19, 20, 2)), 2),
        )
        assertEquals(emptyList<Float>(), SmartPlan.nextChapters(chapters, emptyMap(), 3))
    }
}
