package com.sanjay.anitrack.next.data.providers.connectors.mkissa

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal data class MkissaHttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
)

internal data class MkissaHttpResponse(val code: Int, val body: String) {
    val successful: Boolean get() = code in 200..299
}

internal fun interface MkissaHttpTransport {
    suspend fun execute(request: MkissaHttpRequest): MkissaHttpResponse
}

/**
 * Uses the browser-grade Cronet stack only when Android's TLS stack is rejected by an embed host.
 * Provider API requests keep the smaller OkHttp path, and every Cronet URL still passes the same
 * public-HTTPS policy before any bytes leave the device.
 */
internal object MkissaNetwork {
    @Volatile private var appContext: Context? = null

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    fun transport(): MkissaHttpTransport {
        val primary = MkissaOkHttpTransport()
        val context = appContext ?: return primary
        val engine = runCatching {
            androidx.media3.datasource.cronet.CronetUtil.buildCronetEngine(context)
        }.getOrNull() ?: return primary
        val browser = MkissaCronetHttpTransport(engine)
        return MkissaHttpTransport { request ->
            try {
                primary.execute(request)
            } catch (error: IOException) {
                browser.execute(request)
            }
        }
    }
}

private class MkissaCronetHttpTransport(
    private val engine: org.chromium.net.CronetEngine,
) : MkissaHttpTransport {
    private val executor = Executors.newCachedThreadPool()

    override suspend fun execute(request: MkissaHttpRequest): MkissaHttpResponse =
        suspendCancellableCoroutine { continuation ->
            val safeUrl = when {
                request.url.startsWith("https://mkissa.to") ||
                    request.url.startsWith("https://api.mkissa.net") ||
                    request.url.startsWith("https://cdn.mkissa.net") -> MkissaUrlPolicy.requireProviderUrl(request.url)
                else -> MkissaUrlPolicy.requireMediaUrl(request.url)
            }
            val output = ByteArrayOutputStream(8_192)
            lateinit var call: org.chromium.net.UrlRequest
            val callback = object : org.chromium.net.UrlRequest.Callback() {
                override fun onRedirectReceived(
                    request: org.chromium.net.UrlRequest,
                    info: org.chromium.net.UrlResponseInfo,
                    newLocationUrl: String,
                ) {
                    request.cancel()
                    if (continuation.isActive) {
                        continuation.resumeWithException(IOException("MKissa embed redirected; redirect rejected"))
                    }
                }

                override fun onResponseStarted(
                    request: org.chromium.net.UrlRequest,
                    info: org.chromium.net.UrlResponseInfo,
                ) {
                    request.read(ByteBuffer.allocateDirect(32 * 1024))
                }

                override fun onReadCompleted(
                    request: org.chromium.net.UrlRequest,
                    info: org.chromium.net.UrlResponseInfo,
                    byteBuffer: ByteBuffer,
                ) {
                    byteBuffer.flip()
                    val bytes = ByteArray(byteBuffer.remaining())
                    byteBuffer.get(bytes)
                    if (output.size() + bytes.size > MAX_RESPONSE_BYTES) {
                        request.cancel()
                        if (continuation.isActive) {
                            continuation.resumeWithException(MkissaProtocolException("MKissa response was too large"))
                        }
                        return
                    }
                    output.write(bytes)
                    byteBuffer.clear()
                    request.read(byteBuffer)
                }

                override fun onSucceeded(
                    request: org.chromium.net.UrlRequest,
                    info: org.chromium.net.UrlResponseInfo,
                ) {
                    if (continuation.isActive) {
                        continuation.resume(MkissaHttpResponse(info.httpStatusCode, output.toString(Charsets.UTF_8.name())))
                    }
                }

                override fun onFailed(
                    request: org.chromium.net.UrlRequest,
                    info: org.chromium.net.UrlResponseInfo?,
                    error: org.chromium.net.CronetException,
                ) {
                    if (continuation.isActive) continuation.resumeWithException(IOException(error.message, error))
                }
            }
            val builder = engine.newUrlRequestBuilder(safeUrl, callback, executor)
                .setHttpMethod(request.method.uppercase())
            request.headers.forEach { (name, value) -> builder.addHeader(name, value) }
            request.body?.let { body ->
                builder.setUploadDataProvider(
                    org.chromium.net.UploadDataProviders.create(body.toByteArray()),
                    executor,
                )
            }
            call = builder.build()
            continuation.invokeOnCancellation { call.cancel() }
            call.start()
        }

    companion object {
        private const val MAX_RESPONSE_BYTES = 4 * 1024 * 1024
    }
}

internal class MkissaOkHttpTransport(
    private val client: OkHttpClient = defaultClient(),
) : MkissaHttpTransport {
    override suspend fun execute(request: MkissaHttpRequest): MkissaHttpResponse = withContext(Dispatchers.IO) {
        val safeUrl = when {
            request.url.startsWith("https://mkissa.to") ||
                request.url.startsWith("https://api.mkissa.net") ||
                request.url.startsWith("https://cdn.mkissa.net") -> MkissaUrlPolicy.requireProviderUrl(request.url)
            else -> MkissaUrlPolicy.requireMediaUrl(request.url)
        }
        val builder = Request.Builder().url(safeUrl)
        request.headers.forEach { (name, value) ->
            require(name.matches(HEADER_NAME)) { "Invalid HTTP header name" }
            require(!value.contains(Regex("[\\r\\n\\u0000]"))) { "Invalid HTTP header value" }
            builder.header(name, value)
        }
        when (request.method.uppercase()) {
            "GET" -> builder.get()
            "POST" -> builder.post(
                (request.body ?: "").toRequestBody("application/json; charset=utf-8".toMediaType()),
            )
            else -> error("Unsupported MKissa HTTP method")
        }
        client.newCall(builder.build()).execute().use { response ->
            MkissaHttpResponse(response.code, readBounded(response.body?.byteStream()))
        }
    }

    private fun readBounded(input: java.io.InputStream?): String {
        if (input == null) return ""
        return input.use { stream ->
            val output = ByteArrayOutputStream(8_192)
            val buffer = ByteArray(8_192)
            var total = 0
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                total += count
                if (total > MAX_RESPONSE_BYTES) throw MkissaProtocolException("MKissa response was too large")
                output.write(buffer, 0, count)
            }
            output.toString(Charsets.UTF_8.name())
        }
    }

    companion object {
        private const val MAX_RESPONSE_BYTES = 4 * 1024 * 1024
        private val HEADER_NAME = Regex("[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}")

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .dns(MkissaPublicDns)
            .cookieJar(MemoryCookieJar())
            .callTimeout(20, TimeUnit.SECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            // A provider-controlled redirect must never escape the URL policy. Callers can resolve a
            // known redirect explicitly and validate it before issuing another request.
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }
}

private class MemoryCookieJar : CookieJar {
    private val cookiesByDomain = ConcurrentHashMap<String, List<Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val now = System.currentTimeMillis()
        cookiesByDomain[url.host] = cookies.filter { it.expiresAt > now }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        return cookiesByDomain.values.asSequence().flatten()
            .filter { it.expiresAt > now && it.matches(url) }
            .toList()
    }
}
