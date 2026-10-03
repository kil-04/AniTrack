package com.sanjay.anitrack.next.data.manga.mangadex

import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.manga.MangaUrlPolicy
import org.json.JSONArray
import org.json.JSONObject

/** Parsing of MangaDex's official JSON API (https://api.mangadex.org/docs/). */
internal object MangaDexParser {
    private val UUID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private val HASH = Regex("^[0-9a-f]{32}$")
    private val FILE = Regex("^[A-Za-z0-9_-]{1,120}\\.(?:jpg|jpeg|png|gif|webp)$")
    const val MAX_FILES = 500

    fun isUuid(value: String) = UUID.matches(value)

    /** The search result MangaDex links to this AniList (or MAL) entry. */
    fun linkedId(json: JSONObject, anilistId: Int, malId: Int?): String? {
        val data = json.optJSONArray("data") ?: return null
        for (i in 0 until minOf(data.length(), 50)) {
            val item = data.optJSONObject(i) ?: continue
            val id = item.optString("id").takeIf(::isUuid) ?: continue
            val links = item.optJSONObject("attributes")?.optJSONObject("links") ?: continue
            if (links.optString("al") == anilistId.toString()) return id
            if (malId != null && links.optString("mal") == malId.toString()) return id
        }
        return null
    }

    fun titleOf(json: JSONObject, id: String): String? {
        val data = json.optJSONArray("data") ?: return null
        for (i in 0 until data.length()) {
            val item = data.optJSONObject(i) ?: continue
            if (item.optString("id") != id) continue
            val titles = item.optJSONObject("attributes")?.optJSONObject("title") ?: return null
            return titles.optString("en").takeIf { it.isNotBlank() }
                ?: titles.keys().asSequence().firstOrNull()?.let { titles.optString(it) }
        }
        return null
    }

    data class FeedPage(val chapters: List<FeedChapter>, val total: Int, val received: Int)

    data class FeedChapter(val id: String, val number: Float?, val title: String?, val group: String?)

    /** Readable English chapters of one feed page; external, empty and unavailable ones are skipped. */
    fun feed(json: JSONObject): FeedPage {
        val data = json.optJSONArray("data") ?: JSONArray()
        val chapters = ArrayList<FeedChapter>()
        for (i in 0 until data.length()) {
            val item = data.optJSONObject(i) ?: continue
            val id = item.optString("id").takeIf(::isUuid) ?: continue
            val a = item.optJSONObject("attributes") ?: continue
            if (a.optString("translatedLanguage") != "en") continue
            if (!a.isNull("externalUrl") && a.optString("externalUrl").isNotBlank()) continue
            if (a.optInt("pages", 0) <= 0 || a.optBoolean("isUnavailable", false)) continue
            val number = if (a.isNull("chapter")) null else a.optString("chapter").trim().toFloatOrNull()
                ?.takeIf { it.isFinite() && it >= 0f && it < 100_000f }
            val title = if (a.isNull("title")) null else a.optString("title").trim().take(200).ifEmpty { null }
            chapters += FeedChapter(id, number, title, group(item.optJSONArray("relationships")))
        }
        return FeedPage(chapters, json.optInt("total", 0), data.length())
    }

    private fun group(relationships: JSONArray?): String? {
        if (relationships == null) return null
        for (i in 0 until relationships.length()) {
            val r = relationships.optJSONObject(i) ?: continue
            if (r.optString("type") != "scanlation_group") continue
            return r.optJSONObject("attributes")?.optString("name")?.trim()?.take(80)?.ifEmpty { null }
        }
        return null
    }

    /**
     * Numbered chapters as-is. A title whose chapters are all unnumbered (a
     * one-shot or a series of untitled extras) is numbered in feed order instead.
     */
    fun toChapters(feed: List<FeedChapter>): List<MangaChapter> {
        val numbered = feed.filter { it.number != null }
        return if (numbered.isNotEmpty()) {
            numbered.map { MangaChapter(it.id, it.number!!, it.title, it.group) }
        } else {
            feed.mapIndexed { i, c -> MangaChapter(c.id, (i + 1).toFloat(), c.title, c.group) }
        }
    }

    data class Server(val baseUrl: String, val hash: String, val files: List<String>)

    /** The at-home node assigned to a chapter, with every part validated. */
    fun server(json: JSONObject): Server {
        val base = json.optString("baseUrl").trimEnd('/')
        if (MangaUrlPolicy.publicHttps(base, allowPort = true) == null) {
            throw MangaSourceException("MangaDex returned an unusable image server.")
        }
        val chapter = json.optJSONObject("chapter") ?: throw MangaSourceException("MangaDex returned no pages.")
        val hash = chapter.optString("hash").takeIf { HASH.matches(it) }
            ?: throw MangaSourceException("MangaDex returned no pages.")
        val array = chapter.optJSONArray("data") ?: JSONArray()
        val files = (0 until minOf(array.length(), MAX_FILES)).map { array.optString(it) }
        if (files.isEmpty() || files.any { !FILE.matches(it) }) throw MangaSourceException("MangaDex returned no pages.")
        return Server(base, hash, files)
    }

    fun pageUrl(baseUrl: String, hash: String, file: String) = "$baseUrl/data/$hash/$file"

    /** Splits a page URL built by [pageUrl] back into (baseUrl, hash, file). */
    fun splitPageUrl(url: String): Triple<String, String, String>? {
        val marker = url.lastIndexOf("/data/")
        if (marker <= 0) return null
        val rest = url.substring(marker + "/data/".length).split('/')
        if (rest.size != 2 || !HASH.matches(rest[0]) || !FILE.matches(rest[1])) return null
        return Triple(url.substring(0, marker), rest[0], rest[1])
    }

    /** Body for https://api.mangadex.network/report. */
    fun report(url: String, success: Boolean, bytes: Long, durationMs: Long, cached: Boolean): String =
        JSONObject()
            .put("url", url)
            .put("success", success)
            .put("bytes", bytes.coerceAtLeast(0))
            .put("duration", durationMs.coerceAtLeast(0))
            .put("cached", cached)
            .toString()

    /** MangaDex@Home volunteer nodes must be reported; MangaDex's own hosts must not. */
    fun reportable(host: String): Boolean {
        val h = host.lowercase()
        return h.endsWith(".mangadex.network") && "mangadex.org" !in h
    }
}
