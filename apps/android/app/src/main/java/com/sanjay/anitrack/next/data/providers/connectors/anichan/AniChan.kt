package com.sanjay.anitrack.next.data.providers.connectors.anichan

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

internal class AniChanException(message: String) : Exception(message)

/** Pure catalogue/stream rules. Mirrors packages/shared/anichan.ts. */
internal object AniChan {
    const val ORIGIN = "https://anichan.to"
    const val MAX_EPISODES = 5_000
    const val MAX_CATALOG_BYTES = 2 * 1024 * 1024
    const val MAX_RESPONSE_BYTES = 512 * 1024
    private val MEDIA_HOSTS = setOf("anichan.to", "c.toroplay.cymru")
    data class Episode(val number: Int, val title: String?, val snapshot: String?, val sub: Boolean, val dub: Boolean)
    data class SearchResult(val anilistId: Int, val malId: Int?, val title: String, val poster: String?, val episodes: Int?, val year: Int?, val format: String?)
    data class Title(val anilistId: Int, val malId: Int?, val title: String, val poster: String?, val year: Int?, val episodes: List<Episode>)
    data class Subtitle(val file: String, val label: String, val default: Boolean, val kind: String = "subtitles")
    data class Skip(val start: Double, val end: Double)
    data class Choice(
        val id: String, val name: String, val label: String, val category: String, val tier: String,
        val occurrence: Int, val rank: Double, val url: String, val hls: Boolean,
        val subtitles: List<Subtitle>, val intro: Skip?, val outro: Skip?,
    )

    fun id(value: Any?): Int? {
        val number = value as? Number ?: return null
        val n = number.toDouble()
        return n.takeIf { it.isFinite() && it >= 1 && it <= Int.MAX_VALUE && it % 1.0 == 0.0 }?.toInt()
    }
    private fun episodeNumber(value: Any?) = id(value)?.takeIf { it <= MAX_EPISODES }
    private fun text(value: Any?, limit: Int): String? = (value as? String)
        ?.replace(Regex("[\\s\\p{javaWhitespace}\\p{Z}\\p{Cntrl}\uFEFF]+"), " ")?.trim()?.take(limit)?.takeIf { it.isNotEmpty() }
    private fun year(value: Any?) = id(value)?.takeIf { it in 1900..2200 }

    fun titleUrl(id: Int): String {
        if (id <= 0) throw AniChanException("Invalid AniChan show.")
        return "$ORIGIN/anime/$id/watch/1"
    }
    fun metadataUrl(id: Int): String {
        if (id <= 0) throw AniChanException("Invalid AniChan show.")
        return "$ORIGIN/api/catalog/anime/$id"
    }
    fun searchUrl(query: String) = "$ORIGIN/api/suggest?q=" + java.net.URLEncoder.encode(text(query, 100) ?: "", "UTF-8")
        .replace("+", "%20").replace("%7E", "~").replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")")

    /** Only the same-origin source and its observed proxy may leave the browser session. */
    fun mediaUrl(value: Any?): String? {
        val raw = value as? String ?: return null
        if (raw.length !in 1..16_384 || raw.any { it.code <= 0x20 || it.code == 0x7f || it == '\\' }) return null
        return runCatching {
            val uri = URI("$ORIGIN/").resolve(raw)
            if (!uri.scheme.equals("https", true) || uri.rawUserInfo != null || uri.rawFragment != null ||
                (uri.port != -1 && uri.port != 443) || uri.host?.lowercase() !in MEDIA_HOSTS) null
            else canonical(uri)
        }.getOrNull()
    }

    private fun snapshot(value: Any?): String? {
        val raw = value as? String ?: return null
        if (raw.length !in 1..16_384 || raw.any { it.code <= 0x20 || it.code == 0x7f || it == '\\' }) return null
        return runCatching {
            val uri = URI("$ORIGIN/").resolve(raw)
            val host = uri.host?.lowercase() ?: return null
            if (!uri.scheme.equals("https", true) || uri.rawUserInfo != null || uri.rawFragment != null ||
                (uri.port != -1 && uri.port != 443) || '.' !in host || host.matches(Regex("[0-9.]+")) || ':' in host ||
                listOf(".local", ".localhost", ".internal").any(host::endsWith)) null
            else canonical(uri)
        }.getOrNull()
    }

    private fun canonical(uri: URI): String {
        val authority = uri.host.lowercase()
        val path = uri.normalize().rawPath.takeIf { it.isNotEmpty() } ?: "/"
        return URI("https://$authority$path${uri.rawQuery?.let { "?$it" } ?: ""}").toASCIIString()
    }

    fun parseSearch(payload: JSONObject): List<SearchResult> {
        val rows = payload.optJSONArray("results") ?: throw AniChanException("AniChan sent unreadable search results.")
        val seen = HashSet<Int>()
        val result = ArrayList<SearchResult>()
        for (i in 0 until minOf(rows.length(), 200)) {
            val row = rows.optJSONObject(i) ?: continue
            val animeId = id(row.opt("id")) ?: continue
            if (animeId in seen) continue
            val title = text(row.opt("title"), 300) ?: text(row.opt("titleRomaji"), 300) ?: continue
            seen.add(animeId)
            result += SearchResult(animeId, id(row.opt("idMal")), title, snapshot(row.opt("poster")), episodeNumber(row.opt("episodes")),
                year(row.optJSONObject("startDate")?.opt("year")), text(row.opt("format"), 30))
            if (result.size == 40) break
        }
        return result
    }

    fun parseTitle(metadata: JSONObject, expectedId: Int, episodeCount: JSONObject? = null): Title {
        if (expectedId <= 0 || id(metadata.opt("id")) != expectedId) throw AniChanException("AniChan returned a different show.")
        val title = text(metadata.opt("title"), 300) ?: text(metadata.opt("titleRomaji"), 300) ?: throw AniChanException("AniChan returned an incomplete show.")
        val selfhost = metadata.optJSONObject("selfhost") ?: JSONObject()
        val available = metadata.optJSONObject("available_eps") ?: JSONObject()
        val generic = selfhost.optJSONArray("cached_eps")
        val subArrays = listOf(selfhost.optJSONArray("cached_sub"), available.optJSONArray("sub"), available.optJSONArray("hsub"), generic)
        val dubArrays = listOf(selfhost.optJSONArray("cached_dub"), available.optJSONArray("dub"))
        fun numbers(arrays: List<JSONArray?>): Set<Int> = arrays.filterNotNull().flatMap { array ->
            (0 until minOf(array.length(), MAX_EPISODES * 2)).mapNotNull { episodeNumber(array.opt(it)) }
        }.toSet()
        val sub = numbers(subArrays)
        val dub = numbers(dubArrays)
        val known = (subArrays + dubArrays).any { it != null }
        val numbers = if (known) (sub + dub).sorted() else {
            val count = episodeNumber(episodeCount?.opt("episodes")) ?: 0
            (1..count).toList()
        }
        val sources = episodeCount?.optJSONArray("sources")
        val sourceRows = (0 until minOf(sources?.length() ?: 0, 32)).mapNotNull { sources?.optJSONObject(it) }
        val hasFlags = sourceRows.any { it.opt("sub") is Boolean }
        val fallbackSub = !hasFlags || sourceRows.any { it.opt("sub") == true }
        val fallbackDub = episodeCount?.opt("dubAvailable") == true || sourceRows.any { it.opt("dub") == true }
        val titles = selfhost.optJSONObject("ep_titles")
        val meta = selfhost.optJSONObject("ep_meta")
        return Title(expectedId, id(metadata.opt("idMal")), title, snapshot(metadata.opt("poster")), year(metadata.optJSONObject("startDate")?.opt("year")), numbers.take(MAX_EPISODES).map { n ->
            val row = meta?.optJSONObject(n.toString())
            Episode(n, text(row?.opt("title"), 300) ?: text(titles?.opt(n.toString()), 300), snapshot(row?.opt("image")),
                if (known) n in sub else fallbackSub, if (known) n in dub else fallbackDub)
        })
    }

    fun variantId(category: String, tier: String, name: String, occurrence: Int): String =
        // org.json additionally escapes </; JSON.stringify used by the desktop does not.
        JSONArray().put(category).put(tier).put(name).put(occurrence).toString().replace("<\\/", "</")

    fun variant(value: String): Triple<String, String, String>? = runCatching {
        if (value.length > 512) return null
        val array = JSONArray(value)
        if (array.length() != 4 || array.opt(0) !in listOf("sub", "dub") || array.opt(1) !in listOf("fast", "rest")) return null
        val name = text(array.opt(2), 100) ?: return null
        val occurrence = (array.opt(3) as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 && it <= 255 && it % 1.0 == 0.0 }?.toInt() ?: return null
        if (variantId(array.getString(0), array.getString(1), name, occurrence) != value) return null
        Triple(array.getString(0), array.getString(1), name)
    }.getOrNull()

    private fun skip(value: Any?): Skip? {
        val row = value as? JSONObject ?: return null
        val start = (row.opt("start") as? Number)?.toDouble() ?: return null
        val end = (row.opt("end") as? Number)?.toDouble() ?: return null
        return if (start.isFinite() && end.isFinite() && start >= 0 && end > start && end < 86_400) Skip(start, end) else null
    }

    fun parseServers(payload: JSONObject, category: String, tier: String): List<Choice> {
        if (category !in setOf("sub", "dub") || tier !in setOf("fast", "rest")) throw AniChanException("Invalid AniChan stream choice.")
        if (payload.opt("detail") == "session") throw AniChanException("Connect AniChan before watching.")
        val servers = payload.optJSONArray("servers") ?: throw AniChanException("AniChan sent an unreadable server list.")
        val seen = HashMap<String, Int>()
        val out = ArrayList<Choice>()
        for (i in 0 until minOf(servers.length(), 256)) {
            val server = servers.optJSONObject(i) ?: continue
            val name = text(server.opt("name"), 100) ?: continue
            val occurrence = seen.getOrDefault(name, 0)
            seen[name] = occurrence + 1
            val type = server.optString("type")
            if (type !in setOf("hls", "mp4")) continue
            val url = mediaUrl(server.opt("stream")) ?: continue
            val rank = (server.opt("rank") as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 && it <= 1_000_000 } ?: 1_000_000.0
            val subtitles = server.optJSONArray("subtitles") ?: JSONArray()
            val seenTracks = HashSet<String>()
            val tracks = (0 until minOf(subtitles.length(), 32)).mapNotNull { index ->
                val track = subtitles.optJSONObject(index) ?: return@mapNotNull null
                val file = mediaUrl(track.opt("url")) ?: return@mapNotNull null
                val path = URI(file).path
                if (path != "/api/watch/vtt" && !path.lowercase().endsWith(".vtt")) return@mapNotNull null
                if (!seenTracks.add(file)) return@mapNotNull null
                Subtitle(file, text(track.opt("lang"), 60) ?: "Subtitles", track.opt("default") == true)
            }
            val language = if (category == "dub") "Dub" else if (server.optString("subType") == "hard") "Hard sub" else "Sub"
            out += Choice(variantId(category, tier, name, occurrence), name,
                "${text(server.opt("label"), 100) ?: name} · $language", category, tier, occurrence, rank, url, type == "hls",
                tracks, skip(server.opt("intro")), skip(server.opt("outro")))
        }
        return out.sortedBy { it.rank }.take(32)
    }
}
