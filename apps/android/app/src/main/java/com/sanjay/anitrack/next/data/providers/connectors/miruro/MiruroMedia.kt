package com.sanjay.anitrack.next.data.providers.connectors.miruro

import com.sanjay.anitrack.next.data.providers.PlaybackBackend
import com.sanjay.anitrack.next.data.providers.ProviderSubtitle
import com.sanjay.anitrack.next.data.providers.ResolvedMedia
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject

/** Direct media only. Embed URLs and expiring URL values are never printable. */
internal class MiruroMedia(
    val url: String,
    val hls: Boolean,
    val referer: String,
    val subtitles: List<ProviderSubtitle>,
) {
    fun resolved(userAgent: String) = ResolvedMedia(
        url = url, referer = referer, userAgent = userAgent,
        requestHeaders = if (referer.isEmpty()) emptyMap() else mapOf("Referer" to referer),
        // Miruro manifests can send video segments and subtitles to a rotating
        // HTTPS CDN host. The Referer is public hotlink context, never a cookie
        // or token, so carry it only to recognized HLS media paths.
        authorizationScope = if (hls) StreamAuthorizationScope.PUBLIC_HLS else StreamAuthorizationScope.EXACT,
        subtitles = subtitles, backend = PlaybackBackend.NATIVE,
        seekMode = if (hls) SeekMode.CLOSEST_SYNC else SeekMode.EXACT,
        downloadable = false,
        conservativeNetwork = true,
        mimeType = if (hls) "application/x-mpegURL" else "video/mp4",
    )

    override fun toString() = "MiruroMedia([redacted], hls=$hls)"
}

internal object MiruroMediaParser {
    /** Conservative subset of the observed universal-source response. No embed extraction. */
    fun directMedia(source: JSONObject): List<MiruroMedia> {
        val subs = source.optJSONArray("subtitles")
        val subtitles = (0 until minOf(subs?.length() ?: 0, 32)).mapNotNull { index ->
            val sub = subs?.optJSONObject(index) ?: return@mapNotNull null
            val url = https(sub.opt("file") as? String) ?: return@mapNotNull null
            val kind = sub.optString("kind").lowercase()
            val label = (sub.opt("label") as? String)?.takeIf { it.isNotBlank() }?.take(100) ?: "Subtitles"
            if (kind in setOf("thumbnails", "metadata", "chapters") || label.contains("thumbnail", true)) return@mapNotNull null
            val declared = (sub.opt("format") as? String)?.lowercase()?.trim().orEmpty()
            val extension = url.toHttpUrlOrNull()?.pathSegments?.lastOrNull()?.substringAfterLast('.', "")?.lowercase().orEmpty()
            // Explicit unknown encodings are not assumed to be WebVTT.
            val format = declared.takeIf { it.isNotBlank() } ?: extension
            val mime = when (format) {
                "vtt", "webvtt", "text/vtt" -> "text/vtt"
                "srt", "subrip", "application/x-subrip" -> "application/x-subrip"
                "ass", "ssa", "text/x-ssa" -> "text/x-ssa"
                "ttml", "dfxp", "application/ttml+xml" -> "application/ttml+xml"
                else -> return@mapNotNull null
            }
            val rawLanguage = (sub.opt("language") as? String)?.lowercase()?.trim()
            val language = when {
                rawLanguage in setOf("english", "eng", "en") || label.startsWith("English", true) -> "en"
                rawLanguage?.matches(Regex("[a-z]{2,3}(-[a-z0-9]{2,8})*")) == true -> rawLanguage
                else -> null
            }
            ProviderSubtitle(url, label, mime, language, sub.opt("default") == true)
        }.distinctBy { it.url }.sortedWith(compareByDescending<ProviderSubtitle> { it.language == "en" }.thenByDescending { it.default })
        val streams = source.optJSONArray("streams") ?: return emptyList()
        return (0 until minOf(streams.length(), 32)).mapNotNull { index ->
            val stream = streams.optJSONObject(index) ?: return@mapNotNull null
            val kind = stream.optString("type").lowercase()
            if (kind !in setOf("hls", "m3u8", "mp4")) return@mapNotNull null
            val url = https(stream.opt("url") as? String) ?: return@mapNotNull null
            val rawReferer = stream.opt("referer") as? String
            val referer = if (rawReferer.isNullOrBlank()) "" else https(rawReferer) ?: return@mapNotNull null
            stream.optBoolean("default") to MiruroMedia(url, kind != "mp4", referer, subtitles)
        }.sortedByDescending { it.first }.map { it.second }.distinctBy { it.url }
    }

    private fun https(value: String?): String? {
        if (value.isNullOrBlank() || value.length > 8192 || value.any { it.code <= 32 || it.code == 127 || it == '\\' }) return null
        val url = value.toHttpUrlOrNull() ?: return null
        val host = url.host
        if (url.scheme != "https" || url.port != 443 || url.username.isNotEmpty() || url.password.isNotEmpty()) return null
        // CDN names only; reject IP literals (including canonicalized numeric aliases) and local names.
        if ('.' !in host || ':' in host || host.all { it.isDigit() || it == '.' } ||
            listOf("localhost", "local", "internal", "lan", "home", "invalid").any { host == it || host.endsWith(".$it") }
        ) return null
        return url.toString()
    }
}
