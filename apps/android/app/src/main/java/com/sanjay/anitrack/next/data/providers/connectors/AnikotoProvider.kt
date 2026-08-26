package com.sanjay.anitrack.next.data.providers.connectors

import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.Anikoto
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.ProviderCapabilities
import com.sanjay.anitrack.next.data.providers.ProviderDescriptor
import com.sanjay.anitrack.next.data.providers.ProviderEpisode
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.ProviderSubtitle
import com.sanjay.anitrack.next.data.providers.ResolvedMedia
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.SkipRange

object AnikotoProvider : AnimeProvider {
    private const val USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

    override val descriptor = ProviderDescriptor(
        id = "anikoto",
        name = "Anikoto",
        capabilities = ProviderCapabilities(top = true, externalIds = true, subtitleModes = true),
    )

    override fun isEnabled(config: AndroidRuntimeConfig): Boolean =
        config.anikoto.enabled && config.features.anikotoStreaming

    override fun acceptsResumeKey(key: String): Boolean = !PAHE_UUID.matches(key)

    override suspend fun match(anime: Anime): ProviderSeries? =
        Anikoto.matchFor(anime)?.let { series(it.source.slug, it.list.episodes, it.verified, it.source) }

    override suspend fun resume(key: String): ProviderSeries? =
        runCatching { Anikoto.episodes(key) }.getOrNull()
            ?.takeIf { it.episodes.isNotEmpty() }
            ?.let { series(key, it.episodes, verified = false) }

    internal fun series(
        slug: String,
        episodes: List<Anikoto.Episode>,
        verified: Boolean,
        source: Anikoto.SearchResult? = null,
    ): ProviderSeries = ProviderSeries(
        providerId = descriptor.id,
        resumeKey = slug,
        verified = verified,
        badges = buildList {
            source?.subCount?.let { add("SUB $it") }
            source?.dubCount?.takeIf { it > 0 }?.let { add("DUB $it") }
        },
        episodes = episodes.map { episode ->
            ProviderEpisode(episode.number, episode.title) { preferences ->
                val stream = Anikoto.resolve(slug, episode, preferences.preferHardSub)
                ResolvedMedia(
                    url = stream.url,
                    referer = stream.referer,
                    userAgent = USER_AGENT,
                    subtitles = stream.subtitles.map { ProviderSubtitle(it.url, it.label) },
                    intro = stream.introEnd?.let { SkipRange(stream.introStart, it) },
                    outro = stream.outroEnd?.let { SkipRange(stream.outroStart, it) },
                    backend = PlaybackBackend.NATIVE,
                    seekMode = SeekMode.EXACT,
                )
            }
        },
    )

    private val PAHE_UUID = Regex(
        "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
        RegexOption.IGNORE_CASE,
    )
}
