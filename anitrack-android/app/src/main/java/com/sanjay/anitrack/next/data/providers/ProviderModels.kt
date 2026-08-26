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

data class PlaybackPreferences(val preferHardSub: Boolean = false)
data class ProviderSubtitle(val url: String, val label: String)
data class SkipRange(val startSeconds: Long?, val endSeconds: Long?)

data class ResolvedMedia(
    val url: String,
    val referer: String,
    val userAgent: String,
    val subtitles: List<ProviderSubtitle> = emptyList(),
    val intro: SkipRange? = null,
    val outro: SkipRange? = null,
    val backend: PlaybackBackend = PlaybackBackend.NATIVE,
    val seekMode: SeekMode = SeekMode.CLOSEST_SYNC,
    val downloadable: Boolean = true,
)

class ProviderEpisode(
    val number: Float,
    val title: String? = null,
    val snapshot: String? = null,
    private val resolver: suspend (PlaybackPreferences) -> ResolvedMedia,
) {
    suspend fun resolve(preferences: PlaybackPreferences = PlaybackPreferences()): ResolvedMedia =
        resolver(preferences)
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
