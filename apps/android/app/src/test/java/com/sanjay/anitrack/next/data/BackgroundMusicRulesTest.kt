package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.BackgroundMusicRules.Mode
import com.sanjay.anitrack.next.data.BackgroundMusicRules.Track
import org.junit.Assert.*
import org.junit.Test

/** Mirrors tests/bg-music.test.mjs: both apps must name and step through tracks alike. */
class BackgroundMusicRulesTest {
    private val rules = BackgroundMusicRules

    @Test fun trackNamesComeFromTheFileNameWithoutTheTrackNumber() {
        assertEquals(Track("57 I Will Protect You -Reload-.mp3", "I Will Protect You -Reload-", 57), rules.trackFromFile("57 I Will Protect You -Reload-.mp3"))
        assertEquals(Track("01 Full Moon Full Life.mp3", "Full Moon Full Life", 1), rules.trackFromFile("01 Full Moon Full Life.mp3"))
        assertEquals("tartarus_0d03", rules.trackFromFile("28 tartarus_0d03.mp3")?.title)
        assertEquals("Shadow", rules.trackFromFile("07 - Shadow.flac")?.title)
        assertNull(rules.trackFromFile("Kyoto.MP3")?.number)
        assertEquals("Kyoto", rules.trackFromFile("Kyoto.MP3")?.title)
        // A number that is the whole title stays the title.
        assertEquals("1989", rules.trackFromFile("1989.mp3")?.title)
        assertNull(rules.trackFromFile("cover.jpg"))
        assertFalse(rules.isMusicFile(".hidden.mp3"))
        assertTrue(rules.trackFromFile(BackgroundMusicRules.BUNDLED_DEFAULT, bundled = true)!!.bundled)
    }

    @Test fun tracksSortByNumberUnnumberedLastByTitle() {
        val sorted = rules.sortTracks(listOf("10 b.mp3", "2 a.mp3", "Zeta.mp3", "alpha.ogg", "01 first.mp3").map { rules.trackFromFile(it)!! })
        assertEquals(listOf("01 first.mp3", "2 a.mp3", "10 b.mp3", "alpha.ogg", "Zeta.mp3"), sorted.map { it.id })
    }

    @Test fun nextTrackRepeatOnePlayAllWrapsShuffleNeverRepeatsTheLastOne() {
        assertEquals(3, rules.nextTrackIndex(Mode.ONE, 3, 10))
        assertEquals(4, rules.nextTrackIndex(Mode.ALL, 3, 10))
        assertEquals(0, rules.nextTrackIndex(Mode.ALL, 9, 10))
        for (r in listOf(0.0, 0.2, 0.5, 0.999)) {
            val next = rules.nextTrackIndex(Mode.SHUFFLE, 4, 10) { r }
            assertTrue(next in 0 until 10 && next != 4)
        }
        assertEquals(0, rules.nextTrackIndex(Mode.SHUFFLE, 0, 1))
        assertEquals(-1, rules.nextTrackIndex(Mode.ALL, 0, 0))
        assertEquals(0, rules.nextTrackIndex(Mode.ALL, -1, 5))
    }

    @Test fun nextSkipsOnEvenInRepeatOnePreviousGoesBackInListOrder() {
        assertEquals(3, rules.skipTrackIndex(Mode.ONE, 2, 5))
        assertEquals(0, rules.skipTrackIndex(Mode.ONE, 4, 5))
        assertEquals(0, rules.skipTrackIndex(Mode.ALL, 4, 5))
        assertNotEquals(2, rules.skipTrackIndex(Mode.SHUFFLE, 2, 5) { 0.5 })
        assertEquals(-1, rules.skipTrackIndex(Mode.ONE, 0, 0))
        assertEquals(1, rules.previousTrackIndex(2, 5))
        assertEquals(4, rules.previousTrackIndex(0, 5))
        assertEquals(0, rules.previousTrackIndex(-1, 5))
        assertEquals(-1, rules.previousTrackIndex(0, 0))
    }

    @Test fun theRepeatButtonCyclesPlayAllRepeatOneShuffle() {
        assertEquals(Mode.ONE, rules.nextMode(Mode.ALL))
        assertEquals(Mode.SHUFFLE, rules.nextMode(Mode.ONE))
        assertEquals(Mode.ALL, rules.nextMode(Mode.SHUFFLE))
        assertEquals(Mode.ALL, Mode.of("nonsense"))
        assertEquals(Mode.SHUFFLE, Mode.of("shuffle"))
    }

    @Test fun opensWithTheStarredDefaultElseTheLastTrackElseTheFirst() {
        val tracks = listOf("01 A.mp3", "02 B.mp3", "Because I Will Protect You.mp3").map { Track(it, it, null) }
        assertEquals("Because I Will Protect You.mp3", rules.startTrackId(tracks, "02 B.mp3", "Because I Will Protect You.mp3"))
        assertEquals("02 B.mp3", rules.startTrackId(tracks, "02 B.mp3", null))
        // A default or last track that was removed falls through.
        assertEquals("02 B.mp3", rules.startTrackId(tracks, "02 B.mp3", "gone.mp3"))
        assertEquals("01 A.mp3", rules.startTrackId(tracks, "gone.mp3", null))
        assertNull(rules.startTrackId(emptyList(), "02 B.mp3", "01 A.mp3"))
    }

    @Test fun importedFileNamesAreMadeSafe() {
        assertEquals("57 I Will Protect You.mp3", rules.safeTrackName("C:\\Users\\x\\57 I Will Protect You.mp3"))
        assertEquals("evil.mp3", rules.safeTrackName("../../evil.mp3"))
        assertEquals("a_b__c_.mp3", rules.safeTrackName("a<b>:c?.mp3"))
        assertEquals("It’s Going Down Now.mp3", rules.safeTrackName("It’s Going Down Now.mp3"))
    }
}
