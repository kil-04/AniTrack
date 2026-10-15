package com.sanjay.anitrack.next.data

import org.junit.Assert.*
import org.junit.Test

class PaheEpisodePagesTest {
    @Test fun aLongContiguousShowIsNumberedFromItsFirstAndLastEpisode() {
        val numbers = PaheEpisodePages.contiguousNumbers(1f, 1180f, 1180)!!
        assertEquals(1180, numbers.size)
        assertEquals(1, numbers.first())
        assertEquals(1180, numbers.last())
    }

    @Test fun gapsSpecialsOrAMismatchedTotalFallBack() {
        // A missing episode or an extra .5 special makes the total disagree.
        assertNull(PaheEpisodePages.contiguousNumbers(1f, 1180f, 1179))
        assertNull(PaheEpisodePages.contiguousNumbers(1f, 1180f, 1181))
        assertNull(PaheEpisodePages.contiguousNumbers(1f, 12.5f, 13))
        assertNull(PaheEpisodePages.contiguousNumbers(0.5f, 12f, 12))
        assertNull(PaheEpisodePages.contiguousNumbers(12f, 1f, 12))
        // A sequel season numbered on from its first season is still contiguous.
        assertEquals((25..48).toList(), PaheEpisodePages.contiguousNumbers(25f, 48f, 24))
    }

    @Test fun anEpisodeIsFoundOnItsPage() {
        assertEquals(1, PaheEpisodePages.pageOf(1, 1, 30))
        assertEquals(1, PaheEpisodePages.pageOf(30, 1, 30))
        assertEquals(2, PaheEpisodePages.pageOf(31, 1, 30))
        assertEquals(37, PaheEpisodePages.pageOf(1100, 1, 30))
        assertEquals(40, PaheEpisodePages.pageOf(1180, 1, 30))
        // Numbering that starts later counts from the show's own first episode.
        assertEquals(1, PaheEpisodePages.pageOf(54, 25, 30))
        assertEquals(2, PaheEpisodePages.pageOf(55, 25, 30))
    }
}
