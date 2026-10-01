package com.sanjay.anitrack.next.data.providers.connectors.miruro

import okhttp3.Request

/** App-owned session values are never printable data classes or persisted by the connector. */
internal class MiruroRequestSession(val userAgent: String, val cookies: String?) {
    override fun toString(): String = "MiruroRequestSession([redacted])"
}

internal object MiruroRequestPolicy {
    fun request(url: String, sessionForUrl: ((String) -> MiruroRequestSession?)? = null): Request {
        val builder = Request.Builder().url(url).header("Accept", "application/json, text/plain, */*")
        val parsed = builder.build().url
        if (parsed.scheme != "https" || parsed.host != "www.miruro.ru" || parsed.port != 443 ||
            parsed.username.isNotEmpty() || parsed.password.isNotEmpty() ||
            parsed.encodedPath !in listOf("/api/secure/pipe", "/env2.js")
        ) throw MiruroProtocolException("Miruro request left its approved origin")
        // Validate the destination before accessing session state. Redirects remain disabled.
        sessionForUrl?.invoke(parsed.toString())?.let { session ->
            fun valid(value: String, cap: Int) = value.length <= cap && value.all { it.code in 32..126 }
            if (session.userAgent.isBlank() || !valid(session.userAgent, 1024) ||
                session.cookies?.let { !valid(it, 32_768) } == true
            ) throw MiruroProtocolException("Invalid Miruro session headers")
            builder.header("User-Agent", session.userAgent)
            session.cookies?.takeIf { it.isNotBlank() }?.let { builder.header("Cookie", it) }
        }
        return builder.build()
    }
}
