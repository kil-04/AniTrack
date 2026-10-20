package com.sanjay.anitrack.next.data.providers.connectors.anichan

import java.net.URI

/** Exact source/session destinations; title slug canonicalization may never change the show/episode. */
internal object AniChanPagePolicy {
    private fun url(raw: String): URI? {
        if (raw.length !in 1..8_192 || raw.any { it.code <= 0x20 || it.code == 0x7f || it == '\\' }) return null
        val uri = runCatching { URI(raw) }.getOrNull() ?: return null
        return uri.takeIf { it.scheme.equals("https", true) && it.rawUserInfo == null && (it.port == -1 || it.port == 443) }
    }

    private fun watchPath(path: String, animeId: Int): Boolean = animeId > 0 &&
        Regex("/anime/$animeId/[a-z0-9][a-z0-9-]{0,199}/1").matches(path)

    fun allowed(raw: String, main: Boolean, animeId: Int): Boolean {
        val uri = url(raw) ?: return false
        val host = uri.host?.lowercase() ?: return false
        if (!main) return host in setOf("anichan.to", "challenges.cloudflare.com")
        return host == "anichan.to" && (uri.rawPath == "/" || uri.rawPath.startsWith("/cdn-cgi/") || watchPath(uri.rawPath, animeId))
    }

    fun loaded(raw: String, target: String, animeId: Int): Boolean {
        val actual = url(raw) ?: return false
        val wanted = url(target) ?: return false
        if (actual.host?.lowercase() != "anichan.to" || wanted.host?.lowercase() != "anichan.to") return false
        return if (wanted.rawPath == "/") actual.rawPath == "/"
        else watchPath(wanted.rawPath, animeId) && watchPath(actual.rawPath, animeId)
    }
}
