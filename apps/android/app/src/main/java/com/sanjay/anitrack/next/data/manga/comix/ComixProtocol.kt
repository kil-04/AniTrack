package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.Manga
import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.SourceTitle
import java.net.URI
import java.text.Normalizer
import org.json.JSONArray
import org.json.JSONObject

internal object ComixProtocol {
    const val ORIGIN = "https://comix.to"
    const val MAX_RESPONSE = 200_000
    // This is AniTrack's local policy rejection, never a response from Comix.
    // The website treats a non-JSON 403 as a WAF failure and reloads itself.
    const val BLOCKED_MIME = "application/json"
    const val BLOCKED_BODY = "{\"message\":\"Unavailable in the public catalogue session.\"}"
    private val hid = Regex("[a-zA-Z0-9]{1,32}")
    private val chapterId = Regex("[0-9]{1,15}")

    fun validRequest(path: String, params: JSONObject): Boolean {
        val keys = params.keys().asSequence().toSet()
        return when {
            path == "/manga" -> keys == setOf("keyword", "page", "limit", "order[relevance]") &&
                params.optString("keyword").length in 1..200 && params.optInt("page") == 1 &&
                params.optInt("limit") == 20 && params.optString("order[relevance]") == "desc"
            Regex("/manga/[a-zA-Z0-9]{1,32}/chapters").matches(path) ->
                keys == setOf("page", "limit", "order[number]") && params.optInt("page") in 1..200 &&
                    params.optInt("limit") == 100 && params.optString("order[number]") == "asc"
            Regex("/manga/[a-zA-Z0-9]{1,32}").matches(path) ||
                Regex("/chapters/[0-9]{1,15}").matches(path) -> keys.isEmpty()
            else -> false
        }
    }

    fun titleId(value: String): String {
        require(hid.matches(value)) { "Invalid Comix title." }
        return value
    }

    fun chapterId(value: String): String {
        require(chapterId.matches(value)) { "Invalid Comix chapter." }
        return value
    }

    fun items(value: JSONObject): JSONArray = value.optJSONArray("items")
        ?: throw IllegalStateException("Comix changed its catalogue format.")

    fun title(value: JSONObject): SourceTitle? {
        val id = value.optString("hid")
        val name = value.optString("title").takeIf { it.isNotBlank() && it != "null" } ?: return null
        return if (hid.matches(id)) SourceTitle("comix", id, name.take(300)) else null
    }

    /** IDs win over spelling. Never choose a same-named sequel with a conflicting tracker. */
    fun matches(value: JSONObject, manga: Manga): Boolean {
        val links = value.optJSONObject("links")
        val al = tracker(links?.optString("al"), "anilist.co")
        val mal = tracker(links?.optString("mal"), "myanimelist.net")
        if (al != null) return al == manga.id
        if (mal != null && manga.malId != null) return mal == manga.malId
        val wanted = listOfNotNull(manga.title, manga.titleRomaji).map(::normal)
        val names = mutableListOf(value.optString("title"))
        value.optJSONArray("altTitles")?.let { a ->
            for (i in 0 until minOf(a.length(), 100)) names += a.optString(i)
        }
        return names.any { normal(it).isNotEmpty() && normal(it) in wanted }
    }

    private fun tracker(value: String?, host: String): Int? = runCatching {
        val u = URI(value ?: return null)
        if (u.scheme != "https" || u.host != host || u.userInfo != null || u.port !in listOf(-1,443)) return null
        Regex("^/manga/([0-9]+)(?:/.*)?$").find(u.path)?.groupValues?.get(1)?.toIntOrNull()
    }.getOrNull()

    private fun normal(value: String) = Normalizer.normalize(value, Normalizer.Form.NFKC)
        .lowercase(java.util.Locale.ROOT).replace(Regex("[^\\p{L}\\p{N}]"), "")

    fun chapters(value: JSONObject): List<MangaChapter> {
        val a = items(value)
        require(a.length() <= 100) { "Comix returned too many chapters in one page." }
        return buildList {
            for (i in 0 until a.length()) {
                val row = a.optJSONObject(i) ?: continue
                val id = row.optString("id")
                val number = row.optDouble("number", Double.NaN).toFloat()
                if (!chapterId.matches(id) || !number.isFinite() || number < 0f) continue
                add(MangaChapter(id, number, row.optString("name").takeIf { it.isNotBlank() && it != "null" }?.take(300),
                    row.optJSONObject("group")?.optString("name")?.takeIf { it.isNotBlank() && it != "null" }?.take(120)))
            }
        }
    }

    fun hasNext(value: JSONObject, page: Int): Boolean {
        val pagination = value.optJSONObject("pagination") ?: value.optJSONObject("meta")
            ?: throw IllegalStateException("Comix omitted chapter pagination; refusing a partial list.")
        val current = pagination.optInt("page", page)
        require(current == page) { "Comix repeated a chapter page." }
        val last = pagination.optInt("lastPage", pagination.optInt("last_page", -1))
        if (last >= 1) return page < last
        if (pagination.has("hasNext")) return pagination.getBoolean("hasNext")
        throw IllegalStateException("Comix changed its chapter pagination.")
    }

    fun pages(value: JSONObject): List<MangaPage> {
        val raw = value.opt("pages") ?: throw IllegalStateException("Comix omitted chapter images.")
        val a = if (raw is JSONArray) raw else (raw as? JSONObject)?.optJSONArray("items")
            ?: throw IllegalStateException("Comix changed its chapter image format.")
        val base = (raw as? JSONObject)?.optString("baseUrl")?.takeIf { it != "null" }.orEmpty()
        require(a.length() in 1..500) { "Comix returned an invalid page count." }
        return (0 until a.length()).map { i ->
            val row = a.getJSONObject(i)
            val url = imageUrl(base + row.getString("url"))
            MangaPage(url, row.optInt("width").takeIf { it in 1..20000 },
                row.optInt("height").takeIf { it in 1..20000 },
                mapOf("Referer" to "$ORIGIN/", "Origin" to ORIGIN))
        }
    }

    fun imageUrl(raw: String): String {
        require(raw.length <= 4096 && raw.none { it <= ' ' }) { "Invalid Comix image URL." }
        val u = try { URI(raw) } catch (_: Exception) { throw IllegalArgumentException("Invalid Comix image URL.") }
        val host = u.host?.lowercase() ?: throw IllegalArgumentException("Invalid Comix image host.")
        require(u.scheme == "https" && u.userInfo == null && u.port in listOf(-1,443) && u.fragment == null &&
            host.contains('.') && host != "localhost" && !host.endsWith(".local") &&
            !host.endsWith(".internal") && !host.matches(Regex("[0-9.]+")) && ':' !in host) { "Unsafe Comix image URL." }
        return raw
    }
}
