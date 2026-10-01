package com.sanjay.anitrack.next.data.providers.connectors

import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.ProviderCapabilities
import com.sanjay.anitrack.next.data.providers.ProviderDescriptor
import com.sanjay.anitrack.next.data.providers.ProviderEpisode
import com.sanjay.anitrack.next.data.providers.ProviderSeries
import com.sanjay.anitrack.next.data.providers.ProviderStreamVariant
import com.sanjay.anitrack.next.data.providers.ProviderSubtitle
import com.sanjay.anitrack.next.data.providers.ResolvedMedia
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaMediaKind
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaNetwork
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaService
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaShow
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaTranslation

/**
 * Registered for connector discovery but kept disabled by signed runtime configuration until its
 * playback path is verified. The service preserves all sub/dub episodes and server choices; this
 * adapter exposes a conservative single-translation view until the player can present those choices
 * directly. Resolution still walks the server aliases lazily when the preferred one fails.
 */
object MkissaProvider : AnimeProvider {
    private val service by lazy { MkissaService(transport = MkissaNetwork.transport()) }

    fun init(context: android.content.Context) {
        MkissaNetwork.init(context)
    }

    override val descriptor = ProviderDescriptor(
        id = "mkissa",
        name = "MKissa",
        capabilities = ProviderCapabilities(
            externalIds = true,
            downloads = false,
            subtitleModes = true,
        ),
    )

    // Debug builds expose staged connectors for USB/device verification while
    // release builds continue to obey the signed remote kill switch.
    override fun isEnabled(config: AndroidRuntimeConfig): Boolean =
        BuildConfig.DEBUG || config.providers[descriptor.id]?.enabled == true

    override fun acceptsResumeKey(key: String): Boolean = RESUME_KEY.matches(key)

    override suspend fun match(anime: Anime): ProviderSeries? = service.match(anime)?.let { show ->
        val translation = if (show.subEpisodes.isNotEmpty()) MkissaTranslation.SUB else MkissaTranslation.DUB
        series(show, translation)
    }

    override suspend fun resume(key: String): ProviderSeries? {
        val match = RESUME_KEY.matchEntire(key) ?: return null
        val translation = MkissaTranslation.fromWire(match.groupValues[1]) ?: return null
        return runCatching { service.show(match.groupValues[2]) }.getOrNull()
            ?.let { series(it, translation) }
    }

    internal fun series(show: MkissaShow, translation: MkissaTranslation): ProviderSeries = ProviderSeries(
        providerId = descriptor.id,
        resumeKey = "mkissa:${translation.wireValue}:${show.id}",
        verified = show.aniListId != null,
        badges = buildList {
            if (show.subEpisodes.isNotEmpty()) add("SUB ${show.subEpisodes.size}")
            if (show.dubEpisodes.isNotEmpty()) add("DUB ${show.dubEpisodes.size}")
        },
        // ProviderEpisode currently requires Float. The service retains non-numeric special ids;
        // they can be exposed once the shared model gains an opaque episode key.
        episodes = show.episodes(translation).mapNotNull { episode ->
            val number = episode.number ?: return@mapNotNull null
            ProviderEpisode(
                number = number,
                title = "Episode ${episode.episodeString} (${translation.name})",
                variantsResolver = {
                    streamVariants(service.sources(episode))
                },
                variantResolver = { variantId, _ ->
                    val sources = service.sources(episode)
                    val selected = sourceForVariant(sources, variantId)
                    // Server aliases and ordering can rotate between discovery and playback.
                    // If the chosen alias disappeared, retain the provider's safe automatic fallback.
                    val media = if (selected != null) {
                        service.resolve(selected).first()
                    } else {
                        service.resolveFirst(sources).first()
                    }
                    toResolvedMedia(media)
                },
            ) {
                toResolvedMedia(service.resolveFirst(episode).first())
            }
        },
    )

    internal fun streamVariants(sources: List<com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaSourceCandidate>): List<ProviderStreamVariant> {
        val totals = sources.groupingBy(::sourceIdentity).eachCount()
        val seen = mutableMapOf<String, Int>()
        return sources.map { source ->
            val identity = sourceIdentity(source)
            val occurrence = seen.getOrDefault(identity, 0)
            seen[identity] = occurrence + 1
            ProviderStreamVariant(
                id = "$identity\u001f$occurrence",
                label = if (totals.getValue(identity) > 1) "${source.name} ${occurrence + 1}" else source.name,
            )
        }
    }

    internal fun sourceForVariant(
        sources: List<com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaSourceCandidate>,
        variantId: String,
    ): com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaSourceCandidate? {
        if (variantId.length > 260 || variantId.any { it == '\r' || it == '\n' || it == '\u0000' }) return null
        val variants = streamVariants(sources)
        val index = variants.indexOfFirst { it.id == variantId }
        return sources.getOrNull(index)
    }

    private fun sourceIdentity(source: com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaSourceCandidate): String =
        "${source.name.trim().lowercase()}\u001f${source.type.trim().lowercase()}"

    internal fun toResolvedMedia(media: com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaMediaSource) =
        ResolvedMedia(
            url = media.url,
            referer = media.headers.entries.firstOrNull { it.key.equals("Referer", ignoreCase = true) }
                ?.value.orEmpty(),
            userAgent = media.headers.entries.firstOrNull { it.key.equals("User-Agent", ignoreCase = true) }
                ?.value.orEmpty(),
            requestHeaders = media.headers,
            authorizationScope = if (media.kind == MkissaMediaKind.HLS) {
                StreamAuthorizationScope.DIRECTORY
            } else {
                StreamAuthorizationScope.EXACT
            },
            subtitles = media.subtitles.map { ProviderSubtitle(it.url, it.label) },
            backend = PlaybackBackend.NATIVE,
            seekMode = if (media.kind == MkissaMediaKind.MP4) SeekMode.EXACT else SeekMode.CLOSEST_SYNC,
            downloadable = false,
        )

    private val RESUME_KEY = Regex("^mkissa:(sub|dub):([A-Za-z0-9_-]{4,100})$")
}
