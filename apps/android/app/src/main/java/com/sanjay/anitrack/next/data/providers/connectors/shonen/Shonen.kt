package com.sanjay.anitrack.next.data.providers.connectors.shonen

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/** A shonen.to answer that isn't a usable stream; the message is safe to show. */
class ShonenException(message: String, val notFound: Boolean = false) : Exception(message)

/**
 * shonen.to: an AniList-keyed anime catalogue. Mirrors packages/shared/shonen.ts
 * (search cards, title page, /sources/shonen JSON); keep the two identical.
 */
object Shonen {
    const val ORIGIN = "https://shonen.to"
    val HOSTS = setOf("shonen.to")
    const val MAX_EPISODES = 5_000
    private const val MAX_ID = 2_147_483_647L

    data class SearchResult(
        val anilistId: Int,
        val title: String,
        val poster: String?,
        val episodes: Int?,
        val score: Double?,
        val format: String?,
        val year: Int?,
    )

    data class TitlePage(val title: String?, val episodes: Int?)
    data class Subtitle(val file: String, val label: String, val kind: String, val default: Boolean)
    data class Skip(val start: Double, val end: Double)
    data class Stream(val url: String, val subtitles: List<Subtitle>, val intro: Skip?, val outro: Skip?)

    fun isAnimeId(id: Long): Boolean = id in 1..MAX_ID

    fun searchUrl(query: String): String =
        "$ORIGIN/browse?q=${java.net.URLEncoder.encode(query.trim().take(100), "UTF-8").replace("+", "%20")}"

    fun animeUrl(anilistId: Int): String {
        if (!isAnimeId(anilistId.toLong())) throw ShonenException("Invalid shonen.to show.")
        return "$ORIGIN/anime/$anilistId"
    }

    fun sourcesUrl(anilistId: Int, episode: Int, language: String): String {
        if (!isAnimeId(anilistId.toLong()) || episode !in 1..MAX_EPISODES) throw ShonenException("Invalid shonen.to episode.")
        return "$ORIGIN/sources/shonen?id=$anilistId&episode=$episode&language=${if (language == "dub") "dub" else "sub"}"
    }

    private val ENTITIES = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "#39" to "'", "nbsp" to " ")

    private fun safeChar(code: Int): String =
        if (code in 1..0x10FFFF && code !in 0xD800..0xDFFF) String(Character.toChars(code)) else ""

    private fun decode(text: String): String = text
        .replace(Regex("&#x([0-9a-fA-F]{1,6});")) { safeChar(it.groupValues[1].toInt(16)) }
        .replace(Regex("&#([0-9]{1,7});")) { safeChar(it.groupValues[1].toInt()) }
        .replace(Regex("&([a-zA-Z]+|#39);")) { ENTITIES[it.groupValues[1].lowercase()] ?: it.value }

    private fun strip(html: String) = decode(html.replace(Regex("<[^>]*>"), " ")).replace(Regex("\\s+"), " ").trim()

    /** A public https URL (relative ones resolved against the site), else null. */
    private fun httpsUrl(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        return runCatching {
            val uri = URI(ORIGIN + "/").resolve(decode(raw.trim()))
            if (uri.scheme == "https" && uri.rawUserInfo == null && !uri.host.isNullOrBlank()) uri.toString() else null
        }.getOrNull()
    }

    /** Result cards on /browse?q=: `<a class="card" href="/anime/<anilistId>" title="…">`. */
    fun search(html: String): List<SearchResult> {
        val out = ArrayList<SearchResult>()
        val seen = HashSet<Int>()
        for (m in Regex("<a\\b[^>]*\\bclass=\"card\"[^>]*>[\\s\\S]*?</a>").findAll(html)) {
            val card = m.value
            val id = Regex("href=\"/anime/([1-9][0-9]{0,9})\"").find(card)?.groupValues?.get(1)?.toLongOrNull() ?: continue
            if (!isAnimeId(id) || !seen.add(id.toInt())) continue
            val title = decode(Regex("\\btitle=\"([^\"]{1,300})\"").find(card)?.groupValues?.get(1) ?: "").trim()
                .ifEmpty { strip(Regex("<div class=\"ct\">([\\s\\S]*?)</div>").find(card)?.groupValues?.get(1) ?: "") }
            if (title.isEmpty()) { seen.remove(id.toInt()); continue }
            val meta = strip(Regex("<div class=\"cm\">([\\s\\S]*?)</div>").find(card)?.groupValues?.get(1) ?: "")
            val parts = meta.split("/").map { it.trim() }
            val format = parts.getOrNull(0)?.takeIf { it.isNotEmpty() }
            val year = parts.getOrNull(1)?.takeIf { it.matches(Regex("[12][0-9]{3}")) }?.toInt()
            val episodes = Regex("class=\"pill ep\">\\s*EP\\s*([0-9]{1,5})", RegexOption.IGNORE_CASE).find(card)?.groupValues?.get(1)?.toIntOrNull()
            val score = Regex("class=\"pill score\">\\s*([0-9]{1,2}(?:\\.[0-9])?)").find(card)?.groupValues?.get(1)?.toDoubleOrNull()
            out += SearchResult(
                anilistId = id.toInt(),
                title = title.take(300),
                poster = httpsUrl(Regex("<img\\b[^>]*\\bsrc=\"([^\"]+)\"").find(card)?.groupValues?.get(1)),
                episodes = episodes?.takeIf { it > 0 },
                score = score?.takeIf { it > 0 }?.coerceAtMost(10.0),
                format = format?.take(20),
                year = year,
            )
            if (out.size >= 40) break
        }
        return out
    }

    /** Episodes a title page offers: its Follow button's data-eps, else the "Episodes" fact. */
    fun episodeCount(html: String): Int? {
        val raw = Regex("\\bdata-eps=\"([0-9]{1,5})\"").find(html)?.groupValues?.get(1)
            ?: Regex("<dt>\\s*Episodes\\s*</dt>\\s*<dd>\\s*([0-9]{1,5})", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)
        return raw?.toIntOrNull()?.takeIf { it > 0 }?.coerceAtMost(MAX_EPISODES)
    }

    /** A title page's name and episode count (its `<h1>` and Follow button). */
    fun titlePage(html: String): TitlePage {
        val title = strip(Regex("<h1[^>]*>([\\s\\S]{1,600}?)</h1>").find(html)?.groupValues?.get(1) ?: "").take(300)
        return TitlePage(title.ifEmpty { null }, episodeCount(html))
    }

    private fun skip(value: Any?): Skip? {
        val o = value as? JSONObject ?: return null
        val start = o.optDouble("start", Double.NaN)
        val end = o.optDouble("end", Double.NaN)
        return if (start.isFinite() && end.isFinite() && start >= 0 && end > start && end < 24 * 3600) Skip(start, end) else null
    }

    /** The /sources/shonen answer: `{data:{sources:[{file,type}],tracks:[…],intro,outro}}` or `{error:{code,message}}`. */
    fun sources(root: JSONObject): Stream {
        root.optJSONObject("error")?.let { error ->
            val notFound = error.optString("code") == "SOURCE_NOT_FOUND"
            throw ShonenException(
                if (notFound) "shonen.to has no stream for this episode in this language." else "shonen.to couldn't load this episode. Try again later.",
                notFound,
            )
        }
        val data = root.optJSONObject("data") ?: throw ShonenException("shonen.to sent a response AniTrack couldn't read.")
        val sources = data.optJSONArray("sources") ?: JSONArray()
        var hls: JSONObject? = null
        for (i in 0 until sources.length()) {
            val s = sources.optJSONObject(i) ?: continue
            if (s.optString("type") == "hls" && httpsUrl(s.optString("file")) != null) { hls = s; break }
        }
        val url = httpsUrl(hls?.optString("file") ?: data.optString("source").takeIf { it.isNotEmpty() })
            ?: throw ShonenException("shonen.to has no stream for this episode in this language.", true)
        val tracks = data.optJSONArray("tracks")?.takeIf { it.length() > 0 } ?: hls?.optJSONArray("tracks") ?: JSONArray()
        val subtitles = ArrayList<Subtitle>()
        for (i in 0 until minOf(tracks.length(), 32)) {
            val t = tracks.optJSONObject(i) ?: continue
            val file = httpsUrl(t.optString("file")) ?: continue
            val kind = t.optString("kind").ifEmpty { "subtitles" }
            if (kind != "subtitles" && kind != "captions") continue
            val label = t.optString("label").trim().ifEmpty { "Subtitles" }.take(60)
            subtitles += Subtitle(file, label, kind, t.optBoolean("default", false))
        }
        return Stream(
            url = url,
            subtitles = subtitles,
            intro = skip(data.opt("intro")) ?: skip(hls?.opt("intro")),
            outro = skip(data.opt("outro")) ?: skip(hls?.opt("outro")),
        )
    }
}
