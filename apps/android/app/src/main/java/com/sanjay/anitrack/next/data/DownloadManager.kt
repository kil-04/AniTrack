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
        DownloadTransport.init(appCtx)
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

    internal fun proxyStream(
        url: String,
        ref: String,
        ua: String,
        requestHeaders: Map<String, String> = emptyMap(),
    ): DownloadTransport.StreamingFetched? =
        DownloadTransport.proxyStream(url, ref, ua, requestHeaders)

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
        var playlist = runInterruptible { DownloadTransport.text(playlistUrl, referer, ua) }
        // Follow a bounded chain of master playlists. Some provider CDNs put
        // another master behind the selected quality variant.
        repeat(4) { depth ->
            if (!playlist.contains("#EXT-X-STREAM-INF")) return@repeat
            val variant = pickVariant(playlist, playlistUrl)
                ?: throw Exception("HLS master playlist had no playable variant")
            playlistUrl = variant
            playlist = runInterruptible { DownloadTransport.text(playlistUrl, referer, ua) }
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
                        runInterruptible { DownloadTransport.toFile(d.url, d.file, referer, ua) }
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
