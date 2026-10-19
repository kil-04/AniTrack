package com.sanjay.anitrack.next.data.manga.toonkotsu

import com.sanjay.anitrack.next.data.manga.MangaChapter
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder

/** Mirrors packages/shared/toonkotsu.ts. Catalogue shapes observed 19 Oct 2026. */
object ToonkotsuParser {
    const val ORIGIN = "https://toonkotsu.com"
    const val MAX_CHAPTERS = 20_000
    const val MAX_PAGES = 500
    const val MAX_BYTES = 16 * 1024 * 1024
    private val hidPattern = Regex("^[a-z][a-z0-9]{4}$")
    private val refPattern = Regex("^([a-z][a-z0-9]{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$")
    private val chapterPattern = Regex("^[1-9]\\d{0,14}$")
    fun isChapter(value: String) = chapterPattern.matches(value)
    fun hid(ref: String): String? = if (ref.length <= 190) refPattern.matchEntire(ref)?.groupValues?.get(1) else null
    private fun text(v: Any?, max: Int = 300) = (v as? String)?.trim()?.take(max).orEmpty()
    private fun number(v: Any?): Double? {
        if (v !is Number && !(v is String && Regex("^\\d+(?:\\.\\d+)?$").matches(v))) return null
        return v.toString().toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }
    }
    private fun positive(v: Any?): Long? = number(v)?.takeIf { it > 0 && it <= 9007199254740991.0 && it % 1 == 0.0 }?.toLong()
    fun searchUrl(query: String) = "$ORIGIN/cdn/v1/search?q=${URLEncoder.encode(query.trim().take(120), "UTF-8").replace("+", "%20")}&limit=5"
    fun seriesUrl(ref: String): String {
        val id = ref.takeIf(hidPattern::matches) ?: hid(ref) ?: error("Unrecognised Toonkotsu title.")
        return "$ORIGIN/cdn/v1/series/$id"
    }
    fun search(value: JSONObject): List<String> {
        val items = value.optJSONArray("items") ?: error("Toonkotsu sent an unreadable search result.")
        return (0 until minOf(items.length(), 5)).mapNotNull { i ->
            val s = items.optJSONObject(i) ?: return@mapNotNull null
            val ref = "${text(s.opt("hid"))}-${text(s.opt("slug"), 180)}"
            ref.takeIf { hid(it) != null }
        }.distinct()
    }
    data class Detail(val ref: String, val title: String, val altTitles: List<String>, val anilistId: Int?, val malId: Int?, val year: Int?, val country: String?, val adult: Boolean, val latestChapter: Float?, val latestAt: Long?)
    fun detail(value: JSONObject, expectedRef: String): Detail? {
        val s = value.optJSONObject("series") ?: return null
        val ref = "${text(s.opt("hid"))}-${text(s.opt("slug"), 180)}"
        if (hid(ref) == null || hid(ref) != hid(expectedRef) || text(s.opt("title")).isBlank()) return null
        val trackers = s.optJSONObject("trackers") ?: JSONObject()
        val external = s.optJSONObject("externalIds") ?: JSONObject()
        val latest = s.optJSONObject("latest") ?: JSONObject()
        val alt = s.optJSONArray("alt")
        fun id(v: Any?) = positive(v)?.takeIf { it <= Int.MAX_VALUE }?.toInt()
        return Detail(ref, text(s.opt("title")), if (alt == null) emptyList() else (0 until minOf(alt.length(), 60)).mapNotNull { (alt.opt(it) as? String)?.take(300) },
            id(trackers.opt("anilist")) ?: id(external.opt("anilist")), id(trackers.opt("myanimelist")) ?: id(external.opt("myanimelist")),
            id(s.opt("year")), text(s.opt("country"), 2).ifBlank { null }, s.opt("adult") == true, number(latest.opt("n"))?.toFloat(), positive(latest.opt("at")))
    }
    fun chapters(value: JSONObject): List<MangaChapter> {
        val rows = value.optJSONArray("chapters") ?: error("Toonkotsu sent an unreadable chapter list.")
        val out = LinkedHashMap<String, MangaChapter>()
        var visited = 0
        for (i in 0 until rows.length()) {
            val canonical = rows.optJSONObject(i) ?: JSONObject()
            val alternatives = canonical.optJSONArray("alts")
            if (canonical.has("alts") && !canonical.isNull("alts") && alternatives == null) error("Toonkotsu sent unreadable alternate uploads.")
            val uploads = listOf(canonical) + (0 until (alternatives?.length() ?: 0)).map { alternatives?.optJSONObject(it) ?: JSONObject() }
            for (upload in uploads) {
                if (++visited > MAX_CHAPTERS) error("Toonkotsu chapter list exceeds the supported limit.")
                val id = upload.opt("id")?.toString().orEmpty()
                val n = number(canonical.opt("n"))?.takeIf { it <= 100_000 } ?: continue
                if (!isChapter(id)) continue
                val label = text(if (!upload.isNull("label")) upload.opt("label") else canonical.opt("label"), 200)
                val group = upload.optJSONObject("group") ?: canonical.optJSONObject("group")
                val pages = positive(if (!upload.isNull("pages")) upload.opt("pages") else canonical.opt("pages"))?.takeIf { it <= MAX_PAGES }?.toInt()
                out[id] = MangaChapter(id, n.toFloat(), label.ifBlank { null }, text(group?.opt("name"), 80).ifBlank { Regex("\\[([^\\]]{1,80})\\]\\s*$").find(label)?.groupValues?.get(1) }, pages,
                    positive(if (!upload.isNull("at")) upload.opt("at") else canonical.opt("at")))
            }
        }
        return out.values.toList()
    }
    fun pageUrl(ref: String, chapter: MangaChapter, page: Int): String {
        require(hid(ref) != null && isChapter(chapter.id) && chapter.number.isFinite() && chapter.number in 0f..100_000f && page in 1..MAX_PAGES)
        val n = if (chapter.number % 1f == 0f) chapter.number.toInt().toString() else chapter.number.toString()
        return "$ORIGIN/title/$ref/${chapter.id}-chapter-$n/$page"
    }
    data class PageRef(val ref: String, val chapterId: String, val page: Int)
    fun pageRef(raw: String): PageRef? {
        val u = runCatching { URI(raw) }.getOrNull() ?: return null
        if (u.scheme != "https" || u.host != "toonkotsu.com" || u.port !in listOf(-1, 443) || u.userInfo != null || u.rawQuery != null || u.rawFragment != null) return null
        val m = Regex("^/title/([^/]+)/([1-9]\\d{0,14})-chapter-(\\d{1,6}(?:\\.\\d{1,4})?)/([1-9]\\d{0,2})$").matchEntire(u.rawPath) ?: return null
        if (hid(m.groupValues[1]) == null || m.groupValues[3].toDouble() > 100_000 || m.groupValues[4].toInt() > MAX_PAGES) return null
        return PageRef(m.groupValues[1], m.groupValues[2], m.groupValues[4].toInt())
    }
}
