package com.sanjay.anitrack.next.data.providers.connectors.mkissa

enum class MkissaTranslation(val wireValue: String) {
    SUB("sub"),
    DUB("dub");

    companion object {
        fun fromWire(value: String): MkissaTranslation? = entries.firstOrNull {
            it.wireValue.equals(value, ignoreCase = true)
        }
    }
}

data class MkissaShowSummary(
    val id: String,
    val title: String,
    val englishTitle: String? = null,
    val nativeTitle: String? = null,
    val thumbnail: String? = null,
    val aniListId: Int? = null,
    val year: Int? = null,
    val episodeCount: Int? = null,
)

data class MkissaShow(
    val id: String,
    val title: String,
    val englishTitle: String? = null,
    val nativeTitle: String? = null,
    val thumbnail: String? = null,
    val aniListId: Int? = null,
    val year: Int? = null,
    val description: String? = null,
    val genres: List<String> = emptyList(),
    val subEpisodes: List<String> = emptyList(),
    val dubEpisodes: List<String> = emptyList(),
) {
    fun episodes(translation: MkissaTranslation): List<MkissaEpisodeRef> = when (translation) {
        MkissaTranslation.SUB -> subEpisodes
        MkissaTranslation.DUB -> dubEpisodes
    }.map { MkissaEpisodeRef(id, it, translation) }
}

/** The provider uses strings because fractional episodes and specials are valid identifiers. */
data class MkissaEpisodeRef(
    val showId: String,
    val episodeString: String,
    val translation: MkissaTranslation,
) {
    val number: Float? get() = episodeString.toFloatOrNull()
}

data class MkissaSourceCandidate(
    val url: String,
    val name: String,
    val type: String,
    val priority: Float,
)

enum class MkissaMediaKind { HLS, MP4, DASH, DIRECT }

data class MkissaSubtitle(
    val url: String,
    val label: String,
    val language: String? = null,
)

data class MkissaAudioTrack(
    val url: String,
    val label: String,
)

data class MkissaMediaSource(
    val url: String,
    val serverName: String,
    val kind: MkissaMediaKind,
    val headers: Map<String, String>,
    val subtitles: List<MkissaSubtitle> = emptyList(),
    val audioTracks: List<MkissaAudioTrack> = emptyList(),
    val quality: String? = null,
    val downloadable: Boolean = false,
)

open class MkissaException(message: String, cause: Throwable? = null) : Exception(message, cause)

class MkissaProtocolException(message: String, cause: Throwable? = null) :
    MkissaException(message, cause)

enum class MkissaChallengeKind { CAPTCHA, RATE_LIMIT }

class MkissaRateLimitedException(
    val kind: MkissaChallengeKind = MkissaChallengeKind.RATE_LIMIT,
    message: String = when (kind) {
        MkissaChallengeKind.CAPTCHA -> CAPTCHA_MESSAGE
        MkissaChallengeKind.RATE_LIMIT -> RATE_LIMIT_MESSAGE
    },
) : MkissaException(message) {
    companion object {
        const val RATE_LIMIT_MESSAGE =
            "MKissa rejected this request with a rate limit. No automatic retry; you can try another server or retry manually."
        const val CAPTCHA_MESSAGE =
            "MKissa requested a CAPTCHA/security challenge. AniTrack will not bypass it. You can choose another server or retry manually."
    }
}

class MkissaUnsupportedSourceException(message: String) : MkissaException(message)

/** Centralized, bounded challenge detection used before any retry is attempted. */
internal object MkissaChallengePolicy {
    fun classify(statusCode: Int, responseBody: String): MkissaChallengeKind? {
        val sample = responseBody.take(MAX_INSPECTION_CHARS).uppercase()
        if (CAPTCHA_MARKERS.any(sample::contains)) return MkissaChallengeKind.CAPTCHA
        if (statusCode == 429 || RATE_MARKERS.any(sample::contains)) return MkissaChallengeKind.RATE_LIMIT
        return null
    }

    private const val MAX_INSPECTION_CHARS = 32 * 1024
    private val CAPTCHA_MARKERS = listOf(
        "NEED_CAPTCHA",
        "CAPTCHA_REQUIRED",
        "CF-CHL-",
        "SECURITY CHALLENGE",
    )
    private val RATE_MARKERS = listOf(
        "RATE_LIMIT",
        "TOO_MANY_REQUESTS",
        "TOO MANY REQUESTS",
    )
}

internal data class MkissaGraphQlError(val code: String?, val message: String?) {
    fun cryptoFailure(): Boolean = code?.startsWith("AA_CRYPTO") == true

    fun challengeKind(): MkissaChallengeKind? = MkissaChallengePolicy.classify(
        statusCode = 200,
        responseBody = "${code.orEmpty()} ${message.orEmpty()}",
    )
}
