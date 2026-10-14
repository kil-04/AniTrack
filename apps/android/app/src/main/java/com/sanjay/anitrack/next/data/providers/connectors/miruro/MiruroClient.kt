package com.sanjay.anitrack.next.data.providers.connectors.miruro

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

internal class MiruroHttpResponse(
    val status: Int,
    val text: String = "",
    val obfuscated: String? = null,
    val bytes: ByteArray? = null,
    val contentType: String = "",
) {
    override fun toString() = "MiruroHttpResponse(status=$status, body=[redacted])"
}
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
    private val issued = AtomicLong()
    private var blockedThrough = 0L
    private var blockedFailure = MiruroFailure.SECURITY_CHECK

    suspend fun read(request: MiruroV1ReadRequest): JSONObject {
        val url = MiruroV1Protocol.requestUrl(request)
        val sequence = issued.incrementAndGet()
        return mutex.withLock {
            if (sequence <= blockedThrough) throw MiruroProtocolException("Miruro stopped queued reads after an access rejection", blockedFailure)
            try {
                val response = transport.get(url, MiruroProtocol.MAX_RESPONSE_BYTES)
                // 403/429 stop before decoding/allocating any error body.
                rejectChallenge(response.status, "")
                if (response.status in 300..399) throw MiruroProtocolException("Miruro redirected its API; connector review is required")
                val bytes = response.bytes ?: response.text.toByteArray(Charsets.UTF_8)
                if (bytes.size > MiruroProtocol.MAX_RESPONSE_BYTES) throw MiruroProtocolException("Miruro response exceeded its size limit")
                val prefix = String(bytes, 0, minOf(bytes.size, 32_768), Charsets.UTF_8)
                rejectChallenge(response.status, prefix.takeIf { it.trimStart().startsWith("<") }.orEmpty())
                if (response.status !in 200..299) {
                    rejectChallenge(response.status, prefix)
                    throw MiruroProtocolException("Miruro catalogue request failed (HTTP ${response.status})")
                }
                val payload = MiruroV1Protocol.decode(bytes, response.contentType)
                rejectChallenge(200, listOf("error", "message", "code").mapNotNull { payload.opt(it) as? String }.joinToString(" "))
                payload
            } catch (error: MiruroProtocolException) {
                if (error.failure != MiruroFailure.INVALID_RESPONSE) {
                    blockedThrough = issued.get()
                    blockedFailure = error.failure
                }
                throw error
            }
        }
    }

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
            if (response.code in listOf(403, 429)) return@use MiruroHttpResponse(response.code)
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
            val bytes = output.toByteArray()
            if (response.header("Content-Type").orEmpty().substringBefore(';').trim().equals("application/octet-stream", true)) {
                MiruroHttpResponse(response.code, bytes = bytes, contentType = response.header("Content-Type").orEmpty())
            } else MiruroHttpResponse(response.code, MiruroProtocol.utf8(bytes), response.header("x-obfuscated"),
                bytes = bytes, contentType = response.header("Content-Type").orEmpty())
        }
    }
}
