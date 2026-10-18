package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class TimeMachineArchiveTest {
    @Test fun mapsClassicYearsToTheirEra() {
        assertEquals("1970s", TimeMachineArchive.eraFor(1979).label)
        assertEquals("The age of impossible ambition", TimeMachineArchive.eraFor(1988).headline)
        assertEquals("1990s", TimeMachineArchive.eraFor(1995).label)
    }

    @Test fun clampsYearsToTheSupportedArchive() {
        assertEquals(1960, TimeMachineArchive.clampYear(1945, 2026))
        assertEquals(2026, TimeMachineArchive.clampYear(2032, 2026))
    }

    @Test fun describesPositionInsideTheDecade() {
        assertEquals("Early 1980s", TimeMachineArchive.yearInDecade(1981))
        assertEquals("Mid-1980s", TimeMachineArchive.yearInDecade(1985))
        assertEquals("Late 1980s", TimeMachineArchive.yearInDecade(1989))
    }

    private fun anime(
        id: Int,
        title: String,
        format: String = "TV",
        episodes: Int? = 12,
        popularity: Int = 100_000,
        score: Int? = 75,
        synopsis: String? = null,
        studios: List<String> = emptyList(),
        genres: List<String> = emptyList(),
    ) = Anime(
        id = id, malId = null, title = title, titleRomaji = null, cover = null, banner = null,
        episodes = episodes, status = "FINISHED", format = format, year = null, score = score,
        synopsis = synopsis, genres = genres, popularity = popularity, studios = studios,
    )

    private fun pick(
        year: Int,
        item: Anime,
        month: Int? = 4,
        relations: List<TimeMachineRelation> = emptyList(),
        fromGems: Boolean = false,
    ) = TimeMachineArchive.candidate(item, year, month, relations, fromGems)

    private fun rel(type: String, id: Int, year: Int?) = TimeMachineRelation(type, id, year)
    private fun titles(list: List<Anime>) = list.map { it.title }

    @Test fun readsRelationsToEarlierShows() {
        val sequel = pick(2015, anime(1, "HAIKYU!! 2nd Season"), relations = listOf(rel("PREQUEL", 900, 2014), rel("SEQUEL", 901, 2016)))
        assertTrue(sequel.prequelBefore)
        assertEquals(listOf(900, 901), sequel.franchise)
        assertFalse(pick(2015, anime(2, "One-Punch Man"), relations = listOf(rel("PREQUEL", 902, 2015))).prequelBefore)
        // An undated alternative version is an announced remake, not an older show.
        assertFalse(pick(1988, anime(3, "Akira", format = "MOVIE"), relations = listOf(rel("ALTERNATIVE", 903, null))).alternativeBefore)
        assertTrue(pick(2015, anime(4, "Haikyu!! the Movie", format = "MOVIE", synopsis = "A retelling of the first season of the TV anime Haikyuu!!.")).recap)
        assertTrue(pick(2017, anime(7, "Code Geass: Lelouch of the Rebellion I", synopsis = "First of the three part theatrical film remake of Code Geass: Lelouch of the Rebellion.")).recap)
        assertTrue(pick(2016, anime(8, "Kuroko no Basket: Winter Cup Soushuuhen")).recap)
        assertFalse(pick(1998, anime(5, "Pokémon: The First Movie", synopsis = "Scientists use the DNA of Mew to create Mewtwo.")).recap)
        // Retelling a manga story or a fairy tale, or a note about a "summary" episode, is not a recap.
        assertFalse(pick(1988, anime(9, "Urusei Yatsura Movie 5", synopsis = "The story comes to a climax in this animated retelling of the final Manga story.")).recap)
        assertFalse(pick(1988, anime(10, "Maison Ikkoku: Final Chapter", synopsis = "Don't take the last episode in account, since that is a summary of what will come.")).recap)
        assertNull(pick(1962, anime(6, "Short"), month = 0).startMonth)
    }

    @Test fun splitsAYearIntoNewShowsFilmsAndSequelsOnePerFranchise() {
        val year = TimeMachineArchive.curate(listOf(
            pick(2015, anime(1, "One-Punch Man", popularity = 774_000, score = 82), month = 10, relations = listOf(rel("PREQUEL", 2, 2015))),
            pick(2015, anime(2, "One-Punch Man: Road to Hero", format = "OVA", episodes = 1, popularity = 93_000), month = 12, relations = listOf(rel("SEQUEL", 1, 2015))),
            pick(2015, anime(3, "HAIKYU!! 2nd Season", popularity = 402_000, score = 86), month = 10, relations = listOf(rel("PREQUEL", 90, 2014))),
            pick(2015, anime(4, "Haikyu!! the Movie: The End and the Beginning", format = "MOVIE", episodes = 1, popularity = 27_000, synopsis = "A retelling of the first season."), month = 7, relations = listOf(rel("PARENT", 90, 2014))),
            pick(2015, anime(5, "The Boy and the Beast", format = "MOVIE", episodes = 1, popularity = 112_000, score = 79), month = 7),
            pick(2015, anime(6, "Detective Conan: Sunflowers of Inferno", format = "MOVIE", episodes = 1, popularity = 10_800), relations = listOf(rel("PARENT", 91, 1996))),
            pick(2015, anime(7, "Kuroko's Basketball 3", popularity = 164_000), month = 1, relations = listOf(rel("PREQUEL", 92, 2013))),
            pick(2015, anime(8, "Kuroko no Basket: Saikou no Present Desu", format = "SPECIAL", episodes = 1, popularity = 20_000), month = 12, relations = listOf(rel("PARENT", 7, 2015))),
            pick(2015, anime(9, "Lyric clip", format = "MUSIC", popularity = 30_000)),
            pick(2015, anime(10, "Tiny short", popularity = 600)),
        ))
        assertEquals(listOf("One-Punch Man"), titles(year.newShows))
        assertEquals(listOf("The Boy and the Beast", "Detective Conan: Sunflowers of Inferno"), titles(year.films))
        assertEquals(listOf("HAIKYU!! 2nd Season", "Kuroko's Basketball 3"), titles(year.sequels))
        assertEquals(listOf("One-Punch Man", "The Boy and the Beast", "Detective Conan: Sunflowers of Inferno"), titles(year.headliners))
    }

    @Test fun aSameYearPartTwoFollowsItsPartOneEvenInASeasonWithoutIt() {
        val candidates = listOf(
            pick(2023, anime(1, "Dr. STONE New World", popularity = 205_000), month = 4, relations = listOf(rel("PREQUEL", 50, 2022), rel("SEQUEL", 2, 2023))),
            pick(2023, anime(2, "Dr. STONE New World Part 2", popularity = 142_000), month = 10, relations = listOf(rel("PREQUEL", 1, 2023))),
            pick(2023, anime(3, "Frieren: Beyond Journey's End", popularity = 491_000, score = 91), month = 9),
        )
        assertEquals(listOf("Dr. STONE New World"), titles(TimeMachineArchive.curate(candidates).sequels))
        val fall = TimeMachineArchive.curate(candidates, "FALL")
        assertTrue(fall.newShows.isEmpty())
        assertEquals(listOf("Dr. STONE New World Part 2"), titles(fall.sequels))
        assertEquals(listOf("Frieren: Beyond Journey's End"), titles(TimeMachineArchive.curate(candidates, "SUMMER").newShows))
    }

    @Test fun aNewShowsLaterSeasonThatYearIsASequelButAnOvaAniListCallsItsPrequelIsNot() {
        val candidates = listOf(
            pick(2026, anime(1, "The Ramparts of Ice", popularity = 85_000), month = 1, relations = listOf(TimeMachineRelation("SEQUEL", 2, 2026, 10))),
            pick(2026, anime(2, "The Ramparts of Ice Season 2", popularity = 40_000), month = 10, relations = listOf(TimeMachineRelation("PREQUEL", 1, 2026, 1))),
            pick(2026, anime(3, "Firefly Wedding", popularity = 40_000), month = 10),
            // AniList lists One-Punch Man's later OVA as its prequel.
            pick(2026, anime(4, "One-Punch Man", popularity = 774_000), month = 10, relations = listOf(TimeMachineRelation("PREQUEL", 5, 2026, 12))),
        )
        val fall = TimeMachineArchive.curate(candidates, "FALL")
        assertEquals(listOf("One-Punch Man", "Firefly Wedding"), titles(fall.newShows))
        assertEquals(listOf("The Ramparts of Ice Season 2"), titles(fall.sequels))
        val whole = TimeMachineArchive.curate(candidates)
        assertEquals(listOf("One-Punch Man", "The Ramparts of Ice", "Firefly Wedding"), titles(whole.newShows))
        assertTrue(whole.sequels.isEmpty())
    }

    @Test fun aSeriesLengthRemakeIsNewAShortAlternateTakeIsNot() {
        val year = TimeMachineArchive.curate(listOf(
            pick(2023, anime(1, "Hellsing Ultimate", format = "OVA", episodes = 10, popularity = 188_000), relations = listOf(rel("ALTERNATIVE", 80, 2001))),
            pick(2023, anime(2, "Steins;Gate 0: 23β", format = "OVA", episodes = 1, popularity = 84_000), relations = listOf(rel("ALTERNATIVE", 81, 2011))),
            pick(2023, anime(3, "Horimiya: The Missing Pieces", popularity = 167_000), relations = listOf(rel("PARENT", 82, 2021))),
        ))
        assertEquals(listOf("Hellsing Ultimate"), titles(year.newShows))
        assertEquals(listOf("Horimiya: The Missing Pieces", "Steins;Gate 0: 23β"), titles(year.sequels))
    }

    @Test fun aFranchiseThatPremieresThisYearShowsOnceAsANewShow() {
        val year = TimeMachineArchive.curate(listOf(
            pick(1988, anime(1, "Legend of the Galactic Heroes", format = "OVA", episodes = 110, popularity = 86_000, score = 88), month = 12, relations = listOf(rel("PREQUEL", 2, 1988))),
            pick(1988, anime(2, "Legend of the Galactic Heroes: My Conquest Is the Sea of Stars", format = "MOVIE", episodes = 1, popularity = 16_000), month = 2, relations = listOf(rel("SEQUEL", 1, 1988))),
            pick(1988, anime(3, "My Neighbor Totoro", format = "MOVIE", episodes = 1, popularity = 283_000, score = 81)),
        ))
        assertEquals(listOf("Legend of the Galactic Heroes"), titles(year.newShows))
        assertEquals(listOf("My Neighbor Totoro"), titles(year.films))
    }

    @Test fun ranksByAudienceAndScoreTogether() {
        val year = TimeMachineArchive.curate(listOf(
            pick(1988, anime(1, "Hit", popularity = 200_000, score = 60)),
            pick(1988, anime(2, "Classic", popularity = 150_000, score = 85)),
            pick(1988, anime(3, "Obscure perfect score", popularity = 900, score = 95)),
        ))
        assertEquals(listOf("Classic", "Hit", "Obscure perfect score"), titles(year.newShows))
    }

    @Test fun hiddenGemsAreWellRatedNewTitlesBeyondTheRowsNeverSequels() {
        val row = TimeMachineArchive.ROW
        // The last show rates well but too few follow it to make the row, so it becomes a gem.
        val shows = (0 until row + 2).map { i ->
            if (i == row + 1) pick(2006, anime(i + 1, "Show ${i + 1}", popularity = 5_000, score = 84))
            else pick(2006, anime(i + 1, "Show ${i + 1}", popularity = 500_000 - i * 10_000, score = 65))
        }
        val year = TimeMachineArchive.curate(shows + listOf(
            pick(2006, anime(100, "Quiet masterpiece", popularity = 9_000, score = 86), fromGems = true),
            pick(2006, anime(101, "Well-rated OVA of an old show", format = "OVA", episodes = 2, popularity = 9_000, score = 90), fromGems = true, relations = listOf(rel("PARENT", 300, 2001))),
            pick(2006, anime(102, "Too obscure", popularity = 1_000, score = 95), fromGems = true),
        ))
        assertEquals(row + 2, year.newShows.size)
        assertEquals(listOf("Quiet masterpiece", "Show ${row + 2}"), titles(year.gems))
        assertEquals(row + 2, year.titleCount)
        assertEquals(5_000, TimeMachineArchive.gemPopularityFloor(500_000))
        assertEquals(250, TimeMachineArchive.gemPopularityFloor(10_000))
    }

    @Test fun sumsUpTheYearHonestly() {
        val year = TimeMachineArchive.curate(listOf(
            pick(1998, anime(1, "Cowboy Bebop", popularity = 472_000, score = 86, studios = listOf("Sunrise"), genres = listOf("Action", "Sci-Fi"))),
            pick(1998, anime(2, "Serial Experiments Lain", popularity = 256_000, score = 80, studios = listOf("Triangle Staff"), genres = listOf("Sci-Fi", "Psychological"))),
            pick(1998, anime(3, "Outlaw Star", popularity = 36_000, score = 75, studios = listOf("Sunrise"), genres = listOf("Action", "Sci-Fi"))),
            pick(1998, anime(4, "Perfect Blue", format = "MOVIE", episodes = 1, popularity = 248_000, score = 85, studios = listOf("Madhouse"), genres = listOf("Psychological"))),
            pick(1998, anime(5, "Obscure OVA", format = "OVA", episodes = 3, popularity = 2_000, score = 90, studios = listOf("Madhouse"))),
        ))
        assertEquals("Cowboy Bebop", year.stats.biggestDebut?.title)
        assertEquals("Cowboy Bebop", year.stats.bestRated?.title)
        assertEquals("Sunrise" to 2, year.stats.busiestStudio)
        assertEquals(listOf("Sci-Fi", "Action", "Psychological"), year.stats.topGenres)
        assertEquals("Cowboy Bebop, Serial Experiments Lain and Perfect Blue", TimeMachineArchive.joinTitles(titles(year.headliners)))
        assertEquals("Akira and Totoro", TimeMachineArchive.joinTitles(listOf("Akira", "Totoro")))
    }

    @Test fun mysteryScreeningSkipsTitlesAlreadyInYourList() {
        val year = TimeMachineArchive.curate(listOf(
            pick(1998, anime(1, "Cowboy Bebop", popularity = 472_000)),
            pick(1998, anime(2, "Trigun", popularity = 172_000)),
        ))
        assertEquals("Trigun", TimeMachineArchive.mysteryPick(year, setOf(1), Random(7))?.title)
        assertNull(TimeMachineArchive.mysteryPick(TimeMachineArchive.curate(emptyList()), emptySet()))
    }
}
