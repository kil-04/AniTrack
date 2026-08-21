package com.sanjay.anitrack.next.data

import android.util.Log
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
    @Volatile private var activeBase = ""

    private fun bases(): List<String> = RemoteConfig.current().anikoto.baseUrls.map { it.trimEnd('/') }

    private fun base(): String {
        val config = RemoteConfig.current()
        check(config.anikoto.enabled && config.features.anikotoStreaming) {
            "Anikoto is temporarily disabled by the automation configuration."
        }
        val available = bases()
        if (activeBase !in available) activeBase = available.first()
        return activeBase
    }

    private fun route(name: String, values: Map<String, Any> = emptyMap()): String {
        var value = RemoteConfig.current().anikoto.routes[name]
            ?: error("Missing signed Anikoto route: $name")
        Regex("""\{([A-Za-z][A-Za-z0-9]*)\}""").findAll(value).toList().forEach { match ->
            val key = match.groupValues[1]
            val replacement = values[key] ?: error("Missing Anikoto route value: $key")
            value = value.replace(match.value, android.net.Uri.encode(replacement.toString()))
        }
        check(!value.contains('{')) { "Unresolved Anikoto route: $name" }
        return value
    }

    private fun providerUrl(name: String, values: Map<String, Any> = emptyMap()) = base() + route(name, values)

    private fun selector(name: String): String = RemoteConfig.current().anikoto.selectors[name]
        ?: error("Missing signed Anikoto selector: $name")

    private fun extractRouteValue(value: String, routeName: String, key: String): String? {
        val template = RemoteConfig.current().anikoto.routes[routeName] ?: return null
        val marker = "{$key}"
        val at = template.indexOf(marker)
        if (at < 0) return null
        val pattern = Regex(
            Regex.escape(template.substring(0, at)) + "([^/?&#]+)" +
                Regex.escape(template.substring(at + marker.length)),
        )
        val encoded = pattern.find(value)?.groupValues?.get(1) ?: return null
        return runCatching { android.net.Uri.decode(encoded) }.getOrDefault(encoded)
    }

    private fun attribute(tag: String, name: String): String? = Regex(
        "(?:^|\\s)${Regex.escape(name)}\\s*=\\s*([\"'])(.*?)\\1",
        RegexOption.IGNORE_CASE,
    ).find(tag)?.groupValues?.get(2)

    private fun elementAttributeById(html: String, id: String, attribute: String): String? {
        val tag = Regex(
            "<[^>]+\\sid\\s*=\\s*([\"'])${Regex.escape(id)}\\1[^>]*>",
            RegexOption.IGNORE_CASE,
        ).find(html)?.value
        return tag?.let { attribute(it, attribute) }
    }
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
        val subCount: Int? = null,
        val dubCount: Int? = null,
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

    private fun get(url: String, referer: String = "${base()}/", xhr: Boolean = false): String {
        val available = bases()
        val parsed = runCatching { java.net.URI(url) }.getOrNull()
        val origin = parsed?.let { "${it.scheme}://${it.host}" }
        val providerRequest = origin in available
        val ordered = if (providerRequest) listOf(base()) + available.filter { it != base() } else listOf("")
        var lastError: Exception? = null
        for (candidateBase in ordered) {
            val candidateUrl = if (providerRequest && parsed != null) {
                "$candidateBase${parsed.rawPath}${parsed.rawQuery?.let { "?$it" }.orEmpty()}"
            } else url
            val candidateReferer = runCatching {
                val ref = java.net.URI(referer)
                val refOrigin = "${ref.scheme}://${ref.host}"
                if (providerRequest && refOrigin in available) {
                    "$candidateBase${ref.rawPath}${ref.rawQuery?.let { "?$it" }.orEmpty()}"
                } else referer
            }.getOrDefault(referer)
            try {
                val b = Request.Builder().url(candidateUrl)
                    .header("User-Agent", UA)
                    .header("Referer", candidateReferer)
                if (xhr) b.header("X-Requested-With", "XMLHttpRequest")
                http.newCall(b.build()).execute().use { res ->
                    if (!res.isSuccessful) throw Exception("Anikoto ${res.code} for $candidateUrl")
                    val body = res.body?.string() ?: throw Exception("empty body")
                    if (providerRequest) activeBase = candidateBase
                    return body
                }
            } catch (error: Exception) {
                lastError = error
            }
        }
        throw lastError ?: Exception("Every signed Anikoto origin failed")
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
            val html = get(providerUrl("home"))
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
                    val slug = extractRouteValue(href, "watch", "animeId") ?: continue
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
                get(providerUrl("search", mapOf("query" to query, "page" to page)))
            } catch (e: Exception) { break }
            val itemClass = Regex.escape(selector("searchItemClass"))
            val blocks = html.split(Regex("""<div\s+class=["'][^"']*\b$itemClass\b[^"']*["'][^>]*>""", RegexOption.IGNORE_CASE))
            for (i in 1 until blocks.size) {
                val block = blocks[i]
                val href = attribute(block, "href") ?: continue
                val slug = extractRouteValue(href, "watch", "animeId") ?: continue
                val jp = attribute(block, selector("searchTitleAttribute"))?.replace("&#039;", "'")
                val alt = Regex("""<img src="[^"]+" alt="([^"]+)"""").find(block)?.groupValues?.get(1)
                val title = jp ?: alt ?: "Untitled"
                val total = Regex("""class="ep-status total"[^>]*>\s*<span>\s*(\d+)\s*</span>""")
                    .find(block)?.groupValues?.get(1)?.toIntOrNull()
                val sub = Regex("""class="ep-status sub"[^>]*>\s*<span>\s*(\d+)\s*</span>""")
                    .find(block)?.groupValues?.get(1)?.toIntOrNull()
                val dub = Regex("""class="ep-status dub"[^>]*>\s*<span>\s*(\d+)\s*</span>""")
                    .find(block)?.groupValues?.get(1)?.toIntOrNull()
                if (out.none { it.slug == slug }) {
                    out += SearchResult(slug, title, total, parseYear(title), sub, dub)
                }
            }
        }
        out
    }

    suspend fun episodes(slug: String): EpisodeList = withContext(Dispatchers.IO) {
        synchronized(epsCache) {
            epsCache[slug]?.let { (at, v) -> if (System.currentTimeMillis() - at < EPS_TTL_MS) return@withContext v }
        }
        val watchUrl = providerUrl("watch", mapOf("animeId" to slug))
        val watchHtml = get(watchUrl)
        val showId = elementAttributeById(watchHtml, selector("watchContainerId"), selector("showIdAttribute"))
            ?: throw Exception("no show id on watch page")
        val listJson = get(providerUrl("episodeList", mapOf("showId" to showId)), referer = watchUrl, xhr = true)
        val listHtml = JSONObject(listJson).optString("result", "")

        val malId = Regex("""${Regex.escape(selector("malIdAttribute"))}=["'](\d+)["']""", RegexOption.IGNORE_CASE)
            .find(listHtml)?.groupValues?.get(1)?.toIntOrNull()

        val episodes = mutableListOf<Episode>()
        for (m in Regex("""<a\b[^>]*>""", RegexOption.IGNORE_CASE).findAll(listHtml)) {
            val tag = m.value
            val dataId = attribute(tag, selector("episodeIdAttribute")) ?: continue
            if (attribute(tag, selector("episodeSlugAttribute")) == null) continue
            val num = attribute(tag, selector("episodeNumberAttribute"))?.toFloatOrNull() ?: 0f
            val title = Regex("""title="([^"]*)"""").find(tag)?.groupValues?.get(1) ?: "Episode ${num.toInt()}"
            val token = attribute(tag, selector("episodeServersAttribute")) ?: ""
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

    /** Resolve a playable HLS stream for one episode. Port of the proven
     *  Capacitor flow: server list → server?get → megaplay iframe →
     *  getSources (same rotating origin as the iframe). */
    suspend fun resolve(slug: String, ep: Episode, preferHardSub: Boolean = false): Stream = withContext(Dispatchers.IO) {
        // Warm cookies the way the site expects.
        val watchUrl = providerUrl("watch", mapOf("animeId" to slug))
        runCatching { get(watchUrl) }

        val serversHtml = JSONObject(
            get(providerUrl("serverList", mapOf("servers" to ep.serversToken)), referer = watchUrl, xhr = true),
        ).optString("result", "")

        data class ServerType(val label: String, val linkIds: List<String>)
        val types = Regex("""<div class="type"[^>]*>([\s\S]*?)</ul>\s*</div>""").findAll(serversHtml).map { tm ->
            val body = tm.groupValues[1]
            val label = Regex("""<label[^>]*>([\s\S]*?)</label>""").find(body)
                ?.groupValues?.get(1)?.replace(Regex("<[^>]+>"), "")?.trim() ?: ""
            val ids = Regex("""<li\b[^>]*>""", RegexOption.IGNORE_CASE).findAll(body)
                .mapNotNull { attribute(it.value, selector("serverLinkAttribute")) }.toList()
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

        val serverGet = JSONObject(get(providerUrl("serverResolve", mapOf("linkId" to linkId)), xhr = true))
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
                return@withContext Stream(decoded, "${base()}/", emptyList(), inS, inE, outS, outE)
            }
        }

        val megaHtml = get(iframeUrl, referer = "${base()}/")
        val megaId = elementAttributeById(megaHtml, selector("playerContainerId"), selector("playerIdAttribute"))
            ?: throw Exception("megaplay data-id missing")

        // getSources lives on the SAME (rotating) origin as the iframe.
        val playerOrigin = java.net.URI(iframeUrl).let { "${it.scheme}://${it.host}" }
        val src = JSONObject(get("$playerOrigin${route("sources", mapOf("playerId" to megaId))}", referer = iframeUrl, xhr = true))

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
        var successfulSearches = 0
        var lastSearchError: Throwable? = null
        for (q in queries) {
            val result = runCatching { search(q) }
                .onSuccess { successfulSearches++ }
                .onFailure {
                    lastSearchError = it
                    Log.w("AniTrack/Anikoto", "Search failed for '$q': ${it.message}")
                }
            for (r in result.getOrDefault(emptyList())) {
                candidates.putIfAbsent(r.slug, r)
            }
        }
        if (successfulSearches == 0 && lastSearchError != null) {
            throw java.io.IOException("Anikoto search failed: ${lastSearchError?.message}", lastSearchError)
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
        var lastEpisodeError: Throwable? = null
        var successfulEpisodeLists = 0
        for ((i, cand) in pool.withIndex()) {
            val result = runCatching { episodes(cand.slug) }
                .onSuccess { successfulEpisodeLists++ }
                .onFailure {
                    lastEpisodeError = it
                    Log.w("AniTrack/Anikoto", "Episode lookup failed for ${cand.slug}: ${it.message}")
                }
            val list = result.getOrNull() ?: continue
            val mal = list.malId
            if (anime.malId != null && mal == anime.malId) return Matched(cand, list, verified = true)
            if (i == 0 && (anime.malId == null || mal == null)) return Matched(cand, list, verified = false)
            // known-wrong top pick → keep looking for a verified alternative
        }
        // Nothing verified — fall back to the top-scored candidate.
        val top = pool.first()
        val finalResult = runCatching { episodes(top.slug) }
            .onSuccess { successfulEpisodeLists++ }
            .onFailure {
                lastEpisodeError = it
                Log.w("AniTrack/Anikoto", "Fallback episode lookup failed for ${top.slug}: ${it.message}")
            }
        val list = finalResult.getOrNull()
        if (list == null && successfulEpisodeLists == 0 && lastEpisodeError != null) {
            throw java.io.IOException("Anikoto episode lookup failed: ${lastEpisodeError?.message}", lastEpisodeError)
        }
        if (list == null) return null
        return Matched(top, list, verified = false)
    }
}
