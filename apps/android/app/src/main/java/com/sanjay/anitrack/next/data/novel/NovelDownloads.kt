package com.sanjay.anitrack.next.data.novel

import android.content.Context
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Offline novel chapters: filesDir/novel-downloads/<source>-<hex title id>/ holds
 * meta.json (the title's details and full chapter list when it was queued) and one
 * c-<hex chapter id>.json per saved chapter. One worker saves one chapter at a time
 * on the sources' slower background lane. Mirrors desktop's services/novel/downloads.ts.
 */
object NovelDownloads {
    /** One source copy's offline state, for the UI. */
    data class Title(
        val source: NovelSourceId,
        val titleId: String,
        val title: String,
        val cover: String?,
        val saved: Int,
        val queued: Int,
        val failed: Int,
        val current: String?,
        val sizeBytes: Long,
        val error: String?,
        val updatedAt: Long,
        /** Per-chapter state for the chapter rows. */
        val currentId: String? = null,
        val queuedIds: Set<String> = emptySet(),
        val failedIds: Set<String> = emptySet(),
        /** Saved chapter ids, published together with the counts so a row never shows a gap. */
        val savedIds: Set<String> = emptySet(),
    )

    private class State(
        var detail: NovelDetail,
        var chapters: List<NovelChapter>,
        val saved: MutableSet<String> = HashSet(),
        val queue: ArrayDeque<NovelChapter> = ArrayDeque(),
        val failed: MutableMap<String, String> = HashMap(),
        var current: NovelChapter? = null,
        var sizeBytes: Long = 0,
        var error: String? = null,
        var updatedAt: Long = System.currentTimeMillis(),
        var failStreak: Int = 0,
    )

    /** Observable for the UI (main-thread snapshot list), newest change first. */
    val titles: SnapshotStateList<Title> = mutableStateListOf()

    private var root: File? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private val states = LinkedHashMap<String, State>()
    private var loaded: Job? = null
    private var worker: Job? = null

    private fun key(source: NovelSourceId, id: String) = "${source.key}:$id"
    private fun hex(value: String) = value.toByteArray().joinToString("") { "%02x".format(it) }
    private fun unhex(value: String) = String(value.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
    private fun folder(source: NovelSourceId, id: String) = File(root ?: error("not initialised"), "${source.key}-${hex(id)}")
    private fun chapterFile(source: NovelSourceId, id: String, chapterId: String) = File(folder(source, id), "c-${hex(chapterId)}.json")

    fun init(context: Context) {
        if (root != null) return
        root = File(context.filesDir, "novel-downloads")
        loaded = scope.launch {
            lock.withLock {
                for (dir in root!!.listFiles().orEmpty().filter { it.isDirectory }) {
                    runCatching {
                        val meta = JSONObject(File(dir, "meta.json").readText())
                        val source = NovelSourceId.of(meta.getString("source")) ?: return@runCatching
                        val id = meta.getString("id")
                        if (!Novels.isTitleId(source, id) || dir != folder(source, id)) return@runCatching
                        val state = State(NovelSources.detailFrom(source, id, meta), NovelSources.chaptersFrom(meta.optJSONArray("chapterList") ?: JSONArray()))
                        for (file in dir.listFiles().orEmpty()) {
                            val match = Regex("^c-([0-9a-f]+)\\.json$").find(file.name) ?: continue
                            state.saved += unhex(match.groupValues[1])
                            state.sizeBytes += file.length()
                        }
                        states[key(source, id)] = state
                    }
                }
            }
            publish()
        }
    }

    private suspend fun ready() { loaded?.join() }

    private fun view(s: State) = Title(
        s.detail.card.source, s.detail.card.id, s.detail.card.title, s.detail.card.cover,
        s.saved.size, s.queue.size + (if (s.current != null) 1 else 0), s.failed.size, s.current?.label, s.sizeBytes, s.error, s.updatedAt,
        s.current?.id, s.queue.map { it.id }.toSet(), s.failed.keys.toSet(), s.saved.toSet(),
    )

    /** Rebuilds the UI list from the current states (on the main thread). */
    private suspend fun publish() {
        val list = lock.withLock { states.values.map(::view) }.sortedByDescending { it.updatedAt }
        withContext(Dispatchers.Main) {
            titles.clear()
            titles.addAll(list)
        }
    }

    fun stateOf(source: NovelSourceId, id: String): Title? = titles.firstOrNull { it.source == source && it.titleId == id }

    /** A title's chapter ids saved on disk. */
    suspend fun savedIds(source: NovelSourceId, id: String): Set<String> {
        ready()
        return lock.withLock { states[key(source, id)]?.saved?.toSet().orEmpty() }
    }

    /** A downloaded chapter, or null to fetch it. */
    suspend fun localChapter(source: NovelSourceId, id: String, chapterId: String): NovelChapterText? {
        if (root == null) return null
        ready()
        if (lock.withLock { states[key(source, id)]?.saved?.contains(chapterId) } != true) return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val o = JSONObject(chapterFile(source, id, chapterId).readText())
                val paragraphs = o.getJSONArray("paragraphs")
                NovelChapterText(chapterId, o.getString("label"), (0 until paragraphs.length()).map { paragraphs.getString(it) })
            }.getOrNull()
        }
    }

    /** The details and chapter list saved with a title's downloads (offline title pages). */
    suspend fun savedTitle(source: NovelSourceId, id: String): Pair<NovelDetail, List<NovelChapter>>? {
        if (root == null) return null
        ready()
        return lock.withLock { states[key(source, id)]?.let { it.detail to it.chapters } }
    }

    /**
     * Queues [chapters] of a title (reading order); saved ones and ones already on the
     * way are skipped, failed ones are tried again. Returns how many were added.
     */
    suspend fun enqueue(detail: NovelDetail, chapters: List<NovelChapter>, fullList: List<NovelChapter>): Int {
        ready()
        val source = detail.card.source
        val id = detail.card.id
        val added = lock.withLock {
            val state = states.getOrPut(key(source, id)) { State(detail, fullList) }
            state.detail = detail
            if (fullList.isNotEmpty()) state.chapters = fullList
            withContext(Dispatchers.IO) {
                val dir = folder(source, id).apply { mkdirs() }
                val meta = NovelSources.detailJson(state.detail).put("chapterList", NovelSources.chaptersJson(state.chapters))
                val temp = File(dir, "meta.json.tmp")
                temp.writeText(meta.toString())
                if (!temp.renameTo(File(dir, "meta.json"))) { File(dir, "meta.json").writeText(meta.toString()); temp.delete() }
            }
            val waiting = state.queue.map { it.id }.toMutableSet().apply { state.current?.let { add(it.id) } }
            var n = 0
            for (chapter in chapters.sortedBy { it.order }) {
                if (!Novels.isChapterId(source, chapter.id) || chapter.id in state.saved || !waiting.add(chapter.id)) continue
                state.failed.remove(chapter.id)
                state.queue.addLast(chapter)
                n++
            }
            state.error = null
            state.failStreak = 0
            state.updatedAt = System.currentTimeMillis()
            n
        }
        publish()
        if (worker?.isActive != true) worker = scope.launch { pump() }
        return added
    }

    /** Stops a title's waiting chapters (the one in progress finishes); saved ones stay. */
    suspend fun cancel(source: NovelSourceId, id: String) {
        lock.withLock { states[key(source, id)]?.queue?.clear() }
        publish()
    }

    /** Deletes some (or, without [chapterIds], all) of a title's saved chapters. */
    suspend fun remove(source: NovelSourceId, id: String, chapterIds: Collection<String>? = null) {
        ready()
        lock.withLock {
            val state = states[key(source, id)] ?: return@withLock
            if (chapterIds == null) {
                states.remove(key(source, id))
                state.queue.clear()
                withContext(Dispatchers.IO) { folder(source, id).deleteRecursively() }
            } else {
                withContext(Dispatchers.IO) {
                    for (chapterId in chapterIds) {
                        if (!state.saved.remove(chapterId)) continue
                        val file = chapterFile(source, id, chapterId)
                        state.sizeBytes = (state.sizeBytes - file.length()).coerceAtLeast(0)
                        file.delete()
                    }
                }
                state.updatedAt = System.currentTimeMillis()
            }
        }
        publish()
    }

    /** The single worker: oldest title with waiting chapters first, one chapter at a time. */
    private suspend fun pump() {
        while (true) {
            val job = lock.withLock {
                val state = states.values.filter { it.queue.isNotEmpty() }.minByOrNull { it.updatedAt } ?: return@withLock null
                val chapter = state.queue.removeFirst()
                state.current = chapter
                state.updatedAt = System.currentTimeMillis()
                state to chapter
            } ?: break
            publish()
            val (state, chapter) = job
            val source = state.detail.card.source
            val id = state.detail.card.id
            try {
                val text = NovelSources.chapter(source, id, chapter.id, NovelSources.Lane.Back)
                val body = JSONObject().put("label", chapter.label).put("paragraphs", JSONArray(text.paragraphs)).toString()
                lock.withLock {
                    // The title may have been removed while this chapter was on its way.
                    if (states[key(source, id)] === state) {
                        withContext(Dispatchers.IO) {
                            val target = chapterFile(source, id, chapter.id)
                            val temp = File(target.parentFile, target.name + ".tmp")
                            temp.writeText(body)
                            if (!temp.renameTo(target)) { target.writeText(body); temp.delete() }
                            state.sizeBytes += target.length()
                        }
                        state.saved += chapter.id
                        state.failStreak = 0
                    }
                }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                val message = (e as? MangaSourceException)?.message ?: "Couldn't save this chapter."
                lock.withLock {
                    state.failed[chapter.id] = message
                    state.error = message
                    state.failStreak++
                    // A source that keeps refusing (or limiting) gets left alone instead of hammered.
                    if (state.failStreak >= 3 || (e as? MangaSourceException)?.status == 429) {
                        state.queue.forEach { state.failed[it.id] = message }
                        state.queue.clear()
                        state.error = "$message Downloading stopped; try again later."
                    }
                }
            } finally {
                lock.withLock {
                    state.current = null
                    state.updatedAt = System.currentTimeMillis()
                }
                publish()
            }
        }
    }

    /** Human size, matching the other downloads lists. */
    fun humanSize(bytes: Long): String {
        if (bytes <= 0) return "0 KB"
        val mb = bytes / (1024.0 * 1024.0)
        return if (mb >= 1024) "%.1f GB".format(mb / 1024) else if (mb >= 1) "%.1f MB".format(mb) else "${(bytes / 1024).coerceAtLeast(1)} KB"
    }
}
