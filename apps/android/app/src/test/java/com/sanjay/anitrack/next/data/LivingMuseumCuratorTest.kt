package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LivingMuseumCuratorTest {
    @Test
    fun buildsFactualLabelAndKeepsGenresUnique() {
        val anime = Anime(
            id = 820, malId = null, title = "Legend of the Galactic Heroes", titleRomaji = null,
            cover = null, banner = null, episodes = 110, status = "FINISHED", format = "OVA",
            year = 1988, score = 91, synopsis = null, genres = listOf("Drama", "Sci-Fi", "Drama"),
            duration = 26, popularity = 127000, studios = listOf("Artland"),
        )
        val exhibit = LivingMuseumCurator.build(anime)
        assertEquals("1988-OVA-820", exhibit.accession)
        assertEquals(listOf("Drama", "Sci-Fi"), exhibit.tags)
        assertTrue(exhibit.curatorLine.contains("1988 original video animation from Artland"))
        assertTrue(exhibit.facts.any { it.value == "110 × 26 min" })
    }

    @Test
    fun incompleteRecordsStayHonest() {
        val anime = Anime(7, null, "Unknown", null, null, null, null, null, null, null, null, null, emptyList())
        val exhibit = LivingMuseumCurator.build(anime)
        assertEquals("UNDATED-ANIM-7", exhibit.accession)
        assertEquals(1, exhibit.facts.size)
    }
}
