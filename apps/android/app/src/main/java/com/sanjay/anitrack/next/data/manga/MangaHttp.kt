package com.sanjay.anitrack.next.data.manga

import com.sanjay.anitrack.next.data.Html
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** A reading-source failure whose message is safe to show the user. */
/** [status] is the HTTP status when the failure was an HTTP response. */
open class MangaSourceException(message: String, val status: Int? = null) : Exception(message)

/**
 * The source's site is showing a human-verification check (e.g. Cloudflare).
 * AniTrack never solves it: the user completes it on the source's connection
 * screen, after which the request can be repeated.
 */
class MangaVerificationRequired(label: String) :
    MangaSourceException("$label needs a quick check. Tap Connect $label, complete it, then retry.", 403)

/** URL rules for catalogue and page-image addresses supplied by reading sources. */
internal object MangaUrlPolicy {
    /**
     * Returns the URL as a [URI] when it is an HTTPS address of a public host:
     * no credentials, control characters, IP literals or local names. Ports other
     * than 443 are refused unless [allowPort] (MangaDex@Home nodes may use one).
     */
    fun publicHttps(value: String, allowPort: Boolean = false): URI? {
        if (value.length > 2048 || value.any { it.code < 0x21 || it.code == 0x7f }) return null
        val uri = runCatching { URI(value) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.userInfo != null) return null
        val host = uri.host?.lowercase() ?: return null
        if (!allowPort && uri.port != -1 && uri.port != 443) return null
        if (uri.port != -1 && uri.port !in 1..65535) return null
        if (isLocalName(host) || isIpLiteral(host)) return null
        return uri
    }

    fun requireHost(value: String, hosts: Set<String>): URI {
        val uri = publicHttps(value) ?: throw MangaSourceException("Refused an unsafe address.")
        if (uri.host.lowercase() !in hosts) throw MangaSourceException("Refused an unexpected host.")
        return uri
    }

    private fun isLocalName(host: String): Boolean =
        '.' !in host || host == "localhost" ||
            LOCAL_SUFFIXES.any { host.endsWith(it) }

    private fun isIpLiteral(host: String): Boolean =
        ':' in host || host.startsWith('[') || IPV4.matches(host)

    fun isPublicAddress(address: InetAddress): Boolean =
        !address.isAnyLocalAddress && !address.isLoopbackAddress && !address.isLinkLocalAddress &&
            !address.isSiteLocalAddress && !address.isMulticastAddress &&
            // Carrier-grade NAT (100.64.0.0/10) and IPv6 unique-local (fc00::/7).
            !(address.address.size == 4 && address.address[0].toInt() == 100 && (address.address[1].toInt() and 0xC0) == 64) &&
            !(address.address.size == 16 && (address.address[0].toInt() and 0xFE) == 0xFC)

    private val LOCAL_SUFFIXES = listOf(".localhost", ".local", ".internal", ".lan", ".home.arpa", ".localdomain")
    private val IPV4 = Regex("^[0-9.]+$")
}

/** DNS that refuses answers pointing a public name at the local network. */
internal object MangaPublicDns : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
        val addresses = Dns.SYSTEM.lookup(hostname)
        if (addresses.isEmpty() || addresses.any { !MangaUrlPolicy.isPublicAddress(it) }) {
            throw IOException("Refused a local-network address")
        }
        return addresses
    }
}

/**
 * Catalogue HTTP for one reading source: fixed hosts, serialized requests with a
 * minimum spacing, bounded bodies and no automatic retry loop. Challenge and
 * rate-limit responses stop the attempt with a message instead of retrying.
 */
internal class MangaHttp(
    private val label: String,
    private val hosts: Set<String>,
    private val userAgent: () -> String,
    private val spacingMs: Long,
    client: OkHttpClient? = null,
    /** Extra headers resolved per request, e.g. a user-verified session's cookies. */
    private val headers: () -> Map<String, String> = { emptyMap() },
    /** Report a human-verification page as [MangaVerificationRequired]. */
    private val verifiable: Boolean = false,
) {
    private val http = client ?: OkHttpClient.Builder()
        .dns(MangaPublicDns)
        .connectTimeout(10, TimeUnit.SECONDS)
        .callTimeout(25, TimeUnit.SECONDS)
        .build()
    private val lock = Mutex()
    private var lastCallAt = 0L

    suspend fun get(url: String, accept: String, maxBytes: Int): String {
        MangaUrlPolicy.requireHost(url, hosts)
        val request = Request.Builder().url(url)
            .header("User-Agent", userAgent())
            .header("Accept", accept)
            .apply { headers().forEach { (name, value) -> header(name, value) } }
            .build()
        return lock.withLock {
            val wait = spacingMs - (System.currentTimeMillis() - lastCallAt)
            if (wait > 0) delay(wait)
            try {
                http.newCall(request).await().use { response -> read(response, maxBytes) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: MangaSourceException) {
                throw e
            } catch (e: IOException) {
                throw MangaSourceException("$label couldn't be reached. Check your connection and retry.")
            } finally {
                lastCallAt = System.currentTimeMillis()
            }
        }
    }

    private suspend fun read(response: Response, maxBytes: Int): String = withContext(Dispatchers.IO) {
        // Redirects may only stay on the source's own hosts.
        if (response.request.url.host.lowercase() !in hosts) {
            throw MangaSourceException("$label redirected somewhere unexpected.")
        }
        if (verifiable && response.header("cf-mitigated").equals("challenge", ignoreCase = true)) {
            throw MangaVerificationRequired(label)
        }
        when (response.code) {
            in 200..299 -> Unit
            404 -> throw MangaSourceException("$label doesn't have this anymore.", 404)
            429 -> throw MangaSourceException("$label is limiting requests. Wait a minute, then retry.", 429)
            403, 503 -> {
                val page = runCatching { response.peekBody(16 * 1024).string() }.getOrDefault("")
                if (verifiable && CHALLENGE.containsMatchIn(page)) throw MangaVerificationRequired(label)
                throw MangaSourceException("$label refused the request. Try again later.", response.code)
            }
            else -> throw MangaSourceException("$label returned an error (HTTP ${response.code}).", response.code)
        }
        val body = response.body ?: throw MangaSourceException("$label sent an empty response.")
        if (body.contentLength() > maxBytes) throw MangaSourceException("$label sent an unexpectedly large response.")
        val out = ByteArrayOutputStream()
        body.byteStream().use { stream ->
            val chunk = ByteArray(16 * 1024)
            while (true) {
                val n = stream.read(chunk)
                if (n < 0) break
                if (out.size() + n > maxBytes) throw MangaSourceException("$label sent an unexpectedly large response.")
                out.write(chunk, 0, n)
            }
        }
        val text = out.toString(Charsets.UTF_8.name())
        if (CHALLENGE.containsMatchIn(text.take(4096))) {
            if (verifiable) throw MangaVerificationRequired(label)
            throw MangaSourceException("$label is showing a browser check. Try again later.")
        }
        text
    }

    companion object {
        /** An honest client identity; MangaDex forbids spoofed browser user agents. */
        val USER_AGENT = "AniTrack/${com.sanjay.anitrack.next.BuildConfig.VERSION_NAME} (Android)"

        private val CHALLENGE = Regex(
            "<title[^>]*>\\s*(?:just a moment|attention required)|_cf_chl_opt|verify you are human",
            RegexOption.IGNORE_CASE,
        )
    }
}

internal suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { runCatching { cancel() } }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }

        override fun onResponse(call: Call, response: Response) {
            if (continuation.isActive) continuation.resume(response) else response.close()
        }
    })
}

/** Title normalization shared by the reading-source matchers. */
internal object MangaTitles {
    private val NON_ALNUM = Regex("[^a-z0-9]+")
    private val MARKS = Regex("\\p{Mn}+")

    fun normalize(value: String): String =
        java.text.Normalizer.normalize(Html.decode(value), java.text.Normalizer.Form.NFKD)
            .replace(MARKS, "")
            .lowercase()
            .replace(NON_ALNUM, "")

    /** The AniList names a source title may legitimately carry. */
    fun names(manga: com.sanjay.anitrack.next.data.Manga): Set<String> =
        (listOfNotNull(manga.title, manga.titleRomaji) + manga.synonyms)
            .map(::normalize)
            .filter { it.length >= 2 }
            .toSet()
}
