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
) {
    companion object {
        fun fromMedia(m: JSONObject): Anime {
            val title = m.optJSONObject("title")
            val genres = buildList {
                val g = m.optJSONArray("genres")
                if (g != null) for (i in 0 until g.length()) add(g.getString(i))
            }
            val english = title?.optString("english").orEmpty()
            val romaji = title?.optString("romaji").orEmpty()
            return Anime(
                id = m.getInt("id"),
                malId = if (m.isNull("idMal")) null else m.getInt("idMal"),
                title = english.ifEmpty { romaji.ifEmpty { "Unknown" } },
                titleRomaji = romaji.ifEmpty { null },
                cover = m.optJSONObject("coverImage")?.optString("large"),
                banner = if (m.isNull("bannerImage")) null else m.optString("bannerImage"),
                episodes = if (m.isNull("episodes")) null else m.getInt("episodes"),
                status = if (m.isNull("status")) null else m.optString("status"),
                format = if (m.isNull("format")) null else m.optString("format"),
                year = if (m.isNull("seasonYear")) null else m.getInt("seasonYear"),
                score = if (m.isNull("averageScore")) null else m.getInt("averageScore"),
                synopsis = if (m.isNull("description")) null
                           else m.optString("description").replace(Regex("<[^>]+>"), "").trim(),
                genres = genres,
            )
        }
    }
}
