package com.sanjay.anitrack.next.data.providers.connectors

import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.Pahe
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.ProviderCapabilities
import com.sanjay.anitrack.next.data.providers.ProviderDescriptor
import com.sanjay.anitrack.next.data.providers.ProviderEpisode
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.ResolvedMedia
import com.sanjay.anitrack.next.data.providers.SeekMode

object AnimePaheProvider : AnimeProvider {
    override val descriptor = ProviderDescriptor(
        id = "animepahe",
        name = "AnimePahe",
        capabilities = ProviderCapabilities(latest = true, externalIds = true),
    )

    override fun isEnabled(config: AndroidRuntimeConfig): Boolean =
        config.animepahe.enabled && config.features.animepaheStreaming

    override fun acceptsResumeKey(key: String): Boolean = SESSION_UUID.matches(key)

    override suspend fun match(anime: Anime): ProviderSeries? =
        Pahe.matchFor(anime)?.let { series(it.source.session, it.episodes) }

    override suspend fun resume(key: String): ProviderSeries? =
        runCatching { Pahe.episodesAll(key) }.getOrNull()
            ?.takeIf { it.isNotEmpty() }
            ?.let { series(key, it) }

    internal fun series(session: String, episodes: List<Pahe.Episode>): ProviderSeries = ProviderSeries(
        providerId = descriptor.id,
        resumeKey = session,
        episodes = episodes.map { episode ->
            ProviderEpisode(episode.number, snapshot = episode.snapshot) {
                val links = Pahe.links(session, episode.session)
                val best = links.maxByOrNull {
                    (it.quality.filter(Char::isDigit).toIntOrNull() ?: 0) * 10 +
                        if (!it.audio.lowercase().contains("eng")) 1 else 0
                } ?: error("No stream links found")
                val stream = Pahe.resolveKwik(best.kwik)
                ResolvedMedia(
                    url = stream.url,
                    referer = stream.referer,
                    userAgent = Pahe.MOBILE_UA,
                    backend = PlaybackBackend.WEB_HLS,
                    seekMode = SeekMode.CLOSEST_SYNC,
                )
            }
        },
    )

    private val SESSION_UUID = Regex(
        "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
        RegexOption.IGNORE_CASE,
    )
}
