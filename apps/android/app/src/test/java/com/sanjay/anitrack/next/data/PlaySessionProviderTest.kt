package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.ProviderDescriptor
import com.sanjay.anitrack.next.data.providers.ProviderEpisode
import com.sanjay.anitrack.next.data.providers.ProviderRegistry
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.ProviderSubtitle
import com.sanjay.anitrack.next.data.providers.ResolvedMedia
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.SkipRange
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class PlaySessionProviderTest {
    private val runtime = AndroidRuntimeConfig(
        revision = 1,
        issuedAt = "test",
        providerOrder = listOf("mockstream"),
        providers = emptyMap(),
        features = RuntimeFeatures(true, true, true, true, true),
        notice = null,
    )

    private val connector = object : AnimeProvider {
        override val descriptor = ProviderDescriptor("mockstream", "Mock Stream")
        override fun isEnabled(config: AndroidRuntimeConfig) = true
        override suspend fun match(anime: Anime): ProviderSeries? = null
        override suspend fun resume(key: String): ProviderSeries? = null
    }

    @Test
    fun normalizedSeriesKeepsRawResumeKeyAndMediaDecisions() = runBlocking {
        val media = ResolvedMedia(
            url = "https://media.example/episode.m3u8",
            referer = "https://player.example/",
            userAgent = "test-agent",
            subtitles = listOf(ProviderSubtitle("https://media.example/en.vtt", "English")),
            intro = SkipRange(5, 75),
            backend = PlaybackBackend.WEB_HLS,
            seekMode = SeekMode.EXACT,
            downloadable = false,
        )
        val series = ProviderSeries(
            providerId = "mockstream",
            resumeKey = "raw-provider-key",
            episodes = listOf(ProviderEpisode(7f, "Seventh") { media }),
        )
        PlaySession.startSeries(series, 0, 42, "Example", null, null)

        assertEquals("mockstream", PlaySession.provider)
        assertEquals("raw-provider-key", PlaySession.resumeKey())
        assertEquals(7f, PlaySession.episodeNumber(0))
        assertEquals("Seventh", PlaySession.episodeTitle(0))

        val resolved = PlaySession.resolve(0, ProviderRegistry(listOf(connector)), runtime)
        assertEquals(PlaybackBackend.WEB_HLS, resolved.backend)
        assertEquals(SeekMode.EXACT, resolved.seekMode)
        assertEquals(75L, resolved.introEnd)
        assertEquals("English", resolved.subtitles.single().label)
        assertFalse(resolved.downloadable)
    }
}
