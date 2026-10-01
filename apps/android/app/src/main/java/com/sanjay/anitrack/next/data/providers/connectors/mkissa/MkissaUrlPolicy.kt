package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import okhttp3.Dns
import java.io.IOException
import java.net.InetAddress
import java.net.URI

internal object MkissaUrlPolicy {
    private val providerHosts = setOf("mkissa.to", "api.mkissa.net", "cdn.mkissa.net")

    fun requireProviderUrl(value: String): String {
        val uri = requirePublicHttps(value)
        require(uri.host.lowercase() in providerHosts) { "Untrusted MKissa endpoint" }
        return uri.toASCIIString()
    }

    fun requireMediaUrl(value: String): String = requirePublicHttps(value).toASCIIString()

    fun resolveProviderUrl(base: String, reference: String): String {
        val resolved = URI(requireProviderUrl(base)).resolve(reference)
        return requireProviderUrl(resolved.toString())
    }

    private fun requirePublicHttps(value: String): URI {
        require(value.none { it.code < 0x20 || it.code == 0x7f }) { "Control characters are rejected" }
        val trimmed = value.trim()
        val uri = runCatching { URI(trimmed) }
            .getOrElse { throw IllegalArgumentException("Invalid URL", it) }
        val host = uri.host?.lowercase()?.removePrefix("[")?.removeSuffix("]").orEmpty()
        require(uri.scheme.equals("https", ignoreCase = true)) { "Only HTTPS URLs are accepted" }
        require(uri.userInfo == null && host.isNotBlank()) { "URL credentials and hostless URLs are rejected" }
        require(uri.port == -1 || uri.port == 443) { "Non-standard HTTPS ports are rejected" }
        require(!isForbiddenHost(host)) { "Local and private URLs are rejected" }
        return uri
    }

    private fun isForbiddenHost(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true
        if (host == "::" || host == "::1" || host == "0:0:0:0:0:0:0:1") return true
        val parts = host.split('.')
        if (parts.size == 4 && parts.all { it.toIntOrNull() in 0..255 }) {
            val first = parts[0].toInt()
            val second = parts[1].toInt()
            return first == 0 || first == 10 || first == 127 ||
                (first == 100 && second in 64..127) ||
                (first == 169 && second == 254) ||
                (first == 172 && second in 16..31) ||
                (first == 192 && second == 168) ||
                (first == 198 && second in 18..19) || first >= 224
        }
        if (':' in host) {
            val parsed = runCatching { InetAddress.getByName(host) }.getOrNull() ?: return true
            return !isPublicAddress(parsed)
        }
        return false
    }

    fun isPublicAddress(address: InetAddress): Boolean =
        !address.isAnyLocalAddress && !address.isLoopbackAddress && !address.isLinkLocalAddress &&
            !address.isSiteLocalAddress && !address.isMulticastAddress
}

/** Prevents DNS answers for provider/media hosts from silently targeting the local network. */
internal object MkissaPublicDns : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
        val addresses = Dns.SYSTEM.lookup(hostname)
        if (addresses.isEmpty() || addresses.any { !MkissaUrlPolicy.isPublicAddress(it) }) {
            throw IOException("Unsafe DNS answer for $hostname")
        }
        return addresses
    }
}
