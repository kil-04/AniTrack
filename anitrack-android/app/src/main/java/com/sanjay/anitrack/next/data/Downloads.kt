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

/**
 * Offline downloads — Kotlin/OkHttp port of the Capacitor downloader. Saves a
 * resolved HLS stream (playlist + segments + AES keys) to
 * filesDir/downloads/<id>/, rewriting the playlist so every URI is a LOCAL
 * relative file. ExoPlayer then plays the local index.m3u8 directly (no custom
 * protocol needed on native), so downloads work fully offline.
 */
object Downloads {
    enum class Status { QUEUED, DOWNLOADING, DONE, FAILED }

    data class Item(
        val id: String,           // "<animeId>:<episode>"
        val animeId: Int,
        val episode: Float,
        val title: String,
        val cover: String?,
        var status: Status,
        var progress: Int,        // 0..100
        var error: String? = null,
        var sizeBytes: Long = 0,
    )

    fun sizeOf(id: String): Long =
        folder(id).walkTopDown().filter { it.isFile }.sumOf { it.length() }

    // Same numbers as the desktop's fmtSize (1024-based, whole MB / 1-dp GB).
    fun humanSize(bytes: Long): String {
        if (bytes <= 0) return ""
        val mb = bytes / (1024.0 * 1024.0)
        return if (mb >= 1024) "%.1f GB".format(mb / 1024) else "${mb.toInt()} MB"
    }

    private lateinit var appCtx: Context
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val http = OkHttpClient.Builder().callTimeout(120, TimeUnit.SECONDS).build()
    private val queueLock = Mutex()
    private val jobs = ConcurrentHashMap<String, Job>()
    private val operationGeneration = ConcurrentHashMap<String, Long>()
    private val nextGeneration = AtomicLong()

    // Observable list for the UI.
    val items: SnapshotStateList<Item> = mutableStateListOf()
    private val itemsLock = Any()

    private inline fun <T> withItems(block: SnapshotStateList<Item>.() -> T): T =
        synchronized(itemsLock) { items.block() }

    private fun baseDir() = File(appCtx.filesDir, "downloads")
    private fun folder(id: String) = File(baseDir(), id.replace(":", "_"))
    fun idOf(animeId: Int, episode: Float) = "$animeId:${if (episode % 1f == 0f) episode.toInt() else episode}"

    fun init(ctx: Context) {
        if (::appCtx.isInitialized) return
        appCtx = ctx.applicationContext
        // Load existing downloads' meta.
        baseDir().listFiles()?.forEach { dir ->
            val meta = File(dir, "meta.json")
            if (!meta.exists()) {
                // Old/interrupted jobs without metadata cannot be resumed and
                // otherwise consume storage forever.
                dir.deleteRecursively()
            } else {
                runCatching {
                    val o = JSONObject(meta.readText())
                    val id = o.getString("id")
                    val complete = File(dir, "index.m3u8").exists()
                    withItems {
                        add(
                            Item(
                                id, o.getInt("animeId"), o.getDouble("episode").toFloat(),
                                o.optString("title"), o.optString("cover").takeIf { it.isNotEmpty() },
                                if (complete) Status.DONE else Status.FAILED,
                                if (complete) 100 else 0,
                                error = if (complete) null else "Download was interrupted. Start it again from the episode list.",
                                sizeBytes = sizeOf(id),
                            ),
                        )
                    }
                }.onFailure { dir.deleteRecursively() }
            }
        }
    }

    /** The local playlist for offline playback, or null if not fully downloaded. */
    fun localPlaylist(id: String): File? {
        val f = File(folder(id), "index.m3u8")
        return if (f.exists()) f else null
    }

    fun isDownloaded(animeId: Int, episode: Float) = localPlaylist(idOf(animeId, episode)) != null

    fun remove(id: String) {
        withItems { removeAll { it.id == id } }
        val generation = nextGeneration.incrementAndGet()
        val job = synchronized(jobs) {
            operationGeneration[id] = generation
            jobs.remove(id)
        }
        scope.launch {
            // Wait until an in-flight file write has observed cancellation,
            // then remove the folder. A new retry owns the same folder and
            // must not be deleted out from under it.
            job?.cancelAndJoin()
            synchronized(jobs) {
                if (operationGeneration[id] == generation && !jobs.containsKey(id)) {
                    folder(id).deleteRecursively()
                    operationGeneration.remove(id, generation)
                }
            }
        }
    }

    /**
     * Queue an episode. `resolve` returns the m3u8 URL + Referer + UA at
     * download time (kwik tokens expire fast, so resolve just-in-time).
     */
    fun enqueue(
        animeId: Int, episode: Float, title: String, cover: String?,
        resolve: suspend () -> Triple<String, String, String>,
    ) {
        val id = idOf(animeId, episode)
        if (!RemoteConfig.current().features.downloads) {
            withItems {
                removeAll { it.id == id }
                add(
                    Item(
                        id, animeId, episode, title, cover, Status.FAILED, 0,
                        error = "Downloads are temporarily disabled by the automation configuration.",
                    ),
                )
            }
            return
        }
        val item = Item(id, animeId, episode, title, cover, Status.QUEUED, 0)
        val queued = withItems {
            if (any { it.id == id && it.status != Status.FAILED }) {
                false
            } else {
                removeAll { it.id == id }
                add(item)
                true
            }
        }
        if (!queued) return
        // Claim ownership before the lazy job starts. This prevents an older
        // remove() coroutine from deleting this retry's new folder between its
        // cancellation check and the first metadata write.
        val generation = nextGeneration.incrementAndGet()
        synchronized(jobs) { operationGeneration[id] = generation }
        val job = scope.launch(start = CoroutineStart.LAZY) {
            queueLock.withLock {
                setStatus(id, Status.DOWNLOADING, 0)
                try {
                    // A retry starts from a clean, unplayable folder. Persist
                    // metadata first so a process/device restart can surface
                    // an interrupted item instead of leaking invisible files.
                    folder(id).deleteRecursively()
                    writeMeta(id, animeId, episode, title, cover)
                    val (url, referer, ua) = resolve()
                    download(id, url, referer, ua) { p -> setStatus(id, Status.DOWNLOADING, p) }
                    withItems {
                        val i = indexOfFirst { it.id == id }
                        if (i >= 0) this[i] = this[i].copy(status = Status.DONE, progress = 100, sizeBytes = sizeOf(id))
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    setStatus(id, Status.FAILED, 0, e.message)
                }
            }
        }
        val registered = synchronized(jobs) {
            if (operationGeneration[id] == generation) {
                jobs[id] = job
                true
            } else false
        }
        job.invokeOnCompletion {
            synchronized(jobs) {
                jobs.remove(id, job)
                operationGeneration.remove(id, generation)
            }
        }
        if (registered) job.start() else job.cancel()
    }

    private fun setStatus(id: String, s: Status, p: Int, err: String? = null) {
        withItems {
            val i = indexOfFirst { it.id == id }
            if (i >= 0) this[i] = this[i].copy(status = s, progress = p, error = err)
        }
    }

    private fun writeMeta(id: String, animeId: Int, episode: Float, title: String, cover: String?) {
        val o = JSONObject().put("id", id).put("animeId", animeId).put("episode", episode.toDouble())
            .put("title", title).put("cover", cover ?: "")
        val dir = folder(id).apply { mkdirs() }
        val target = File(dir, "meta.json")
        val temp = File(dir, "meta.json.part")
        temp.writeText(o.toString())
        if (!temp.renameTo(target)) {
            temp.delete()
            throw Exception("Could not save download metadata")
        }
    }

    // ── HLS download ────────────────────────────────────────────────────────────

    private data class Dl(val url: String, val file: File)

    private suspend fun download(
        id: String, hlsUrl: String, referer: String, ua: String, onProgress: (Int) -> Unit,
    ) = withContext(Dispatchers.IO) {
        val dir = folder(id).apply { mkdirs() }

        var playlistUrl = hlsUrl
        var playlist = runInterruptible { httpText(playlistUrl, referer, ua) }
        // Follow a bounded chain of master playlists. Some provider CDNs put
        // another master behind the selected quality variant.
        repeat(4) { depth ->
            if (!playlist.contains("#EXT-X-STREAM-INF")) return@repeat
            val variant = pickVariant(playlist, playlistUrl)
                ?: throw Exception("HLS master playlist had no playable variant")
            playlistUrl = variant
            playlist = runInterruptible { httpText(playlistUrl, referer, ua) }
            if (depth == 3 && playlist.contains("#EXT-X-STREAM-INF")) {
                throw Exception("HLS playlist nesting is too deep")
            }
        }
        if (!playlist.contains("#EXTM3U")) throw Exception("Stream response was not an HLS playlist")
        val base = playlistUrl.substringBeforeLast('/') + "/"
        val toDownload = mutableListOf<Dl>()
        val outLines = mutableListOf<String>()
        var segIndex = 0
        var keyIndex = 0
        var mapIndex = 0
        for (raw in playlist.split("\n")) {
            val line = raw.trimEnd('\r')
            when {
                line.startsWith("#EXT-X-MAP") -> {
                    val m = Regex("URI=\"([^\"]+)\"").find(line)
                    if (m != null) {
                        val source = absolutize(m.groupValues[1], base)
                        val mapName = "init${mapIndex++}.${mediaExtension(source, "mp4")}"
                        toDownload += Dl(source, File(dir, mapName))
                        outLines += line.replace(m.groupValues[0], "URI=\"$mapName\"")
                    } else outLines += line
                }
                line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-SESSION-KEY") -> {
                    val m = Regex("URI=\"([^\"]+)\"").find(line)
                    if (m != null) {
                        val keyName = "key$keyIndex.bin"; keyIndex++
                        toDownload += Dl(absolutize(m.groupValues[1], base), File(dir, keyName))
                        outLines += line.replace(m.groupValues[0], "URI=\"$keyName\"")
                    } else outLines += line
                }
                line.isNotBlank() && !line.startsWith("#") -> {
                    val source = absolutize(line, base)
                    val segName = "seg%05d.%s".format(segIndex, mediaExtension(source, "ts")); segIndex++
                    toDownload += Dl(source, File(dir, segName))
                    outLines += segName
                }
                else -> outLines += line
            }
        }
        if (toDownload.isEmpty()) throw Exception("Playlist had no segments")

        val total = toDownload.size
        var done = 0
        // Sequential-ish with light parallelism (chunks of 6) + 429 retry.
        for (chunk in toDownload.chunked(6)) {
            // Children belong to this download, not the app-wide SupervisorJob,
            // so any failed key/segment aborts the item instead of producing a
            // broken playlist that is incorrectly marked DONE.
            coroutineScope {
                chunk.map { d ->
                    async(Dispatchers.IO) {
                        runInterruptible { httpToFile(d.url, d.file, referer, ua) }
                    }
                }.awaitAll()
            }
            done += chunk.size
            onProgress((done * 100 / total).coerceIn(0, 99))
        }
        // Write the rewritten local playlist last, so a partial download is
        // detectable (no index.m3u8 = incomplete).
        val playlistTemp = File(dir, "index.m3u8.part")
        val playlistFile = File(dir, "index.m3u8")
        playlistTemp.writeText(outLines.joinToString("\n"))
        if (!playlistTemp.renameTo(playlistFile)) {
            playlistTemp.delete()
            throw Exception("Could not finalize offline playlist")
        }
    }

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

    private fun httpText(url: String, ref: String, ua: String): String = String(getBytes(url, ref, ua))

    private fun httpToFile(url: String, file: File, ref: String, ua: String, maxRetries: Int = 6) {
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

    private fun mediaExtension(url: String, fallback: String): String {
        val path = runCatching { java.net.URI(url).path }.getOrNull().orEmpty()
        return path.substringAfterLast('.', "").lowercase()
            .takeIf { it in setOf("ts", "m4s", "mp4", "aac", "m4a", "webm") }
            ?: fallback
    }

    private fun isRetryableStatus(code: Int): Boolean =
        code == 408 || code == 425 || code == 429 || code in 500..504

    private fun absolutize(uri: String, base: String): String =
        runCatching { java.net.URI(base).resolve(uri).toString() }.getOrDefault(uri)

    private fun pickVariant(playlist: String, base: String): String? {
        val lines = playlist.split("\n").map { it.trimEnd('\r') }
        var bestBw = -1; var best: String? = null
        for (i in lines.indices) {
            val line = lines[i]
            if (line.startsWith("#EXT-X-STREAM-INF")) {
                val bw = Regex("BANDWIDTH=(\\d+)").find(line)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                val uri = lines.getOrNull(i + 1)?.takeIf { it.isNotBlank() && !it.startsWith("#") }
                if (uri != null && bw > bestBw) { bestBw = bw; best = absolutize(uri, base.substringBeforeLast('/') + "/") }
            }
        }
        return best
    }
}
