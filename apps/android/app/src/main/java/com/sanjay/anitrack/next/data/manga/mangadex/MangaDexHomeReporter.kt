package com.sanjay.anitrack.next.data.manga.mangadex

import com.sanjay.anitrack.next.data.manga.MangaHttp
import com.sanjay.anitrack.next.data.manga.MangaPublicDns
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Interceptor
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.buffer
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * MangaDex asks every client to report each image loaded from a MangaDex@Home
 * volunteer node (success, bytes, duration, cache hit) so broken nodes are taken
 * out of rotation. This interceptor sits on the image loader's HTTP client and
 * only acts on `*.mangadex.network` hosts; reports are fire-and-forget and never
 * delay page display. Failed nodes are remembered so the reader asks MangaDex
 * for a new node on retry.
 */
internal object MangaDexHomeReporter : Interceptor {
    private const val REPORT_URL = "https://api.mangadex.network/report"
    private const val MAX_PENDING = 32
    private val JSON: MediaType = "application/json".toMediaType()
    private val pending = AtomicInteger(0)
    private val failures = object : LinkedHashMap<String, Long>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>) = size > 64
    }
    private val client by lazy {
        OkHttpClient.Builder()
            .dns(MangaPublicDns)
            .callTimeout(15, TimeUnit.SECONDS)
            .build()
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val host = request.url.host
        if (!MangaDexParser.reportable(host)) return chain.proceed(request)
        val url = request.url.toString()
        val started = System.nanoTime()
        fun elapsedMs() = (System.nanoTime() - started) / 1_000_000
        val response = try {
            chain.proceed(request)
        } catch (e: IOException) {
            fail(host)
            report(url, success = false, bytes = 0, durationMs = elapsedMs(), cached = false)
            throw e
        }
        val cached = response.header("X-Cache")?.startsWith("HIT", ignoreCase = true) == true
        val body = response.body
        if (!response.isSuccessful || body == null) {
            fail(host)
            report(url, success = false, bytes = 0, durationMs = elapsedMs(), cached = cached)
            return response
        }
        return response.newBuilder()
            .body(CountingBody(body) { bytes, outcome ->
                when (outcome) {
                    Outcome.COMPLETE -> report(url, success = true, bytes = bytes, durationMs = elapsedMs(), cached = cached)
                    Outcome.FAILED -> {
                        fail(host)
                        report(url, success = false, bytes = bytes, durationMs = elapsedMs(), cached = cached)
                    }
                    // The reader cancelled the load (page scrolled away): not the node's fault.
                    Outcome.ABORTED -> Unit
                }
            })
            .build()
    }

    /** True when the node behind [baseUrl] failed after [sinceMs]. */
    fun failedSince(baseUrl: String, sinceMs: Long): Boolean {
        val host = runCatching { java.net.URI(baseUrl).host?.lowercase() }.getOrNull() ?: return false
        val at = synchronized(failures) { failures[host] } ?: return false
        return at > sinceMs
    }

    private fun fail(host: String) {
        synchronized(failures) { failures[host.lowercase()] = System.currentTimeMillis() }
    }

    private fun report(url: String, success: Boolean, bytes: Long, durationMs: Long, cached: Boolean) {
        sender(
            Request.Builder()
                .url(REPORT_URL)
                .header("User-Agent", MangaHttp.USER_AGENT)
                .post(MangaDexParser.report(url, success, bytes, durationMs, cached).toRequestBody(JSON))
                .build(),
        )
    }

    /** Posts one report without waiting; at most [MAX_PENDING] in flight, extra ones are dropped. Replaced in tests. */
    internal var sender: (Request) -> Unit = { request ->
        if (pending.incrementAndGet() > MAX_PENDING) {
            pending.decrementAndGet()
        } else {
            client.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { pending.decrementAndGet() }
                override fun onResponse(call: Call, response: Response) {
                    response.close()
                    pending.decrementAndGet()
                }
            })
        }
    }

    private enum class Outcome { COMPLETE, FAILED, ABORTED }

    private class CountingBody(
        private val body: ResponseBody,
        private val done: (bytes: Long, outcome: Outcome) -> Unit,
    ) : ResponseBody() {
        private var total = 0L
        private var finished = false

        private val counted: BufferedSource = object : ForwardingSource(body.source()) {
            override fun read(sink: Buffer, byteCount: Long): Long {
                val n = try {
                    super.read(sink, byteCount)
                } catch (e: IOException) {
                    finish(Outcome.FAILED)
                    throw e
                }
                if (n == -1L) finish(Outcome.COMPLETE) else total += n
                return n
            }

            override fun close() {
                // Decoders may stop at the image's end marker without reading EOF.
                val length = body.contentLength()
                finish(if (length > 0 && total >= length) Outcome.COMPLETE else Outcome.ABORTED)
                super.close()
            }
        }.buffer()

        private fun finish(outcome: Outcome) {
            if (finished) return
            finished = true
            done(total, outcome)
        }

        override fun contentType() = body.contentType()
        override fun contentLength() = body.contentLength()
        override fun source(): BufferedSource = counted
    }
}
