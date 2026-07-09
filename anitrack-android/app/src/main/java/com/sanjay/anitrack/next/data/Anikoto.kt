package com.sanjay.anitrack.next.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Anikoto provider — Kotlin port of the proven scraping flow from the
 * Capacitor app (api-capacitor.ts + electron/services/providers/anikoto.ts).
 *
 * Hard-won rules carried over:
 *  - Titles LIE (their "City Hunter" entry contains City Hunter '91). The
 *    episode list's data-mal attribute is the only reliable identity, so
 *    matching verifies against the target's MAL id, serially, one candidate
 *    at a time (bursts trip the site's anti-bot limit).
 *  - Episode lists are cached with in-flight-friendly TTL; verification and
 *    display share one fetch.
 */
object Anikoto {
    private const val BASE = "https://anikototv.to"
    private const val UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

    private val http = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    data class SearchResult(
        val slug: String,
        val title: String,
        val episodes: Int?,
        val year: Int?,
    )

    data class Episode(
        val number: Float,
        val title: String,
        val dataId: String,
        val serversToken: String,
    )

    data class EpisodeList(val malId: Int?, val episodes: List<Episode>)

    private val epsCache = object : LinkedHashMap<String, Pair<Long, EpisodeList>>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Pair<Long, EpisodeList>>) = size > 60
    }
    private const val EPS_TTL_MS = 15 * 60 * 1000L

    private fun get(url: String, referer: String = "$BASE/", xhr: Boolean = false): String {
        val b = Request.Builder().url(url)
            .header("User-Agent", UA)
            .header("Referer", referer)
        if (xhr) b.header("X-Requested-With", "XMLHttpRequest")
        http.newCall(b.build()).execute().use { res ->
            if (!res.isSuccessful) throw Exception("Anikoto ${res.code} for $url")
            return res.body?.string() ?: throw Exception("empty body")
        }
    }

    /** Year parsed from a title, the same imperfect way the JS did (titles can
     *  still lie — that's what MAL verification is for). */
    private fun parseYear(title: String): Int? {
        Regex("""\b(19\d\d|20[0-2]\d)\b""").find(title)?.let { return it.groupValues[1].toInt() }
        Regex("""'(\d{2})\b""").find(title)?.let {
            val v = it.groupValues[1].toInt()
            return if (v >= 50) 1900 + v else 2000 + v
        }
        return null
    }

    data class TopItem(val slug: String, val title: String, val poster: String?)

    /** Anikoto's Top-10 board (Day / Week / Month) scraped from /home — the same
     *  source the desktop app uses. Returns the three tabs keyed by name. */
    suspend fun top(): Map<String, List<TopItem>> = withContext(Dispatchers.IO) {
        val out = linkedMapOf("day" to emptyList<TopItem>(), "week" to emptyList(), "month" to emptyList())
        try {
            val html = get("$BASE/home")
            val secStart = html.indexOf("id=\"top-anime\"")
            if (secStart < 0) return@withContext out
            val sec = html.substring(secStart, minOf(secStart + 80000, html.length))
            val markers = Regex("""<div class="tab-content" data-name="(day|week|month)"""").findAll(sec).toList()
            for (i in markers.indices) {
                val name = markers[i].groupValues[1]
                val start = markers[i].range.first
                val end = if (i + 1 < markers.size) markers[i + 1].range.first else sec.length
                val block = sec.substring(start, end)
                val items = mutableListOf<TopItem>()
                for (p in block.split(Regex("""<a class="item""")).drop(1).take(10)) {
                    val href = Regex("""href="([^"]+)"""").find(p)?.groupValues?.get(1) ?: ""
                    val slug = Regex("""/watch/([^"?/]+)""").find(href)?.groupValues?.get(1) ?: continue
                    val poster = Regex("""<img[^>]+src="([^"]+)"""").find(p)?.groupValues?.get(1)
                    val alt = Regex("""alt="([^"]*)"""").find(p)?.groupValues?.get(1) ?: ""
                    val nameM = Regex("""class="name[^"]*"[^>]*>\s*([^<]+?)\s*<""").find(p)?.groupValues?.get(1)
                    val title = (nameM ?: alt).trim().replace("&#039;", "'")
                    if (title.isNotEmpty()) items += TopItem(slug, title, poster)
                }
                out[name] = items
            }
        } catch (e: Exception) { /* offline / layout change */ }
        out
    }

    suspend fun search(query: String): List<SearchResult> = withContext(Dispatchers.IO) {
        val out = mutableListOf<SearchResult>()
        for (page in 1..2) {
            val html = try {
                get("$BASE/filter?keyword=${java.net.URLEncoder.encode(query, "UTF-8")}&page=$page")
            } catch (e: Exception) { break }
            val blocks = html.split(Regex("""<div class="item\s*"""))
            for (i in 1 until blocks.size) {
                val block = blocks[i]
                val slug = Regex("""href="[^"]*/watch/([^/"]+)""").find(block)?.groupValues?.get(1) ?: continue
                val jp = Regex("""data-jp="([^"]+)"""").find(block)?.groupValues?.get(1)?.replace("&#039;", "'")
                val alt = Regex("""<img src="[^"]+" alt="([^"]+)"""").find(block)?.groupValues?.get(1)
                val title = jp ?: alt ?: "Untitled"
                val total = Regex("""class="ep-status total"[^>]*>\s*<span>\s*(\d+)\s*</span>""")
                    .find(block)?.groupValues?.get(1)?.toIntOrNull()
                if (out.none { it.slug == slug }) {
                    out += SearchResult(slug, title, total, parseYear(title))
                }
            }
        }
        out
    }

    suspend fun episodes(slug: String): EpisodeList = withContext(Dispatchers.IO) {
        synchronized(epsCache) {
            epsCache[slug]?.let { (at, v) -> if (System.currentTimeMillis() - at < EPS_TTL_MS) return@withContext v }
        }
        val watchHtml = get("$BASE/watch/$slug")
        val showId = Regex("""id="watch-main"[^>]*data-id="([^"]+)"""").find(watchHtml)?.groupValues?.get(1)
            ?: Regex("""data-id="([^"]+)"""").find(watchHtml)?.groupValues?.get(1)
            ?: throw Exception("no show id on watch page")
        val listJson = get("$BASE/ajax/episode/list/$showId", referer = "$BASE/watch/$slug", xhr = true)
        val listHtml = JSONObject(listJson).optString("result", "")

        val malId = Regex("""data-mal="(\d+)"""").find(listHtml)?.groupValues?.get(1)?.toIntOrNull()

        val episodes = mutableListOf<Episode>()
        for (m in Regex("""<a[^>]+data-id="([^"]+)"[^>]+data-slug="([^"]+)"[^>]*>""").findAll(listHtml)) {
            val tag = m.value
            val dataId = m.groupValues[1]
            val num = Regex("""data-num="([^"]*)"""").find(tag)?.groupValues?.get(1)?.toFloatOrNull() ?: 0f
            val title = Regex("""title="([^"]*)"""").find(tag)?.groupValues?.get(1) ?: "Episode ${num.toInt()}"
            val token = Regex("""data-ids="([^"]*)"""").find(tag)?.groupValues?.get(1) ?: ""
            episodes += Episode(num, title, dataId, token)
        }
        val result = EpisodeList(malId, episodes)
        synchronized(epsCache) { epsCache[slug] = System.currentTimeMillis() to result }
        result
    }

    data class Matched(val source: SearchResult, val list: EpisodeList, val verified: Boolean)

    data class Subtitle(val url: String, val label: String)

    data class Stream(
        val url: String,
        // The segment CDN (nekostream) hotlink-checks Referer against the
        // player origin — ExoPlayer's HTTP factory must send it explicitly.
        val referer: String,
        val subtitles: List<Subtitle>,
        val introStart: Long?, val introEnd: Long?,
        val outroStart: Long?, val outroEnd: Long?,
    )

    private fun enc(s: String) = java.net.URLEncoder.encode(s, "UTF-8")

    /** Resolve a playable HLS stream for one episode. Port of the proven
     *  Capacitor flow: server list → server?get → megaplay iframe →
     *  getSources (same rotating origin as the iframe). */
    suspend fun resolve(slug: String, ep: Episode, preferHardSub: Boolean = false): Stream = withContext(Dispatchers.IO) {
        // Warm cookies the way the site expects.
        runCatching { get("$BASE/watch/$slug") }

        val serversHtml = JSONObject(
            get("$BASE/ajax/server/list?servers=${enc(ep.serversToken)}", referer = "$BASE/watch/$slug", xhr = true),
        ).optString("result", "")

        data class ServerType(val label: String, val linkIds: List<String>)
        val types = Regex("""<div class="type"[^>]*>([\s\S]*?)</ul>\s*</div>""").findAll(serversHtml).map { tm ->
            val body = tm.groupValues[1]
            val label = Regex("""<label[^>]*>([\s\S]*?)</label>""").find(body)
                ?.groupValues?.get(1)?.replace(Regex("<[^>]+>"), "")?.trim() ?: ""
            val ids = Regex("""<li[^>]+data-link-id="([^"]+)"""").findAll(body).map { it.groupValues[1] }.toList()
            ServerType(label, ids)
        }.toList()

        fun isHard(l: String): Boolean {
            val u = l.uppercase()
            return u.contains("H-SUB") || u.contains("H SUB") || u.contains("HARDSUB") || u.contains("HARD SUB") || u.contains("HSUB")
        }
        fun isSoft(l: String) = l.uppercase().contains("SUB") && !isHard(l)

        val target = types.firstOrNull { if (preferHardSub) isHard(it.label) else isSoft(it.label) }
            ?: types.firstOrNull { it.linkIds.isNotEmpty() }
            ?: throw Exception("no stream servers listed")
        val linkId = target.linkIds.firstOrNull() ?: throw Exception("no server link id")
        val actualHard = isHard(target.label)

        val serverGet = JSONObject(get("$BASE/ajax/server?get=${enc(linkId)}", xhr = true))
        val iframeUrl = serverGet.optJSONObject("result")?.optString("url").orEmpty()
        if (iframeUrl.isEmpty()) throw Exception("server iframe URL missing")

        fun skip(obj: JSONObject?, key: String): Pair<Long?, Long?> {
            val o = obj?.optJSONObject(key) ?: return null to null
            val end = o.optLong("end", 0)
            return if (end > 0) o.optLong("start", 0) to end else null to null
        }
        val skipData = serverGet.optJSONObject("result")?.optJSONObject("skip_data")

        // Direct-stream hosts encode the URL in the hash.
        if (iframeUrl.contains("plyr.php") || iframeUrl.contains("mewcdn.online/player/")) {
            val hash = iframeUrl.substringAfter('#', "")
            if (hash.isNotEmpty()) {
                val decoded = String(android.util.Base64.decode(hash, android.util.Base64.DEFAULT))
                val (inS, inE) = skip(skipData, "intro"); val (outS, outE) = skip(skipData, "outro")
                return@withContext Stream(decoded, "$BASE/", emptyList(), inS, inE, outS, outE)
            }
        }

        val megaHtml = get(iframeUrl, referer = "$BASE/")
        val megaId = Regex("""id="megaplay-player"[^>]*data-id="([^"]+)"""").find(megaHtml)?.groupValues?.get(1)
            ?: Regex("""data-id="([^"]+)"""").find(megaHtml)?.groupValues?.get(1)
            ?: throw Exception("megaplay data-id missing")

        // getSources lives on the SAME (rotating) origin as the iframe.
        val playerOrigin = java.net.URI(iframeUrl).let { "${it.scheme}://${it.host}" }
        val src = JSONObject(get("$playerOrigin/stream/getSources?id=$megaId", referer = iframeUrl, xhr = true))

        val streamUrl = src.optJSONObject("sources")?.optString("file").orEmpty()
        if (streamUrl.isEmpty()) throw Exception("stream URL missing in getSources")

        val subs = mutableListOf<Subtitle>()
        if (!actualHard) {
            val tracks = src.optJSONArray("tracks")
            if (tracks != null) for (i in 0 until tracks.length()) {
                val t = tracks.getJSONObject(i)
                if (t.optString("kind") == "captions") {
                    subs += Subtitle(t.optString("file"), t.optString("label", "English"))
                }
            }
        }
        val (inS, inE) = skip(src, "intro").takeIf { it.second != null } ?: skip(skipData, "intro")
        val (outS, outE) = skip(src, "outro").takeIf { it.second != null } ?: skip(skipData, "outro")
        Stream(streamUrl, playerOrigin, subs, inS, inE, outS, outE)
    }

    /**
     * Find the right Anikoto entry for an AniList anime: score by title,
     * verify by MAL id (serial, early-exit), and let a positive verification
     * rescue year-rejected candidates whose lying titles parsed the wrong year.
     */
    suspend fun matchFor(anime: Anime): Matched? {
        val queries = buildList {
            add(anime.title)
            anime.titleRomaji?.let { if (it.lowercase() != anime.title.lowercase()) add(it) }
        }
        val candidates = LinkedHashMap<String, SearchResult>()
        for (q in queries) {
            for (r in runCatching { search(q) }.getOrDefault(emptyList())) {
                candidates.putIfAbsent(r.slug, r)
            }
        }
        if (candidates.isEmpty()) return null

        val airing = anime.status == "RELEASING"
        fun bestScore(r: SearchResult): Int = queries.maxOf {
            Match.score(r.title, r.year, r.episodes, it, anime.year, anime.episodes, airing)
        }

        val yearOk = candidates.values.filter { it.year == null || anime.year == null || Math.abs(it.year - anime.year) <= 3 }
        val scored = yearOk.map { it to bestScore(it) }.filter { it.second >= 20 }.sortedByDescending { it.second }.map { it.first }

        // Title-plausible year-rejects join the verification pool (their year
        // came from the lying title in the first place).
        val rejects = candidates.values
            .filter { it !in yearOk }
            .filter { r -> queries.any { q ->
                val c = Match.norm(r.title); val t = Match.norm(q)
                t.isNotEmpty() && c.isNotEmpty() && (c.contains(t) || t.contains(c))
            } }
            .take(2)

        val pool = (scored.take(3) + rejects).ifEmpty { return null }

        // Serial verification, early exit — one episodes fetch in the common case.
        for ((i, cand) in pool.withIndex()) {
            val list = runCatching { episodes(cand.slug) }.getOrNull() ?: continue
            val mal = list.malId
            if (anime.malId != null && mal == anime.malId) return Matched(cand, list, verified = true)
            if (i == 0 && (anime.malId == null || mal == null)) return Matched(cand, list, verified = false)
            // known-wrong top pick → keep looking for a verified alternative
        }
        // Nothing verified — fall back to the top-scored candidate.
        val top = pool.first()
        val list = runCatching { episodes(top.slug) }.getOrNull() ?: return null
        return Matched(top, list, verified = false)
    }
}
