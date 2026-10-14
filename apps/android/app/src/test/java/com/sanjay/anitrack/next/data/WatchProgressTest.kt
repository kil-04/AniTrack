package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.WatchProgress.Entry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchProgressTest {
    @Test fun rewatchingACompletedShowLeavesItAlone() {
        assertNull(WatchProgress.after(Entry("completed", 26), 1, 26))
        assertNull(WatchProgress.after(Entry("completed", 25), 3, 26))
        assertNull(WatchProgress.after(Entry("completed", 12), 1, null))
    }

    @Test fun earlierEpisodesNeverLowerTheCount() {
        assertEquals(Entry("watching", 10), WatchProgress.after(Entry("watching", 10), 3, 12))
        assertEquals(Entry("watching", 10), WatchProgress.after(Entry("watching", 10), 10, 12))
    }

    @Test fun watchingProgressesAndTheLastEpisodeCompletes() {
        assertEquals(Entry("watching", 1), WatchProgress.after(null, 1, 12))
        assertEquals(Entry("watching", 1), WatchProgress.after(Entry("plan_to_watch", 0), 1, 12))
        assertEquals(Entry("watching", 5), WatchProgress.after(Entry("on_hold", 4), 5, 12))
        assertEquals(Entry("completed", 12), WatchProgress.after(Entry("watching", 11), 12, 12))
        // Unknown total (airing show): never completes on its own.
        assertEquals(Entry("watching", 41), WatchProgress.after(Entry("watching", 40), 41, null))
        assertEquals(Entry("watching", 41), WatchProgress.after(Entry("watching", 40), 41, 0))
    }

    @Test fun aDroppedShowStaysDropped() {
        assertEquals(Entry("dropped", 4), WatchProgress.after(Entry("dropped", 3), 4, 12))
    }
}
