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

    // Anikoto
    var slug: String = ""
    var anikotoEps: List<Anikoto.Episode> = emptyList()

    // AnimePahe
    var paheSession: String = ""
    var paheEps: List<Pahe.Episode> = emptyList()

    /** True while the player screen is mounted — drives auto-PiP on Home press. */
    var playerActive: Boolean = false

    data class Resolved(
        val url: String,
        val referer: String,
        val subtitles: List<Anikoto.Subtitle>,
        val introStart: Long?, val introEnd: Long?,
        val outroStart: Long?, val outroEnd: Long?,
    )

    val count: Int get() = if (provider == "animepahe") paheEps.size else anikotoEps.size

    fun episodeNumber(i: Int): Float =
        if (provider == "animepahe") paheEps.getOrNull(i)?.number ?: 0f
        else anikotoEps.getOrNull(i)?.number ?: 0f

    /** The slug/session persisted with progress so Continue Watching can resume
     *  without re-matching. Prefixed by provider so the two never collide. */
    fun resumeKey(): String =
        if (provider == "animepahe") "pahe:$paheSession" else slug

    suspend fun resolve(i: Int): Resolved {
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
            Resolved(s.url, s.referer, emptyList(), null, null, null, null)
        } else {
            val s = Anikoto.resolve(slug, anikotoEps[i])
            Resolved(s.url, s.referer, s.subtitles, s.introStart, s.introEnd, s.outroStart, s.outroEnd)
        }
    }
}
