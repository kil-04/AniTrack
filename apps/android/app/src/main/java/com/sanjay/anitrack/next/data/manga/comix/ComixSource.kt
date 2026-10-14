package com.sanjay.anitrack.next.data.manga.comix

import android.app.Activity
import android.content.*
import android.os.*
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

object ComixSource : MangaSource {
    override val id = "comix"
    override val label = "Comix"
    override val connectionActivity get() = ComixConnectActivity::class.java
    override val foregroundOnly = true
    private var context: Context? = null
    private var owner: Activity? = null
    private var binding: CompletableDeferred<Messenger>? = null
    private var connection: ServiceConnection? = null
    private val requests = mutableMapOf<Int, CompletableDeferred<JSONObject>>()
    private val catalogueLock = Mutex()
    private var sequence = 0
    private var catalogueLease: String? = null
    private var catalogueRemote: Messenger? = null
    private var images: ComixImages? = null
    private val titles = mutableMapOf<Int, SourceTitle>()
    private val chapterCache = mutableMapOf<String, Pair<Long, List<MangaChapter>>>()
    /** Kept across [detach]: it is only a folder of saved lists and matches. */
    @Volatile private var saved: ComixSavedChapters? = null

    fun attach(activity: Activity) {
        if (owner === activity) return
        detach()
        owner = activity
        context = activity.applicationContext
        images = ComixImages(activity.applicationContext)
        if (saved == null) saved = ComixSavedChapters(java.io.File(activity.applicationContext.filesDir, "comix-chapters"))
    }

    fun detach(activity: Activity? = null) {
        if (activity != null && owner !== activity) return
        requests.values.forEach { it.cancel() }
        requests.clear()
        connection?.let { runCatching { context?.unbindService(it) } }
        binding?.cancel()
        binding = null; connection = null; owner = null; context = null; images = null
    }

    override suspend fun find(manga: Manga): SourceTitle? = catalogue {
        titles[manga.id]?.let { return@catalogue it }
        // A match confirmed by an earlier run needs no search reads.
        saved?.let { store -> withContext(Dispatchers.IO) { store.title(manga.id) } }?.let {
            if (titles.size >= 100) titles.clear()
            titles[manga.id] = it
            return@catalogue it
        }
        val checked = hashSetOf<String>()
        for (name in listOfNotNull(manga.title, manga.titleRomaji).distinct().take(2)) {
            val result = read("/manga", JSONObject().put("keyword", name.take(200)).put("page",1).put("limit",20).put("order[relevance]","desc"))
            val items = ComixProtocol.items(result)
            for (i in 0 until minOf(items.length(),20)) {
                val candidate = items.optJSONObject(i) ?: continue
                val sourceTitle = ComixProtocol.title(candidate) ?: continue
                if (!checked.add(sourceTitle.id)) continue
                // Search hits can omit trackers/year. Only the observed HID's
                // complete detail is eligible to confirm and cache an identity.
                val detail = read("/manga/${sourceTitle.id}", JSONObject())
                val confirmed = ComixProtocol.title(detail) ?: continue
                if (ComixProtocol.matches(detail, manga, sourceTitle.id)) {
                    if (titles.size >= 100) titles.clear()
                    titles[manga.id] = confirmed
                    saved?.let { store -> withContext(Dispatchers.IO) { runCatching { store.saveTitle(manga.id, confirmed) } } }
                    return@catalogue confirmed
                }
            }
        }
        null
    }

    override suspend fun chapters(title: SourceTitle): List<MangaChapter> = catalogue {
        require(title.sourceId == id)
        val hid = ComixProtocol.titleId(title.id)
        chapterCache[hid]?.takeIf { System.currentTimeMillis() - it.first < 300_000 }?.let { return@catalogue it.second }
        val store = saved
        val known = store?.let { s -> withContext(Dispatchers.IO) { s.read(hid) } }
        withTimeoutOrNull(ComixProtocol.CHAPTER_LIST_DEADLINE_MS) {
            val result = readComixChapters(known, System.currentTimeMillis()) { page ->
                read("/manga/$hid/chapters", JSONObject().put("page",page).put("limit",100).put("order[number]","asc"))
            }
            ensureActive()
            if (chapterCache.size >= 20) chapterCache.clear()
            chapterCache[hid] = System.currentTimeMillis() to result.chapters
            // Only a complete, stable traversal replaces the saved list; a quick check leaves it as it was.
            if (result.traversed) store?.let { s -> withContext(Dispatchers.IO + NonCancellable) { runCatching { s.write(hid, result.chapters) } } }
            result.chapters
        } ?: error("Comix chapter list timed out. Retry manually; no partial list was saved.")
    }

    override suspend fun savedChapters(manga: Manga): Pair<SourceTitle, List<MangaChapter>>? {
        val store = saved ?: return null
        return withContext(Dispatchers.IO) {
            val title = store.title(manga.id) ?: return@withContext null
            store.read(title.id)?.let { title to it.chapters }
        }
    }

    /** The host's reader-HTML supplier; null (the default) keeps the catalogue API path. */
    @Volatile var readerHtml: ComixReaderHtmlSource? = null

    override suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage> {
        require(title.sourceId == id)
        ComixProtocol.titleId(title.id)
        val chapterId = ComixProtocol.chapterId(chapter.id)
        // A supplied snapshot needs no catalogue host; its pages still decode through resolvePage.
        readerHtml?.readerHtml(title, chapter)?.let { return comixPagesFromHtml(it) }
        return catalogue { ComixProtocol.pages(read("/chapters/$chapterId", JSONObject())) }
    }

    override suspend fun resolvePage(page: MangaPage): MangaPage {
        // Downloaded chapters were decoded when they were saved; read them as they are.
        if (page.url.startsWith("file:")) {
            return page.takeIf { MangaDownloads.localFile(it.url) != null }
                ?: throw MangaSourceException("This downloaded page is missing. Download the chapter again.")
        }
        return (images ?: error("Return to AniTrack to load Comix pages.")).resolve(page)
    }

    private suspend fun <T> catalogue(block: suspend () -> T): T = withContext(Dispatchers.Main.immediate) {
        catalogueLock.withLock {
            try { block() }
            finally {
                catalogueLease?.let { lease ->
                    runCatching {
                        catalogueRemote?.send(Message.obtain(null, ComixSessionService.CLOSE_HOST).apply {
                            data = Bundle().apply { putString(ComixCatalogueActivity.LEASE, lease) }
                        })
                    }
                }
                catalogueLease = null; catalogueRemote = null
            }
        }
    }

    private suspend fun read(path: String, params: JSONObject): JSONObject = withContext(Dispatchers.Main.immediate) {
        check(Build.VERSION.SDK_INT >= 28) { "Comix needs Android 9 or newer for its separate website profile." }
        val remote = withTimeoutOrNull(10_000) { bind().await() }
            ?: error("Comix session could not start in time. Retry manually.")
        val lease = catalogueLease ?: java.util.UUID.randomUUID().toString().also {
            val activity = owner?.takeIf { !it.isFinishing && !it.isDestroyed }
                ?: error("Return to AniTrack to load Comix.")
            awaitComixForeground {
                owner === activity && !activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus()
            }
            catalogueLease = it; catalogueRemote = remote
            activity.startActivity(Intent(activity, ComixCatalogueActivity::class.java).apply {
                putExtra(ComixCatalogueActivity.LEASE, it)
                addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
            })
        }
        val id = ++sequence
        val result = CompletableDeferred<JSONObject>()
        requests[id] = result
        val reply = Messenger(object : Handler(Looper.getMainLooper()) {
            override fun handleMessage(message: Message) {
                if (message.what != ComixSessionService.READ || message.arg1 != id) return
                val raw = message.data.getString("body") ?: return
                if (raw.length > ComixProtocol.MAX_RESPONSE + 1000) { result.completeExceptionally(IllegalStateException("Comix response too large.")); return }
                try {
                    val body = JSONObject(raw)
                    if (body.optBoolean("ok")) result.complete(body.getJSONObject("value"))
                    else if (body.optBoolean("verify")) result.completeExceptionally(MangaVerificationRequired(label))
                    else result.completeExceptionally(MangaSourceException(body.optString("error","Comix request failed.").take(160)))
                } catch (_: Exception) { result.completeExceptionally(IllegalStateException("Invalid Comix response.")) }
            }
        })
        try {
            remote.send(Message.obtain(null, ComixSessionService.READ, id, 0).apply {
                replyTo = reply
                data = Bundle().apply {
                    putString("path",path); putString("params",params.toString())
                    putString(ComixCatalogueActivity.LEASE, lease)
                }
            })
            comixCatalogueDeadline { result.await() }
        } finally {
            requests.remove(id)
            if (!result.isCompleted) runCatching { remote.send(Message.obtain(null, ComixSessionService.CANCEL, id,0)) }
        }
    }

    private fun bind(): CompletableDeferred<Messenger> {
        binding?.let { return it }
        val app = context ?: error("Return to AniTrack to connect Comix.")
        val deferred = CompletableDeferred<Messenger>()
        binding = deferred
        val conn = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) { deferred.complete(Messenger(binder)) }
            override fun onServiceDisconnected(name: ComponentName) {
                requests.values.forEach { it.completeExceptionally(IllegalStateException("Comix session closed. Connect again.")) }
                if (!deferred.isCompleted) deferred.completeExceptionally(IllegalStateException("Comix session closed. Connect again."))
                if (connection === this) {
                    runCatching { app.unbindService(this) }
                    binding = null; connection = null
                }
            }
            override fun onBindingDied(name: ComponentName) { onServiceDisconnected(name) }
            override fun onNullBinding(name: ComponentName) { deferred.completeExceptionally(IllegalStateException("Comix session unavailable.")) }
        }
        connection = conn
        if (!app.bindService(Intent(app, ComixSessionService::class.java), conn, Context.BIND_AUTO_CREATE)) {
            binding = null; connection = null
            deferred.completeExceptionally(IllegalStateException("Comix session could not start."))
        }
        return deferred
    }
}

/** Pure accumulation: an incomplete/repeated final page must never become a cached success. */
internal class ComixChapterAccumulator {
    private val chapters = linkedMapOf<String, MangaChapter>()
    private var expectedTotal: Int? = null

    fun append(value: JSONObject, rows: List<MangaChapter>, more: Boolean): List<MangaChapter>? {
        val count = total(value)
        check(expectedTotal == null || expectedTotal == count) {
            "Comix chapter total changed; retry manually. No partial list was saved."
        }
        expectedTotal = count
        for (row in rows) {
            check(!chapters.containsKey(row.id)) { "Comix repeated a chapter; no partial list was saved." }
            chapters[row.id] = row
        }
        check(chapters.size <= count) { "Comix returned an inconsistent chapter total; no partial list was saved." }
        if (!more) {
            check(chapters.size == count) { "Comix returned an incomplete chapter list; no partial list was saved." }
            return chapters.values.toList()
        }
        check(rows.isNotEmpty() && chapters.size < count) {
            "Comix returned inconsistent chapter pagination; no partial list was saved."
        }
        return null
    }

    companion object {
        /** A page's advertised chapter total; a missing or implausible one fails the whole list. */
        fun total(value: JSONObject): Int {
            val pagination = value.optJSONObject("pagination") ?: value.optJSONObject("meta")
            val total = (pagination?.opt("total") as? Number)?.toDouble()
            check(total != null && total.isFinite() && total >= 0 && total <= 20_000 && total == total.toInt().toDouble()) {
                "Comix omitted its chapter total; no partial list was saved."
            }
            return total.toInt()
        }
    }
}
