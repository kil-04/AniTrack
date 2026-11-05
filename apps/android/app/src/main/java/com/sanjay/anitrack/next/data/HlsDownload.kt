package com.sanjay.anitrack.next.data

import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * The HLS part of [Downloads], free of Android so it runs in unit tests with
 * fake fetchers: reads the playlist chain, plans the pieces with
 * [DownloadResume], keeps what an earlier run saved for the same rendition,
 * fetches the rest with the shared retry rules, saves the captions
 * (best-effort) and writes the local playlist.
 */
internal object HlsDownload {
    private const val SEGMENT_WORKERS = 6
    const val CAPTION_FILE = "subs.vtt"
    private const val MAX_CAPTION_BYTES = 2 * 1024 * 1024

    /** One request's answer; [status] is 0 when none came (offline, reset, refused, timeout). */
    class Attempt(val status: Int, val retryAfter: String?, val bytes: Long = 0)

    /** How the run reaches the network (and the clock), replaced by fakes in tests. */
    class Fetcher(
        val bytes: (String) -> Pair<Attempt, ByteArray?>,
        val toFile: (String, File) -> Attempt,
        val wait: suspend (Long) -> Unit = { delay(it) },
        val now: () -> Long = System::currentTimeMillis,
        /** Whether the device has a network: only without one is a missing answer the network's fault. */
        val online: () -> Boolean = { true },
    )

    private data class Dl(val url: String, val file: File, val piece: DownloadResume.Piece)

    sealed class Outcome {
        object Done : Outcome()
        /**
         * The stream expired or was refused: resolve it again and continue. [progressed]: this run
         * saved a media piece (keys don't count, nor does a run that discarded another rendition's pieces).
         */
        data class ReResolve(val progressed: Boolean) : Outcome()
        data class Pause(val reason: DownloadResume.PauseReason, val resumeAt: Long?, val progressed: Boolean) : Outcome()
    }

    private class Interrupt(val step: DownloadResume.Step) : Exception()
    private class KeyChanged : Exception()

    /** Per-run request state shared by the segment workers. */
    private class RunState(val reResolves: Int, val resolvedAt: Long, val conservative: Boolean, val onProgressed: () -> Unit) {
        @Volatile var cooldownUntil = 0L
        @Volatile var savedMedia = false
        @Volatile var startedOver = false
        private val told = AtomicBoolean(false)
        val progressed get() = savedMedia && !startedOver
        /** The stall streak now: once this run saved a media piece it is off it ([DownloadResume.streakNow]). */
        val streak get() = DownloadResume.streakNow(reResolves, progressed)

        /** A media piece was saved: the first one (in a pass that kept what was saved) ends the streak, once. */
        fun saved() {
            savedMedia = true
            if (progressed && told.compareAndSet(false, true)) onProgressed()
        }
    }

    /** One request with the shared retry rules; throws [Interrupt] when the run has to stop. */
    private suspend fun <T> request(state: RunState, fetcher: Fetcher, url: String, attempt: () -> Pair<Attempt, T?>): T {
        var failures = 0
        while (true) {
            val cooling = state.cooldownUntil - fetcher.now()
            if (cooling > 0) fetcher.wait(cooling)
            // A signed URL about to expire is resolved again rather than refused mid-episode (only
            // while fresh streams help: one that is always about to expire is tried as it is).
            if (DownloadResume.reResolveFirst(url, state.resolvedAt, state.reResolves, fetcher.now())) {
                throw Interrupt(DownloadResume.Step.ReResolve)
            }
            if (state.conservative) fetcher.wait(500)
            val (result, value) = runInterruptible { attempt() }
            if (result.status in 200..299 && value != null) return value
            val failure = failureOf(result, fetcher)
            val now = fetcher.now()
            val streak = state.streak
            var step = DownloadResume.nextStep(failure, failures, streak, now)
            // A rate-sensitive stream is never retried at once: it pauses, longer with each stall.
            if (state.conservative) step = DownloadResume.conservativeStep(step, failure, streak, now)
            when (step) {
                is DownloadResume.Step.Retry -> {
                    val http = failure as? DownloadResume.Failure.Http
                    if (http != null && (http.status == 429 || http.status == 503)) state.cooldownUntil = maxOf(state.cooldownUntil, now + step.delayMs)
                    fetcher.wait(step.delayMs)
                    failures++
                }
                DownloadResume.Step.Fail -> throw Exception("HTTP ${result.status} from the media server")
                else -> throw Interrupt(step)
            }
        }
    }

    private fun failureOf(result: Attempt, fetcher: Fetcher): DownloadResume.Failure =
        if (result.status == 0) DownloadResume.Failure.Network(fetcher.online()) else DownloadResume.Failure.Http(result.status, result.retryAfter)

    /**
     * Captions, best-effort ([DownloadResume.captionStep]): a couple of short retries, never a
     * pause for the server or a fresh stream; then the episode finishes without them. Offline,
     * the run stops for the network instead (keeping every piece), so a dropped connection doesn't
     * cost a soft-subbed episode its captions.
     */
    private suspend fun saveCaptions(state: RunState, fetcher: Fetcher, url: String, dir: File) {
        if (runCatching { java.net.URI(url).scheme }.getOrNull() != "https") return
        var attempt = 0
        while (true) {
            if (state.conservative) fetcher.wait(500)
            val (result, body) = try {
                runInterruptible { fetcher.bytes(url) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
                return // an address the transport refuses: no captions
            }
            if (result.status in 200..299 && body != null) {
                val text = String(body, Charsets.UTF_8)
                if (body.size <= MAX_CAPTION_BYTES && text.trimStart('\uFEFF').trimStart().startsWith("WEBVTT")) {
                    val temp = File(dir, "$CAPTION_FILE.part")
                    runCatching {
                        temp.writeBytes(body)
                        if (!temp.renameTo(File(dir, CAPTION_FILE))) temp.delete()
                    }.onFailure { temp.delete() }
                }
                return
            }
            when (val step = DownloadResume.captionStep(failureOf(result, fetcher), attempt, state.conservative, fetcher.now())) {
                is DownloadResume.Step.Retry -> { fetcher.wait(step.delayMs); attempt++ }
                is DownloadResume.Step.Pause -> throw Interrupt(step)
                else -> return
            }
        }
    }

    /**
     * Downloads the HLS stream at [url] into [dir], keeping what an earlier run
     * saved for the same rendition, then its captions ([captionUrl], best-effort).
     * Returns Done, or why it stopped (its files stay); throws for a failure
     * resuming can't help. [reResolves]: runs in a row before this one that stalled;
     * [onProgressed] runs once, when this run saves its first media piece (it is no stall).
     */
    suspend fun run(
        dir: File, url: String, conservative: Boolean, reResolves: Int, resolvedAt: Long,
        fetcher: Fetcher, onProgress: (Int) -> Unit, captionUrl: String? = null, onProgressed: () -> Unit = {},
    ): Outcome {
        val state = RunState(reResolves, resolvedAt, conservative, onProgressed)
        try {
            var playlistUrl = url
            suspend fun readPlaylist(url: String): String =
                String(request(state, fetcher, url) { fetcher.bytes(url) }, Charsets.UTF_8)
            var playlist = readPlaylist(playlistUrl)
            val variant = mutableListOf<String>()
            // Follow a bounded chain of master playlists. Some provider CDNs put
            // another master behind the selected quality variant.
            repeat(4) { depth ->
                if (!playlist.contains("#EXT-X-STREAM-INF")) return@repeat
                val (variantUrl, line) = pickVariant(playlist, playlistUrl)
                    ?: throw Exception("HLS master playlist had no playable variant")
                variant += DownloadResume.variantAttributes(line)
                playlistUrl = variantUrl
                playlist = readPlaylist(playlistUrl)
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
            var encrypted = false
            var duration: String? = null
            for (raw in playlist.split("\n")) {
                val line = raw.trimEnd('\r')
                when {
                    line.startsWith("#EXT-X-MAP") -> {
                        val m = Regex("URI=\"([^\"]+)\"").find(line)
                        if (m != null) {
                            val url = absolutize(m.groupValues[1], base)
                            val mapName = "init${mapIndex++}.${mediaExtension(url, "mp4")}"
                            toDownload += Dl(url, File(dir, mapName), DownloadResume.Piece(DownloadResume.Kind.INIT, url, mapName))
                            outLines += line.replace(m.groupValues[0], "URI=\"$mapName\"")
                        } else outLines += line
                    }
                    line.startsWith("#EXT-X-KEY") || line.startsWith("#EXT-X-SESSION-KEY") -> {
                        if (line.startsWith("#EXT-X-KEY")) encrypted = !Regex("METHOD=NONE\\b").containsMatchIn(line)
                        val m = Regex("URI=\"([^\"]+)\"").find(line)
                        if (m != null) {
                            val keyName = "key$keyIndex.bin"; keyIndex++
                            val url = absolutize(m.groupValues[1], base)
                            toDownload += Dl(url, File(dir, keyName), DownloadResume.Piece(DownloadResume.Kind.KEY, url, keyName))
                            outLines += line.replace(m.groupValues[0], "URI=\"$keyName\"")
                        } else outLines += line
                    }
                    line.startsWith("#EXTINF:") -> {
                        duration = line.substring(8).substringBefore(',').trim()
                        outLines += line
                    }
                    line.isNotBlank() && !line.startsWith("#") -> {
                        val url = absolutize(line, base)
                        val segName = "seg%05d.%s".format(segIndex, mediaExtension(url, "ts")); segIndex++
                        toDownload += Dl(url, File(dir, segName), DownloadResume.Piece(DownloadResume.Kind.SEGMENT, url, segName, duration, encrypted))
                        outLines += segName
                        duration = null
                    }
                    else -> outLines += line
                }
            }
            if (toDownload.isEmpty()) throw Exception("Playlist had no segments")

            val pieces = toDownload.map { it.piece }
            val rendition = DownloadResume.renditionId(variant.joinToString("|"), pieces)
            val ledgerFile = File(dir, DownloadResume.LEDGER_FILE)
            val ledgerLock = Any()
            val total = toDownload.size
            val done = AtomicInteger(0)

            suspend fun save(index: Int, ledger: DownloadResume.Ledger?) {
                val d = toDownload[index]
                request(state, fetcher, d.url) {
                    val attempt = fetcher.toFile(d.url, d.file)
                    attempt to (if (attempt.status in 200..299) attempt else null)
                }
                val head = readHead(d.file)
                val tag = DownloadResume.pieceTag(d.piece, head?.head ?: ByteArray(0))
                if (d.piece.kind == DownloadResume.Kind.KEY && !DownloadResume.keyStillMatches(ledger, index, tag)) throw KeyChanged()
                synchronized(ledgerLock) { ledgerFile.appendText(DownloadResume.ledgerLine(index, d.file.name, d.file.length(), tag)) }
                // Keys are fetched again every run: only media counts as progress.
                if (d.piece.kind != DownloadResume.Kind.KEY) state.saved()
            }

            var pass = 0
            while (true) {
                val previous = if (pass == 0 && ledgerFile.isFile) DownloadResume.parseLedger(ledgerFile.readText()) else null
                val plan = DownloadResume.resumePlan(pieces, rendition, previous) { name -> readHead(File(dir, name)) }
                // Discarding what an earlier run saved (another rendition, a changed key) isn't progress.
                if (plan.restart && (pass > 0 || (previous?.pieces?.size ?: 0) > 0)) state.startedOver = true
                if (plan.restart) {
                    // Another rendition (or none recorded): never mix its files into this one.
                    dir.listFiles().orEmpty().filter { PIECE_FILE.matches(it.name) || it.name.endsWith(".part") }.forEach { it.delete() }
                    ledgerFile.writeText(DownloadResume.ledgerHeader(rendition, total))
                } else {
                    dir.listFiles().orEmpty().filter { it.name.endsWith(".part") }.forEach { it.delete() }
                }
                val ledger = if (plan.restart) null else previous
                done.set(plan.keep.size)
                onProgress((done.get() * 100 / total).coerceIn(0, 99))
                try {
                    // Keys first: one that changed means the kept segments can't be used.
                    for (index in plan.fetch) if (pieces[index].kind == DownloadResume.Kind.KEY) save(index, ledger)
                } catch (e: KeyChanged) {
                    if (pass++ == 0) continue
                    throw Exception("The stream's encryption key keeps changing")
                }
                val queue = plan.fetch.filter { pieces[it].kind != DownloadResume.Kind.KEY }
                val next = AtomicInteger(0)
                // Children belong to this download, not the app-wide SupervisorJob,
                // so any failed key/segment aborts the item instead of producing a
                // broken playlist that is incorrectly marked DONE.
                coroutineScope {
                    repeat(minOf(if (conservative) 1 else SEGMENT_WORKERS, maxOf(1, queue.size))) {
                        launch {
                            while (true) {
                                val at = next.getAndIncrement()
                                if (at >= queue.size) break
                                save(queue[at], ledger)
                                onProgress((done.incrementAndGet() * 100 / total).coerceIn(0, 99))
                            }
                        }
                    }
                }
                break
            }
            captionUrl?.let { saveCaptions(state, fetcher, it, dir) }
            // Write the rewritten local playlist last, so a partial download is
            // detectable (no index.m3u8 = incomplete).
            val playlistTemp = File(dir, "index.m3u8.part")
            val playlistFile = File(dir, "index.m3u8")
            playlistTemp.writeText(outLines.joinToString("\n"))
            if (!playlistTemp.renameTo(playlistFile)) {
                playlistTemp.delete()
                throw Exception("Could not finalize offline playlist")
            }
            return Outcome.Done
        } catch (e: Interrupt) {
            return when (val step = e.step) {
                is DownloadResume.Step.Pause -> Outcome.Pause(step.reason, step.resumeAt, state.progressed)
                else -> Outcome.ReResolve(state.progressed)
            }
        }
    }

    private val PIECE_FILE = Regex("^(?:seg\\d+|key\\d+|init\\d+)\\.[a-z0-9]+$")

    private fun readHead(file: File): DownloadResume.Disk? = runCatching {
        if (!file.isFile) return null
        file.inputStream().use { input ->
            val buffer = ByteArray(minOf(DownloadResume.HEAD_BYTES.toLong(), file.length()).toInt())
            var read = 0
            while (read < buffer.size) {
                val n = input.read(buffer, read, buffer.size - read)
                if (n < 0) break
                read += n
            }
            DownloadResume.Disk(file.length(), buffer.copyOf(read))
        }
    }.getOrNull()

    private fun mediaExtension(url: String, fallback: String): String {
        val path = runCatching { java.net.URI(url).path }.getOrNull().orEmpty()
        return path.substringAfterLast('.', "").lowercase()
            .takeIf { it in setOf("ts", "m4s", "mp4", "aac", "m4a", "webm") }
            ?: fallback
    }

    private fun absolutize(uri: String, base: String): String =
        runCatching { java.net.URI(base).resolve(uri).toString() }.getOrDefault(uri)

    private fun pickVariant(playlist: String, base: String): Pair<String, String>? {
        val lines = playlist.split("\n").map { it.trimEnd('\r') }
        var bestBw = -1; var best: Pair<String, String>? = null
        for (i in lines.indices) {
            val line = lines[i]
            if (line.startsWith("#EXT-X-STREAM-INF")) {
                val bw = Regex("BANDWIDTH=(\\d+)").find(line)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                val uri = lines.getOrNull(i + 1)?.takeIf { it.isNotBlank() && !it.startsWith("#") }
                if (uri != null && bw > bestBw) { bestBw = bw; best = absolutize(uri, base.substringBeforeLast('/') + "/") to line }
            }
        }
        return best
    }
}
