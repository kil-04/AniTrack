package com.sanjay.anitrack.next.data.providers.connectors.miruro

import org.json.JSONObject

/** Opaque source IDs remain in memory, separate from episode numbers and persisted resume keys. */
internal class MiruroEpisodeChoice(
    val number: Float,
    val episodeId: String,
    val server: String,
    val category: String,
    val title: String?,
) {
    val variantId get() = "$server:$category"
    val label get() = "${server.uppercase()} · ${when (category) {
        "ssub" -> "Soft sub"
        "dub" -> "Dub"
        else -> "Sub"
    }}"
    override fun toString() = "MiruroEpisodeChoice(number=$number, variant=$variantId, id=[redacted])"
}

internal object MiruroCatalogue {
    /** Parse only configured, visible servers. Never infer identities from array indexes. */
    fun choices(anilistId: Int, translation: String, config: JSONObject, payload: JSONObject): List<MiruroEpisodeChoice> {
        require(anilistId > 0 && translation in listOf("sub", "dub"))
        val mapped = payload.optJSONObject("mappings")?.opt("aniId") as? Number
        if (mapped != null && mapped.toDouble() != anilistId.toDouble()) throw MiruroProtocolException("Miruro returned another show's episodes")
        val servers = config.optJSONObject("streaming") ?: throw MiruroProtocolException()
        val providers = payload.optJSONObject("providers") ?: throw MiruroProtocolException()
        if (servers.length() > 32 || providers.length() > 32) throw MiruroProtocolException()
        val order = config.optJSONArray("providerOrder")
        val ordered = (0 until minOf(order?.length() ?: 0, 32)).mapNotNull { order?.opt(it) as? String }
        val keys = (ordered + servers.keys().asSequence().toList().sorted()).distinct()
        return buildList {
            for (server in keys) {
                if (!server.matches(Regex("[a-zA-Z0-9_-]{1,64}"))) continue
                val setting = servers.optJSONObject(server) ?: continue
                if (setting.opt("visible") != true) continue
                val capabilities = setting.optJSONObject("capabilities")
                val categories = if (translation == "dub") listOf("dub") else buildList {
                    if (capabilities?.opt("sub") == true) add("sub")
                    if (capabilities?.opt("ssub") == true) add("ssub")
                }
                if (categories.isEmpty()) continue
                val episodes = providers.optJSONObject(server)?.optJSONObject("episodes")?.optJSONArray(translation) ?: continue
                if (episodes.length() > 5000) throw MiruroProtocolException()
                val seen = mutableSetOf<Float>()
                for (index in 0 until episodes.length()) {
                    val episode = episodes.optJSONObject(index) ?: continue
                    val raw = (episode.opt("number") as? Number)?.toDouble() ?: continue
                    val number = raw.toFloat()
                    if (!raw.isFinite() || raw < 0 || raw > 100_000 || kotlin.math.abs(raw - number.toDouble()) > 0.001) continue
                    val id = episode.opt("id") as? String ?: continue
                    if (id.isBlank() || id.length > 512 || id.any { it.code < 32 || it.code == 127 }) continue
                    if (!seen.add(number)) continue
                    val title = (episode.opt("title") as? String)?.take(300)?.takeIf { it.isNotBlank() }
                    for (category in categories) {
                        if (size >= 10_000) throw MiruroProtocolException()
                        add(MiruroEpisodeChoice(number, id, server, category, title))
                    }
                }
            }
        }
    }
}
