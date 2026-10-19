package com.sanjay.anitrack.next.data.manga.toonkotsu

import android.content.Context
import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Tracker-confirmed catalogue; normal website reader decoding stays in its WebView. */
object ToonkotsuSource : MangaSource {
    override val id = "toonkotsu"
    override val label = "Toonkotsu"
    override val connectionActivity get() = ToonkotsuConnectActivity::class.java
    override val foregroundOnly = true
    private lateinit var context: Context
    private val catalogues = object : LinkedHashMap<String, Pair<Long, JSONObject>>(8, .75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Long, JSONObject>>) = size > 8
    }
    private val imageLane = Mutex()
    fun init(context: Context) { this.context = context.applicationContext; ToonkotsuSession.init(context) }
    private fun prefs() = context.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)
    override fun knownTitle(anilistId: Int): SourceTitle? {
        val saved = prefs().getString("toonkotsu_match_$anilistId", null) ?: return null
        val ref = saved.substringBefore('\t').takeIf { ToonkotsuParser.hid(it) != null } ?: return null
        return SourceTitle(id, ref, saved.substringAfter('\t', ""))
    }
    private suspend fun catalogue(ref: String): JSONObject {
        val hid = ToonkotsuParser.hid(ref) ?: throw MangaSourceException("Unrecognised Toonkotsu title.")
        synchronized(catalogues) { catalogues[hid] }?.let { if (System.currentTimeMillis() - it.first < 300_000) return it.second }
        val value = JSONObject(ToonkotsuSession.get(ToonkotsuParser.seriesUrl(ref)))
        if (ToonkotsuParser.detail(value, ref) == null) throw MangaSourceException("Toonkotsu returned a different title.")
        synchronized(catalogues) { catalogues[hid] = System.currentTimeMillis() to value }
        return value
    }
    override suspend fun find(manga: Manga): SourceTitle? {
        knownTitle(manga.id)?.let { return it }
        val queries = listOfNotNull(manga.title, manga.titleRomaji).map { it.trim().take(120) }.filter { it.length >= 2 }.distinctBy(MangaTitles::normalize)
        val checked = HashSet<String>()
        for (query in queries) {
            val refs = ToonkotsuParser.search(JSONObject(ToonkotsuSession.get(ToonkotsuParser.searchUrl(query))))
            for (ref in refs) {
                if (!checked.add(ref)) continue
                val detail = ToonkotsuParser.detail(catalogue(ref), ref) ?: continue
                if (detail.anilistId != manga.id) continue
                val title = SourceTitle(id, detail.ref, detail.title)
                prefs().edit().putString("toonkotsu_match_${manga.id}", "${title.id}\t${title.title}").apply()
                return title
            }
        }
        return null
    }
    override suspend fun chapters(title: SourceTitle): List<MangaChapter> {
        require(title.sourceId == id)
        return withContext(Dispatchers.Default) { ToonkotsuParser.chapters(catalogue(title.id)) }
    }
    override suspend fun latest(title: SourceTitle): SourceLatest? {
        require(title.sourceId == id)
        return ToonkotsuParser.detail(catalogue(title.id), title.id)?.let { SourceLatest(it.latestChapter, it.latestAt) }
    }
    override suspend fun pages(title: SourceTitle, chapter: MangaChapter): List<MangaPage> {
        val actual = chapters(title).firstOrNull { it.id == chapter.id } ?: throw MangaSourceException("Unrecognised Toonkotsu chapter.")
        val count = actual.pageCount ?: throw MangaSourceException("Toonkotsu has no pages for this chapter.")
        val pages = (1..count).map { MangaPage(ToonkotsuParser.pageUrl(title.id, actual, it)) }
        resolvePage(pages.first()) // Reader-specific checks must offer Connect before image loading begins.
        return pages
    }
    override suspend fun resolvePage(page: MangaPage): MangaPage = withContext(Dispatchers.IO) {
        if (page.url.startsWith("file:")) {
            if (MangaDownloads.localFile(page.url) != null || MangaDownloads.toonkotsuCachedFile(page.url) != null) return@withContext page
            throw MangaSourceException("This downloaded page is missing. Download the chapter again.")
        }
        val ref = ToonkotsuParser.pageRef(page.url) ?: throw MangaSourceException("Unrecognised Toonkotsu page.")
        if (ToonkotsuSession.verificationNeeded) throw MangaVerificationRequired("Toonkotsu")
        imageLane.withLock {
            val dir = File(context.cacheDir, "toonkotsu-pages").apply { mkdirs() }
            val hash = MessageDigest.getInstance("SHA-256").digest(page.url.toByteArray()).joinToString("") { "%02x".format(it) }
            val file = File(dir, "$hash.page")
            if (file.isFile && file.length() in 1..ToonkotsuParser.MAX_BYTES) { file.setLastModified(System.currentTimeMillis()); return@withLock page.copy(url = file.toURI().toString()) }
            val result = ToonkotsuSession.image(page.url)
            if (result.optString("chapterId") != ref.chapterId || result.optInt("page") != ref.page) throw MangaSourceException("Toonkotsu returned a different page.")
            val data = result.optString("data")
            if (data.length > ToonkotsuParser.MAX_BYTES * 1.34 + 100) throw MangaSourceException("Toonkotsu sent an oversized image.")
            val match = Regex("^data:image/(?:jpeg|png|webp|avif|gif);base64,([A-Za-z0-9+/]+={0,2})$").matchEntire(data) ?: throw MangaSourceException("Toonkotsu sent an unreadable image.")
            val bytes = java.util.Base64.getDecoder().decode(match.groupValues[1])
            if (bytes.size !in 1..ToonkotsuParser.MAX_BYTES) throw MangaSourceException("Toonkotsu sent an oversized image.")
            val partial = File(dir, "$hash.part")
            try { partial.writeBytes(bytes); java.nio.file.Files.move(partial.toPath(), file.toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING) } finally { partial.delete() }
            // Bounded cache; offline chapters are copied to the separate downloads folder.
            var total = dir.listFiles().orEmpty().sumOf { it.length() }
            for (old in dir.listFiles().orEmpty().filter { it != file && it.extension == "page" }.sortedBy { it.lastModified() }) {
                if (total <= 128L * 1024 * 1024) break
                val size = old.length(); if (old.delete()) total -= size
            }
            page.copy(url = file.toURI().toString(), width = result.optInt("width").takeIf { it > 0 }, height = result.optInt("height").takeIf { it > 0 })
        }
    }
}
