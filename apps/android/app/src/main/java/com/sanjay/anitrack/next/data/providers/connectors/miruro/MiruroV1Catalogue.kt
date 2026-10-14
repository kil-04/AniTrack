package com.sanjay.anitrack.next.data.providers.connectors.miruro

import com.sanjay.anitrack.next.data.providers.SkipRange
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject

internal class MiruroV1Episode(
    val number: Float,
    val coordinate: Double,
    val title: String?,
    val intro: SkipRange?,
    val outro: SkipRange?,
)

/** Coordinates only identify a choice. Expiring media values are never retained by the adapter. */
internal class MiruroV1Choice(
    val track: String,
    val provider: String,
    val server: String,
    val occurrence: Int,
    val media: MiruroMedia,
    val headers: Map<String, String>,
) {
    val variantId get() = "$track:$provider:$server:$occurrence"
    val label get() = "${provider.uppercase()} · $server · ${when (track) { "ssub" -> "Soft sub"; "dub" -> "Dub"; else -> "Sub" }}"
    override fun toString() = "MiruroV1Choice(variant=$variantId, media=[redacted])"
}

internal object MiruroV1Catalogue {
    fun show(payload: JSONObject, anilistId: Int): String {
        val data = payload.optJSONArray("data") ?: invalid("Miruro lookup was incomplete")
        if (data.length() > 100 || payload.opt("has_more") == true) invalid("Miruro lookup was incomplete")
        val matches = (0 until data.length()).mapNotNull(data::optJSONObject).filter { show ->
            val ids = show.optJSONObject("external_ids")?.optJSONArray("anilist") ?: return@filter false
            ids.length() <= 64 && (0 until ids.length()).any { index ->
                val value = ids.opt(index)
                value is String && value == anilistId.toString() || value is Number && value.toString() == anilistId.toString()
            }
        }
        if (matches.size != 1) invalid("Miruro show identity could not be verified unambiguously")
        return (matches.single().opt("id") as? String)?.takeIf { Regex("[A-Za-z0-9_-]{1,256}").matches(it) }
            ?: invalid("Invalid Miruro catalogue reference")
    }

    fun episodes(payload: JSONObject): List<MiruroV1Episode> {
        val data = payload.optJSONArray("data") ?: invalid("Miruro episode catalogue was incomplete")
        if (data.length() > 10_000 || payload.opt("has_more") == true) invalid("Miruro episode catalogue was incomplete")
        val seen = mutableSetOf<Float>()
        return (0 until data.length()).mapNotNull { index ->
            val episode = data.optJSONObject(index) ?: return@mapNotNull null
            val coordinate = (episode.opt("episode_number") as? Number)?.toDouble() ?: return@mapNotNull null
            if (!coordinate.isFinite() || coordinate !in 0.0..100_000.0) return@mapNotNull null
            val number = coordinate.toFloat()
            if (kotlin.math.abs(number.toDouble() - coordinate) > 0.001 || !seen.add(number))
                invalid("Miruro returned conflicting episode identities")
            val ranges = episode.optJSONArray("skip_times")
            var intro: SkipRange? = null
            var outro: SkipRange? = null
            for (i in 0 until minOf(ranges?.length() ?: 0, 10)) {
                val range = ranges?.optJSONObject(i) ?: continue
                val start = (range.opt("start_seconds") as? Number)?.toDouble() ?: continue
                val end = (range.opt("end_seconds") as? Number)?.toDouble() ?: continue
                if (!start.isFinite() || !end.isFinite() || start < 0 || end <= start || end > 86_400 || end.toLong() <= start.toLong()) continue
                val skip = SkipRange(start.toLong(), end.toLong())
                when (range.optString("kind")) {
                    "intro", "opening" -> if (intro == null) intro = skip
                    "outro", "ending" -> if (outro == null) outro = skip
                }
            }
            MiruroV1Episode(number, coordinate, (episode.opt("title") as? String)?.take(300)?.takeIf { it.isNotBlank() }, intro, outro)
        }.sortedBy { it.number }
    }

    fun choices(payload: JSONObject, episodeNumber: Double): List<MiruroV1Choice> {
        val actualNumber = (payload.opt("episode_number") as? Number)?.toDouble()
        val tracks = payload.optJSONArray("tracks")
        if (actualNumber != episodeNumber || tracks == null || tracks.length() > 3)
            invalid("Miruro returned another episode or an unsupported playback catalogue")
        val occurrences = mutableMapOf<String, Int>()
        return buildList {
            for (i in 0 until tracks.length()) {
                val track = tracks.optJSONObject(i) ?: continue
                val category = track.optString("track")
                if (category !in setOf("sub", "ssub", "dub")) continue
                val providers = track.optJSONArray("providers") ?: invalid("Miruro returned an invalid provider list")
                if (providers.length() > 32) invalid("Miruro returned too many providers")
                for (j in 0 until providers.length()) {
                    val provider = providers.optJSONObject(j) ?: continue
                    val id = provider.opt("provider") as? String ?: continue
                    if (!Regex("[A-Za-z0-9_-]{1,64}").matches(id)) continue
                    val servers = provider.optJSONArray("servers") ?: invalid("Miruro returned an invalid server list")
                    if (servers.length() > 32) invalid("Miruro returned too many servers")
                    for (k in 0 until servers.length()) {
                        val server = servers.optJSONObject(k) ?: continue
                        val name = server.opt("server") as? String ?: continue
                        if (!Regex("[A-Za-z0-9 _.-]{1,100}").matches(name)) continue
                        val identity = "$category:$id:$name"
                        val occurrence = occurrences[identity] ?: 0
                        if (occurrence > 31) invalid("Miruro returned too many duplicate server identities")
                        occurrences[identity] = occurrence + 1
                        val headers = headers(if (server.has("headers")) server.opt("headers") else JSONObject()) ?: continue
                        val rawStreams = server.optJSONArray("streams") ?: continue
                        if (rawStreams.length() > 32) continue
                        val streams = JSONArray()
                        for (s in 0 until rawStreams.length()) {
                            val stream = rawStreams.optJSONObject(s) ?: continue
                            if (stream.has("embed") && stream.opt("embed") !in listOf(null, JSONObject.NULL, false)) continue
                            streams.put(JSONObject().put("url", stream.opt("url"))
                                .put("type", stream.opt("format")).put("referer", headers["Referer"].orEmpty())
                                .put("default", stream.opt("default")))
                        }
                        val subtitles = JSONArray()
                        val rawSubtitles = provider.optJSONArray("subtitles")
                        for (s in 0 until minOf(rawSubtitles?.length() ?: 0, 32)) {
                            val raw = rawSubtitles?.optJSONObject(s) ?: continue
                            val sub = JSONObject(raw.toString()).put("file", (raw.opt("url") as? String) ?: (raw.opt("file") as? String))
                            subtitles.put(sub)
                        }
                        val media = MiruroMediaParser.directMedia(JSONObject().put("streams", streams).put("subtitles", subtitles)).firstOrNull() ?: continue
                        if (size >= 256) invalid("Miruro returned too many direct server choices")
                        add(MiruroV1Choice(category, id, name, occurrence, media, headers))
                    }
                }
            }
        }
    }

    private fun headers(value: Any?): Map<String, String>? {
        val input = value as? JSONObject ?: return null
        if (input.length() > 2) return null
        val output = mutableMapOf<String, String>()
        for (name in input.keys()) {
            if (name.lowercase() !in setOf("referer", "origin")) return null
            if (output.containsKey(if (name.equals("origin", true)) "Origin" else "Referer")) return null
            val url = MiruroMediaParser.https(input.opt(name) as? String) ?: return null
            if (name.equals("origin", true)) {
                val parsed = url.toHttpUrlOrNull() ?: return null
                val origin = "https://${parsed.host}"
                if (url != "$origin/") return null
                output["Origin"] = origin
            } else output["Referer"] = url
        }
        return output
    }

    private fun invalid(message: String): Nothing = throw MiruroProtocolException(message)
}
