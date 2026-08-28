package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Test

class RecommendationRankingTest {
    @Test
    fun `classic decades receive explicit boosts`() {
        assertEquals(2.5, RecommendationRanking.classicEraBoost(1975), 0.0)
        assertEquals(3.0, RecommendationRanking.classicEraBoost(1986), 0.0)
        assertEquals(2.5, RecommendationRanking.classicEraBoost(1999), 0.0)
        assertEquals(0.0, RecommendationRanking.classicEraBoost(2000), 0.0)
    }

    @Test
    fun `seed selection reserves each strong classic decade`() {
        val seeds = RecommendationRanking.selectSeedIds(
            listOf(
                RecommendationSeedCandidate(1, "completed", 10.0, year = 2022),
                RecommendationSeedCandidate(2, "completed", 8.0, year = 1978),
                RecommendationSeedCandidate(3, "completed", 9.0, year = 1988),
                RecommendationSeedCandidate(4, "watching", 8.0, year = 1995),
                RecommendationSeedCandidate(5, "completed", 9.0, year = 2018),
                RecommendationSeedCandidate(6, "dropped", 10.0, year = 1984),
            ),
            limit = 5,
        )
        assertEquals(listOf(2, 3, 4), seeds.take(3))
        assertEquals(setOf(1, 2, 3, 4, 5), seeds.toSet())
    }
}
