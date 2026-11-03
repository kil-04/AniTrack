package com.sanjay.anitrack.next.data.providers.connectors.xanime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as tests/xanime.test.mjs (xanime.me pages, 3 Nov 2026, reduced to their Qwik state). */
class XanimeTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource("xanime/$name")!!.readText()

    @Test fun searchResultsCarryIdsYearTypeAndCounts() {
        val shows = Xanime.shows(fixture("search.html"))
        assertEquals(
            listOf(
                listOf("91594", 1, 1, 1998, "TV", 26, 26, 26),
                listOf("94002", 5, 5, 2001, "MOVIE", 1, 1, 1),
            ),
            shows.map { listOf(it.id, it.anilistId, it.malId, it.year, it.type, it.episodes, it.subCount, it.dubCount) },
        )
        assertEquals("Cowboy Bebop", shows[0].title)
        assertEquals("31962046", shows[0].latestEpisodeId)
        assertFalse(shows[0].adult)
        assertTrue(shows[0].poster!!.startsWith("https://s4.anilist.co/"))
        assertEquals("https://xanime.me/search?word=cowboy%20bebop", Xanime.searchUrl("  cowboy bebop "))
    }

    @Test fun episodePageListsTheShowsEpisodesInOrder() {
        val list = Xanime.episodes(fixture("episode.html"), "91594")
        assertEquals(26, list.total)
        assertEquals(26, list.episodes.size)
        assertEquals(Xanime.Episode("31962021", 1f, "Episode 1"), list.episodes.first())
        assertEquals(Xanime.Episode("31962046", 26f, "Episode 26"), list.episodes.last())
        assertEquals(1, list.show?.anilistId)
        assertTrue(Xanime.episodes(fixture("episode.html"), "123").episodes.isEmpty())
    }

    @Test fun longShowListsOnlyThePageAroundItsEpisode() {
        val list = Xanime.episodes(fixture("episode-long.html"), "88514")
        assertEquals(1180, list.total)
        assertEquals(30, list.episodes.size)
        assertEquals(1151f, list.episodes.first().number)
        assertEquals(1180f, list.episodes.last().number)
        assertEquals(21, Xanime.show(fixture("episode-long.html"), "88514")?.anilistId)
    }

    @Test fun subAndDubStreamsWithCaptionsAndSkipTimes() {
        val streams = Xanime.streams(fixture("episode.html"), "31962021")
        assertEquals(listOf(listOf("835924", "sub", null), listOf("835925", "dub", null)), streams.map { listOf(it.id, it.language, it.server) })
        assertTrue(streams[0].url.startsWith("https://xanivsrc5.org/media/s1v/810/84018/a-master.m3u8?"))
        assertEquals(listOf(Triple("English", "captions", true)), streams[0].subtitles.map { Triple(it.label, it.kind, it.default) })
        assertTrue(streams[0].subtitles[0].file.startsWith("https://xanivsrc3.org/media/"))
        assertEquals(Xanime.Skip(49, 144), streams[0].intro)
        assertEquals(Xanime.Skip(1357, 1451), streams[0].outro)
        assertEquals(listOf("Sub", "Dub"), streams.map { Xanime.label(it, streams) })
        assertTrue("only the page's own episode has streams", Xanime.streams(fixture("episode.html"), "31962046").isEmpty())
    }

    @Test fun hardSubbedStreamNamesItsServer() {
        val streams = Xanime.streams(fixture("episode-hardsub.html"), "32070822")
        assertEquals(1, streams.size)
        val stream = streams.single()
        assertEquals("sub", stream.language)
        assertEquals("Vidplay", stream.server)
        assertTrue(stream.subtitles.isEmpty())
        assertNull(stream.intro)
        assertEquals("Sub · Vidplay", Xanime.label(stream, streams))
    }

    @Test fun idsRoutesAndMediaHosts() {
        assertTrue(Xanime.isId("91594"))
        listOf("0", "-1", "91594-cowboy-bebop", "99999999999", null).forEach { assertFalse(it.toString(), Xanime.isId(it)) }
        assertEquals("https://xanime.me/title/91594/31962021", Xanime.episodeUrl("91594", "31962021"))
        assertTrue(Xanime.isMediaUrl("https://xanivsrc10.org/media/s1v/071/84170/a-master.m3u8?slug=x&e=1&s=y"))
        listOf(
            "http://xanivsrc10.org/media/a.m3u8",
            "https://xanivsrc10.org/other/a.m3u8",
            "https://xanivsrc10.org.evil.com/media/a.m3u8",
            "https://user@xanivsrc10.org/media/a.m3u8",
            "https://xanivsrc10.org:8443/media/a.m3u8",
        ).forEach { assertFalse(it, Xanime.isMediaUrl(it)) }
        assertTrue(Xanime.shows("<html>no state</html>").isEmpty())
        assertTrue(Xanime.streams("<script type=\"qwik/json\">{not json</script>", "1").isEmpty())
    }
}
