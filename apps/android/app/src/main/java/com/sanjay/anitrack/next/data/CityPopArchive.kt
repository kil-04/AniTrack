package com.sanjay.anitrack.next.data

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import java.io.File
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject

data class CityPopArchiveItem(val id: String, val title: String, val creator: String, val mediaType: String, val year: Int?, val coverUrl: String)
data class CityPopArchiveSearch(val items: List<CityPopArchiveItem>, val total: Int, val page: Int)
data class CityPopArchiveTrack(val itemId: String, val fileName: String, val title: String, val artist: String, val mediaType: String, val url: String, val size: Long?)
data class CityPopArchiveDownload(val downloadId: Long, val track: CityPopArchiveTrack, val status: Int, val downloaded: Long, val total: Long, val localUri: Uri?)
enum class CityPopArchiveMediaFilter { ALL, AUDIO, VIDEO }

/** Internet Archive's public search/metadata; mirrors packages/shared/city-pop-archive.ts. */
object CityPopArchive {
    const val DOWNLOADS_PREF = "city_pop_archive_downloads"
    private val archiveId = Regex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
    private val http = OkHttpClient.Builder().callTimeout(25, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
    private const val MAX_BYTES = 16 * 1024 * 1024
    private const val MAX_DOWNLOAD_BYTES = 2L * 1024 * 1024 * 1024
    private val audio = setOf("mp3", "m4a", "ogg", "flac", "wav")
    private val videos = setOf("mp4", "webm")

    fun validId(id: String) = archiveId.matches(id)
    private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        .replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")").replace("%7E", "~")
    fun validFile(name: String): Boolean = name.isNotEmpty() && name.length <= 1000 && !name.contains('\\') &&
        name.none { it.code < 32 || it.code == 127 } && name.split('/').all { it.isNotEmpty() && it != "." && it != ".." }
    fun trackUrl(id: String, name: String): String {
        require(validId(id) && validFile(name)) { "Invalid Archive file." }
        return "https://archive.org/download/${encode(id)}/${name.split('/').joinToString("/") { encode(it) }}"
    }
    fun query(query: String, mediaFilter: CityPopArchiveMediaFilter = CityPopArchiveMediaFilter.ALL): String {
        val q = query.trim().replace(Regex("[\\x00-\\x1f\\x7f]"), " ").take(200).trim()
        val words = if (q.isEmpty()) "(title:\"city pop\" OR subject:\"city pop\" OR title:citypop OR subject:citypop)"
        else {
            val tokens = q.split(Regex("\\s+")).joinToString(" AND ") { word -> "\"${word.replace("\\", "\\\\").replace("\"", "\\\"")}\"" }
            val phrase = "\"${q.replace("\\", "\\\\").replace("\"", "\\\"")}\""
            "title:($tokens) OR creator:($tokens) OR subject:$phrase"
        }
        val media = when (mediaFilter) {
            CityPopArchiveMediaFilter.ALL -> "mediatype:(audio OR movies)"
            CityPopArchiveMediaFilter.AUDIO -> "mediatype:audio"
            CityPopArchiveMediaFilter.VIDEO -> "mediatype:movies"
        }
        return "$media AND ($words)"
    }
    suspend fun search(query: String = "", page: Int = 1, mediaFilter: CityPopArchiveMediaFilter = CityPopArchiveMediaFilter.ALL): CityPopArchiveSearch = withContext(Dispatchers.IO) {
        val builder = okhttp3.HttpUrl.Builder().scheme("https").host("archive.org").addPathSegment("advancedsearch.php")
            .addQueryParameter("q", query(query, mediaFilter)).addQueryParameter("rows", "24").addQueryParameter("page", page.coerceIn(1, 1000).toString()).addQueryParameter("output", "json")
        listOf("identifier", "title", "creator", "mediatype", "year", "date", "is_dark", "access-restricted-item").forEach { builder.addQueryParameter("fl[]", it) }
        val url = builder.addQueryParameter("sort[]", "downloads desc").build().toString()
        parseSearch(fetch(url), page.coerceIn(1, 1000), mediaFilter)
    }
    suspend fun tracks(item: CityPopArchiveItem): List<CityPopArchiveTrack> = withContext(Dispatchers.IO) {
        require(validId(item.id))
        parseMetadata(fetch("https://archive.org/metadata/${encode(item.id)}"), item.id)
    }
    private suspend fun execute(url: String): Response = suspendCancellableCoroutine { continuation ->
        val call = http.newCall(Request.Builder().url(url).header("User-Agent", "AniTrack/CityPop").build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: java.io.IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) {
                if (continuation.isActive) continuation.resume(response) else response.close()
            }
        })
    }
    private suspend fun fetch(url: String): String = try {
        fetchFrom(url)
    } catch (e: java.io.IOException) {
        // Offline, DNS or a dropped connection: not OkHttp's internal wording (as on desktop).
        throw IllegalStateException("Couldn't reach Internet Archive. Check your connection and try again.", e)
    }

    private suspend fun fetchFrom(url: String): String {
        var target = url
        repeat(6) {
            val parsed = Uri.parse(target)
            require(parsed.scheme == "https" && parsed.userInfo == null && parsed.port in listOf(-1, 443) && (parsed.host == "archive.org" || parsed.host?.endsWith(".archive.org") == true))
            execute(target).use { response ->
                if (response.isRedirect) {
                    target = response.header("Location")?.let { response.request.url.resolve(it)?.toString() } ?: error("Archive returned an invalid redirect.")
                } else {
                    check(response.isSuccessful) { "Internet Archive is unavailable (${response.code}). Try again later." }
                    val body = response.body ?: error("Internet Archive returned no data.")
                    return body.byteStream().use { input ->
                        val out = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(16384)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = input.read(buffer)
                            if (n < 0) break
                            check(out.size() + n <= MAX_BYTES) { "This Archive item has too much metadata." }
                            out.write(buffer, 0, n)
                        }
                        out.toString("UTF-8")
                    }
                }
            }
        }
        error("Internet Archive redirected too many times.")
    }
    private fun text(value: Any?): String = when (value) {
        is String -> value.trim()
        is JSONArray -> (0 until minOf(value.length(), 10)).mapNotNull { (value.opt(it) as? String)?.trim()?.takeIf { part -> part.isNotEmpty() } }.joinToString("; ")
        else -> ""
    }
    private fun truth(value: Any?): Boolean = value == true || value == 1 || value is String && Regex("^(?:true|1|yes|y)$", RegexOption.IGNORE_CASE).matches(value.trim())
    private fun restricted(value: JSONObject) = listOf("is_dark", "dark", "is_restricted", "restricted", "access_restricted", "access-restricted-item", "is_private", "private", "hidden").any { truth(value.opt(it)) }
    const val SEARCH_UNAVAILABLE = "Internet Archive search is unavailable right now. Try again later."
    const val ITEM_UNAVAILABLE = "This Internet Archive item is unavailable right now. Try again later."

    /** An error envelope, a non-JSON page or a missing result set is Archive failing, not zero matches. */
    fun parseSearch(json: String, page: Int = 1, mediaFilter: CityPopArchiveMediaFilter = CityPopArchiveMediaFilter.ALL): CityPopArchiveSearch {
        val root = runCatching { JSONObject(json) }.getOrNull() ?: error(SEARCH_UNAVAILABLE)
        val response = root.optJSONObject("response") ?: error(SEARCH_UNAVAILABLE)
        val status = root.optJSONObject("responseHeader")?.opt("status")
        check(!root.has("error") && (status == null || status is Number && status.toDouble() == 0.0)) { SEARCH_UNAVAILABLE }
        val rows = response.optJSONArray("docs") ?: JSONArray()
        val seen = HashSet<String>()
        val items = (0 until minOf(rows.length(), 100)).mapNotNull { i ->
            val row = rows.optJSONObject(i) ?: return@mapNotNull null
            val id = text(row.opt("identifier"))
            val media = text(row.opt("mediatype"))
            if (!validId(id) || media !in setOf("audio", "movies") || restricted(row) || !seen.add(id)) return@mapNotNull null
            if (mediaFilter == CityPopArchiveMediaFilter.AUDIO && media != "audio" || mediaFilter == CityPopArchiveMediaFilter.VIDEO && media != "movies") return@mapNotNull null
            val title = text(row.opt("title")).ifEmpty { id }
            val yearValue = row.opt("year")
            val yearText = if (yearValue is Number) yearValue.toString() else text(yearValue).ifEmpty { text(row.opt("date")) }
            val year = Regex("^(\\d{4})(?:\\b|-)").find(yearText)?.groupValues?.get(1)?.toIntOrNull()?.takeIf { it in 1900..2100 }
            CityPopArchiveItem(id, title.take(300), text(row.opt("creator")).ifEmpty { "Unknown artist" }.take(300), if (media == "audio") "audio" else "video", year, "https://archive.org/services/img/${encode(id)}")
        }.take(24)
        val total = (response.opt("numFound") as? Number)?.toDouble()?.takeIf { it.isFinite() }?.toInt()?.coerceAtLeast(0) ?: 0
        return CityPopArchiveSearch(items, total, page.coerceIn(1, 1000))
    }
    /**
     * An error answer, a non-JSON page, or an item listed without its files is Archive failing
     * (it throws); an empty object is an item that no longer exists, so nothing plays.
     */
    fun parseMetadata(json: String, id: String): List<CityPopArchiveTrack> {
        if (!validId(id)) return emptyList()
        val root = runCatching { JSONObject(json) }.getOrNull() ?: error(ITEM_UNAVAILABLE)
        check(!root.has("error")) { ITEM_UNAVAILABLE }
        val metadata = root.optJSONObject("metadata") ?: return emptyList()
        if (restricted(root) || restricted(metadata) || metadata.optString("mediatype") !in setOf("audio", "movies") ||
            metadata.has("identifier") && metadata.opt("identifier") != id) return emptyList()
        val files = root.optJSONArray("files") ?: error(ITEM_UNAVAILABLE)
        val rows = (0 until minOf(files.length(), 5000)).mapNotNull { files.optJSONObject(it) }
        val byName = rows.filter { validFile(it.optString("name")) }.associateBy { it.optString("name") }
        fun originalName(file: JSONObject): String? {
            var name = file.optString("name")
            var current = file
            val visited = hashSetOf(name)
            repeat(10) {
                val original = current.opt("original") as? String ?: return name
                if (!validFile(original) || !visited.add(original)) return name
                name = original
                val parent = byName[original] ?: return name
                if (restricted(parent)) return null
                current = parent
            }
            return name
        }
        fun position(value: Any?): Int? {
            val raw = if (value is Number || value is String) value.toString().trim() else ""
            return Regex("^(\\d{1,4})(?:\\s*/\\s*\\d{1,4})?$").find(raw)?.groupValues?.get(1)?.toIntOrNull()
        }
        data class Candidate(val track: CityPopArchiveTrack, val priority: Int, val index: Int, val number: Int?, val disc: Int)
        val groups = linkedMapOf<String, Candidate>()
        val preference = mapOf("mp3" to 0, "m4a" to 1, "ogg" to 2, "flac" to 3, "wav" to 4)
        rows.forEachIndexed { i, file ->
            val name = file.optString("name")
            val ext = name.substringAfterLast('.', "").lowercase()
            if (!validFile(name) || restricted(file) || ext !in audio + videos) return@forEachIndexed
            val sourceName = originalName(file) ?: return@forEachIndexed
            val source = byName[sourceName]
            if (source != null && restricted(source)) return@forEachIndexed
            val sizeRaw = file.opt("size")
            val size = when (sizeRaw) {
                is Number -> sizeRaw.toDouble().takeIf { it.isFinite() && it >= 0 && it <= 9007199254740991L && it == it.toLong().toDouble() }?.toLong()
                is String -> sizeRaw.takeIf { Regex("^\\d+$").matches(it) }?.toLongOrNull()?.takeIf { it in 0..9007199254740991L }
                else -> null
            }
            if (size == 0L) return@forEachIndexed
            val type = if (ext in audio) "audio" else "video"
            val priority = if (type == "audio") preference.getValue(ext) else if (name.endsWith(".ia.mp4", true)) 0 else if (ext == "mp4") 1 else 2
            val key = "$type:$sourceName"
            val existing = groups[key]
            val title = text(file.opt("title")).ifEmpty { text(source?.opt("title")) }.ifEmpty { name.substringAfterLast('/').substringBeforeLast('.') }.take(300)
            val artist = listOf(file.opt("artist"), file.opt("creator"), source?.opt("artist"), source?.opt("creator"), metadata.opt("creator"))
                .map(::text).firstOrNull { it.isNotEmpty() }?.take(300) ?: "Unknown artist"
            val candidate = Candidate(CityPopArchiveTrack(id, name, title, artist, type, trackUrl(id, name), size), priority, existing?.index ?: i,
                position(file.opt("track") ?: source?.opt("track")), position(file.opt("disc") ?: file.opt("discnumber") ?: source?.opt("disc") ?: source?.opt("discnumber")) ?: 0)
            if (existing == null || priority < existing.priority) groups[key] = candidate
        }
        val sorted = if (groups.values.all { it.number != null }) groups.values.sortedWith(compareBy<Candidate> { it.disc }.thenBy { it.number }.thenBy { it.index })
            else groups.values.sortedBy { it.index }
        return sorted.take(500).map { it.track }
    }

    private fun manager(context: Context) = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private fun prefs(context: Context) = context.getSharedPreferences("anitrack_next", Context.MODE_PRIVATE)
    private fun fileName(track: CityPopArchiveTrack): String {
        val hash = MessageDigest.getInstance("SHA-256").digest(track.fileName.toByteArray()).take(12).joinToString("") { "%02x".format(it) }
        return "city-pop/${track.itemId}-$hash.${track.fileName.substringAfterLast('.').lowercase()}"
    }
    private fun trackJson(track: CityPopArchiveTrack): JSONObject = JSONObject().put("itemId", track.itemId).put("fileName", track.fileName)
        .put("title", track.title).put("artist", track.artist).put("mediaType", track.mediaType).put("size", track.size ?: JSONObject.NULL)
    private fun readTrack(row: JSONObject): CityPopArchiveTrack? {
        val id = row.optString("itemId")
        val name = row.optString("fileName")
        val ext = name.substringAfterLast('.').lowercase()
        if (!validId(id) || !validFile(name) || ext !in audio + videos) return null
        return CityPopArchiveTrack(id, name, row.optString("title").take(300), row.optString("artist").take(300), if (ext in audio) "audio" else "video", trackUrl(id, name), row.optLong("size", -1).takeIf { it >= 0 })
    }
    private fun records(context: Context): JSONArray = runCatching { JSONArray(prefs(context).getString(DOWNLOADS_PREF, "[]")) }.getOrDefault(JSONArray())
    @Synchronized fun enqueue(context: Context, track: CityPopArchiveTrack): Boolean {
        require(validId(track.itemId) && validFile(track.fileName) && track.url == trackUrl(track.itemId, track.fileName))
        require(track.size != null && track.size in 1L..MAX_DOWNLOAD_BYTES) { "Downloads require a known file size of 2 GB or less. Choose another playable version." }
        val rows = records(context)
        if ((0 until rows.length()).any { val row = rows.optJSONObject(it); row?.optString("itemId") == track.itemId && row.optString("fileName") == track.fileName }) return false
        require(rows.length() < 500) { "The City Pop download queue is full." }
        val musicDir = context.getExternalFilesDir(Environment.DIRECTORY_MUSIC) ?: error("Download storage isn't available.")
        val downloadDir = File(musicDir, "city-pop")
        check(downloadDir.isDirectory || downloadDir.mkdirs()) { "Couldn't create the City Pop download folder." }
        val id = manager(context).enqueue(DownloadManager.Request(Uri.parse(track.url)).setTitle(track.title).setDescription("${track.artist} · City Pop")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_MUSIC, fileName(track)))
        rows.put(trackJson(track).put("downloadId", id))
        prefs(context).edit().putString(DOWNLOADS_PREF, rows.toString()).apply()
        return true
    }
    fun downloads(context: Context): List<CityPopArchiveDownload> {
        val rows = records(context)
        val dm = manager(context)
        val records = (0 until minOf(rows.length(), 500)).mapNotNull { i ->
            val row = rows.optJSONObject(i) ?: return@mapNotNull null
            val track = readTrack(row) ?: return@mapNotNull null
            val id = row.optLong("downloadId", -1)
            if (id < 0) return@mapNotNull null
            id to track
        }
        if (records.isEmpty()) return emptyList()
        data class State(val status: Int, val downloaded: Long, val total: Long)
        val states = HashMap<Long, State>()
        runCatching { dm.query(DownloadManager.Query().setFilterById(*records.map { it.first }.toLongArray()))?.use { cursor ->
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID))
                    states[id] = State(cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                        cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                        cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)))
                }
        } }
        return records.map { (id, track) ->
            val state = states[id] ?: State(DownloadManager.STATUS_FAILED, 0L, track.size ?: -1)
            val file = File(context.getExternalFilesDir(Environment.DIRECTORY_MUSIC), fileName(track))
            val local = if (state.status == DownloadManager.STATUS_SUCCESSFUL && file.isFile && file.length() > 0) Uri.fromFile(file) else null
            CityPopArchiveDownload(id, track, state.status, state.downloaded, state.total, local)
        }
    }
    @Synchronized fun remove(context: Context, downloadId: Long) {
        val rows = records(context)
        val kept = JSONArray()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (row.optLong("downloadId", -1) != downloadId) kept.put(row)
            else readTrack(row)?.let { track ->
                manager(context).remove(downloadId)
                File(context.getExternalFilesDir(Environment.DIRECTORY_MUSIC), fileName(track)).delete()
            }
        }
        prefs(context).edit().putString(DOWNLOADS_PREF, kept.toString()).apply()
    }
}
