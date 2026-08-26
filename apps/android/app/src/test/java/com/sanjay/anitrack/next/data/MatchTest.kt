package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MatchTest {
    @Test
    fun extractsCommonSeasonFormats() {
        assertEquals(4, Match.seasonNumber("Attack on Titan Season 4"))
        assertEquals(4, Match.seasonNumber("Classroom of the Elite IV"))
        assertEquals(2, Match.seasonNumber("Example 2nd Season"))
        assertEquals(3, Match.seasonNumber("Example Cour 3"))
        assertEquals(null, Match.seasonNumber("A title without a sequel"))
    }

    @Test
    fun prefersExactTitleAndMatchingYear() {
        val exact = Match.score(
            "Frieren: Beyond Journey's End", 2023, 28,
            "Frieren: Beyond Journey's End", 2023, 28, false,
        )
        val unrelatedYear = Match.score(
            "Frieren: Beyond Journey's End", 2018, 28,
            "Frieren: Beyond Journey's End", 2023, 28, false,
        )
        assertTrue(exact > 100)
        assertEquals(-100, unrelatedYear)
    }

    @Test
    fun heavilyPenalizesWrongSeason() {
        val correct = Match.score(
            "Classroom of the Elite Season 3", 2024, 13,
            "Classroom of the Elite Season 3", 2024, 13, false,
        )
        val wrong = Match.score(
            "Classroom of the Elite Season 2", 2022, 13,
            "Classroom of the Elite Season 3", 2024, 13, false,
        )
        assertTrue(correct - wrong >= 50)
    }

    @Test
    fun doesNotPenalizeAiringProviderForFewerEpisodes() {
        val caughtUp = Match.score(
            "Currently Airing", 2026, 12,
            "Currently Airing", 2026, 12, true,
        )
        val providerBehind = Match.score(
            "Currently Airing", 2026, 8,
            "Currently Airing", 2026, 12, true,
        )
        assertEquals(caughtUp, providerBehind)
    }
}
