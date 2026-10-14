package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.manga.ReadState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StoryBridgeTest {
    private fun book(id: Int, format: String, popularity: Int) = Manga(
        id = id, malId = null, title = "Book $id", titleRomaji = null, cover = null, banner = null,
        chapters = null, volumes = null, status = "FINISHED", format = format, year = 2010,
        score = null, synopsis = null, genres = emptyList(), popularity = popularity,
    )

    private fun link(type: String, id: Int, format: String, popularity: Int) =
        StoryBridge.Link(type, book(id, format, popularity))

    @Test fun mangaBasedShowsLeadWithTheMainSeriesNotOneShots() {
        // ONE PIECE: the series, an anthology, the pilot one-shot and a novelisation.
        val plan = StoryBridge.plan(
            "MANGA",
            listOf(
                link("ADAPTATION", 30793, "MANGA", 9_000),
                link("ADAPTATION", 134184, "ONE_SHOT", 4_000),
                link("ADAPTATION", 30013, "MANGA", 300_000),
                link("ADAPTATION", 96427, "NOVEL", 2_000),
            ),
        )
        assertEquals(30013, plan.primary?.id)
        assertEquals(StoryBridge.Kind.SourceManga, plan.kind)
        assertEquals(30013, plan.readable?.id)
        assertEquals(listOf(30793, 134184, 96427), plan.more.map { it.manga.id })
    }

    @Test fun aSourceEdgeBeatsAMorePopularAdaptation() {
        // Version-2 labels: the adapted manga is SOURCE, a comic made from the anime ADAPTATION.
        val plan = StoryBridge.plan(
            "MANGA",
            listOf(link("ADAPTATION", 2, "MANGA", 80_000), link("SOURCE", 1, "MANGA", 20_000)),
        )
        assertEquals(1, plan.primary?.id)
        assertEquals(listOf(2), plan.more.map { it.manga.id })
    }

    @Test fun novelBasedShowsPointAtTheNovelAndReadItsMangaVersion() {
        // Re:Zero: the light novel, plus a manga per arc linked as alternatives.
        val plan = StoryBridge.plan(
            "LIGHT_NOVEL",
            listOf(
                link("ADAPTATION", 85737, "NOVEL", 60_000),
                link("ALTERNATIVE", 87259, "MANGA", 20_000),
                link("ALTERNATIVE", 85736, "MANGA", 30_000),
            ),
        )
        assertEquals(85737, plan.primary?.id)
        assertEquals(StoryBridge.Kind.SourceNovel, plan.kind)
        assertEquals(85736, plan.readable?.id)
        assertEquals(listOf(87259), plan.more.map { it.manga.id })
    }

    @Test fun originalShowsOfferTheirMangaRetelling() {
        val plan = StoryBridge.plan(
            "ORIGINAL",
            listOf(link("ADAPTATION", 30173, "MANGA", 8_000), link("ADAPTATION", 30174, "MANGA", 6_000)),
        )
        assertEquals(30173, plan.primary?.id)
        assertEquals(StoryBridge.Kind.MangaVersion, plan.kind)
        assertEquals(listOf(30174), plan.more.map { it.manga.id })
    }

    @Test fun spinOffsAloneAreNotTheStory() {
        val plan = StoryBridge.plan("ORIGINAL", listOf(link("SPIN_OFF", 1, "MANGA", 50_000)))
        assertNull(plan.primary)
        assertNull(plan.kind)
        assertEquals(listOf(1), plan.more.map { it.manga.id })
    }

    @Test fun nothingInPrintMeansNoPlan() {
        val plan = StoryBridge.plan("MANGA", emptyList())
        assertNull(plan.primary)
        assertTrue(plan.more.isEmpty())
    }

    @Test fun resumesTheChapterReadLastOrTheOneAfterIt() {
        assertNull(StoryBridge.nextChapter(emptyMap()))
        // Chapter 12 open at page 3 of 20, read after chapter 11 was finished.
        assertEquals(12f, StoryBridge.nextChapter(mapOf(11f to ReadState(19, 20, 100), 12f to ReadState(3, 20, 200))))
        // Chapter 12 finished last: continue at 13.
        assertEquals(13f, StoryBridge.nextChapter(mapOf(11f to ReadState(19, 20, 100), 12f to ReadState(19, 20, 200))))
        // A half chapter finished last: the next whole chapter.
        assertEquals(13f, StoryBridge.nextChapter(mapOf(12.5f to ReadState(9, 10, 300))))
    }
}
