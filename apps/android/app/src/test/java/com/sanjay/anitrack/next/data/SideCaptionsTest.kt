package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.providers.ProviderSubtitle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SideCaptionsTest {
    private val dead = "https://xanivsrc2.example/media/cowboy-bebop/1/dub/eng.vtt"
    private val alive = "https://xanivsrc2.example/media/cowboy-bebop/1/dub/eng-signs.vtt"
    private val stream = PlaySession.Resolved(
        url = "https://xanivsrc2.example/media/cowboy-bebop/1/dub/master.m3u8",
        referer = "https://xanime.example/",
        userAgent = "AniTrack",
        subtitles = listOf(ProviderSubtitle(dead, "English"), ProviderSubtitle(alive, "English (signs)")),
        introStart = 30, introEnd = 120, outroStart = null, outroEnd = null,
    )

    @Test fun aCaptionThatGotAnHttpAnswerIsNotRetried() {
        assertFalse(SideCaptions.retries(404))
        assertFalse(SideCaptions.retries(403))
        assertFalse(SideCaptions.retries(503))
        assertTrue("a network error without an answer keeps the usual retries", SideCaptions.retries(null))
    }

    @Test fun aDeadCaptionLeavesTheStreamAndTheRestStays() {
        val next = SideCaptions.withoutFailed(stream, dead)!!
        assertEquals(listOf(alive), next.subtitles.map { it.url })
        assertEquals("the same video, intro and all", stream.copy(subtitles = next.subtitles), next)
        assertTrue(SideCaptions.withoutFailed(next, alive)!!.subtitles.isEmpty())
    }

    @Test fun aFailureOfAnythingButACaptionIsLeftToThePlayerScreen() {
        assertNull("the video itself failed", SideCaptions.withoutFailed(stream, stream.url))
        assertNull("no request address", SideCaptions.withoutFailed(stream, null))
        assertNull("no stream loaded", SideCaptions.withoutFailed(null, dead))
        // Once dropped, the same caption's error isn't taken for another one.
        assertNull(SideCaptions.withoutFailed(SideCaptions.withoutFailed(stream, dead), dead))
        assertTrue(SideCaptions.isCaption(stream, dead))
        assertFalse(SideCaptions.isCaption(stream, stream.url))
    }
}
