package com.sanjay.anitrack.next.data.novel

import android.content.Context
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import com.sanjay.anitrack.next.data.DownloadResume
import com.sanjay.anitrack.next.data.NetworkWatch
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import kotlinx.coroutines.delay
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
 *
 * pending.json lists the chapters still to fetch, so downloads carry on after
 * the app is closed or killed. A chapter that hits a rate limit or a network
 * drop waits (Retry-After, backoff, the network coming back) and continues,
 * using the rules shared with the other downloads (DownloadResume): a chapter
 * that stalls a few times in a row (offline waits aside) fails. Removing or
 * cancelling a title ends a chapter's wait at once.
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
        /** Bumped by cancel: the chapter in progress (and its wait) stops. */
        @Volatile var generation: Int = 0,
        /** The [generation] [current] started in: once cancel moved past it, queuing it again re-queues it. */
        var currentGeneration: Int = 0,
        /** The whole title was removed. */
        @Volatile var removed: Boolean = false,
    )

    /** Observable for the UI (main-thread snapshot list), newest change first. */
    val titles: SnapshotStateList<Title> = mutableStateListOf()

    private var root: File? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private val states = LinkedHashMap<String, State>()
    private var loaded: Job? = null
    private var worker: Job? = null
    private var appContext: Context? = null
    /** When the single worker continues from a timed wait (null: not waiting on a clock). */
    @Volatile private var parkedUntil: Long? = null
    @Volatile private var parkedForNetwork = false
    private const val WAIT_SLICE_MS = 2_000L
    /** A retry wait this long (a Retry-After) parks the worker like a pause. */
    private const val PARK_RETRY_MS = 30_000L

    private fun key(source: NovelSourceId, id: String) = "${source.key}:$id"
    private fun hex(value: String) = value.toByteArray().joinToString("") { "%02x".format(it) }
    private fun unhex(value: String) = String(value.chunked(2).map { it.toInt(16).toByte() }.toByteArray())
    private fun folder(source: NovelSourceId, id: String) = File(root ?: error("not initialised"), "${source.key}-${hex(id)}")
    private fun chapterFile(source: NovelSourceId, id: String, chapterId: String) = File(folder(source, id), "c-${hex(chapterId)}.json")
    private fun pendingFile(source: NovelSourceId, id: String) = File(folder(source, id), "pending.json")

    /** Records the chapters still to fetch (in progress and waiting), so a restart resumes them. Call under [lock]. */
    private suspend fun savePending(state: State) = withContext(Dispatchers.IO) {
        val ids = listOfNotNull(state.current?.id) + state.queue.map { it.id }
        val file = pendingFile(state.detail.card.source, state.detail.card.id)
        runCatching {
            if (ids.isEmpty()) file.delete()
            else {
                val temp = File(file.parentFile, "pending.json.tmp")
                temp.writeText(JSONArray(ids).toString())
                if (!temp.renameTo(file)) { file.writeText(JSONArray(ids).toString()); temp.delete() }
            }
        }
    }

    fun init(context: Context) {
        if (root != null) return
        appContext = context.applicationContext
        root = File(context.filesDir, "novel-downloads")
        NetworkWatch.init(context)
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
                        // Chapters that were still on their way when the app closed carry on, in order.
                        val pending = runCatching { JSONArray(File(dir, "pending.json").readText()) }.getOrNull()
                        val byId = state.chapters.associateBy { it.id }
                        val waiting = LinkedHashSet<String>()
                        for (i in 0 until (pending?.length() ?: 0)) {
                            val chapterId = pending!!.optString(i)
                            if (chapterId !in state.saved && Novels.isChapterId(source, chapterId) && byId.containsKey(chapterId)) waiting += chapterId
                        }
                        waiting.forEach { state.queue.addLast(byId.getValue(it)) }
                        states[key(source, id)] = state
                    }
                }
            }
            publish()
            if (lock.withLock { states.values.any { it.queue.isNotEmpty() } } && worker?.isActive != true) {
                worker = scope.launch { pump() }
                com.sanjay.anitrack.next.data.DownloadResumeWorker.reschedule(context.applicationContext)
            }
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

    /** Whether any title has chapters waiting or in progress. */
    suspend fun hasPending(): Boolean {
        ready()
        return lock.withLock { states.values.any { it.queue.isNotEmpty() || it.current != null } }
    }

    /** A chapter is downloading, or ready to: the worker isn't parked on a wait. */
    suspend fun busy(): Boolean = parkedUntil == null && !parkedForNetwork && hasPending()

    /** When the parked worker continues on its own, or null. */
    fun nextWake(): Long? = parkedUntil

    fun waitingForNetwork(): Boolean = parkedForNetwork

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
            // The chapter in progress is on its way, unless it was cancelled since it
            // started: it stops then, so asking for it again queues it again.
            val waiting = state.queue.map { it.id }.toMutableSet().apply {
                state.current?.takeIf { state.currentGeneration == state.generation }?.let { add(it.id) }
            }
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
            savePending(state)
            n
        }
        publish()
        if (worker?.isActive != true) worker = scope.launch { pump() }
        return added
    }

    /**
     * Stops a title's waiting chapters; saved ones stay. The one in progress finishes,
     * unless it is waiting (a rate limit, the network): that wait ends now.
     */
    suspend fun cancel(source: NovelSourceId, id: String) {
        lock.withLock { states[key(source, id)]?.let { it.queue.clear(); it.generation++; savePending(it) } }
        publish()
    }

    /** Deletes some (or, without [chapterIds], all) of a title's saved chapters. */
    suspend fun remove(source: NovelSourceId, id: String, chapterIds: Collection<String>? = null) {
        ready()
        lock.withLock {
            val state = states[key(source, id)] ?: return@withLock
            if (chapterIds == null) {
                states.remove(key(source, id))
                state.removed = true
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
                // A chapter queued again while it was finishing may be saved by now.
                states.values.forEach { s -> s.queue.removeAll { it.id in s.saved } }
                val state = states.values.filter { it.queue.isNotEmpty() }.minByOrNull { it.updatedAt } ?: return@withLock null
                val chapter = state.queue.removeFirst()
                state.current = chapter
                state.currentGeneration = state.generation
                state.updatedAt = System.currentTimeMillis()
                state to chapter
            } ?: break
            publish()
            val (state, chapter) = job
            val source = state.detail.card.source
            val id = state.detail.card.id
            val generation = state.currentGeneration
            try {
                val text = fetchChapter(state, source, id, chapter, generation) ?: continue
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
                        state.failed.remove(chapter.id)
                        state.failStreak = 0
                        state.error = null
                    }
                }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                // Cancelled meanwhile: it isn't a failure (and if it was asked for again, it is queued).
                if (state.generation != generation || state.removed) continue
                val message = (e as? MangaSourceException)?.message ?: "Couldn't save this chapter."
                lock.withLock {
                    state.failed[chapter.id] = message
                    state.error = message
                    state.failStreak++
                    // A source that keeps refusing gets left alone instead of hammered. (Rate
                    // limits and network drops are waited out in fetchChapter instead.)
                    if (state.failStreak >= 3) {
                        state.queue.forEach { state.failed[it.id] = message }
                        state.queue.clear()
                        state.error = "$message Downloading stopped; try again later."
                    }
                }
            } finally {
                lock.withLock {
                    state.current = null
                    state.updatedAt = System.currentTimeMillis()
                    if (states[key(source, id)] === state) savePending(state)
                }
                publish()
            }
        }
    }

    /**
     * One chapter, waiting out rate limits (Retry-After) and network drops with the
     * shared rules; null when the title was removed or cancelled meanwhile (a wait
     * ends at once then). Other failures, and a chapter that stalls a few times in
     * a row ([DownloadResume.afterStop]), are thrown.
     */
    private suspend fun fetchChapter(state: State, source: NovelSourceId, id: String, chapter: NovelChapter, generation: Int): NovelChapterText? {
        // Still wanted: the title is there and wasn't cancelled since this chapter started.
        fun wanted() = state.generation == generation && !state.removed
        var attempt = 0
        // Pauses in a row for this chapter (each one a stall: no chapter saved), and when the first began.
        var stalls = 0
        var stalledSince: Long? = null
        while (true) {
            if (!wanted()) return null
            val error = try {
                return NovelSources.chapter(source, id, chapter.id, NovelSources.Lane.Back)
            } catch (e: com.sanjay.anitrack.next.data.manga.MangaVerificationRequired) {
                throw e
            } catch (e: MangaSourceException) {
                e
            }
            val status = error.status ?: throw error
            if (status != 0 && status != 429 && status != 503 && status != 408 && status !in 500..599) throw error
            val failure = if (status == 0) DownloadResume.Failure.Network(NetworkWatch.online()) else DownloadResume.Failure.Http(status, error.retryAfter)
            when (val step = DownloadResume.nextStep(failure, attempt, 0, System.currentTimeMillis())) {
                is DownloadResume.Step.Retry -> {
                    val at = System.currentTimeMillis() + step.delayMs
                    // A long wait (a Retry-After) parks the worker, so the background job doesn't hold the phone awake for it.
                    val park = step.delayMs >= PARK_RETRY_MS
                    if (park) {
                        parkedUntil = at
                        appContext?.let { com.sanjay.anitrack.next.data.DownloadResumeWorker.reschedule(it) }
                    }
                    try {
                        if (!waitWhile(at) { wanted() }) return null
                    } finally {
                        if (park) parkedUntil = null
                    }
                    attempt++
                }
                is DownloadResume.Step.Pause -> {
                    when (val verdict = DownloadResume.afterStop(DownloadResume.StopReason.of(step.reason), stalls, stalledSince, false, System.currentTimeMillis())) {
                        is DownloadResume.Verdict.Fail -> throw MangaSourceException(DownloadResume.stalledMessage(verdict.reason, DownloadResume.Subject.CHAPTER))
                        is DownloadResume.Verdict.Wait -> { stalls = verdict.reResolves; stalledSince = verdict.stalledSince }
                    }
                    val note = if (step.reason == DownloadResume.PauseReason.NETWORK) "Waiting for the network; downloading continues when it's back."
                        else "${error.message?.removeSuffix(" Wait a minute, then retry.")} Continuing automatically."
                    lock.withLock { state.error = note }
                    publish()
                    // Cancelled or removed meanwhile: nothing continues, so the note goes too.
                    suspend fun stopped(): NovelChapterText? {
                        lock.withLock { if (state.error == note) state.error = null }
                        return null
                    }
                    try {
                        step.resumeAt?.let { at ->
                            parkedUntil = at
                            appContext?.let { com.sanjay.anitrack.next.data.DownloadResumeWorker.reschedule(it) }
                            if (!waitWhile(at) { wanted() }) return stopped()
                        }
                        parkedUntil = null
                        if (!NetworkWatch.online()) {
                            parkedForNetwork = true
                            appContext?.let { com.sanjay.anitrack.next.data.DownloadResumeWorker.reschedule(it) }
                            if (!NetworkWatch.awaitOnline { wanted() }) return stopped()
                        }
                    } finally {
                        parkedUntil = null
                        parkedForNetwork = false
                    }
                    lock.withLock { state.error = null }
                    publish()
                    attempt = 0
                }
                else -> throw error
            }
        }
    }

    /** Sleeps until [until] in short slices; false as soon as the chapter is no longer [wanted]. */
    private suspend fun waitWhile(until: Long, wanted: () -> Boolean): Boolean {
        while (true) {
            if (!wanted()) return false
            val left = until - System.currentTimeMillis()
            if (left <= 0) return true
            delay(minOf(left, WAIT_SLICE_MS))
        }
    }

    /** Human size, matching the other downloads lists. */
    fun humanSize(bytes: Long): String {
        if (bytes <= 0) return "0 KB"
        val mb = bytes / (1024.0 * 1024.0)
        return if (mb >= 1024) "%.1f GB".format(mb / 1024) else if (mb >= 1) "%.1f MB".format(mb) else "${(bytes / 1024).coerceAtLeast(1)} KB"
    }
}
