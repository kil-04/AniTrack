package com.sanjay.anitrack.next.data.manga

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import com.sanjay.anitrack.next.data.DownloadResume
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.NetworkWatch
import com.sanjay.anitrack.next.data.manga.comix.ComixCachedPageCopy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Offline manga chapters: each chapter's page images are saved to
 * filesDir/manga-downloads/<anilistId>/<chapter>/ with a meta.json, one chapter
 * at a time. The reader opens them from disk (long strips are sliced from the
 * local file), so downloaded chapters read without a connection.
 *
 * Interrupted chapters resume (DownloadResume, the twin of
 * packages/shared/download-resume.ts): each saved page is appended to
 * download.ledger, and a later run keeps the pages that still verify (same
 * size and image format, and they decode) for the same page list, fetching only
 * the rest in their places. A chapter waits out rate limits and network drops,
 * fetches its page list again when page addresses expire, and carries on after
 * the app is closed or killed.
 */
object MangaDownloads {
    enum class Status { QUEUED, DOWNLOADING, DONE, FAILED }

    data class Item(
        val key: String,
        val mangaId: Int,
        val mangaTitle: String,
        val cover: String?,
        val sourceId: String,
        val sourceTitleId: String,
        val sourceTitle: String,
        val chapter: MangaChapter,
        val status: Status,
        val done: Int = 0,
        val total: Int = 0,
        val error: String? = null,
        val sizeBytes: Long = 0,
    )

    private const val MAX_PAGE_BYTES = 40L * 1024 * 1024
    // A chapter's pages come three at a time, about what the reader asks for:
    // MangaBall's CDN served one page in 25 s alone but three in parallel in 6 s
    // (11 Oct 2026), so one at a time took minutes per chapter.
    private const val PAGE_WORKERS = 3
    private var root: File? = null
    private var comixPageCopy: ComixCachedPageCopy? = null
    private var toonkotsuPageCopy: ComixCachedPageCopy? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val queue = Channel<Pending>(Channel.UNLIMITED)
    // The live request per chapter: a queued or running download whose generation no
    // longer matches was removed or cancelled, and stops without touching the list.
    private val generations = ConcurrentHashMap<String, Long>()
    private val nextGeneration = java.util.concurrent.atomic.AtomicLong()
    private var worker: Job? = null
    private val client by lazy {
        OkHttpClient.Builder()
            .dns(MangaPublicDns)
            .connectTimeout(15, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .build()
    }

    /** Observable for the UI (main-thread snapshot list). */
    val items: SnapshotStateList<Item> = mutableStateListOf()

    private data class Pending(val item: Item, val source: MangaSource, val title: SourceTitle, val generation: Long)

    private fun live(pending: Pending) = generations[pending.item.key] == pending.generation

    fun keyOf(mangaId: Int, chapterId: String) = "$mangaId:$chapterId"

    private fun safe(chapterId: String) = chapterId.replace(Regex("[^A-Za-z0-9_-]"), "_").take(80)
    private fun folder(mangaId: Int, chapterId: String) = File(File(root ?: error("not initialised"), mangaId.toString()), safe(chapterId))
    internal fun directory(): File? = root

    /** A saved page (file URL) inside the download folder, or null for anything else. */
    internal fun localFile(url: String): File? {
        if (!url.startsWith("file:")) return null
        val local = runCatching { File(java.net.URI(url)).canonicalFile }.getOrNull() ?: return null
        val downloads = root?.canonicalFile ?: return null
        return local.takeIf { it.path.startsWith(downloads.path + File.separator) && it.isFile }
    }

    /** A page Comix already decoded into its own cache, or null (exact cache names only). */
    internal fun comixCachedFile(url: String): File? =
        if (!url.startsWith("file:")) null else runCatching { comixPageCopy?.cachedFile(url) }.getOrNull()

    internal fun toonkotsuCachedFile(url: String): File? =
        if (!url.startsWith("file:")) null else runCatching { toonkotsuPageCopy?.cachedFile(url) }.getOrNull()

    fun init(context: Context) {
        if (root != null) return
        val dir = File(context.filesDir, "manga-downloads")
        comixPageCopy = ComixCachedPageCopy(File(context.cacheDir, "comix-pages"))
        toonkotsuPageCopy = ComixCachedPageCopy(File(context.cacheDir, "toonkotsu-pages"), "toonkotsu")
        root = dir
        // Only the main process downloads; WebView helper processes (:comix) just read.
        val main = NetworkWatch.isMainProcess(context)
        if (main) NetworkWatch.init(context)
        val app = context.applicationContext
        scope.launch {
            val restored = dir.listFiles().orEmpty().filter { it.isDirectory }.flatMap { mangaDir ->
                mangaDir.listFiles().orEmpty().filter { it.isDirectory }.mapNotNull { chapterDir -> restore(chapterDir) }
            }
            val resumed = withContext(Dispatchers.Main) {
                restored.forEach { item -> if (items.none { it.key == item.key }) items += item }
                // Unfinished chapters carry on where they stopped.
                if (main) restored.filter { it.status == Status.QUEUED }.count { resume(it) } else 0
            }
            if (resumed > 0) com.sanjay.anitrack.next.data.DownloadResumeWorker.schedule(app)
        }
    }

    /** Queues a restored, unfinished chapter again (main thread); false when its source is gone. */
    private fun resume(item: Item): Boolean {
        val source = MangaSources.byId(item.sourceId)
        if (source == null) {
            val index = items.indexOfFirst { it.key == item.key }
            if (index >= 0) items[index] = item.copy(status = Status.FAILED, error = "Download was interrupted. Download it again.")
            return false
        }
        val generation = nextGeneration.incrementAndGet()
        generations[item.key] = generation
        queue.trySend(Pending(item, source, SourceTitle(item.sourceId, item.sourceTitleId, item.sourceTitle), generation))
        if (worker?.isActive != true) worker = scope.launch { for (pending in queue) run(pending) }
        return true
    }

    private fun restore(chapterDir: File): Item? = runCatching {
        val meta = JSONObject(File(chapterDir, "meta.json").readText())
        val complete = meta.optBoolean("complete")
        val chapter = MangaChapter(
            id = meta.getString("chapterId"),
            number = meta.getDouble("number").toFloat(),
            title = meta.optString("chapterTitle").ifEmpty { null },
            group = meta.optString("group").ifEmpty { null },
            pageCount = meta.optJSONArray("pages")?.length(),
        )
        Item(
            key = keyOf(meta.getInt("mangaId"), chapter.id),
            mangaId = meta.getInt("mangaId"),
            mangaTitle = meta.optString("mangaTitle", "Unknown"),
            cover = meta.optString("cover").ifEmpty { null },
            sourceId = meta.getString("sourceId"),
            sourceTitleId = meta.getString("sourceTitleId"),
            sourceTitle = meta.optString("sourceTitle"),
            chapter = chapter,
            // Unfinished: queued again, keeping the pages its ledger lists.
            status = if (complete) Status.DONE else Status.QUEUED,
            done = if (complete) chapter.pageCount ?: 0 else 0,
            total = chapter.pageCount ?: 0,
            error = null,
            sizeBytes = chapterDir.listFiles().orEmpty().sumOf { it.length() },
        )
    }.getOrElse {
        // Metadata from an interrupted first write can't be resumed; free the space.
        chapterDir.deleteRecursively()
        null
    }

    /** Chapters queued, downloading or waiting to resume (main thread). */
    fun hasPending(): Boolean = items.any { it.status == Status.QUEUED || it.status == Status.DOWNLOADING }

    fun statusOf(mangaId: Int, chapterId: String): Item? = items.firstOrNull { it.key == keyOf(mangaId, chapterId) }

    fun enqueue(manga: Manga, source: MangaSource, title: SourceTitle, chapter: MangaChapter) {
        val key = keyOf(manga.id, chapter.id)
        val existing = items.firstOrNull { it.key == key }
        if (existing != null && existing.status != Status.FAILED) return
        val item = Item(
            key = key, mangaId = manga.id, mangaTitle = manga.title, cover = manga.cover,
            sourceId = source.id, sourceTitleId = title.id, sourceTitle = title.title,
            chapter = chapter, status = Status.QUEUED, total = chapter.pageCount ?: 0,
        )
        // Called from the UI thread, which owns the snapshot list.
        val index = items.indexOfFirst { it.key == key }
        if (index >= 0) items[index] = item else items += item
        val generation = nextGeneration.incrementAndGet()
        generations[key] = generation
        queue.trySend(Pending(item, source, title, generation))
        if (worker?.isActive != true) worker = scope.launch { for (pending in queue) run(pending) }
    }

    /** A series' chapter numbers that are downloaded or on the way, from any group (failed tries don't count). */
    fun held(mangaId: Int): Map<Float, Item> =
        items.filter { it.mangaId == mangaId && it.status != Status.FAILED }.associateBy { it.chapter.number }

    /**
     * Queues [chapters] in reading order. A chapter number already downloaded or
     * on the way, from any group, is skipped, so a range never saves the same
     * chapter twice; a failed try at that number is replaced. Returns how many were added.
     */
    fun enqueueAll(manga: Manga, source: MangaSource, title: SourceTitle, chapters: List<MangaChapter>): Int {
        var added = 0
        for (chapter in chapters.distinctBy { it.number }.sortedBy { it.number }) {
            val same = items.filter { it.mangaId == manga.id && it.chapter.number == chapter.number }
            if (same.any { it.status != Status.FAILED }) continue
            same.filter { it.key != keyOf(manga.id, chapter.id) }.forEach { remove(it.key) }
            enqueue(manga, source, title, chapter)
            added++
        }
        return added
    }

    /** Stops a series' queued and in-progress chapters; finished ones stay. */
    fun cancel(mangaId: Int) {
        items.filter { it.mangaId == mangaId && (it.status == Status.QUEUED || it.status == Status.DOWNLOADING) }
            .map { it.key }
            .forEach(::remove)
    }

    fun remove(key: String) {
        val item = items.firstOrNull { it.key == key } ?: return
        generations.remove(key)
        items.removeAll { it.key == key }
        scope.launch {
            folder(item.mangaId, item.chapter.id).deleteRecursively()
            folder(item.mangaId, item.chapter.id).parentFile?.takeIf { it.listFiles().isNullOrEmpty() }?.delete()
        }
    }

    /** Local pages of a fully downloaded chapter, or null to read it online. */
    suspend fun localPages(mangaId: Int, chapterId: String): List<MangaPage>? = withContext(Dispatchers.IO) {
        if (root == null) return@withContext null
        val dir = folder(mangaId, chapterId)
        val meta = runCatching { JSONObject(File(dir, "meta.json").readText()) }.getOrNull() ?: return@withContext null
        if (!meta.optBoolean("complete")) return@withContext null
        val pages = meta.optJSONArray("pages") ?: return@withContext null
        (0 until pages.length()).map { i ->
            val p = pages.getJSONObject(i)
            val file = File(dir, p.getString("file"))
            if (!file.isFile) return@withContext null
            MangaPage(
                url = file.toURI().toString(),
                width = p.optInt("w", 0).takeIf { it > 0 },
                height = p.optInt("h", 0).takeIf { it > 0 },
            )
        }
    }

    /** Like [update], with the row built on the main thread (pages finish out of order). */
    private suspend fun updateWith(pending: Pending, change: () -> Item) = withContext(Dispatchers.Main) {
        if (!live(pending)) return@withContext
        val item = change()
        val index = items.indexOfFirst { it.key == item.key }
        if (index >= 0) items[index] = item
    }

    /** Updates the row of a still-live download (a removed row is never re-added). */
    private suspend fun update(pending: Pending, item: Item) = withContext(Dispatchers.Main) {
        if (!live(pending)) return@withContext
        val index = items.indexOfFirst { it.key == item.key }
        if (index >= 0) items[index] = item
    }

    private class Interrupt(val step: DownloadResume.Step) : Exception()

    private suspend fun run(pending: Pending) {
        if (!live(pending)) return // removed or cancelled while queued
        var item = pending.item
        val dir = folder(item.mangaId, item.chapter.id)
        try {
            // The folder is kept: pages an earlier run saved are reused below.
            dir.mkdirs()
            writeMeta(dir, item, JSONArray(), complete = false)
            var reResolves = 0
            while (true) {
                try {
                    item = saveChapter(pending, item, dir, reResolves)
                    break
                } catch (e: Interrupt) {
                    if (!live(pending)) throw CancellationException("removed")
                    when (val step = e.step) {
                        DownloadResume.Step.ReResolve -> reResolves++
                        is DownloadResume.Step.Pause -> waitOut(pending, step)
                        else -> throw e
                    }
                }
            }
            update(pending, item.copy(status = Status.DONE, sizeBytes = dir.listFiles().orEmpty().sumOf { it.length() }, error = null))
        } catch (e: CancellationException) {
            if (!live(pending)) dir.deleteRecursively()
            if (e.message != "removed") throw e
        } catch (e: Exception) {
            if (com.sanjay.anitrack.next.BuildConfig.DEBUG) {
                android.util.Log.d("MangaDownloads", "Chapter download failed (${pending.source.id}): ${e.javaClass.simpleName}: ${e.message?.take(160)}")
            }
            // The saved pages stay: downloading the chapter again continues from them.
            updateWith(pending) { (items.firstOrNull { it.key == pending.item.key } ?: item).copy(status = Status.FAILED, error = e.message ?: "Download failed. Try again.") }
        }
    }

    /** Shows why a chapter is waiting, then returns once it may continue. */
    private suspend fun waitOut(pending: Pending, step: DownloadResume.Step.Pause) {
        updateWith(pending) {
            val current = items.first { it.key == pending.item.key }
            val saved = if (current.done > 0) " (${current.done} of ${current.total} pages saved)" else ""
            current.copy(
                status = Status.QUEUED,
                error = when (step.reason) {
                    DownloadResume.PauseReason.NETWORK -> "Waiting for the network$saved."
                    DownloadResume.PauseReason.RATE_LIMIT -> "The source asked to wait; continuing automatically$saved."
                    DownloadResume.PauseReason.SERVER -> "The source is busy; continuing automatically$saved."
                },
            )
        }
        step.resumeAt?.let { at -> delay((at - System.currentTimeMillis()).coerceAtLeast(0)) }
        NetworkWatch.awaitOnline()
    }

    /** [work] with the shared retry rules; throws [Interrupt] when the chapter has to stop. */
    private suspend fun <T> withRetry(reResolves: Int, work: suspend () -> T): T {
        var attempt = 0
        while (true) {
            val failure = try {
                return work()
            } catch (e: CancellationException) {
                throw e
            } catch (e: MangaVerificationRequired) {
                throw e
            } catch (e: MangaSourceException) {
                val status = e.status ?: throw e
                if (status == 0) DownloadResume.Failure.Network else DownloadResume.Failure.Http(status, e.retryAfter)
            } catch (e: java.io.IOException) {
                DownloadResume.Failure.Network
            }
            when (val step = DownloadResume.nextStep(failure, attempt, reResolves, System.currentTimeMillis())) {
                is DownloadResume.Step.Retry -> { delay(step.delayMs); attempt++ }
                DownloadResume.Step.Fail -> throw MangaSourceException(
                    if (failure is DownloadResume.Failure.Http && failure.status == 404) "A page is missing at the source." else "A page didn't download (HTTP ${(failure as? DownloadResume.Failure.Http)?.status}).",
                    (failure as? DownloadResume.Failure.Http)?.status,
                )
                else -> throw Interrupt(step)
            }
        }
    }

    private val PAGE_FILE = Regex("^\\d{3,4}\\.(?:jpg|jpeg|png|webp|gif|avif|img)$")

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

    /** One pass at a chapter: keeps what's saved for the same page list, fetches the rest. */
    private suspend fun saveChapter(pending: Pending, start: Item, dir: File, reResolves: Int): Item {
        var item = start
        val pages = withRetry(reResolves) { pending.source.pages(pending.title, item.chapter) }
        if (!live(pending)) throw CancellationException("removed")
        val pieces = pages.map { DownloadResume.Piece(DownloadResume.Kind.PAGE, it.url) }
        val rendition = DownloadResume.renditionId("chapter ${item.chapter.id}", pieces)
        val ledgerFile = File(dir, DownloadResume.LEDGER_FILE)
        val previous = withContext(Dispatchers.IO) { runCatching { DownloadResume.parseLedger(ledgerFile.readText()) }.getOrNull() }
        val plan = withContext(Dispatchers.IO) { DownloadResume.resumePlan(pieces, rendition, previous) { name -> readHead(File(dir, name)) } }
        val ledger = if (plan.restart) null else previous
        val saved = arrayOfNulls<JSONObject>(pages.size)
        val fetch = plan.fetch.toMutableList()
        withContext(Dispatchers.IO) {
            if (plan.restart) {
                // Another page list (or none recorded): start the chapter clean.
                dir.listFiles().orEmpty().filter { PAGE_FILE.matches(it.name) || it.name.endsWith(".part") }.forEach { it.delete() }
                ledgerFile.writeText(DownloadResume.ledgerHeader(rendition, pages.size))
            } else {
                dir.listFiles().orEmpty().filter { it.name.endsWith(".part") }.forEach { it.delete() }
            }
            for (index in plan.keep) {
                val name = ledger!!.pieces.getValue(index).file
                val (w, h) = pages[index].width?.let { it to (pages[index].height ?: 0) } ?: bounds(File(dir, name))
                // A kept page must still decode.
                if (bounds(File(dir, name)).first <= 0) { fetch += index; continue }
                saved[index] = JSONObject().put("file", name).put("w", w).put("h", h)
            }
        }
        fetch.sort()
        val keptCount = pages.size - fetch.size
        item = item.copy(status = Status.DOWNLOADING, total = pages.size, done = keptCount, error = null)
        update(pending, item)
        val downloading = item
        val next = AtomicInteger(0)
        val finished = AtomicInteger(keptCount)
        val ledgerLock = Any()
        // One failed page cancels the other workers before the chapter fails.
        coroutineScope {
            repeat(minOf(PAGE_WORKERS, fetch.size)) {
                launch {
                    while (live(pending)) {
                        val at = next.getAndIncrement()
                        if (at >= fetch.size) break
                        val index = fetch[at]
                        val resolved = withRetry(reResolves) { pending.source.resolvePage(pages[index]) }
                        val name = "%03d.%s".format(index + 1, extensionOf(resolved.url))
                        val file = File(dir, name)
                        withRetry(reResolves) { fetch(pending, resolved, file) }
                        val (w, h) = resolved.width?.let { it to (resolved.height ?: 0) } ?: bounds(file)
                        val head = readHead(file)?.head ?: ByteArray(0)
                        val tag = DownloadResume.pieceTag(pieces[index], head)
                        withContext(Dispatchers.IO) {
                            synchronized(ledgerLock) { ledgerFile.appendText(DownloadResume.ledgerLine(index, name, file.length(), tag)) }
                        }
                        saved[index] = JSONObject().put("file", name).put("w", w).put("h", h)
                        finished.incrementAndGet()
                        // Read the count on the main thread so progress never steps back.
                        updateWith(pending) { downloading.copy(done = finished.get()) }
                    }
                }
            }
        }
        if (!live(pending)) throw CancellationException("removed")
        writeMeta(dir, item, JSONArray().apply { for (page in saved) put(page) }, complete = true)
        return item.copy(done = pages.size)
    }

    private suspend fun fetch(pending: Pending, page: MangaPage, target: File) {
        if (page.url.startsWith("file:", ignoreCase = true)) {
            val context = currentCoroutineContext()
            val cache = (if (pending.source.id == "toonkotsu") toonkotsuPageCopy else comixPageCopy) ?: error("not initialised")
            cache.copy(
                pending.source.id, page.url, target, MAX_PAGE_BYTES,
            ) {
                context.ensureActive()
                if (!live(pending)) throw CancellationException("removed")
            }
            return
        }
        val url = MangaUrlPolicy.publicHttps(page.url)?.toASCIIString()
            ?: throw MangaSourceException("Refused an unsafe page address.")
        val request = Request.Builder().url(url).apply { page.headers.forEach { (k, v) -> header(k, v) } }.build()
        withContext(Dispatchers.IO) {
            val response = try {
                client.newCall(request).execute()
            } catch (e: java.io.IOException) {
                throw MangaSourceException("The download was interrupted. Check your connection and try again.", 0)
            }
            response.use {
                if (!response.isSuccessful) throw MangaSourceException("A page didn't download (HTTP ${response.code}).", response.code, response.header("Retry-After"))
                val body = response.body ?: throw MangaSourceException("A page came back empty.")
                if (body.contentLength() > MAX_PAGE_BYTES) throw MangaSourceException("A page is too large.")
                val partial = File(target.parentFile, target.name + ".part")
                try {
                    partial.outputStream().use { out ->
                        body.byteStream().use { input ->
                            val buffer = ByteArray(64 * 1024)
                            var total = 0L
                            while (true) {
                                val n = input.read(buffer)
                                if (n < 0) break
                                total += n
                                if (total > MAX_PAGE_BYTES) throw MangaSourceException("A page is too large.")
                                out.write(buffer, 0, n)
                            }
                        }
                    }
                } catch (e: java.io.IOException) {
                    partial.delete()
                    throw MangaSourceException("The download was interrupted. Check your connection and try again.", 0)
                }
                if (!partial.renameTo(target)) throw MangaSourceException("Couldn't save a page.")
            }
        }
    }

    private fun bounds(file: File): Pair<Int, Int> {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, options)
        return options.outWidth.coerceAtLeast(0) to options.outHeight.coerceAtLeast(0)
    }

    private fun extensionOf(url: String): String =
        url.substringBefore('?').substringAfterLast('.', "").lowercase()
            .takeIf { it in setOf("jpg", "jpeg", "png", "webp", "gif", "avif") } ?: "img"

    private fun writeMeta(dir: File, item: Item, pages: JSONArray, complete: Boolean) {
        val meta = JSONObject()
            .put("mangaId", item.mangaId)
            .put("mangaTitle", item.mangaTitle)
            .put("cover", item.cover ?: "")
            .put("sourceId", item.sourceId)
            .put("sourceTitleId", item.sourceTitleId)
            .put("sourceTitle", item.sourceTitle)
            .put("chapterId", item.chapter.id)
            .put("number", item.chapter.number.toDouble())
            .put("chapterTitle", item.chapter.title ?: "")
            .put("group", item.chapter.group ?: "")
            .put("pages", pages)
            .put("complete", complete)
        val temp = File(dir, "meta.json.tmp")
        temp.writeText(meta.toString())
        if (!temp.renameTo(File(dir, "meta.json"))) {
            File(dir, "meta.json").writeText(meta.toString())
            temp.delete()
        }
    }

    /** Human size, matching the anime downloads list. */
    fun humanSize(bytes: Long): String {
        if (bytes <= 0) return ""
        val mb = bytes / (1024.0 * 1024.0)
        return if (mb >= 1024) "%.1f GB".format(mb / 1024) else if (mb >= 1) "${mb.toInt()} MB" else "${(bytes / 1024).coerceAtLeast(1)} KB"
    }
}
