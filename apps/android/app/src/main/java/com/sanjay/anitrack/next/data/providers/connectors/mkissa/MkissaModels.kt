package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import org.json.JSONObject

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
    val default: Boolean = false,
)

data class MkissaSkipRange(val start: Double, val end: Double)

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
    val intro: MkissaSkipRange? = null,
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
        val sample = responseBody.take(MAX_INSPECTION_CHARS)
        val messages = errorMessages(sample).toMutableList()
        if (sample.trimStart().startsWith("<") && HTML_CHALLENGE.containsMatchIn(sample)) {
            messages += "security check"
        }
        return classifyMessages(statusCode, messages)
    }

    fun classifyMessages(statusCode: Int, messages: List<String>): MkissaChallengeKind? = when {
        statusCode == 429 || messages.any(RATE_LIMIT::containsMatchIn) -> MkissaChallengeKind.RATE_LIMIT
        messages.any(CAPTCHA::containsMatchIn) -> MkissaChallengeKind.CAPTCHA
        // Only an explicit crypto error, never an unexplained denial, permits refreshing keys.
        messages.any(CRYPTO_STALE::containsMatchIn) -> null
        statusCode == 403 -> MkissaChallengeKind.CAPTCHA
        else -> null
    }

    fun cryptoFailure(responseBody: String): Boolean = errorMessages(responseBody).any(CRYPTO_STALE::containsMatchIn)

    private fun errorMessages(body: String): List<String> {
        val errors = runCatching { JSONObject(body.take(MAX_INSPECTION_CHARS)).optJSONArray("errors") }
            .getOrNull() ?: return emptyList()
        return (0 until minOf(errors.length(), 50)).flatMap { index ->
            val error = errors.optJSONObject(index) ?: return@flatMap emptyList()
            listOfNotNull(
                error.optString("message").takeIf { it.isNotBlank() },
                error.optJSONObject("extensions")?.optString("code")?.takeIf { it.isNotBlank() },
            ).map { it.take(160) }
        }
    }

    private const val MAX_INSPECTION_CHARS = 64 * 1024
    private val CAPTCHA = Regex("NEED_CAPTCHA|captcha|security.?check|security.?challenge|verify.{0,20}human", RegexOption.IGNORE_CASE)
    private val RATE_LIMIT = Regex("rate.?limit|too.many.requests", RegexOption.IGNORE_CASE)
    internal val CRYPTO_STALE = Regex("^AA_CRYPTO_|crypto.*(?:mismatch|stale|invalid)", RegexOption.IGNORE_CASE)
    private val HTML_CHALLENGE = Regex(
        "cf-chl-|<title[^>]*>[^<]*(?:just a moment|attention required|verify.{0,20}human)|<form[^>]*(?:challenge|captcha)",
        RegexOption.IGNORE_CASE,
    )
}

internal data class MkissaGraphQlError(val code: String?, val message: String?) {
    fun cryptoFailure(): Boolean = listOfNotNull(code, message).any(MkissaChallengePolicy.CRYPTO_STALE::containsMatchIn)

    fun challengeKind(): MkissaChallengeKind? = MkissaChallengePolicy.classifyMessages(
        statusCode = 200,
        messages = listOfNotNull(code, message),
    )
}
