package com.sanjay.anitrack.next.data

import android.content.Context
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.IOException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal object DownloadTransport {
    private lateinit var appCtx: Context
    private val http = OkHttpClient.Builder().callTimeout(120, TimeUnit.SECONDS).build()

    fun init(context: Context) {
        if (!::appCtx.isInitialized) appCtx = context.applicationContext
    }

    private fun isRetryableStatus(code: Int): Boolean =
        code == 408 || code == 425 || code == 429 || code in 500..504

    // Chromium network stack — the pahe CDN (mewstream) 403s Java/OkHttp on
    // TLS fingerprint, so segment/playlist fetches go through Cronet too.
    private var cronet: org.chromium.net.CronetEngine? = null
    private var cronetTried = false
    private val cronetExecutor by lazy { java.util.concurrent.Executors.newCachedThreadPool() }
    private fun cronetEngine(): org.chromium.net.CronetEngine? {
        if (!cronetTried) {
            cronetTried = true
            cronet = try { androidx.media3.datasource.cronet.CronetUtil.buildCronetEngine(appCtx) } catch (e: Throwable) { null }
        }
        return cronet
    }

    /** Blocking GET returning the body bytes, via Cronet (Chrome TLS) if
     *  available, else OkHttp. 429-aware retry either way. */
    private fun getBytes(url: String, ref: String, ua: String, maxRetries: Int = 6): ByteArray {
        val cookie = runCatching { android.webkit.CookieManager.getInstance().getCookie(url) }.getOrNull()
        val engine = cronetEngine()
        var attempt = 0
        while (true) {
            if (engine != null) {
                val (code, body) = cronetGet(engine, url, ref, ua, cookie)
                if (isRetryableStatus(code) && attempt < maxRetries) { Thread.sleep((1000L * (attempt + 1)).coerceAtMost(8000)); attempt++; continue }
                if (code !in 200..299) throw Exception("HTTP $code for $url")
                return body
            } else {
                val req = Request.Builder().url(url).header("User-Agent", ua)
                    .header("Referer", ref.trimEnd('/') + "/").header("Accept", "*/*")
                    .apply { if (!cookie.isNullOrBlank()) header("Cookie", cookie) }.build()
                http.newCall(req).execute().use { resp ->
                    if (isRetryableStatus(resp.code) && attempt < maxRetries) { Thread.sleep((1000L * (attempt + 1)).coerceAtMost(8000)); attempt++; return@use }
                    if (!resp.isSuccessful) throw Exception("HTTP ${resp.code} for $url")
                    return resp.body!!.bytes()
                }
            }
        }
    }

    private fun cronetGet(
        engine: org.chromium.net.CronetEngine, url: String, ref: String, ua: String, cookie: String?,
    ): Pair<Int, ByteArray> {
        val f = cronetGetFull(engine, url, ref, ua, cookie)
        return f.status to f.body
    }

    class Fetched(
        val status: Int,
        val reason: String,
        val headers: Map<String, String>,
        val body: ByteArray,
    )

    class StreamingFetched(
        val status: Int,
        val reason: String,
        val headers: Map<String, String>,
        val body: InputStream,
    )

    /**
     * Start a Cronet request for the AnimePahe WebView and return as soon as
     * response headers arrive. The response body is delivered through a
     * bounded stream (at most eight 64 KiB chunks) instead of first building a
     * complete ByteArray. hls.js routinely overlaps several segment requests;
     * buffering every response in full was enough to kill Samsung's WebView
     * renderer and leave a black player.
     */
    fun proxyStream(
        url: String,
        ref: String,
        ua: String,
        requestHeaders: Map<String, String> = emptyMap(),
    ): StreamingFetched? = try {
        val engine = cronetEngine() ?: return null
        val cookie = runCatching { android.webkit.CookieManager.getInstance().getCookie(url) }.getOrNull()
        cronetStream(engine, url, ref, ua, cookie, requestHeaders)
    } catch (e: Exception) {
        val host = runCatching { java.net.URI(url).host }.getOrNull() ?: "stream host"
        android.util.Log.w("AniTrackNext", "Web stream proxy failed for $host: ${e.message}")
        null
    }

    private sealed class StreamPacket {
        class Data(val bytes: ByteArray) : StreamPacket()
        object End : StreamPacket()
    }

    /** InputStream consumed by WebView while Cronet fills a small bounded
     * queue. Closing an aborted XHR immediately cancels its network request. */
    private class BoundedProxyInputStream : InputStream() {
        private val queue = ArrayBlockingQueue<StreamPacket>(8)
        private val closed = AtomicBoolean(false)
        private val finished = AtomicBoolean(false)
        @Volatile private var failure: IOException? = null
        @Volatile private var cancelRequest: (() -> Unit)? = null
        private var current: ByteArray? = null
        private var currentOffset = 0

        fun attachCancel(action: () -> Unit) {
            cancelRequest = action
            if (closed.get()) action()
        }

        fun enqueue(bytes: ByteArray): Boolean {
            while (!closed.get() && !finished.get()) {
                try {
                    if (queue.offer(StreamPacket.Data(bytes), 1, TimeUnit.SECONDS)) return true
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return false
                }
            }
            return false
        }

        fun finish() {
            if (finished.compareAndSet(false, true)) queue.offer(StreamPacket.End)
        }

        fun fail(error: IOException) {
            if (finished.compareAndSet(false, true)) {
                failure = error
                queue.clear()
                queue.offer(StreamPacket.End)
            }
        }

        override fun read(): Int {
            val one = ByteArray(1)
            val count = read(one, 0, 1)
            return if (count < 0) -1 else one[0].toInt() and 0xff
        }

        override fun read(target: ByteArray, offset: Int, length: Int): Int {
            if (length == 0) return 0
            while (current == null || currentOffset >= current!!.size) {
                current = null
                currentOffset = 0
                if (closed.get()) return -1
                if (finished.get() && queue.isEmpty()) {
                    failure?.let { throw it }
                    return -1
                }
                val packet = try {
                    queue.poll(60, TimeUnit.SECONDS)
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw IOException("stream read interrupted", e)
                }
                when (packet) {
                    is StreamPacket.Data -> current = packet.bytes
                    StreamPacket.End -> {
                        failure?.let { throw it }
                        return -1
                    }
                    null -> {
                        if (finished.get()) {
                            failure?.let { throw it }
                            return -1
                        }
                        throw IOException("stream read timed out")
                    }
                }
            }
            val source = current!!
            val count = minOf(length, source.size - currentOffset)
            System.arraycopy(source, currentOffset, target, offset, count)
            currentOffset += count
            return count
        }

        override fun close() {
            if (closed.compareAndSet(false, true)) {
                queue.clear()
                queue.offer(StreamPacket.End)
                cancelRequest?.invoke()
            }
        }
    }

    private fun cronetStream(
        engine: org.chromium.net.CronetEngine,
        url: String,
        ref: String,
        ua: String,
        cookie: String?,
        extraHeaders: Map<String, String>,
    ): StreamingFetched {
        val headersReady = CountDownLatch(1)
        val body = BoundedProxyInputStream()
        var status = 0
        var reason = "OK"
        var responseHeaders: Map<String, String> = emptyMap()
        var earlyError: Exception? = null
        val callback = object : org.chromium.net.UrlRequest.Callback() {
            override fun onRedirectReceived(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo?,
                newUrl: String?,
            ) = request.followRedirect()

            override fun onResponseStarted(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo,
            ) {
                status = info.httpStatusCode
                reason = info.httpStatusText.takeIf { it.isNotBlank() } ?: "OK"
                responseHeaders = info.allHeaders.mapValues { it.value.joinToString(", ") }
                headersReady.countDown()
                request.read(java.nio.ByteBuffer.allocateDirect(64 * 1024))
            }

            override fun onReadCompleted(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo,
                buffer: java.nio.ByteBuffer,
            ) {
                buffer.flip()
                val bytes = ByteArray(buffer.remaining())
                buffer.get(bytes)
                if (!body.enqueue(bytes)) {
                    request.cancel()
                    body.fail(IOException("stream consumer stopped"))
                    return
                }
                buffer.clear()
                request.read(buffer)
            }

            override fun onSucceeded(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo,
            ) = body.finish()

            override fun onFailed(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo?,
                error: org.chromium.net.CronetException,
            ) {
                earlyError = error
                headersReady.countDown()
                body.fail(IOException("stream request failed", error))
            }

            override fun onCanceled(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo?,
            ) {
                headersReady.countDown()
                body.fail(IOException("stream request canceled"))
            }
        }
        val builder = engine.newUrlRequestBuilder(url, callback, cronetExecutor)
            .addHeader("User-Agent", ua)
            .addHeader("Referer", ref.trimEnd('/') + "/")
            .addHeader("Accept", "*/*")
        if (!cookie.isNullOrBlank()) builder.addHeader("Cookie", cookie)
        val blocked = setOf(
            "user-agent", "referer", "cookie", "host", "connection", "content-length",
            "accept-encoding", "transfer-encoding", "if-none-match", "if-modified-since",
        )
        for ((name, value) in extraHeaders) {
            if (name.lowercase() !in blocked && value.isNotBlank()) builder.addHeader(name, value)
        }
        val request = builder.build()
        body.attachCancel { request.cancel() }
        request.start()
        try {
            if (!headersReady.await(30, TimeUnit.SECONDS)) {
                request.cancel()
                body.close()
                throw IOException("stream response timed out")
            }
        } catch (e: InterruptedException) {
            request.cancel()
            body.close()
            Thread.currentThread().interrupt()
            throw e
        }
        earlyError?.let {
            body.close()
            throw it
        }
        return StreamingFetched(status, reason, responseHeaders, body)
    }

    private fun cronetGetFull(
        engine: org.chromium.net.CronetEngine, url: String, ref: String, ua: String, cookie: String?,
        extraHeaders: Map<String, String> = emptyMap(),
    ): Fetched {
        val latch = java.util.concurrent.CountDownLatch(1)
        val out = java.io.ByteArrayOutputStream()
        var status = 0
        var reason = "OK"
        var responseHeaders: Map<String, String> = emptyMap()
        var err: Exception? = null
        val cb = object : org.chromium.net.UrlRequest.Callback() {
            override fun onRedirectReceived(r: org.chromium.net.UrlRequest, i: org.chromium.net.UrlResponseInfo?, newUrl: String?) = r.followRedirect()
            override fun onResponseStarted(r: org.chromium.net.UrlRequest, i: org.chromium.net.UrlResponseInfo) {
                status = i.httpStatusCode
                reason = i.httpStatusText.takeIf { it.isNotBlank() } ?: "OK"
                responseHeaders = i.allHeaders.mapValues { it.value.joinToString(", ") }
                r.read(java.nio.ByteBuffer.allocateDirect(64 * 1024))
            }
            override fun onReadCompleted(r: org.chromium.net.UrlRequest, i: org.chromium.net.UrlResponseInfo, bb: java.nio.ByteBuffer) {
                bb.flip(); val arr = ByteArray(bb.remaining()); bb.get(arr); out.write(arr); bb.clear(); r.read(bb)
            }
            override fun onSucceeded(r: org.chromium.net.UrlRequest, i: org.chromium.net.UrlResponseInfo) = latch.countDown()
            override fun onFailed(r: org.chromium.net.UrlRequest, i: org.chromium.net.UrlResponseInfo?, e: org.chromium.net.CronetException) { err = e; latch.countDown() }
            override fun onCanceled(r: org.chromium.net.UrlRequest, i: org.chromium.net.UrlResponseInfo?) = latch.countDown()
        }
        val b = engine.newUrlRequestBuilder(url, cb, cronetExecutor)
            .addHeader("User-Agent", ua).addHeader("Referer", ref.trimEnd('/') + "/").addHeader("Accept", "*/*")
        if (!cookie.isNullOrBlank()) b.addHeader("Cookie", cookie)
        // Preserve range/conditional requests made by hls.js. Do not forward
        // headers whose values are controlled above or by Cronet itself.
        val blocked = setOf(
            "user-agent", "referer", "cookie", "host", "connection", "content-length",
            "accept-encoding", "transfer-encoding",
        )
        for ((name, value) in extraHeaders) {
            if (name.lowercase() !in blocked && value.isNotBlank()) b.addHeader(name, value)
        }
        val request = b.build()
        request.start()
        try {
            if (!latch.await(90, TimeUnit.SECONDS)) {
                request.cancel()
                throw Exception("request timed out")
            }
        } catch (e: InterruptedException) {
            request.cancel()
            Thread.currentThread().interrupt()
            throw e
        }
        err?.let { throw it }
        return Fetched(status, reason, responseHeaders, out.toByteArray())
    }

    fun text(url: String, ref: String, ua: String): String = String(getBytes(url, ref, ua))

    fun toFile(url: String, file: File, ref: String, ua: String, maxRetries: Int = 6) {
        val tmp = File(file.parentFile, file.name + ".part")
        val engine = cronetEngine()
        var attempt = 0
        while (true) {
            tmp.delete()
            val cookie = runCatching { android.webkit.CookieManager.getInstance().getCookie(url) }.getOrNull()
            val code = if (engine != null) {
                cronetToFile(engine, url, tmp, ref, ua, cookie)
            } else {
                okHttpToFile(url, tmp, ref, ua, cookie)
            }
            if (isRetryableStatus(code) && attempt < maxRetries) {
                tmp.delete()
                Thread.sleep((1000L * (attempt + 1)).coerceAtMost(8000))
                attempt++
                continue
            }
            if (code !in 200..299) {
                tmp.delete()
                throw Exception("HTTP $code for $url")
            }
            break
        }
        if (!tmp.renameTo(file)) {
            tmp.delete()
            throw Exception("Could not finalize ${file.name}")
        }
    }

    /** Stream a response directly to disk. The previous ByteArray path kept
     * six complete video segments in RAM at once, which could push tablets
     * into low-memory kills during high-resolution downloads. */
    private fun cronetToFile(
        engine: org.chromium.net.CronetEngine,
        url: String,
        file: File,
        ref: String,
        ua: String,
        cookie: String?,
    ): Int {
        val latch = CountDownLatch(1)
        val output = file.outputStream().buffered(64 * 1024)
        val finished = AtomicBoolean(false)
        var status = 0
        var failure: Exception? = null
        val finish: (Exception?) -> Unit = { error ->
            if (finished.compareAndSet(false, true)) {
                failure = error
                runCatching { output.close() }
                latch.countDown()
            }
        }
        val callback = object : org.chromium.net.UrlRequest.Callback() {
            override fun onRedirectReceived(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo?,
                newUrl: String?,
            ) = request.followRedirect()

            override fun onResponseStarted(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo,
            ) {
                status = info.httpStatusCode
                request.read(java.nio.ByteBuffer.allocateDirect(64 * 1024))
            }

            override fun onReadCompleted(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo,
                buffer: java.nio.ByteBuffer,
            ) {
                if (finished.get()) {
                    request.cancel()
                    return
                }
                try {
                    buffer.flip()
                    val bytes = ByteArray(buffer.remaining())
                    buffer.get(bytes)
                    output.write(bytes)
                    buffer.clear()
                    request.read(buffer)
                } catch (e: Exception) {
                    request.cancel()
                    finish(e)
                }
            }

            override fun onSucceeded(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo,
            ) = finish(null)

            override fun onFailed(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo?,
                error: org.chromium.net.CronetException,
            ) = finish(error)

            override fun onCanceled(
                request: org.chromium.net.UrlRequest,
                info: org.chromium.net.UrlResponseInfo?,
            ) = finish(IOException("request canceled for $url"))
        }
        val builder = engine.newUrlRequestBuilder(url, callback, cronetExecutor)
            .addHeader("User-Agent", ua)
            .addHeader("Referer", ref.trimEnd('/') + "/")
            .addHeader("Accept", "*/*")
        if (!cookie.isNullOrBlank()) builder.addHeader("Cookie", cookie)
        val request = try {
            builder.build()
        } catch (e: Exception) {
            finish(e)
            throw e
        }
        try {
            request.start()
        } catch (e: Exception) {
            finish(e)
            throw e
        }
        try {
            if (!latch.await(90, TimeUnit.SECONDS)) {
                request.cancel()
                finish(IOException("timeout for $url"))
            }
        } catch (e: InterruptedException) {
            request.cancel()
            finish(IOException("download canceled for $url", e))
            Thread.currentThread().interrupt()
            throw e
        }
        failure?.let { throw it }
        return status
    }

    private fun okHttpToFile(
        url: String,
        file: File,
        ref: String,
        ua: String,
        cookie: String?,
    ): Int {
        val request = Request.Builder().url(url).header("User-Agent", ua)
            .header("Referer", ref.trimEnd('/') + "/").header("Accept", "*/*")
            .apply { if (!cookie.isNullOrBlank()) header("Cookie", cookie) }.build()
        http.newCall(request).execute().use { response ->
            if (response.isSuccessful) {
                val body = response.body ?: throw IOException("empty response for $url")
                body.byteStream().use { input ->
                    file.outputStream().buffered(64 * 1024).use { output -> input.copyTo(output, 64 * 1024) }
                }
            }
            return response.code
        }
    }
}
