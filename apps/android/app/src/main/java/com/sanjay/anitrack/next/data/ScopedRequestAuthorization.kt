package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import java.net.URI

/**
 * Applies provider credentials only to the resolved media URL or its HLS
 * directory. Explicitly public hotlink headers may also follow playlists to a
 * rotating HTTPS media host. This is deliberately independent of the HTTP
 * implementation so the same rule covers Cronet and OkHttp-backed sources.
 */
internal class ScopedRequestAuthorization private constructor(
    private val root: Target,
    private val scope: StreamAuthorizationScope,
    private val headers: Map<String, String>,
) {
    fun headersFor(rawUrl: String): Map<String, String> {
        val candidate = Target.parse(rawUrl) ?: return emptyMap()
        if (candidate.origin != root.origin && scope != StreamAuthorizationScope.PUBLIC_HLS) return emptyMap()
        val authorized = when (scope) {
            StreamAuthorizationScope.EXACT -> candidate.pathAndQuery == root.pathAndQuery
            StreamAuthorizationScope.DIRECTORY -> candidate.path.startsWith(root.directory)
            StreamAuthorizationScope.PUBLIC_HLS ->
                (candidate.origin == root.origin && candidate.path.startsWith(root.directory)) ||
                    candidate.hasPublicHlsMediaPath()
        }
        return if (authorized) headers else emptyMap()
    }

    companion object {
        fun create(
            rootUrl: String,
            scope: StreamAuthorizationScope,
            headers: Map<String, String>,
        ): ScopedRequestAuthorization? {
            if (headers.isEmpty()) return null
            if (scope == StreamAuthorizationScope.PUBLIC_HLS &&
                headers.keys.any { it.lowercase() !in PUBLIC_HLS_HEADERS }
            ) return null
            val root = Target.parse(rootUrl) ?: return null
            return ScopedRequestAuthorization(root, scope, headers.toMap())
        }

        private val PUBLIC_HLS_HEADERS = setOf("accept", "origin", "referer", "user-agent")
    }

    private data class Target(
        val origin: String,
        val path: String,
        val pathAndQuery: String,
        val directory: String,
    ) {
        fun hasPublicHlsMediaPath(): Boolean {
            val lowerPath = path.lowercase()
            val fileName = lowerPath.substringAfterLast('/')
            return PUBLIC_HLS_EXTENSIONS.any(lowerPath::endsWith) ||
                PUBLIC_HLS_SEGMENT.matches(fileName)
        }

        companion object {
            private val PUBLIC_HLS_EXTENSIONS = setOf(
                ".m3u8", ".ts", ".m4s", ".mp4", ".aac", ".vtt", ".key", ".jpg",
            )
            private val PUBLIC_HLS_SEGMENT = Regex("^seg-\\d+[a-z0-9._-]{0,120}$")

            fun parse(rawUrl: String): Target? = runCatching {
                if (rawUrl.any { it == '\r' || it == '\n' || it == '\u0000' }) return null
                val uri = URI(rawUrl).normalize()
                val scheme = uri.scheme?.lowercase()
                val host = uri.host?.lowercase()
                if (scheme != "https" || host.isNullOrBlank() || uri.userInfo != null) return null
                if (uri.port != -1 && uri.port != 443) return null
                val path = uri.rawPath?.ifEmpty { "/" } ?: "/"
                val directory = path.substringBeforeLast('/', "") + "/"
                val origin = "https://$host"
                val pathAndQuery = path + (uri.rawQuery?.let { "?$it" } ?: "")
                Target(origin, path, pathAndQuery, directory)
            }.getOrNull()
        }
    }
}
