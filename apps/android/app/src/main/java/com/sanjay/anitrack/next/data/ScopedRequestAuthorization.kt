package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope
import java.net.InetAddress
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
    private val exactAdditional: Map<String, Map<String, String>>,
) {
    fun headersFor(rawUrl: String): Map<String, String> {
        val candidate = Target.parse(rawUrl) ?: return emptyMap()
        exactAdditional[candidate.origin + candidate.pathAndQuery]?.let { return it }
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
            /** Validated connector-offered caption URLs, never sibling paths. */
            exactAdditionalUrls: List<String> = emptyList(),
        ): ScopedRequestAuthorization? {
            if (headers.isEmpty()) return null
            if (scope == StreamAuthorizationScope.PUBLIC_HLS &&
                headers.keys.any { it.lowercase() !in PUBLIC_HLS_HEADERS }
            ) return null
            val root = Target.parse(rootUrl) ?: return null
            val additional = exactAdditionalUrls.take(32).mapNotNull { raw ->
                val target = Target.parse(raw) ?: return@mapNotNull null
                val safeHeaders = if (target.origin == root.origin) headers else
                    headers.filterKeys { it.lowercase() in PUBLIC_HLS_HEADERS }
                (target.origin + target.pathAndQuery) to safeHeaders.toMap()
            }.toMap()
            return ScopedRequestAuthorization(root, scope, headers.toMap(), additional)
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
            // Anikoto's CDN names segments per variant (seg-f1-00273.html) on rotating hosts.
            private val PUBLIC_HLS_SEGMENT = Regex("^seg-(?:f\\d+-)?\\d+[a-z0-9._-]{0,120}$")
            private val NUMERIC_HOST = Regex("^(?:0x[0-9a-f]+|[0-9]+)(?:\\.(?:0x[0-9a-f]+|[0-9]+))*$")

            fun parse(rawUrl: String): Target? = runCatching {
                if (rawUrl.any { it == '\r' || it == '\n' || it == '\u0000' }) return null
                val uri = URI(rawUrl).normalize()
                val scheme = uri.scheme?.lowercase()
                val host = uri.host?.lowercase()
                if (scheme != "https" || host.isNullOrBlank() || uri.userInfo != null) return null
                if (uri.port != -1 && uri.port != 443) return null
                val canonicalHost = host.removeSurrounding("[", "]").trimEnd('.')
                if (!isPublicHost(canonicalHost) ||
                    setOf("localhost", "local", "internal", "lan", "home").any { canonicalHost == it || canonicalHost.endsWith(".$it") }
                ) return null
                val path = uri.rawPath?.ifEmpty { "/" } ?: "/"
                val directory = path.substringBeforeLast('/', "") + "/"
                val origin = "https://$host"
                val pathAndQuery = path + (uri.rawQuery?.let { "?$it" } ?: "")
                Target(origin, path, pathAndQuery, directory)
            }.getOrNull()

            /** Check literals without resolving catalogue-controlled domain names. */
            private fun isPublicHost(host: String): Boolean {
                if (':' in host) {
                    // URI has already validated the IPv6 authority. Reject zone IDs;
                    // they select a local interface and are not public destinations.
                    if ('%' in host) return false
                    val bytes = runCatching { InetAddress.getByName(host).address }.getOrNull() ?: return false
                    // Only global unicast IPv6 is usable here. This also excludes
                    // mapped IPv4, NAT64, local, multicast and unspecified forms.
                    if (bytes.size != 16 || (bytes[0].toInt() and 0xe0) != 0x20) return false
                    val first = ((bytes[0].toInt() and 0xff) shl 8) or (bytes[1].toInt() and 0xff)
                    val second = ((bytes[2].toInt() and 0xff) shl 8) or (bytes[3].toInt() and 0xff)
                    // Protocol/transition, documentation and non-routable assignments
                    // inside the otherwise public global-unicast allocation.
                    if (first == 0x2001 && (second < 0x0200 || second == 0x0db8)) return false
                    if (first == 0x2002 || (first == 0x3fff && (second and 0xf000) == 0)) return false
                    return true
                }
                if (!NUMERIC_HOST.matches(host)) return true
                if ('x' in host) return false
                val parts = host.split('.')
                // Do not let platform-specific shortened, integer or octal forms
                // disguise a loopback/private address behind an apparently public URL.
                if (parts.size != 4 || parts.any { it.isEmpty() || (it.length > 1 && it.startsWith('0')) }) return false
                val octets = parts.map { it.toIntOrNull()?.takeIf { value -> value in 0..255 } ?: return false }
                val (first, second, third) = octets
                return !(first == 0 || first == 10 || first == 127 || first >= 224 ||
                    (first == 100 && second in 64..127) ||
                    (first == 169 && second == 254) ||
                    (first == 172 && second in 16..31) ||
                    (first == 192 && second == 168) ||
                    (first == 192 && second == 0 && third == 0 && octets[3] !in setOf(9, 10)) ||
                    (first == 192 && second == 0 && third == 2) ||
                    (first == 192 && second == 88 && third == 99) ||
                    (first == 198 && second in 18..19) ||
                    (first == 198 && second == 51 && third == 100) ||
                    (first == 203 && second == 0 && third == 113))
            }
        }
    }
}
