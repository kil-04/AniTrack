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
    private var context: Context? = null
    private var owner: Activity? = null
    private var binding: CompletableDeferred<Messenger>? = null
    private var connection: ServiceConnection? = null
    private val requests = mutableMapOf<Int, CompletableDeferred<JSONObject>>()
    private val catalogueLock = Mutex()
    private var sequence = 0
    private var images: ComixImages? = null
    private val titles = mutableMapOf<Int, SourceTitle>()
    private val chapterCache = mutableMapOf<String, Pair<Long, List<MangaChapter>>>()

    fun attach(activity: Activity) {
        if (owner === activity) return
        detach()
        owner = activity
        context = activity.applicationContext
        images = ComixImages(activity.applicationContext)
    }

    fun detach(activity: Activity? = null) {
        if (activity != null && owner !== activity) return
        requests.values.forEach { it.cancel() }
        requests.clear()
        connection?.let { runCatching { context?.unbindService(it) } }
        binding?.cancel()
        binding = null; connection = null; owner = null; context = null; images = null
    }

    override suspend fun find(manga: Manga): SourceTitle? = catalogueLock.withLock {
        titles[manga.id]?.let { return@withLock it }
        for (name in listOfNotNull(manga.title, manga.titleRomaji).distinct().take(2)) {
            val result = read("/manga", JSONObject().put("keyword", name.take(200)).put("page",1).put("limit",20).put("order[relevance]","desc"))
            val items = ComixProtocol.items(result)
            for (i in 0 until minOf(items.length(),20)) {
                val candidate = items.optJSONObject(i) ?: continue
                val sourceTitle = ComixProtocol.title(candidate) ?: continue
                if (!ComixProtocol.matches(candidate, manga)) continue
                // Search hits do not always include tracker links: confirm public detail.
                val detail = read("/manga/${sourceTitle.id}", JSONObject())
                if (ComixProtocol.matches(detail, manga)) {
                    if (titles.size >= 100) titles.clear()
                    titles[manga.id] = sourceTitle
                    return@withLock sourceTitle
                }
            }
        }
        null
    }

    override suspend fun chapters(title: SourceTitle): List<MangaChapter> = catalogueLock.withLock {
        require(title.sourceId == id)
        val hid = ComixProtocol.titleId(title.id)
        chapterCache[hid]?.takeIf { System.currentTimeMillis() - it.first < 300_000 }?.let { return@withLock it.second }
        withTimeoutOrNull(120_000) {
            val all = linkedMapOf<String, MangaChapter>()
            for (page in 1..200) {
                val value = read("/manga/$hid/chapters", JSONObject().put("page",page).put("limit",100).put("order[number]","asc"))
                val rows = ComixProtocol.chapters(value)
                val before = all.size
                rows.forEach { all.putIfAbsent(it.id, it) }
                val more = ComixProtocol.hasNext(value,page)
                if (!more) {
                    val chapters = all.values.toList()
                    if (chapterCache.size >= 20) chapterCache.clear()
                    chapterCache[hid] = System.currentTimeMillis() to chapters
                    return@withTimeoutOrNull chapters
                }
                check(all.size > before) { "Comix repeated a chapter page; try again later." }
            }
            error("Comix chapter list exceeds the supported limit; no partial list was saved.")
        } ?: error("Comix chapter list timed out. Retry manually; no partial list was saved.")
    }

    override suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage> = catalogueLock.withLock {
        require(title.sourceId == id)
        ComixProtocol.titleId(title.id)
        ComixProtocol.pages(read("/chapters/${ComixProtocol.chapterId(chapter.id)}", JSONObject()))
    }

    override suspend fun resolvePage(page: MangaPage): MangaPage =
        (images ?: error("Return to AniTrack to load Comix pages.")).resolve(page)

    private suspend fun read(path: String, params: JSONObject): JSONObject = withContext(Dispatchers.Main.immediate) {
        check(Build.VERSION.SDK_INT >= 28) { "Comix needs Android 9 or newer for its separate website profile." }
        val remote = withTimeoutOrNull(10_000) { bind().await() }
            ?: error("Comix session could not start in time. Retry manually.")
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
                    else result.completeExceptionally(IllegalStateException(body.optString("error","Comix request failed.").take(160)))
                } catch (_: Exception) { result.completeExceptionally(IllegalStateException("Invalid Comix response.")) }
            }
        })
        try {
            remote.send(Message.obtain(null, ComixSessionService.READ, id, 0).apply {
                replyTo = reply
                data = Bundle().apply { putString("path",path); putString("params",params.toString()) }
            })
            try { withTimeout(30_000) { result.await() } }
            catch (_: TimeoutCancellationException) { error("Comix catalogue timed out. Retry manually.") }
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
