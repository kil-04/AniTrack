package com.sanjay.anitrack.next.data

import org.json.JSONObject

/** An AniList MANGA entry (manga, manhwa, manhua, one-shots and novels). */
data class Manga(
    val id: Int,
    val malId: Int?,
    val title: String,
    val titleRomaji: String?,
    val cover: String?,
    val banner: String?,
    val chapters: Int?,
    val volumes: Int?,
    val status: String?,
    val format: String?,
    val year: Int?,
    val score: Int?, // AniList averageScore, 0-100
    val synopsis: String?,
    val genres: List<String>,
    val popularity: Int? = null,
    val country: String? = null,
    /** Alternative names from AniList, used to match reading sources. */
    val synonyms: List<String> = emptyList(),
) {
    /** "Manhwa" / "Manhua" for Korean and Chinese comics, otherwise the AniList format. */
    val kind: String?
        get() = when {
            format == "MANGA" && country == "KR" -> "Manhwa"
            format == "MANGA" && country == "CN" -> "Manhua"
            format == "MANGA" -> "Manga"
            format == "ONE_SHOT" -> "One-shot"
            format == "NOVEL" -> "Light novel"
            else -> null
        }

    companion object {
        fun fromMedia(m: JSONObject): Manga {
            val title = m.optJSONObject("title")
            // org.json's optString returns the literal "null" for JSON null values.
            fun JSONObject?.str(key: String): String? {
                if (this == null || isNull(key)) return null
                val v = optString(key)
                return if (v.isBlank() || v == "null") null else v
            }
            fun JSONObject.int(key: String): Int? = if (isNull(key) || !has(key)) null else optInt(key)
            val genres = buildList {
                val g = m.optJSONArray("genres")
                if (g != null) for (i in 0 until g.length()) add(g.getString(i))
            }
            val synonyms = buildList {
                val s = m.optJSONArray("synonyms")
                if (s != null) for (i in 0 until minOf(s.length(), 20)) {
                    s.optString(i).takeIf { it.isNotBlank() && it != "null" }?.let(::add)
                }
            }
            val english = title.str("english")
            val romaji = title.str("romaji")
            return Manga(
                id = m.getInt("id"),
                malId = m.int("idMal"),
                title = english ?: romaji ?: title.str("native") ?: "Unknown",
                titleRomaji = romaji,
                cover = m.optJSONObject("coverImage").str("large"),
                banner = m.str("bannerImage"),
                chapters = m.int("chapters"),
                volumes = m.int("volumes"),
                status = m.str("status"),
                format = m.str("format"),
                year = m.optJSONObject("startDate")?.int("year"),
                score = m.int("averageScore"),
                synopsis = cleanDescription(m.str("description")),
                genres = genres,
                popularity = m.int("popularity"),
                country = m.str("countryOfOrigin"),
                synonyms = synonyms,
            )
        }
    }
}
