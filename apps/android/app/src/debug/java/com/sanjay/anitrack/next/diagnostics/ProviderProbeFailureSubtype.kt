package com.sanjay.anitrack.next.diagnostics

import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroFailure
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroProtocolException
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaChallengeKind
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaProtocolException
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaRateLimitedException
import com.sanjay.anitrack.next.data.providers.connectors.mkissa.MkissaUnsupportedSourceException
import java.util.IdentityHashMap

/** Fixed reviewed categories only. Never inspect/export messages, response bodies or URLs. */
internal object ProviderProbeFailureSubtype {
    fun classify(error: Throwable): String? {
        val visited = IdentityHashMap<Throwable, Boolean>()
        var current: Throwable? = error
        var ordinaryFailure: String? = null
        repeat(8) {
            val failure = current ?: return ordinaryFailure
            if (visited.put(failure, true) != null) return ordinaryFailure
            when (failure) {
                is MkissaRateLimitedException -> return when (failure.kind) {
                    MkissaChallengeKind.CAPTCHA -> "CAPTCHA_REQUIRED"
                    MkissaChallengeKind.RATE_LIMIT -> "RATE_LIMIT"
                }
                is MiruroProtocolException -> when (failure.failure) {
                    MiruroFailure.SECURITY_CHECK -> return "SECURITY_CHECK"
                    MiruroFailure.RATE_LIMITED -> return "RATE_LIMITED"
                    MiruroFailure.INVALID_RESPONSE -> if (ordinaryFailure == null) ordinaryFailure = "INVALID_RESPONSE"
                }
                is MkissaProtocolException -> if (ordinaryFailure == null) ordinaryFailure = "INVALID_RESPONSE"
                is MkissaUnsupportedSourceException -> if (ordinaryFailure == null) ordinaryFailure = "UNSUPPORTED_SOURCE"
            }
            current = failure.cause
        }
        return ordinaryFailure
    }
}
