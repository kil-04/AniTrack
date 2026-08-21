package com.sanjay.anitrack.next.data

import android.content.Context
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

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

    // Observable list for the UI.
    val items: SnapshotStateList<Item> = mutableStateListOf()

    private fun baseDir() = File(appCtx.filesDir, "downloads")
    private fun folder(id: String) = File(baseDir(), id.replace(":", "_"))
    fun idOf(animeId: Int, episode: Float) = "$animeId:${if (episode % 1f == 0f) episode.toInt() else episode}"

    fun init(ctx: Context) {
        if (::appCtx.isInitialized) return
        appCtx = ctx.applicationContext
        // Load existing downloads' meta.
        baseDir().listFiles()?.forEach { dir ->
            val meta = File(dir, "meta.json")
            if (meta.exists()) {
                runCatching {
                    val o = JSONObject(meta.readText())
                    val id = o.getString("id")
                    items += Item(
                        id, o.getInt("animeId"), o.getDouble("episode").toFloat(),
                        o.optString("title"), o.optString("cover").takeIf { it.isNotEmpty() },
                        if (File(dir, "index.m3u8").exists()) Status.DONE else Status.FAILED, 100,
                        sizeBytes = sizeOf(id),
                    )
                }
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
        items.removeAll { it.id == id }
        scope.launch { folder(id).deleteRecursively() }
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
            items.removeAll { it.id == id }
            items += Item(
                id, animeId, episode, title, cover, Status.FAILED, 0,
                error = "Downloads are temporarily disabled by the automation configuration.",
            )
            return
        }
        if (items.any { it.id == id && it.status != Status.FAILED }) return
        items.removeAll { it.id == id }
        val item = Item(id, animeId, episode, title, cover, Status.QUEUED, 0)
        items += item
        scope.launch {
            queueLock.withLock {
                setStatus(id, Status.DOWNLOADING, 0)
                try {
                    val (url, referer, ua) = resolve()
                    download(id, url, referer, ua) { p -> setStatus(id, Status.DOWNLOADING, p) }
                    writeMeta(id, animeId, episode, title, cover)
                    val i = items.indexOfFirst { it.id == id }
                    if (i >= 0) items[i] = items[i].copy(status = Status.DONE, progress = 100, sizeBytes = sizeOf(id))
                } catch (e: Exception) {
                    setStatus(id, Status.FAILED, 0, e.message)
                }
            }
        }
    }

    private fun setStatus(id: String, s: Status, p: Int, err: String? = null) {
        val i = items.indexOfFirst { it.id == id }
        if (i >= 0) items[i] = items[i].copy(status = s, progress = p, error = err)
    }

    private fun writeMeta(id: String, animeId: Int, episode: Float, title: String, cover: String?) {
        val o = JSONObject().put("id", id).put("animeId", animeId).put("episode", episode.toDouble())
            .put("title", title).put("cover", cover ?: "")
        File(folder(id), "meta.json").writeText(o.toString())
    }

    // ── HLS download ────────────────────────────────────────────────────────────

    private data class Dl(val url: String, val file: File)

    private suspend fun download(
        id: String, hlsUrl: String, referer: String, ua: String, onProgress: (Int) -> Unit,
    ) = withContext(Dispatchers.IO) {
        val dir = folder(id).apply { mkdirs() }

        var playlistUrl = hlsUrl
        var playlist = httpText(playlistUrl, referer, ua)
        // Master playlist → highest-bandwidth variant.
        if (playlist.contains("#EXT-X-STREAM-INF")) {
            pickVariant(playlist, playlistUrl)?.let {
                playlistUrl = it
                playlist = httpText(playlistUrl, referer, ua)
            }
        }
        val base = playlistUrl.substringBeforeLast('/') + "/"
        val toDownload = mutableListOf<Dl>()
        val outLines = mutableListOf<String>()
        var segIndex = 0
        var keyIndex = 0
        for (raw in playlist.split("\n")) {
            val line = raw.trimEnd('\r')
            when {
                line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-SESSION-KEY") -> {
                    val m = Regex("URI=\"([^\"]+)\"").find(line)
                    if (m != null) {
                        val keyName = "key$keyIndex.bin"; keyIndex++
                        toDownload += Dl(absolutize(m.groupValues[1], base), File(dir, keyName))
                        outLines += line.replace(m.groupValues[0], "URI=\"$keyName\"")
                    } else outLines += line
                }
                line.isNotBlank() && !line.startsWith("#") -> {
                    val segName = "seg%05d.ts".format(segIndex); segIndex++
                    toDownload += Dl(absolutize(line, base), File(dir, segName))
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
                        httpToFile(d.url, d.file, referer, ua)
                    }
                }.awaitAll()
            }
            done += chunk.size
            onProgress((done * 100 / total).coerceIn(0, 99))
        }
        // Write the rewritten local playlist last, so a partial download is
        // detectable (no index.m3u8 = incomplete).
        File(dir, "index.m3u8").writeText(outLines.joinToString("\n"))
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
                if (code == 429 && attempt < maxRetries) { Thread.sleep((1000L * (attempt + 1)).coerceAtMost(8000)); attempt++; continue }
                if (code !in 200..299) throw Exception("HTTP $code for $url")
                return body
            } else {
                val req = Request.Builder().url(url).header("User-Agent", ua)
                    .header("Referer", ref.trimEnd('/') + "/").header("Accept", "*/*")
                    .apply { if (!cookie.isNullOrBlank()) header("Cookie", cookie) }.build()
                http.newCall(req).execute().use { resp ->
                    if (resp.code == 429 && attempt < maxRetries) { Thread.sleep((1000L * (attempt + 1)).coerceAtMost(8000)); attempt++; return@use }
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

    /** Blocking Cronet GET used by the pahe WebView proxy (shouldInterceptRequest):
     *  Chrome TLS + Referer/UA/cookies, returns content type for the response. */
    fun proxyGet(
        url: String,
        ref: String,
        ua: String,
        requestHeaders: Map<String, String> = emptyMap(),
    ): Fetched? = try {
        val engine = cronetEngine() ?: return null
        val cookie = runCatching { android.webkit.CookieManager.getInstance().getCookie(url) }.getOrNull()
        cronetGetFull(engine, url, ref, ua, cookie, requestHeaders)
    } catch (e: Exception) {
        android.util.Log.w("AniTrackNext", "proxyGet failed ${e.message} for $url")
        null
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
        b.build().start()
        if (!latch.await(90, TimeUnit.SECONDS)) throw Exception("timeout for $url")
        err?.let { throw it }
        return Fetched(status, reason, responseHeaders, out.toByteArray())
    }

    private fun httpText(url: String, ref: String, ua: String): String = String(getBytes(url, ref, ua))

    private fun httpToFile(url: String, file: File, ref: String, ua: String) {
        val tmp = File(file.parentFile, file.name + ".part")
        tmp.writeBytes(getBytes(url, ref, ua))
        if (!tmp.renameTo(file)) {
            tmp.delete()
            throw Exception("Could not finalize ${file.name}")
        }
    }

    private fun absolutize(uri: String, base: String): String = when {
        uri.startsWith("http") -> uri
        uri.startsWith("/") -> {
            val root = Regex("^(https?://[^/]+)").find(base)?.groupValues?.get(1) ?: base
            root + uri
        }
        else -> base + uri
    }

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
