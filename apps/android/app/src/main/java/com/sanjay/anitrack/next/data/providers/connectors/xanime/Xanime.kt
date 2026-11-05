package com.sanjay.anitrack.next.data.providers.connectors.xanime

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder

/** An Xanime answer that isn't a usable stream; the message is safe to show. */
class XanimeException(message: String, val notFound: Boolean = false) : Exception(message)

/**
 * Xanime (xanime.me): read from each page's Qwik server state (`<script type="qwik/json">`)
 * without running site code. Mirrors packages/shared/xanime.ts; keep the two identical.
 * Search and title pages give each show's AniList/MAL ids, totals and latest episode; an
 * episode page lists the 50-episode page holding it and carries that episode's streams.
 */
object Xanime {
    const val ORIGIN = "https://xanime.me"
    val HOSTS = setOf("xanime.me")
    const val EPISODES_PER_PAGE = 50
    private const val MAX_ID = 2_147_483_647L
    private val ID = Regex("^[1-9][0-9]{0,9}$")
    private val MEDIA_HOST = Regex("^xanivsrc\\d{1,3}\\.org$")
    private val REF = Regex("^[0-9a-z]{1,6}!?$")
    private val STATE = Regex("<script type=\"qwik/json\">([\\s\\S]*?)</script>")

    data class Show(
        val id: String,
        val anilistId: Int?,
        val malId: Int?,
        val title: String,
        val poster: String?,
        val year: Int?,
        val type: String?,
        val episodes: Int?,
        val subCount: Int?,
        val dubCount: Int?,
        val latestEpisodeId: String?,
        val adult: Boolean,
    )

    data class Episode(val id: String, val number: Float, val title: String)
    data class EpisodeList(val show: Show?, val episodes: List<Episode>, val total: Int?)
    data class Subtitle(val file: String, val label: String, val kind: String, val default: Boolean)
    data class Skip(val start: Int, val end: Int)
    data class Stream(
        val id: String,
        val episodeId: String,
        val language: String,
        val server: String?,
        val url: String,
        val subtitles: List<Subtitle>,
        val intro: Skip?,
        val outro: Skip?,
    )

    fun isId(value: String?): Boolean = value != null && ID.matches(value) && value.toLong() <= MAX_ID

    fun searchUrl(query: String) = "$ORIGIN/search?word=" + URLEncoder.encode(query.trim().take(100), "UTF-8").replace("+", "%20")
    fun titleUrl(showId: String) = "$ORIGIN/title/$showId"
    fun episodeUrl(showId: String, episodeId: String) = "$ORIGIN/title/$showId/$episodeId"

    /** A stream or caption AniTrack may load: https on an xanivsrc host, under /media/. */
    fun isMediaUrl(raw: String): Boolean = runCatching {
        val uri = URI(raw)
        uri.scheme == "https" && uri.rawUserInfo == null && (uri.port == -1 || uri.port == 443) &&
            MEDIA_HOST.matches(uri.host.orEmpty()) && uri.path.startsWith("/media/") && !uri.path.contains("..")
    }.getOrDefault(false)

    // ── Qwik server state ─────────────────────────────────────────────────────
    // `objs` is a flat array; inside an object or array every value is a reference: the
    // base-36 index of another `objs` entry, sometimes followed by "!".

    private class State(private val objs: JSONArray) {
        fun ref(value: Any?): Any? {
            if (value !is String || !REF.matches(value)) return null
            val index = value.trimEnd('!').toIntOrNull(36) ?: return null
            return if (index < objs.length()) objs.opt(index).takeIf { it != JSONObject.NULL } else null
        }

        fun field(o: JSONObject, key: String): Any? = if (o.has(key)) ref(o.opt(key)) else null

        fun text(o: JSONObject, key: String): String? = when (val v = field(o, key)) {
            is Number -> if (v is Double || v is Float) v.toString() else v.toLong().toString()
            is String -> v.takeIf { it.isEmpty() || it[0].code >= 0x20 }
            else -> null
        }

        fun int(o: JSONObject, key: String): Int? = when (val v = field(o, key)) {
            is Int -> v
            is Long -> v.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
            is Double -> v.takeIf { it == Math.floor(it) && it in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble() }?.toInt()
            is String -> v.takeIf { Regex("^-?\\d{1,10}$").matches(it) }?.toLongOrNull()?.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
            else -> null
        }

        fun obj(value: Any?): JSONObject? = ref(value) as? JSONObject

        fun list(o: JSONObject, key: String): List<Any?> {
            val v = field(o, key) as? JSONArray ?: return emptyList()
            return (0 until minOf(v.length(), 500)).map { v.opt(it) }
        }

        fun objectsWith(vararg keys: String): List<JSONObject> =
            (0 until objs.length()).mapNotNull { objs.opt(it) as? JSONObject }.filter { o -> keys.all(o::has) }

        companion object {
            fun parse(html: String): State? {
                val raw = STATE.find(html)?.groupValues?.get(1) ?: return null
                return try {
                    JSONObject(raw).optJSONArray("objs")?.let(::State)
                } catch (_: JSONException) {
                    null
                }
            }
        }
    }

    private fun positive(n: Int?) = n?.takeIf { it > 0 }

    private fun available(state: State, counts: JSONObject?, language: String): Int? {
        val entry = counts?.let { state.obj(it.opt(language)) } ?: return null
        return positive(state.int(entry, "downloaded"))
    }

    private fun show(state: State, o: JSONObject): Show? {
        val id = state.text(o, "ani_id")
        val title = state.text(o, "info_title")?.trim()
        if (!isId(id) || title.isNullOrEmpty()) return null
        // { sub: { downloaded: 26 }, dub: { downloaded: 26 } }
        val counts = state.obj(o.opt("info_sou_counts"))
        val type = state.list(o, "info_meta_type").map(state::ref).filterIsInstance<String>().firstOrNull()
        val year = state.int(o, "info_meta_year")
        val latest = state.text(o, "ep_up_id")
        val poster = state.text(o, "urlCover600") ?: state.text(o, "urlCoverOri")
        return Show(
            id = id!!,
            anilistId = positive(state.int(o, "al_id")),
            malId = positive(state.int(o, "ani_id_mal")),
            title = title.take(300),
            poster = poster?.takeIf { it.startsWith("https://") },
            year = year?.takeIf { it in 1901..2099 },
            type = type?.uppercase()?.take(20),
            episodes = positive(state.int(o, "ep_total")),
            subCount = available(state, counts, "sub"),
            dubCount = available(state, counts, "dub"),
            latestEpisodeId = latest?.takeIf(::isId),
            adult = state.field(o, "info_meta_rating_nsfw") == true,
        )
    }

    /** Every show a page describes (search results, or a title or episode page's own show), once each. */
    fun shows(html: String): List<Show> {
        val state = State.parse(html) ?: return emptyList()
        val seen = HashSet<String>()
        val out = ArrayList<Show>()
        for (o in state.objectsWith("ani_id", "info_title", "al_id")) {
            val show = show(state, o) ?: continue
            if (seen.add(show.id)) out += show
            if (out.size >= 60) break
        }
        return out
    }

    fun show(html: String, showId: String): Show? = shows(html).firstOrNull { it.id == showId }

    /** An episode page's episode list (the 50-episode page holding it), ascending, and the show's total. */
    fun episodes(html: String, showId: String): EpisodeList {
        val state = State.parse(html) ?: return EpisodeList(null, emptyList(), null)
        val byId = LinkedHashMap<String, Episode>()
        for (o in state.objectsWith("ep_id", "ep_index", "epPath")) {
            if (state.text(o, "ani_id") != showId) continue
            val id = state.text(o, "ep_id")?.takeIf(::isId) ?: continue
            val index = state.int(o, "ep_index")?.takeIf { it in 0..100_000 } ?: continue
            val part = state.int(o, "ep_sub_index") ?: 0
            val number = if (part in 1..9) index + part / 10f else index.toFloat()
            val label = if (number % 1f == 0f) number.toInt().toString() else number.toString()
            val title = state.text(o, "ep_title")?.trim().orEmpty().ifEmpty { "Episode $label" }
            byId[id] = Episode(id, number, title.take(200))
        }
        val show = show(html, showId)
        return EpisodeList(show, byId.values.sortedBy { it.number }, show?.episodes)
    }

    /** The episode's streams, Sub first, each with its captions and skip times. */
    fun streams(html: String, episodeId: String): List<Stream> {
        val state = State.parse(html) ?: return emptyList()
        val out = ArrayList<Stream>()
        val seen = HashSet<String>()
        for (o in state.objectsWith("sou_id", "src_type", "souPath")) {
            val id = state.text(o, "sou_id")
            val language = state.text(o, "src_type")
            val url = state.text(o, "souPath")
            if (state.text(o, "ep_id") != episodeId || !isId(id) || id in seen) continue
            if ((language != "sub" && language != "dub") || url == null || !isMediaUrl(url)) continue
            seen += id!!
            val subtitles = ArrayList<Subtitle>()
            for (ref in state.list(o, "track")) {
                val track = state.obj(ref) ?: continue
                val file = state.text(track, "trackPath")?.takeIf(::isMediaUrl) ?: continue
                if (subtitles.any { it.file == file }) continue
                subtitles += Subtitle(
                    file = file,
                    label = (state.text(track, "label") ?: "English").take(60),
                    kind = if (state.text(track, "kind") == "subtitles") "subtitles" else "captions",
                    default = state.field(track, "default") == true,
                )
            }
            val jump = state.obj(o.opt("jump"))
            fun skip(key: String): Skip? {
                val range = jump?.let { state.obj(it.opt(key)) } ?: return null
                val start = state.int(range, "start") ?: return null
                val end = state.int(range, "end") ?: return null
                return if (start >= 0 && end > start && end < 24 * 3600) Skip(start, end) else null
            }
            val name = state.text(o, "src_name")?.trim().orEmpty()
            out += Stream(
                id = id,
                episodeId = episodeId,
                language = language,
                // Bebop's servers are just "1"; current shows name theirs ("Vidplay").
                server = name.takeIf { it.isNotEmpty() && !Regex("^\\d{1,3}$").matches(it) }?.take(40),
                url = url,
                subtitles = subtitles.take(16),
                intro = skip("intro"),
                outro = skip("outro"),
            )
        }
        return out.sortedBy { if (it.language == "dub") 1 else 0 }
    }

    /** A stream's choice label: "Sub", "Dub · Vidplay", "Sub 2" when one language has several. */
    fun label(stream: Stream, all: List<Stream>): String {
        val same = all.filter { it.language == stream.language }
        val base = if (stream.language == "dub") "Dub" else "Sub"
        if (stream.server != null) return "$base · ${stream.server}"
        return if (same.size > 1) "$base ${same.indexOf(stream) + 1}" else base
    }
}
