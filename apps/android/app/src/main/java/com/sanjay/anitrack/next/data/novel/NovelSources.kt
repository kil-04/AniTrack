package com.sanjay.anitrack.next.data.novel

import android.content.Context
import com.sanjay.anitrack.next.data.manga.MangaHttp
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Fetching for novels mode: fixed hosts, spaced requests and bounded bodies
 * (through [MangaHttp]) on two lanes per source — "front" for what's on screen and
 * a slower "back" lane for update checks and downloads, so a long download never
 * queues ahead of the chapter being read — plus small in-memory caches and the last
 * title page and chapter list saved on disk (opens at once, and offline).
 */
object NovelSources {
    enum class Lane { Front, Back }

    private val lanes = mapOf(
        NovelSourceId.NovelBuddy to mapOf(
            Lane.Front to MangaHttp("NovelBuddy", NovelBuddyParser.HOSTS, { MangaHttp.USER_AGENT }, 300),
            Lane.Back to MangaHttp("NovelBuddy", NovelBuddyParser.HOSTS, { MangaHttp.USER_AGENT }, 900),
        ),
        NovelSourceId.NovelArchive to mapOf(
            Lane.Front to MangaHttp("NovelArchive", NovelArchiveParser.HOSTS, { MangaHttp.USER_AGENT }, 400),
            Lane.Back to MangaHttp("NovelArchive", NovelArchiveParser.HOSTS, { MangaHttp.USER_AGENT }, 1000),
        ),
    )
    private fun http(source: NovelSourceId, lane: Lane = Lane.Front) = lanes.getValue(source).getValue(lane)

    private const val JSON_TYPE = "application/json"
    private const val LIST_BYTES = 4 * 1024 * 1024
    private const val CHAPTERS_BYTES = 16 * 1024 * 1024
    private const val TEXT_BYTES = 4 * 1024 * 1024

    @Volatile private var cacheDir: File? = null

    fun init(context: Context) {
        cacheDir = File(context.applicationContext.filesDir, "novel_cache").apply { mkdirs() }
    }

    private class Ttl<T>(private val ttlMs: Long, private val max: Int) {
        private val map = object : LinkedHashMap<String, Pair<Long, T>>(16, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Long, T>>) = size > max
        }
        @Synchronized fun get(key: String): T? = map[key]?.takeIf { System.currentTimeMillis() - it.first < ttlMs }?.second
        @Synchronized fun set(key: String, value: T) { map[key] = System.currentTimeMillis() to value }
    }

    private val homeCache = Ttl<NovelHome>(30 * 60_000L, 1)
    private val searchCache = Ttl<NovelPage>(10 * 60_000L, 40)
    private val detailCache = Ttl<NovelDetail>(30 * 60_000L, 60)
    private val chapterCache = Ttl<List<NovelChapter>>(10 * 60_000L, 20)
    private val textCache = Ttl<NovelChapterText>(60 * 60_000L, 12)

    private fun <T> parse(label: String, text: String, read: (JSONObject) -> T): T {
        val json = runCatching { JSONObject(text) }.getOrElse { throw MangaSourceException("$label sent a response AniTrack couldn't read.") }
        return try { read(json) } catch (e: NovelParseException) { throw MangaSourceException(e.message ?: "$label sent a response AniTrack couldn't read.") }
    }

    suspend fun home(): NovelHome {
        homeCache.get("home")?.let { return it }
        val buddy = http(NovelSourceId.NovelBuddy)
        val home = parse("NovelBuddy", buddy.get(NovelBuddyParser.homeUrl(), JSON_TYPE, LIST_BYTES), NovelBuddyParser::home)
        // The feed's "latest" is mostly machine translations: ask for recent updates, finished
        // series and the most bookmarked directly, keeping the human translations.
        suspend fun human(f: NovelFilters, limit: Int) = runCatching {
            parse("NovelBuddy", buddy.get(NovelBuddyParser.searchUrl(f, limit), JSON_TYPE, LIST_BYTES), NovelBuddyParser::search).items.filter { !it.mtl }
        }.getOrDefault(emptyList())
        val latest = human(NovelFilters(sort = NovelSort.Latest), 60)
        val completed = human(NovelFilters(status = "completed"), 30)
        val favourites = human(NovelFilters(sort = NovelSort.Favourites), 30)
        val value = home.copy(latest = latest.ifEmpty { home.latest }, completed = completed, favourites = favourites)
        homeCache.set("home", value)
        return value
    }

    suspend fun search(source: NovelSourceId, filters: NovelFilters): NovelPage {
        val url = if (source == NovelSourceId.NovelBuddy) NovelBuddyParser.searchUrl(filters) else NovelArchiveParser.searchUrl(filters)
        searchCache.get(url)?.let { return it }
        val page = parse(source.label, http(source).get(url, JSON_TYPE, LIST_BYTES),
            if (source == NovelSourceId.NovelBuddy) NovelBuddyParser::search else NovelArchiveParser::search)
        searchCache.set(url, page)
        return page
    }

    /** NovelArchive sends the contents list with the title, so one request fills both caches. */
    private suspend fun archiveTitle(id: String, lane: Lane): NovelDetail {
        val text = http(NovelSourceId.NovelArchive, lane).get(NovelArchiveParser.titleUrl(id), JSON_TYPE, CHAPTERS_BYTES)
        val detail = parse("NovelArchive", text, NovelArchiveParser::detail)
        val chapters = parse("NovelArchive", text, NovelArchiveParser::chapters)
        chapterCache.set("${NovelSourceId.NovelArchive.key}:$id", chapters)
        writeChapters(NovelSourceId.NovelArchive, id, chapters)
        return detail
    }

    /** A title's details; they're remembered too, which links copies of the same novel. */
    suspend fun title(source: NovelSourceId, id: String, lane: Lane = Lane.Front): NovelDetail {
        require(Novels.isTitleId(source, id))
        val key = "${source.key}:$id"
        detailCache.get(key)?.let { return it }
        val detail = if (source == NovelSourceId.NovelBuddy) {
            parse("NovelBuddy", http(source, lane).get(NovelBuddyParser.titleUrl(id), JSON_TYPE, LIST_BYTES), NovelBuddyParser::detail)
        } else archiveTitle(id, lane)
        detailCache.set(key, detail)
        writeDetail(detail)
        runCatching { NovelStore.registerTitle(detail) }
        return detail
    }

    suspend fun chapters(source: NovelSourceId, id: String, lane: Lane = Lane.Front): List<NovelChapter> {
        require(Novels.isTitleId(source, id))
        val key = "${source.key}:$id"
        chapterCache.get(key)?.let { return it }
        return if (source == NovelSourceId.NovelBuddy) {
            val list = parse("NovelBuddy", http(source, lane).get(NovelBuddyParser.chaptersUrl(id), JSON_TYPE, CHAPTERS_BYTES), NovelBuddyParser::chapters)
            chapterCache.set(key, list)
            writeChapters(source, id, list)
            list
        } else {
            detailCache.set(key, archiveTitle(id, lane))
            chapterCache.get(key).orEmpty()
        }
    }

    /** A chapter's text: a downloaded copy first, then a recent fetch, then the source. */
    suspend fun chapter(source: NovelSourceId, titleId: String, chapterId: String, lane: Lane = Lane.Front): NovelChapterText {
        require(Novels.isTitleId(source, titleId) && Novels.isChapterId(source, chapterId))
        if (lane == Lane.Front) NovelDownloads.localChapter(source, titleId, chapterId)?.let { return it }
        val key = "${source.key}:$titleId:$chapterId"
        textCache.get(key)?.let { return it }
        val text = if (source == NovelSourceId.NovelBuddy) {
            parse("NovelBuddy", http(source, lane).get(NovelBuddyParser.chapterUrl(titleId, chapterId), JSON_TYPE, TEXT_BYTES), NovelBuddyParser::chapterText)
        } else {
            parse("NovelArchive", http(source, lane).get(NovelArchiveParser.chapterUrl(titleId, chapterId), JSON_TYPE, TEXT_BYTES)) { NovelArchiveParser.chapterText(it, chapterId) }
        }
        if (text.paragraphs.isEmpty()) throw MangaSourceException("This chapter came back empty on the source. Try another source.")
        // Downloads don't fill the reading cache (they'd push out the chapters around the reader).
        if (lane == Lane.Front) textCache.set(key, text)
        return text
    }

    // ── Linked copies ─────────────────────────────────────────────────────────

    sealed interface FindResult {
        data class Linked(val member: NovelStore.Member) : FindResult
        data class Candidates(val items: List<NovelCard>) : FindResult
        data object None : FindResult
    }

    /**
     * This novel's copy on [target]: linked already, found and linked now (same name
     * and author), or a few candidates for the user to choose from.
     */
    suspend fun findOn(detail: NovelDetail, target: NovelSourceId): FindResult {
        val c = detail.card
        suspend fun linked() = NovelStore.group(c.source, c.id).firstOrNull { it.source == target }
        linked()?.let { return FindResult.Linked(it) }
        val queries = (listOf(c.title) + detail.altNames.filter { name -> name.length >= 3 && name.all { it.code in 0x20..0x7e } }).take(2)
        var ranked: List<NovelCard> = emptyList()
        for (query in queries) {
            ranked = Novels.rankMatches(c.title, detail.altNames, search(target, NovelFilters(query = query)).items)
            val close = ranked.filter { Novels.sameNovel(c.title, detail.altNames, detail.author, it.title, emptyList(), null) != "no" }.take(3)
            for (candidate in close) {
                val other = runCatching { title(target, candidate.id) }.getOrNull() ?: continue
                if (linked() == null && Novels.sameNovel(c.title, detail.altNames, detail.author, other.card.title, other.altNames, other.author) == "yes") {
                    NovelStore.link(c.source, c.id, target, other.card.id)
                }
                linked()?.let { return FindResult.Linked(it) }
            }
            if (ranked.isNotEmpty()) break
        }
        return if (ranked.isNotEmpty()) FindResult.Candidates(ranked.take(8)) else FindResult.None
    }

    // ── New chapters (background lane, cached) ───────────────────────────────

    data class Update(val source: NovelSourceId, val titleId: String, val title: String, val cover: String?, val newCount: Int, val latestLabel: String?, val latestAt: Long?)

    private val updatesLock = Mutex()
    @Volatile private var updatesCache: Pair<Long, List<Update>>? = null

    fun invalidateUpdates() { updatesCache = null }

    /** New chapters (since each list was last shown) for the novels being read. */
    suspend fun updates(force: Boolean = false): List<Update> = updatesLock.withLock {
        updatesCache?.takeIf { !force && System.currentTimeMillis() - it.first < 20 * 60_000L }?.let { return@withLock it.second }
        val out = ArrayList<Update>()
        for (row in NovelStore.continueReading(20)) {
            val detail = runCatching { title(row.source, row.titleId, Lane.Back) }.getOrNull() ?: continue
            val latest = detail.latest ?: continue
            val seen = NovelStore.seenCount(row.source, row.titleId) ?: continue
            val fresh = latest.count - seen
            if (fresh > 0) out += Update(row.source, row.titleId, detail.card.title, detail.card.cover, fresh, latest.label, latest.at)
        }
        out.sortByDescending { it.latestAt ?: 0L }
        updatesCache = System.currentTimeMillis() to out
        out
    }

    /** The list is on screen now: its chapters stop counting as new. */
    suspend fun markSeen(source: NovelSourceId, id: String, count: Int) {
        if (count <= 0 || NovelStore.seenCount(source, id) == count) return
        NovelStore.markSeen(source, id, count)
        invalidateUpdates()
    }

    // ── Saved title pages ─────────────────────────────────────────────────────

    private fun hex(id: String) = id.toByteArray().joinToString("") { "%02x".format(it) }

    private fun file(kind: String, source: NovelSourceId, id: String): File? {
        val dir = cacheDir ?: return null
        // Case-sensitive ids: hex-encode for a safe, collision-free file name.
        return File(dir, "$kind-${source.key}-${hex(id)}.json")
    }

    private suspend fun write(target: File?, json: String) = withContext(Dispatchers.IO) {
        if (target == null) return@withContext
        runCatching {
            val temp = File(target.parentFile, target.name + ".tmp")
            temp.writeText(json)
            temp.renameTo(target)
            prune()
        }
    }

    private fun prune() {
        val files = cacheDir?.listFiles()?.filter { it.name.endsWith(".json") } ?: return
        if (files.size <= 300) return
        files.sortedByDescending { it.lastModified() }.drop(300).forEach { it.delete() }
    }

    private suspend fun writeDetail(d: NovelDetail) = write(file("title", d.card.source, d.card.id), detailJson(d).toString())

    private suspend fun writeChapters(source: NovelSourceId, id: String, list: List<NovelChapter>) =
        write(file("chapters", source, id), chaptersJson(list).toString())

    internal fun detailJson(d: NovelDetail): JSONObject {
        val c = d.card
        return JSONObject()
            .put("source", c.source.key).put("id", c.id).put("title", c.title).put("cover", c.cover ?: JSONObject.NULL)
            .put("status", c.status ?: JSONObject.NULL).put("chapters", c.chapters ?: JSONObject.NULL).put("rating", c.rating ?: JSONObject.NULL)
            .put("genres", JSONArray(c.genres)).put("mtl", c.mtl).put("author", d.author ?: JSONObject.NULL)
            .put("altNames", JSONArray(d.altNames)).put("synopsis", d.synopsis ?: JSONObject.NULL).put("url", d.url)
    }

    internal fun detailFrom(source: NovelSourceId, id: String, o: JSONObject): NovelDetail {
        fun str(k: String) = if (o.isNull(k)) null else o.optString(k).ifEmpty { null }
        fun strings(k: String) = o.optJSONArray(k)?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
        return NovelDetail(
            card = NovelCard(
                source, id, o.getString("title"), str("cover"), str("status"),
                if (o.isNull("chapters")) null else o.optInt("chapters"),
                if (o.isNull("rating")) null else o.optDouble("rating"),
                strings("genres"), o.optBoolean("mtl"),
            ),
            author = str("author"),
            altNames = strings("altNames"),
            synopsis = str("synopsis"),
            url = o.optString("url"),
        )
    }

    internal fun chaptersJson(list: List<NovelChapter>): JSONArray =
        JSONArray().apply { list.forEach { put(JSONArray().put(it.id).put(it.label).put(it.updatedAt ?: 0L)) } }

    internal fun chaptersFrom(arr: JSONArray): List<NovelChapter> = (0 until arr.length()).map { i ->
        val row = arr.getJSONArray(i)
        NovelChapter(row.getString(0), i, row.getString(1), row.optLong(2).takeIf { it > 0 })
    }

    /** The title page saved last time (or kept with a download), with its chapter list (possibly empty). */
    suspend fun saved(source: NovelSourceId, id: String): Pair<NovelDetail, List<NovelChapter>>? = withContext(Dispatchers.IO) {
        if (!Novels.isTitleId(source, id)) return@withContext null
        val cached = runCatching {
            val detail = detailFrom(source, id, JSONObject(file("title", source, id)?.takeIf { it.exists() }?.readText() ?: return@runCatching null))
            val chapters = file("chapters", source, id)?.takeIf { it.exists() }?.let { chaptersFrom(JSONArray(it.readText())) }.orEmpty()
            detail to chapters
        }.getOrNull()
        if (cached != null && cached.second.isNotEmpty()) return@withContext cached
        val downloaded = NovelDownloads.savedTitle(source, id)
        when {
            cached == null -> downloaded
            downloaded != null && downloaded.second.isNotEmpty() -> cached.first to downloaded.second
            else -> cached
        }
    }
}
