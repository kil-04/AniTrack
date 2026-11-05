package com.sanjay.anitrack.next.data

import java.time.Instant
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** Mirrors tests/year-review.test.mjs so both apps recap a year alike. */
class YearReviewTest {
    private val utc = ZoneOffset.UTC
    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()
    private fun ep(id: Int, episode: Int, iso: String, position: Double = 1400.0, updatedAt: Long = at(iso)) = RecapWatch(
        animeId = id, episode = episode.toFloat(), positionSec = position, durationSec = 1440.0, updatedAt = updatedAt,
        title = when (id) { 1 -> "Frieren"; 2 -> "Dandadan"; else -> "Show $id" },
        genres = if (id == 1) listOf("Adventure", "Fantasy") else listOf("Action", "Comedy"),
    )

    @Test fun countsOnlyEpisodesWatchedThroughInTheYear() {
        val watches = listOf(
            ep(1, 1, "2025-01-03T20:00:00Z"),
            ep(1, 2, "2025-01-04T20:00:00Z"),
            ep(1, 3, "2025-01-05T20:00:00Z"),
            ep(2, 1, "2025-03-10T23:30:00Z", position = 300.0),
            ep(2, 2, "2024-12-31T20:00:00Z"),
        )
        val recap = YearReview.build(2025, watches, emptyList(), utc)
        assertEquals(3, recap.episodes)
        assertEquals(1, recap.shows)
        assertEquals("Frieren", recap.topShows.first().title)
        assertEquals(3, recap.topShows.first().count)
        assertEquals(Math.round((1400.0 * 3 + 300) / 60).toInt(), recap.minutes)
        assertEquals(3, recap.longestStreak)
        assertEquals(4, recap.activeDays)
        assertEquals(0, recap.busiestMonth)
        assertEquals(TimeOfDay.EVENING, recap.timeOfDay)
        assertEquals(listOf("Adventure", "Fantasy"), recap.topGenres.map { it.label })
        assertEquals("Frieren", recap.firstShow?.title)
        assertEquals(3, recap.biggestDay?.day)
    }

    @Test fun bulkMarkedRowsAreNotReadingOrWatching() {
        val base = at("2025-06-01T12:00:00Z")
        val marked = (0 until 40).map { RecapRead("manga", "77", "${it + 1}", 1.0, base + it, "Berserk") }
        val read = listOf(
            RecapRead("manga", "77", "41", 1.0, at("2025-06-02T22:00:00Z"), "Berserk"),
            RecapRead("manga", "77", "42", 0.2, at("2025-06-02T22:20:00Z"), "Berserk"),
            RecapRead("novel", "ln:1", "a", 0.9, at("2025-06-03T23:00:00Z"), "Mushoku Tensei"),
        )
        val bulkEpisodes = (0 until 12).map { ep(5, it + 1, "2025-06-01T10:00:00Z", updatedAt = base + it) }
        val recap = YearReview.build(2025, bulkEpisodes, marked + read, utc)
        assertEquals(1, recap.mangaChapters)
        assertEquals(1, recap.novelChapters)
        assertEquals(2, recap.titlesRead)
        assertEquals("Berserk", recap.topManga?.title)
        assertEquals(0, recap.episodes)
        assertEquals(0, recap.minutes)
        assertEquals(2, recap.monthChapters[5])
    }

    @Test fun anEmptyYearIsHonest() {
        val recap = YearReview.build(2023, listOf(ep(1, 1, "2025-01-01T10:00:00Z")), emptyList(), utc)
        assertFalse(recap.hasActivity)
        assertEquals(0, recap.episodes)
        assertNull(recap.busiestMonth)
        assertNull(recap.timeOfDay)
        assertEquals("A Quiet Year", recap.persona.title)
    }

    @Test fun personasFollowTheYearsShape() {
        val devotee = (1..20).map { ep(1, it, "2025-02-%02dT13:00:00Z".format(it)) }
        assertEquals("The Devotee", YearReview.build(2025, devotee, emptyList(), utc).persona.title)

        val owl = (0 until 10).map { ep(10 + it, 1, "2025-04-%02dT23:30:00Z".format(it * 2 + 1)) }
        val owlRecap = YearReview.build(2025, owl, emptyList(), utc)
        assertEquals(TimeOfDay.NIGHT, owlRecap.timeOfDay)
        assertEquals("The Night Owl", owlRecap.persona.title)

        val reader = (0 until 30).map { RecapRead("manga", "9", "$it", 1.0, at("2025-05-01T09:00:00Z") + it * 600_000L) }
        assertEquals("The Page Turner", YearReview.build(2025, listOf(ep(1, 1, "2025-05-02T09:00:00Z")), reader, utc).persona.title)
    }

    @Test fun yearsWithActivityNewestFirst() {
        val years = YearReview.years(
            listOf(ep(1, 1, "2024-05-01T00:00:00Z"), ep(1, 2, "2025-05-01T00:00:00Z")),
            listOf(RecapRead("novel", "x", "1", 1.0, at("2022-01-01T12:00:00Z"))),
            utc,
        )
        assertEquals(listOf(2025, 2024, 2022), years)
    }

    @Test fun watchTimeReadsAsMinutesThenHours() {
        assertEquals("45" to "minutes", YearReview.formatWatchTime(45))
        assertEquals("1,500" to "hours", YearReview.formatWatchTime(90_000))
    }
}
