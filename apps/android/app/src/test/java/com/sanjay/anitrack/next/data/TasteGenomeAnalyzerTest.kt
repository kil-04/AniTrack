package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TasteGenomeAnalyzerTest {
    private val entries = listOf(
        TasteGenomeInput("completed", 10.0, 1988, listOf("Sci-Fi", "Drama"), "OVA"),
        TasteGenomeInput("completed", 9.0, 1985, listOf("Sci-Fi", "Mecha"), "TV"),
        TasteGenomeInput("watching", 8.0, 1997, listOf("Drama"), "TV"),
        TasteGenomeInput("completed", 6.0, 2022, listOf("Comedy"), "ONA"),
        TasteGenomeInput("plan_to_watch", 10.0, 2024, listOf("Fantasy"), "TV"),
    )

    @Test fun buildsGenomeOnlyFromExperiencedTitles() {
        val genome = TasteGenomeAnalyzer.analyze(entries)
        assertEquals(4, genome.analyzed)
        assertEquals("1980s", genome.eras.first().label)
        assertEquals("Sci-Fi", genome.genres.first().label)
        assertTrue(genome.archetype.contains("1980s Sci-Fi Archivist"))
        assertEquals(75, genome.classicShare)
    }

    @Test fun returnsHonestEmptyProfile() {
        val genome = TasteGenomeAnalyzer.analyze(listOf(TasteGenomeInput("plan_to_watch", null, 1980, listOf("Mecha"), "TV")))
        assertEquals(0, genome.analyzed)
        assertEquals(0, genome.confidence)
        assertEquals("Uncharted Viewer", genome.archetype)
    }
}
