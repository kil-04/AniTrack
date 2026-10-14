package com.sanjay.anitrack.next.diagnostics

import java.net.URI

/** Fixed diagnostic categories only; no network URL or query value leaves the test process. */
internal object ProviderProbeRequestKind {
    enum class EngineLoadKind { MANIFEST, INITIALIZATION, MEDIA, OTHER }

    fun withEngineContext(urlKind: String, loadKind: EngineLoadKind, textTrack: Boolean): String {
        if (urlKind != "unknown") return urlKind
        if (textTrack) return "caption"
        return when (loadKind) {
            EngineLoadKind.MANIFEST -> "manifest"
            EngineLoadKind.INITIALIZATION -> "media-initialization"
            // A progressive MP4 and an HLS segment both use DATA_TYPE_MEDIA;
            // do not claim segment identity without URI/manifest evidence.
            EngineLoadKind.MEDIA -> "media-load"
            EngineLoadKind.OTHER -> "unknown"
        }
    }

    fun classify(requestUrl: String?, mediaUrl: String?, subtitleUrls: List<String>): String {
        if (requestUrl == null) return "unknown"
        if (requestUrl == mediaUrl) return "main-media"
        if (subtitleUrls.take(32).any { it == requestUrl }) return "caption"
        val path = runCatching { URI(requestUrl).rawPath?.lowercase() }.getOrNull() ?: return "unknown"
        return when {
            path.endsWith(".m3u8") || path.endsWith(".mpd") -> "manifest"
            path.endsWith(".vtt") || path.endsWith(".srt") || path.endsWith(".ass") || path.endsWith(".ttml") -> "caption"
            path.endsWith(".ts") || path.endsWith(".m4s") || path.endsWith(".aac") || path.endsWith(".mp4") -> "media-segment"
            path.endsWith(".key") -> "media-key"
            else -> "unknown"
        }
    }
}
