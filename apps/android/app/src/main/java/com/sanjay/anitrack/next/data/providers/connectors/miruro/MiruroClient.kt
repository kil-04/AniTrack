package com.sanjay.anitrack.next.data.providers.connectors.miruro

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

internal data class MiruroHttpResponse(val status: Int, val text: String, val obfuscated: String? = null)
internal fun interface MiruroTransport {
    suspend fun get(url: String, maximumBytes: Int): MiruroHttpResponse
}

/** Staged transport. Instantiation makes no requests; no retry or alternate-host fallback. */
internal class MiruroClient(
    private val transport: MiruroTransport = MiruroHttpTransport(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()
    private var key: String? = null
    private var keyExpiresAt = 0L

    suspend fun read(request: MiruroReadRequest): JSONObject {
        val url = MiruroProtocol.requestUrl(request)
        // Serialize requests; each failure ends its attempt without automatic retries.
        return mutex.withLock {
            val response = get(url, MiruroProtocol.MAX_RESPONSE_BYTES)
            if (response.obfuscated == "2" && (key == null || keyExpiresAt <= now())) {
                val environment = get("${MiruroProtocol.ORIGIN}/env2.js", MiruroProtocol.MAX_ENV_BYTES)
                key = MiruroProtocol.environmentKey(environment.text)
                keyExpiresAt = now() + 30 * 60_000
            }
            val payload = MiruroProtocol.decode(response.text, response.obfuscated, key)
            val errorText = listOf("error", "message", "code").mapNotNull { payload.opt(it) as? String }.joinToString(" ")
            rejectChallenge(200, errorText)
            payload
        }
    }

    private fun rejectChallenge(status: Int, text: String) {
        MiruroProtocol.responseFailure(status, text)?.let {
            throw it
        }
    }

    private suspend fun get(url: String, maximumBytes: Int): MiruroHttpResponse {
        val response = transport.get(url, maximumBytes)
        // Catalogue titles/descriptions are not challenge messages. Structured
        // error fields are checked separately after decoding the API envelope.
        rejectChallenge(response.status, response.text.takeIf { it.trimStart().startsWith("<") }.orEmpty())
        if (response.status in 300..399) throw MiruroProtocolException("Miruro redirected its API; connector review is required")
        if (response.status !in 200..299) throw MiruroProtocolException("Miruro request failed (HTTP ${response.status})")
        if (response.text.toByteArray(Charsets.UTF_8).size > maximumBytes) throw MiruroProtocolException("Miruro response exceeded its size limit")
        return response
    }
}

internal class MiruroHttpTransport(
    private val sessionForUrl: ((String) -> MiruroRequestSession?)? = null,
) : MiruroTransport {
    private val http = OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .callTimeout(15, TimeUnit.SECONDS).build()

    override suspend fun get(url: String, maximumBytes: Int): MiruroHttpResponse = withContext(Dispatchers.IO) {
        val request = MiruroRequestPolicy.request(url, sessionForUrl)
        http.newCall(request).execute().use { response ->
            // Security status must reach the session policy even with an oversized body.
            if (!response.isSuccessful) return@use MiruroHttpResponse(response.code, "")
            val body = response.body
            if (body != null && body.contentLength() > maximumBytes) throw MiruroProtocolException("Miruro response exceeded its size limit")
            val output = ByteArrayOutputStream()
            body?.byteStream()?.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count == -1) break
                    if (output.size() + count > maximumBytes) throw MiruroProtocolException("Miruro response exceeded its size limit")
                    output.write(buffer, 0, count)
                }
            }
            MiruroHttpResponse(response.code, MiruroProtocol.utf8(output.toByteArray()), response.header("x-obfuscated"))
        }
    }
}
