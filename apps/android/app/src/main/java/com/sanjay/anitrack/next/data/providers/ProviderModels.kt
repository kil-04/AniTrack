package com.sanjay.anitrack.next.data.providers

data class ProviderCapabilities(
    val latest: Boolean = false,
    val top: Boolean = false,
    val externalIds: Boolean = false,
    val downloads: Boolean = true,
    val subtitleModes: Boolean = false,
)

data class ProviderDescriptor(
    val id: String,
    val name: String,
    val capabilities: ProviderCapabilities = ProviderCapabilities(),
)

enum class PlaybackBackend { NATIVE, WEB_HLS }
enum class SeekMode { EXACT, CLOSEST_SYNC }
enum class StreamAuthorizationScope {
    EXACT,
    DIRECTORY,
    /** Public hotlink headers may follow an HLS playlist to rotating media hosts. */
    PUBLIC_HLS,
}

data class PlaybackPreferences(val preferHardSub: Boolean = false)
data class ProviderSubtitle(
    val url: String,
    val label: String,
    val mimeType: String = "text/vtt",
    val language: String? = "en",
    val default: Boolean = false,
)
data class SkipRange(val startSeconds: Long?, val endSeconds: Long?)

/** A provider-native stream choice for one episode (for example an MKissa server alias). */
data class ProviderStreamVariant(
    val id: String,
    val label: String,
    /** "sub" or "dub" when known: a failed server hands over only to one in the same language. */
    val language: String? = null,
)

/**
 * The server to try after [current] fails: the next one in list order, wrapping, in the
 * same language and not already [failed]. Null when the language is unknown or none is
 * left, so Sub never turns into Dub (as desktop's nextAvailableLinkIndex keeps the audio).
 */
fun nextSameLanguageVariant(
    variants: List<ProviderStreamVariant>,
    current: String,
    failed: Set<String>,
): ProviderStreamVariant? {
    val start = variants.indexOfFirst { it.id == current }
    val language = variants.getOrNull(start)?.language ?: return null
    return (1 until variants.size).map { variants[(start + it) % variants.size] }
        .firstOrNull { it.language == language && it.id != current && it.id !in failed }
}

data class ResolvedMedia(
    val url: String,
    val referer: String,
    val userAgent: String,
    val requestHeaders: Map<String, String> = emptyMap(),
    val authorizationScope: StreamAuthorizationScope? = null,
    val subtitles: List<ProviderSubtitle> = emptyList(),
    val intro: SkipRange? = null,
    val outro: SkipRange? = null,
    val backend: PlaybackBackend = PlaybackBackend.NATIVE,
    val seekMode: SeekMode = SeekMode.CLOSEST_SYNC,
    val downloadable: Boolean = true,
    /** Do not retry, modify playlists or import ambient WebView cookies for this media. */
    val conservativeNetwork: Boolean = false,
    val mimeType: String? = null,
    /** The provider-native server this media came from, when the connector chose one itself. */
    val variantId: String? = null,
)

class ProviderEpisode(
    val number: Float,
    val title: String? = null,
    val snapshot: String? = null,
    private val variantsResolver: suspend () -> List<ProviderStreamVariant> = { emptyList() },
    private val variantResolver: (suspend (String, PlaybackPreferences) -> ResolvedMedia)? = null,
    private val resolver: suspend (PlaybackPreferences) -> ResolvedMedia,
) {
    suspend fun variants(): List<ProviderStreamVariant> = variantsResolver()

    suspend fun resolve(
        preferences: PlaybackPreferences = PlaybackPreferences(),
        variantId: String? = null,
    ): ResolvedMedia = if (variantId != null && variantResolver != null) {
        variantResolver.invoke(variantId, preferences)
    } else {
        resolver(preferences)
    }
}

data class ProviderSeries(
    val providerId: String,
    val resumeKey: String,
    val episodes: List<ProviderEpisode>,
    val verified: Boolean = false,
    val badges: List<String> = emptyList(),
) {
    fun episodeIndex(number: Float, fallback: Int = 0): Int =
        episodes.indexOfFirst { kotlin.math.abs(it.number - number) < 0.01f }
            .takeIf { it >= 0 }
            ?: fallback.coerceIn(0, (episodes.size - 1).coerceAtLeast(0))
}
