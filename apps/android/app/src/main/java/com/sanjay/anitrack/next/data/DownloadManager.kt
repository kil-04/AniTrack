package com.sanjay.anitrack.next.data

import android.content.Context
import com.sanjay.anitrack.next.data.providers.EpisodeOrigin
import com.sanjay.anitrack.next.data.providers.OriginCapture
import com.sanjay.anitrack.next.data.providers.PlaybackPreferences
import com.sanjay.anitrack.next.data.providers.Providers
import com.sanjay.anitrack.next.data.providers.ResolvedMedia
import java.util.concurrent.atomic.AtomicInteger
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
import kotlinx.coroutines.delay
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
 *
 * Interrupted downloads resume (DownloadResume, the twin of
 * packages/shared/download-resume.ts): every finished piece is appended to
 * download.ledger, and a later run keeps the pieces that still verify for the
 * same rendition and continues from the first missing one. A download waits
 * out rate limits, waits for the network when it drops (Doze included), and
 * resolves the stream again when it expires. meta.json keeps the episode's
 * provider and resume key, so after the app is closed or killed the download
 * carries on at the next start, or from [DownloadResumeWorker] once a network
 * is available.
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
        watchNetwork()
        // Directory walks and recursive size calculations can be expensive
        // with a large offline library. Restore them after the first frame.
        scope.launch {
            val restored = mutableListOf<Item>()
            val resumable = mutableListOf<Pair<Item, EpisodeOrigin>>()
            baseDir().listFiles()?.forEach { dir ->
                val meta = File(dir, "meta.json")
                if (!meta.exists()) {
                    // Old/interrupted jobs without metadata cannot be resumed
                    // and otherwise consume storage forever.
                    dir.deleteRecursively()
                } else {
                    runCatching {
                        val o = JSONObject(meta.readText())
                        val id = o.getString("id")
                        val complete = File(dir, "index.m3u8").exists()
                        val origin = originOf(o)
                        val canResume = !complete && origin != null && File(dir, DownloadResume.LEDGER_FILE).isFile
                        val item = Item(
                            id, o.getInt("animeId"), o.getDouble("episode").toFloat(),
                            o.optString("title"), o.optString("cover").takeIf { it.isNotEmpty() },
                            when { complete -> Status.DONE; canResume -> Status.QUEUED; else -> Status.FAILED },
                            if (complete) 100 else savedProgress(dir) ?: o.optInt("progress", 0).coerceIn(0, 99),
                            error = if (complete || canResume) null else "Download was interrupted. Start it again from the episode list.",
                            sizeBytes = sizeOf(id),
                        )
                        restored += item
                        if (canResume) resumable += item to origin!!
                    }.onFailure { dir.deleteRecursively() }
                }
            }
            withContext(Dispatchers.Main) {
                withItems {
                    restored.forEach { item ->
                        if (none { it.id == item.id }) add(item)
                    }
                }
            }
            // Unfinished episodes carry on where they stopped (resolved afresh).
            resumable.forEach { (item, origin) -> start(item, resolverFor(origin), resumed = true) }
            if (resumable.isNotEmpty()) DownloadResumeWorker.schedule(appCtx)
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

    /** Unfinished downloads that are queued, running or waiting to resume. */
    fun hasPending(): Boolean = withItems { any { it.status == Status.QUEUED || it.status == Status.DOWNLOADING } }

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

    /** What one download needs; resolved just in time (kwik tokens expire fast). */
    data class Source(val url: String, val referer: String, val userAgent: String, val subtitleUrl: String? = null, val conservativeNetwork: Boolean = false)

    /** A download [Source] for resolved media, with its preferred caption track. */
    fun sourceOf(media: ResolvedMedia): Source {
        check(media.downloadable) { "Downloads are not supported by this server" }
        val captions = media.subtitles.filter { it.mimeType == "text/vtt" }
        val caption = captions.firstOrNull { it.default }
            ?: captions.firstOrNull { it.language == "en" || it.label.contains("english", ignoreCase = true) }
            ?: captions.firstOrNull()
        return Source(media.url, media.referer, media.userAgent, caption?.url, media.conservativeNetwork)
    }

    /** Finds an episode again from its persisted origin and resolves it, as the first run did. */
    private fun resolverFor(origin: EpisodeOrigin): suspend () -> Source = {
        val series = Providers.registry.resume(origin.providerId, origin.resumeKey, RemoteConfig.current())
            ?: throw Exception("Couldn't find this episode's source again. Start it again from the episode list.")
        val episode = series.episodes.firstOrNull { kotlin.math.abs(it.number - origin.episode) < 0.01f }
            ?: throw Exception("This episode is no longer listed by its source.")
        sourceOf(episode.resolve(PlaybackPreferences(origin.preferHardSub), origin.variantId))
    }

    private const val SUBTITLE_FILE = "subs.vtt"
    private const val MAX_SUBTITLE_BYTES = 2 * 1024 * 1024

    /** Captions saved beside a downloaded episode, if any. */
    fun localSubtitle(playlist: File): File? = File(playlist.parentFile, SUBTITLE_FILE).takeIf { it.isFile }

    /**
     * Queue an episode. `resolve` returns the m3u8 URL + Referer + UA (and the
     * preferred caption track) at download time. A failed or interrupted
     * episode asked for again keeps the pieces it already saved.
     */
    fun enqueue(
        animeId: Int, episode: Float, title: String, cover: String?,
        resolve: suspend () -> Source,
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
        val kept = withItems { firstOrNull { it.id == id }?.progress ?: 0 }
        val item = Item(id, animeId, episode, title, cover, Status.QUEUED, kept)
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
        start(item, resolve, resumed = false)
    }

    private fun start(item: Item, resolve: suspend () -> Source, resumed: Boolean) {
        val id = item.id
        // Claim ownership before the lazy job starts. This prevents an older
        // remove() coroutine from deleting this retry's new folder between its
        // cancellation check and the first metadata write.
        val generation = nextGeneration.incrementAndGet()
        synchronized(jobs) {
            if (jobs[id]?.isActive == true) return
            operationGeneration[id] = generation
        }
        val job = scope.launch(start = CoroutineStart.LAZY) {
            queueLock.withLock { run(item, resolve, resumed) }
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

    /** One download from first resolve to DONE or FAILED, waiting and resolving again as needed. */
    private suspend fun run(item: Item, resolve: suspend () -> Source, resumed: Boolean) {
        val id = item.id
        setStatus(id, Status.DOWNLOADING, currentProgress(id))
        var origin: EpisodeOrigin? = readOrigin(id)
        var reResolves = 0
        try {
            // Persist metadata first so a process/device restart can surface
            // (and resume) an interrupted item instead of leaking invisible files.
            writeMeta(id, item.animeId, item.episode, item.title, item.cover, origin, currentProgress(id))
            while (true) {
                if (resumed || reResolves > 0) awaitNetwork(id)
                val capture = OriginCapture()
                val source = try {
                    withContext(capture) { resolve() }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // Offline while resolving: wait for the network, then try again.
                    if (!online()) { awaitNetwork(id); continue }
                    throw e
                }
                capture.origin?.let { found ->
                    if (found != origin) {
                        origin = found
                        writeMeta(id, item.animeId, item.episode, item.title, item.cover, origin, currentProgress(id))
                    }
                }
                setStatus(id, Status.DOWNLOADING, currentProgress(id))
                when (val outcome = download(id, source, reResolves, System.currentTimeMillis()) { p -> setStatus(id, Status.DOWNLOADING, p) }) {
                    is HlsDownload.Outcome.Done -> break
                    is HlsDownload.Outcome.ReResolve -> {
                        reResolves = if (outcome.progressed) 1 else reResolves + 1
                        continue
                    }
                    is HlsDownload.Outcome.Pause -> {
                        if (outcome.progressed) reResolves = 0
                        waitOut(id, outcome)
                        // The next pass resolves the stream again: signed URLs may have expired meanwhile.
                        continue
                    }
                }
            }
            withItems {
                val i = indexOfFirst { it.id == id }
                if (i >= 0) this[i] = this[i].copy(status = Status.DONE, progress = 100, error = null, sizeBytes = sizeOf(id))
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val message = e.message?.replace(Regex("https?://\\S+"), "the media server") ?: "The download failed. Start it again to continue."
            // The saved pieces stay: asking for the episode again continues from them.
            setStatus(id, Status.FAILED, currentProgress(id), message)
            writeProgress(id)
        }
    }

    /** How much of an unfinished download its ledger says is saved (0..99). */
    private fun savedProgress(dir: File): Int? = runCatching {
        val ledger = DownloadResume.parseLedger(File(dir, DownloadResume.LEDGER_FILE).readText()) ?: return null
        if (ledger.total <= 0) null else (ledger.pieces.size * 100 / ledger.total).coerceIn(0, 99)
    }.getOrNull()

    private fun currentProgress(id: String): Int = withItems { firstOrNull { it.id == id }?.progress ?: 0 }

    /** Waits until a paused download may continue; it shows as queued meanwhile. */
    private suspend fun waitOut(id: String, pause: HlsDownload.Outcome.Pause) {
        val p = currentProgress(id)
        val label = when (pause.reason) {
            DownloadResume.PauseReason.NETWORK -> "Waiting for the network"
            DownloadResume.PauseReason.RATE_LIMIT -> "The server asked to wait"
            DownloadResume.PauseReason.SERVER -> "The server is busy"
        } + if (p > 0) " · $p% saved" else ""
        setStatus(id, Status.QUEUED, p, label)
        writeProgress(id)
        // Should the process die while waiting, the worker carries on once there's a network.
        DownloadResumeWorker.schedule(appCtx, pause.resumeAt?.let { it - System.currentTimeMillis() } ?: 0L)
        pause.resumeAt?.let { at -> delay((at - System.currentTimeMillis()).coerceAtLeast(0)) }
        awaitNetwork(id)
        setStatus(id, Status.DOWNLOADING, p)
    }

    // ── Network ─────────────────────────────────────────────────────────────

    private fun watchNetwork() = NetworkWatch.init(appCtx)

    private fun online(): Boolean = NetworkWatch.online()

    /** Returns once a network is up (at once when it already is). */
    private suspend fun awaitNetwork(id: String) {
        if (online()) return
        val p = currentProgress(id)
        setStatus(id, Status.QUEUED, p, "Waiting for the network" + if (p > 0) " · $p% saved" else "")
        DownloadResumeWorker.schedule(appCtx)
        NetworkWatch.awaitOnline()
        setStatus(id, Status.DOWNLOADING, p)
    }

    // ── Metadata ────────────────────────────────────────────────────────────

    private fun setStatus(id: String, s: Status, p: Int, err: String? = null) {
        withItems {
            val i = indexOfFirst { it.id == id }
            if (i >= 0) this[i] = this[i].copy(status = s, progress = p, error = err)
        }
    }

    private fun originOf(o: JSONObject): EpisodeOrigin? {
        val provider = o.optString("providerId").takeIf { it.isNotEmpty() } ?: return null
        val key = o.optString("resumeKey").takeIf { it.isNotEmpty() } ?: return null
        return EpisodeOrigin(
            provider, key, o.getDouble("episode").toFloat(),
            o.optString("variantId").takeIf { it.isNotEmpty() }, o.optBoolean("preferHardSub", false),
        )
    }

    private fun readOrigin(id: String): EpisodeOrigin? =
        runCatching { originOf(JSONObject(File(folder(id), "meta.json").readText())) }.getOrNull()

    private fun writeMeta(id: String, animeId: Int, episode: Float, title: String, cover: String?, origin: EpisodeOrigin?, progress: Int) {
        val o = JSONObject().put("id", id).put("animeId", animeId).put("episode", episode.toDouble())
            .put("title", title).put("cover", cover ?: "").put("progress", progress)
        origin?.let {
            o.put("providerId", it.providerId).put("resumeKey", it.resumeKey).put("preferHardSub", it.preferHardSub)
            it.variantId?.let { variant -> o.put("variantId", variant) }
        }
        val dir = folder(id).apply { mkdirs() }
        val target = File(dir, "meta.json")
        val temp = File(dir, "meta.json.part")
        temp.writeText(o.toString())
        if (!temp.renameTo(target)) {
            temp.delete()
            throw Exception("Could not save download metadata")
        }
    }

    /** Records the progress shown after a restart (best-effort). */
    private fun writeProgress(id: String) {
        runCatching {
            val file = File(folder(id), "meta.json")
            val o = JSONObject(file.readText()).put("progress", currentProgress(id))
            val temp = File(folder(id), "meta.json.part")
            temp.writeText(o.toString())
            if (!temp.renameTo(file)) temp.delete()
        }
    }

    /**
     * Soft-sub episodes are unwatchable offline without their captions, so save
     * them beside the video. Best-effort: a caption failure never fails the
     * already-complete video download.
     */
    private suspend fun saveSubtitle(id: String, url: String, referer: String, ua: String, conservativeNetwork: Boolean) = withContext(Dispatchers.IO) {
        runCatching {
            if (java.net.URI(url).scheme != "https") return@runCatching
            if (conservativeNetwork) delay(500)
            val bytes = runInterruptible { DownloadTransport.bytes(url, referer, ua, maxRetries = if (conservativeNetwork) 0 else 2) }
            if (bytes.size > MAX_SUBTITLE_BYTES) return@runCatching
            if (!String(bytes, Charsets.UTF_8).trimStart('﻿').trimStart().startsWith("WEBVTT")) return@runCatching
            val dir = folder(id)
            val temp = File(dir, "$SUBTITLE_FILE.part")
            temp.writeBytes(bytes)
            if (!temp.renameTo(File(dir, SUBTITLE_FILE))) temp.delete()
        }.onFailure { error -> if (error is CancellationException) throw error }
    }

    // ── HLS download ────────────────────────────────────────────────────────────

    private suspend fun download(
        id: String, source: Source, reResolves: Int, resolvedAt: Long, onProgress: (Int) -> Unit,
    ): HlsDownload.Outcome = withContext(Dispatchers.IO) {
        val fetcher = HlsDownload.Fetcher(
            bytes = { url -> DownloadTransport.attemptBytes(url, source.referer, source.userAgent) },
            toFile = { url, file -> DownloadTransport.attemptToFile(url, file, source.referer, source.userAgent) },
        )
        HlsDownload.run(folder(id).apply { mkdirs() }, source.url, source.conservativeNetwork, reResolves, resolvedAt, fetcher, onProgress) {
            source.subtitleUrl?.let { saveSubtitle(id, it, source.referer, source.userAgent, source.conservativeNetwork) }
        }
    }
}
