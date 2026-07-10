package com.sanjay.anitrack.next.data

/**
 * What the player screen should play — set right before navigating to it.
 * Provider-agnostic: holds enough to resolve either Anikoto or AnimePahe, and
 * exposes a unified [resolve] + [episodeNumbers] so the player stays simple.
 * (Server tokens are large base64 blobs; a singleton beats route-encoding.)
 */
object PlaySession {
    var provider: String = "anikoto"      // "anikoto" | "animepahe"
    var animeId: Int = 0
    var animeTitle: String = ""
    var animeCover: String? = null
    var index: Int = 0
    // Full metadata, set on detail-page launches — enables in-player server
    // switching (matchFor needs title/year/episodes/malId). Null on a bare
    // Continue-Watching resume, where switching is simply disabled.
    var anime: Anime? = null

    // Anikoto
    var slug: String = ""
    var anikotoEps: List<Anikoto.Episode> = emptyList()
    var subType: String = "soft"   // "soft" | "hard" (anikoto only)

    // AnimePahe
    var paheSession: String = ""
    var paheEps: List<Pahe.Episode> = emptyList()

    /** True while the player screen is mounted — drives auto-PiP on Home press. */
    var playerActive: Boolean = false

    data class Resolved(
        val url: String,
        val referer: String,
        // The CDN binds sessions to the browser fingerprint that resolved the
        // stream — the player must present the SAME user agent.
        val userAgent: String,
        val subtitles: List<Anikoto.Subtitle>,
        val introStart: Long?, val introEnd: Long?,
        val outroStart: Long?, val outroEnd: Long?,
    )

    val count: Int get() = if (provider == "animepahe") paheEps.size else anikotoEps.size

    fun episodeNumber(i: Int): Float =
        if (provider == "animepahe") paheEps.getOrNull(i)?.number ?: 0f
        else anikotoEps.getOrNull(i)?.number ?: 0f

    /** The slug/session persisted with progress so Continue Watching can resume
     *  without re-matching. RAW value, same as the desktop app writes to the
     *  sync gist: pahe sessions are UUIDs, anikoto slugs never are — consumers
     *  detect the provider with PAHE_UUID (a "pahe:" prefix broke desktop). */
    fun resumeKey(): String =
        if (provider == "animepahe") paheSession else slug

    /** AnimePahe sessions are full UUIDs; anikoto slugs are never UUID-shaped. */
    val PAHE_UUID = Regex("^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", RegexOption.IGNORE_CASE)

    /** Episode title for side-panel labels (anikoto has real titles; pahe doesn't). */
    fun episodeTitle(i: Int): String? =
        if (provider == "animepahe") null else anikotoEps.getOrNull(i)?.title

    val canSwitchServer: Boolean get() = anime != null

    /**
     * Switch the active server without leaving the player (the desktop app's
     * "SERVERS" buttons). Matches the target provider lazily, then lands on the
     * same EPISODE NUMBER — the two providers index episodes differently.
     * Returns false if the target has no source for this show.
     */
    suspend fun switchProvider(target: String): Boolean {
        if (target == provider) return true
        val a = anime ?: return false
        val currentNum = episodeNumber(index)
        val prevIndex = index
        // Match by episode NUMBER; if that fails (providers number differently),
        // keep the SAME position rather than snapping back to episode 1.
        fun match(nums: List<Float>): Int =
            nums.indexOfFirst { kotlin.math.abs(it - currentNum) < 0.01f }
                .takeIf { it >= 0 } ?: prevIndex.coerceIn(0, (nums.size - 1).coerceAtLeast(0))
        if (target == "animepahe") {
            if (paheEps.isEmpty()) {
                val m = Pahe.matchFor(a) ?: return false
                paheSession = m.source.session
                paheEps = m.episodes
            }
            if (paheEps.isEmpty()) return false
            provider = "animepahe"
            index = match(paheEps.map { it.number })
        } else {
            if (anikotoEps.isEmpty()) {
                val m = Anikoto.matchFor(a) ?: return false
                slug = m.source.slug
                anikotoEps = m.list.episodes
            }
            if (anikotoEps.isEmpty()) return false
            provider = "anikoto"
            index = match(anikotoEps.map { it.number })
        }
        return true
    }

    // Offline single-episode playback (set when launched from Downloads).
    var localFile: String? = null

    suspend fun resolve(i: Int): Resolved {
        localFile?.let { path ->
            // Downloaded HLS — play the local index.m3u8 directly.
            return Resolved(java.io.File(path).toURI().toString(), "", "", emptyList(), null, null, null, null)
        }
        return if (provider == "animepahe") {
            val ep = paheEps[i]
            val links = Pahe.links(paheSession, ep.session)
            if (links.isEmpty()) throw Exception("No stream links found")
            // Highest resolution, prefer the non-dub (jpn) track.
            val best = links.maxByOrNull {
                (it.quality.filter { c -> c.isDigit() }.toIntOrNull() ?: 0) * 10 +
                    (if (!it.audio.lowercase().contains("eng")) 1 else 0)
            }!!
            val s = Pahe.resolveKwik(best.kwik)
            // AnimePahe is hard-subbed — no separate tracks, no provider skip data.
            // UA must match the kwik WebView's (session is fingerprint-bound).
            Resolved(s.url, s.referer, Pahe.MOBILE_UA, emptyList(), null, null, null, null)
        } else {
            val s = Anikoto.resolve(slug, anikotoEps[i], preferHardSub = subType == "hard")
            Resolved(
                s.url, s.referer,
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                s.subtitles, s.introStart, s.introEnd, s.outroStart, s.outroEnd,
            )
        }
    }
}
