package com.sanjay.anitrack.next.data

import org.json.JSONObject

data class Anime(
    val id: Int,
    val malId: Int?,
    val title: String,
    val titleRomaji: String?,
    val cover: String?,
    val banner: String?,
    val episodes: Int?,
    val status: String?,
    val format: String?,
    val year: Int?,
    val score: Int?, // AniList averageScore, 0-100
    val synopsis: String?,
    val genres: List<String>,
    val duration: Int? = null,
    val popularity: Int? = null,
    val studios: List<String> = emptyList(),
) {
    companion object {
        fun fromMedia(m: JSONObject): Anime {
            val title = m.optJSONObject("title")
            // org.json's optString returns the literal "null" for JSON null values,
            // which leaked into titles/covers — normalize those away.
            fun JSONObject?.str(key: String): String? {
                if (this == null || isNull(key)) return null
                val v = optString(key)
                return if (v.isBlank() || v == "null") null else v
            }
            val genres = buildList {
                val g = m.optJSONArray("genres")
                if (g != null) for (i in 0 until g.length()) add(g.getString(i))
            }
            val studios = buildList {
                val nodes = m.optJSONObject("studios")?.optJSONArray("nodes")
                if (nodes != null) for (i in 0 until nodes.length()) {
                    nodes.optJSONObject(i)?.str("name")?.let(::add)
                }
            }
            val english = title.str("english")
            val romaji = title.str("romaji")
            return Anime(
                id = m.getInt("id"),
                malId = if (m.isNull("idMal")) null else m.getInt("idMal"),
                title = english ?: romaji ?: title.str("native") ?: "Unknown",
                titleRomaji = romaji,
                cover = m.optJSONObject("coverImage").str("large"),
                banner = m.str("bannerImage"),
                episodes = if (m.isNull("episodes")) null else m.getInt("episodes"),
                status = m.str("status"),
                format = m.str("format"),
                year = if (m.isNull("seasonYear")) null else m.getInt("seasonYear"),
                score = if (m.isNull("averageScore")) null else m.getInt("averageScore"),
                synopsis = m.str("description")?.replace(Regex("<[^>]+>"), "")?.trim(),
                genres = genres,
                duration = if (m.isNull("duration")) null else m.optInt("duration"),
                popularity = if (m.isNull("popularity")) null else m.optInt("popularity"),
                studios = studios,
            )
        }
    }
}
