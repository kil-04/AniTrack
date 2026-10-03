package com.sanjay.anitrack.next.data.manga

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import com.sanjay.anitrack.next.data.Manga
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Offline manga chapters: each chapter's page images are saved to
 * filesDir/manga-downloads/<anilistId>/<chapter>/ with a meta.json, one chapter
 * at a time. The reader opens them from disk (long strips are sliced from the
 * local file), so downloaded chapters read without a connection.
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
    private var root: File? = null
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

    fun init(context: Context) {
        if (root != null) return
        val dir = File(context.filesDir, "manga-downloads")
        root = dir
        scope.launch {
            val restored = dir.listFiles().orEmpty().filter { it.isDirectory }.flatMap { mangaDir ->
                mangaDir.listFiles().orEmpty().filter { it.isDirectory }.mapNotNull { chapterDir -> restore(chapterDir) }
            }
            withContext(Dispatchers.Main) {
                restored.forEach { item -> if (items.none { it.key == item.key }) items += item }
            }
        }
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
            status = if (complete) Status.DONE else Status.FAILED,
            done = if (complete) chapter.pageCount ?: 0 else 0,
            total = chapter.pageCount ?: 0,
            error = if (complete) null else "Download was interrupted. Download it again.",
            sizeBytes = chapterDir.listFiles().orEmpty().sumOf { it.length() },
        )
    }.getOrElse {
        // Metadata from an interrupted first write can't be resumed; free the space.
        chapterDir.deleteRecursively()
        null
    }

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

    /** Updates the row of a still-live download (a removed row is never re-added). */
    private suspend fun update(pending: Pending, item: Item) = withContext(Dispatchers.Main) {
        if (!live(pending)) return@withContext
        val index = items.indexOfFirst { it.key == item.key }
        if (index >= 0) items[index] = item
    }

    private suspend fun run(pending: Pending) {
        if (!live(pending)) return // removed or cancelled while queued
        var item = pending.item
        val dir = folder(item.mangaId, item.chapter.id)
        try {
            dir.deleteRecursively()
            dir.mkdirs()
            writeMeta(dir, item, JSONArray(), complete = false)
            val pages = pending.source.pages(pending.title, item.chapter)
            item = item.copy(status = Status.DOWNLOADING, total = pages.size, done = 0)
            update(pending, item)
            val saved = JSONArray()
            pages.forEachIndexed { index, page ->
                if (!live(pending)) throw CancellationException("removed")
                val resolved = pending.source.resolvePage(page)
                val name = "%03d.%s".format(index + 1, extensionOf(resolved.url))
                val file = File(dir, name)
                fetch(resolved, file)
                val (w, h) = resolved.width?.let { it to (resolved.height ?: 0) } ?: bounds(file)
                saved.put(JSONObject().put("file", name).put("w", w).put("h", h))
                item = item.copy(done = index + 1)
                update(pending, item)
            }
            if (!live(pending)) throw CancellationException("removed")
            writeMeta(dir, item, saved, complete = true)
            update(pending, item.copy(status = Status.DONE, done = pages.size, sizeBytes = dir.listFiles().orEmpty().sumOf { it.length() }, error = null))
        } catch (e: CancellationException) {
            dir.deleteRecursively()
        } catch (e: Exception) {
            update(pending, item.copy(status = Status.FAILED, error = e.message ?: "Download failed. Try again."))
        }
    }

    private fun fetch(page: MangaPage, target: File) {
        val url = MangaUrlPolicy.publicHttps(page.url)?.toASCIIString()
            ?: throw MangaSourceException("Refused an unsafe page address.")
        val request = Request.Builder().url(url).apply { page.headers.forEach { (k, v) -> header(k, v) } }.build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw MangaSourceException("A page didn't download (HTTP ${response.code}).")
            val body = response.body ?: throw MangaSourceException("A page came back empty.")
            if (body.contentLength() > MAX_PAGE_BYTES) throw MangaSourceException("A page is too large.")
            val partial = File(target.parentFile, target.name + ".part")
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
            if (!partial.renameTo(target)) throw MangaSourceException("Couldn't save a page.")
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
