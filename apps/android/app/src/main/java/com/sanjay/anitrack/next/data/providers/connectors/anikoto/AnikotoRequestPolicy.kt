package com.sanjay.anitrack.next.data.providers.connectors.anikoto

import kotlinx.coroutines.CancellationException

internal class AnikotoAccessError(val code: Code) : IllegalStateException(
    when (code) {
        Code.SECURITY_CHECK -> "Anikoto requested verification. Complete the website check yourself or choose another provider."
        Code.RATE_LIMITED -> "Anikoto limited requests. Wait a minute or choose another provider."
        Code.COOLDOWN -> "Anikoto recently rejected a request. Wait a minute or choose another provider."
    },
) {
    enum class Code { SECURITY_CHECK, RATE_LIMITED, COOLDOWN }
}

/** A rejection stops this attempt, not a burst of requests to other origins/servers. */
internal class AnikotoRequestPolicy(private val now: () -> Long = System::currentTimeMillis) {
    private val blockedUntil = mutableMapOf<String, Long>()

    @Synchronized fun beforeRequest(origin: String) {
        if ((blockedUntil[origin] ?: 0L) > now()) throw AnikotoAccessError(AnikotoAccessError.Code.COOLDOWN)
        blockedUntil.remove(origin)
    }

    @Synchronized fun checkResponse(origin: String, status: Int, body: String = "") {
        val code = when {
            status == 429 -> AnikotoAccessError.Code.RATE_LIMITED
            status == 403 || challenge.containsMatchIn(body) -> AnikotoAccessError.Code.SECURITY_CHECK
            else -> null
        } ?: return
        blockedUntil[origin] = now() + 60_000L
        throw AnikotoAccessError(code)
    }

    companion object {
        // Challenge markers only: a show named "Security Check" is ordinary catalogue data.
        private val challenge = Regex(
            """<title>\s*(?:Just a moment|Attention Required|Security Check|Verify you are human)(?:[.!|\s][^<]*)?</title>|(?:id|class)=["'][^"']*\b(?:cf-challenge|challenge-form|g-recaptcha|h-captcha)\b|["'](?:error|code|message)["']\s*:\s*["'](?:CAPTCHA_REQUIRED|NEED_CAPTCHA|CHALLENGE_REQUIRED|SECURITY_CHECK_REQUIRED)["']""",
            RegexOption.IGNORE_CASE,
        )

        fun rethrowTerminal(error: Throwable) {
            if (error is CancellationException || error is AnikotoAccessError) throw error
        }
    }
}
