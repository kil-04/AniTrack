package com.sanjay.anitrack.plugins

import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Offline downloads. Saves a resolved HLS stream (playlist + segments + AES keys)
 * to filesDir/anitrack_downloads/<id>/, rewriting the playlist so every URI is a
 * local relative file. Playback then loads `anitrack-dl://d/<id>/index.m3u8` via
 * the WebView's hls.js (the JS loader reads files back through `readFile`).
 */
@CapacitorPlugin(name = "AniTrackDownloader")
class AniTrackDownloaderPlugin : Plugin() {

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }

    // At most 2 episodes download at once (the JS queue already serializes, this is
    // a safety cap).
    private val episodePool = Executors.newFixedThreadPool(2)
    private val cancelled = ConcurrentHashMap.newKeySet<String>()
    private val UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"

    private fun baseDir(): File = File(context.filesDir, "anitrack_downloads")
    private fun folderName(id: String): String = id.replace(":", "_")
    private fun itemDir(id: String): File = File(baseDir(), folderName(id))

    // ── Public API ────────────────────────────────────────────────────────────

    @PluginMethod
    fun start(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val hlsUrl = call.getString("hlsUrl") ?: return call.reject("hlsUrl required")
        val animeId = call.getInt("animeId") ?: 0
        val episode = call.getInt("episode") ?: 0
        val title = call.getString("title") ?: "Episode"
        val coverUrl = call.getString("coverUrl")
        val providerId = call.getString("providerId") ?: "animepahe"
        val referer = call.getString("referer")
        val animeSession = call.getString("animeSession")
        val episodeSession = call.getString("episodeSession")
        val subtitleUrl = call.getString("subtitleUrl")
        call.resolve() // download proceeds in the background; progress via events

        cancelled.remove(id)
        episodePool.execute {
            runDownload(id, animeId, episode, title, coverUrl, providerId, hlsUrl, referer, animeSession, episodeSession, subtitleUrl)
        }
    }

    @PluginMethod
    fun list(call: PluginCall) {
        val arr = JSArray()
        baseDir().listFiles()?.forEach { dir ->
            val meta = File(dir, "meta.json")
            if (meta.exists()) {
                try { arr.put(JSObject(meta.readText())) } catch (_: Exception) {}
            }
        }
        val ret = JSObject()
        ret.put("items", arr)
        call.resolve(ret)
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        cancelled.add(id)
        try { itemDir(id).deleteRecursively() } catch (_: Exception) {}
        call.resolve()
    }

    @PluginMethod
    fun getPlayUrl(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val ret = JSObject()
        ret.put("url", "anitrack-dl://d/${folderName(id)}/index.m3u8")
        call.resolve(ret)
    }

    /** Read a downloaded file for the player. url = anitrack-dl://d/<folder>/<name> */
    @PluginMethod
    fun readFile(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url required")
        val binary = call.getBoolean("binary") ?: false
        try {
            val path = url.removePrefix("anitrack-dl://d/")
            val file = File(baseDir(), path)
            if (!file.exists() || !file.canonicalPath.startsWith(baseDir().canonicalPath)) {
                val miss = JSObject(); miss.put("data", ""); miss.put("status", 404); miss.put("binary", binary)
                return call.resolve(miss)
            }
            val ret = JSObject()
            if (binary) {
                ret.put("data", Base64.encodeToString(file.readBytes(), Base64.NO_WRAP))
                ret.put("binary", true)
            } else {
                ret.put("data", file.readText())
                ret.put("binary", false)
            }
            ret.put("status", 200)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("readFile failed: ${e.message}")
        }
    }

    // ── Download worker ─────────────────────────────────────────────────────────

    private fun runDownload(
        id: String, animeId: Int, episode: Int, title: String, coverUrl: String?,
        providerId: String, hlsUrl: String, referer: String?,
        animeSession: String?, episodeSession: String?, subtitleUrl: String?,
    ) {
        val dir = itemDir(id)
        dir.mkdirs()
        emit(id, animeId, episode, title, coverUrl, providerId, "downloading", 0, 0, 0, 0, null, animeSession, episodeSession)

        try {
            val ref = when {
                !referer.isNullOrEmpty() -> referer.trimEnd('/')
                hlsUrl.contains("animepahe") -> "https://animepahe.pw"
                else -> AniTrackPahePlugin.lastKwikOrigin.trimEnd('/')
            }

            var playlistUrl = hlsUrl
            var playlist = httpGetText(playlistUrl, ref)

            // Master playlist → pick the highest-bandwidth variant and download that.
            if (playlist.contains("#EXT-X-STREAM-INF")) {
                val variant = pickVariant(playlist, playlistUrl)
                if (variant != null) {
                    playlistUrl = variant
                    playlist = httpGetText(playlistUrl, ref)
                }
            }

            val base = playlistUrl.substringBeforeLast('/') + "/"
            val outLines = ArrayList<String>()
            data class Dl(val url: String, val file: File)
            val toDownload = ArrayList<Dl>()
            var segIndex = 0
            var keyIndex = 0

            for (raw in playlist.split("\n")) {
                val line = raw.trimEnd('\r')
                when {
                    line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-SESSION-KEY") -> {
                        val m = Regex("URI=\"([^\"]+)\"").find(line)
                        if (m != null) {
                            val keyName = "key$keyIndex.key"; keyIndex++
                            toDownload.add(Dl(absolutize(m.groupValues[1], base), File(dir, keyName)))
                            outLines.add(line.replace(m.groupValues[0], "URI=\"$keyName\""))
                        } else outLines.add(line)
                    }
                    line.isNotEmpty() && !line.startsWith("#") -> {
                        val segName = "seg%05d.ts".format(segIndex); segIndex++
                        toDownload.add(Dl(absolutize(line, base), File(dir, segName)))
                        outLines.add(segName)
                    }
                    else -> outLines.add(line)
                }
            }

            if (toDownload.isEmpty()) throw Exception("Playlist had no segments")
            File(dir, "index.m3u8").writeText(outLines.joinToString("\n"))

            val total = toDownload.size
            val done = AtomicInteger(0)
            // 6 parallel segment fetches for speed; the 429 backoff/retry in
            // execWithRetry absorbs the CDN's occasional rate-limiting.
            val pool = Executors.newFixedThreadPool(6)
            val futures = toDownload.map { d ->
                pool.submit {
                    if (!cancelled.contains(id)) httpDownloadToFile(d.url, d.file, ref)
                }
            }
            pool.shutdown()
            for (f in futures) {
                if (cancelled.contains(id)) { pool.shutdownNow(); throw Exception("cancelled") }
                f.get()
                val n = done.incrementAndGet()
                if (n % 4 == 0 || n == total) {
                    emit(id, animeId, episode, title, coverUrl, providerId,
                        "downloading", n * 100 / total, n, total, 0, null, animeSession, episodeSession)
                }
            }

            // Best-effort: save the soft subtitle (.vtt) for offline display.
            if (!subtitleUrl.isNullOrEmpty()) {
                try { httpDownloadToFile(subtitleUrl, File(dir, "subs.vtt"), ref) } catch (_: Exception) {}
            }

            val sizeBytes = dir.listFiles()?.sumOf { it.length() } ?: 0L
            emit(id, animeId, episode, title, coverUrl, providerId,
                "done", 100, total, total, sizeBytes, null, animeSession, episodeSession)
        } catch (e: Exception) {
            Log.e("AniTrackDownloader", "download $id failed", e)
            if (cancelled.contains(id)) {
                try { dir.deleteRecursively() } catch (_: Exception) {}
            } else {
                emit(id, animeId, episode, title, coverUrl, providerId,
                    "failed", 0, 0, 0, 0, e.message ?: "download failed", animeSession, episodeSession)
            }
        }
    }

    // ── HTTP helpers ────────────────────────────────────────────────────────────

    private fun reqBuilder(url: String, ref: String): Request.Builder {
        val cookies = try { CookieManager.getInstance().getCookie(url) } catch (_: Exception) { null }
        return Request.Builder()
            .url(url)
            .header("User-Agent", UA)
            .header("Referer", "$ref/")
            .header("Origin", ref)
            .apply { if (!cookies.isNullOrEmpty()) header("Cookie", cookies) }
    }

    // Execute with retry/backoff. The AnimePahe CDN (owocdn) rate-limits bursts of
    // segment requests with 429 — back off (honoring Retry-After) and retry instead
    // of failing the whole episode. Returns an OPEN successful response; the caller
    // must close it.
    private fun execWithRetry(url: String, ref: String, maxRetries: Int = 6): okhttp3.Response {
        var attempt = 0
        while (true) {
            val resp = client.newCall(reqBuilder(url, ref).build()).execute()
            if (resp.isSuccessful) return resp
            val code = resp.code
            val retryAfterMs = resp.header("Retry-After")?.toLongOrNull()?.times(1000)
            resp.close()
            val retryable = code == 429 || code == 408 || code in 500..599
            if (!retryable || attempt >= maxRetries) throw Exception("HTTP $code for $url")
            // Recover quickly: ~0.4s, 0.8, 1.6, 3.2 … capped at 5s (or Retry-After).
            val backoff = retryAfterMs ?: minOf(5_000L, 400L * (1L shl attempt))
            Thread.sleep(backoff + (0..300).random())
            attempt++
        }
    }

    private fun httpGetText(url: String, ref: String): String {
        execWithRetry(url, ref).use { resp ->
            return resp.body?.string() ?: throw Exception("Empty playlist")
        }
    }

    private fun httpDownloadToFile(url: String, file: File, ref: String) {
        // Already fully downloaded (atomic rename guarantees completeness) → skip,
        // so a retry resumes instead of re-fetching from the rate-limited CDN.
        if (file.exists() && file.length() > 0) return
        val tmp = File(file.parentFile, file.name + ".part")
        execWithRetry(url, ref).use { resp ->
            val body = resp.body ?: throw Exception("Empty body for $url")
            tmp.outputStream().use { out -> body.byteStream().copyTo(out) }
        }
        if (!tmp.renameTo(file)) { tmp.copyTo(file, overwrite = true); tmp.delete() }
    }

    /** Resolve a possibly-relative URI against the playlist base URL. */
    private fun absolutize(uri: String, base: String): String {
        return when {
            uri.startsWith("http://") || uri.startsWith("https://") -> uri
            uri.startsWith("//") -> "https:$uri"
            uri.startsWith("/") -> {
                val root = Regex("^(https?://[^/]+)").find(base)?.groupValues?.get(1) ?: base
                root + uri
            }
            else -> base + uri
        }
    }

    /** Pick the highest-bandwidth variant URL from a master playlist. */
    private fun pickVariant(playlist: String, base: String): String? {
        val lines = playlist.split("\n").map { it.trimEnd('\r') }
        var bestUrl: String? = null
        var bestBw = -1
        var i = 0
        val baseDir = base.substringBeforeLast('/') + "/"
        while (i < lines.size) {
            val line = lines[i]
            if (line.startsWith("#EXT-X-STREAM-INF")) {
                val bw = Regex("BANDWIDTH=(\\d+)").find(line)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                val uri = lines.getOrNull(i + 1)?.trim()
                if (!uri.isNullOrEmpty() && !uri.startsWith("#") && bw > bestBw) {
                    bestBw = bw
                    bestUrl = absolutize(uri, baseDir)
                }
                i += 2
            } else i++
        }
        return bestUrl
    }

    // ── Progress events + meta persistence ───────────────────────────────────────

    private fun emit(
        id: String, animeId: Int, episode: Int, title: String, coverUrl: String?,
        providerId: String, status: String, progress: Int, doneSeg: Int, totalSeg: Int,
        sizeBytes: Long, error: String?, animeSession: String? = null, episodeSession: String? = null,
    ) {
        val obj = JSObject()
        obj.put("id", id)
        obj.put("animeId", animeId)
        obj.put("episode", episode)
        obj.put("title", title)
        obj.put("coverUrl", coverUrl)
        obj.put("animeSession", animeSession)
        obj.put("episodeSession", episodeSession)
        obj.put("providerId", providerId)
        obj.put("status", status)
        obj.put("progress", progress)
        obj.put("doneSegments", doneSeg)
        obj.put("totalSegments", totalSeg)
        obj.put("sizeBytes", sizeBytes)
        if (error != null) obj.put("error", error)
        obj.put("updatedAt", System.currentTimeMillis())

        // Persist meta for list() across app restarts.
        try {
            val dir = itemDir(id)
            if (dir.exists() || status != "failed") {
                dir.mkdirs()
                File(dir, "meta.json").writeText(obj.toString())
            }
        } catch (_: Exception) {}

        notifyListeners("progress", obj)
    }
}
