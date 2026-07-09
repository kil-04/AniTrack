package com.sanjay.anitrack.next.data

import android.content.Context
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
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

    fun humanSize(bytes: Long): String = when {
        bytes >= 1_000_000_000 -> "%.1f GB".format(bytes / 1_000_000_000.0)
        bytes >= 1_000_000 -> "${bytes / 1_000_000} MB"
        bytes >= 1_000 -> "${bytes / 1_000} KB"
        else -> "$bytes B"
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
            val jobs = chunk.map { d ->
                scope.launch { httpToFile(d.url, d.file, referer, ua) }
            }
            jobs.forEach { it.join() }
            done += chunk.size
            onProgress((done * 100 / total).coerceIn(0, 99))
        }
        // Write the rewritten local playlist last, so a partial download is
        // detectable (no index.m3u8 = incomplete).
        File(dir, "index.m3u8").writeText(outLines.joinToString("\n"))
    }

    private fun reqBuilder(url: String, ref: String, ua: String) = Request.Builder().url(url)
        .header("User-Agent", ua)
        .header("Referer", ref.trimEnd('/') + "/")
        .header("Accept", "*/*")

    private fun execRetry(url: String, ref: String, ua: String, maxRetries: Int = 6): okhttp3.Response {
        var attempt = 0
        while (true) {
            val resp = http.newCall(reqBuilder(url, ref, ua).build()).execute()
            if (resp.code == 429 && attempt < maxRetries) {
                resp.close()
                val wait = (resp.header("Retry-After")?.toLongOrNull()?.times(1000) ?: (1000L * (attempt + 1))).coerceAtMost(8000)
                Thread.sleep(wait); attempt++; continue
            }
            if (!resp.isSuccessful) { val c = resp.code; resp.close(); throw Exception("HTTP $c for $url") }
            return resp
        }
    }

    private fun httpText(url: String, ref: String, ua: String): String =
        execRetry(url, ref, ua).use { it.body?.string() ?: throw Exception("empty playlist") }

    private fun httpToFile(url: String, file: File, ref: String, ua: String) {
        execRetry(url, ref, ua).use { resp ->
            val tmp = File(file.parentFile, file.name + ".part")
            resp.body?.byteStream()?.use { input -> tmp.outputStream().use { input.copyTo(it) } }
            tmp.renameTo(file)
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
