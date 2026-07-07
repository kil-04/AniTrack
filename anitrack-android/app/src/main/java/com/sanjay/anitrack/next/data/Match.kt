package com.sanjay.anitrack.next.data

// Port of src/lib/match.ts — title scoring shared by all provider matching.

object Match {
    private val romanMap = mapOf(
        "i" to 1, "ii" to 2, "iii" to 3, "iv" to 4, "v" to 5,
        "vi" to 6, "vii" to 7, "viii" to 8, "ix" to 9, "x" to 10,
    )

    fun seasonNumber(title: String): Int? {
        val clean = title.lowercase()
        Regex("""\b(season|ss|part|cour)\s+(\d+|ii|iii|iv|v|vi|vii|viii|ix|x)\b""").find(clean)?.let { m ->
            val v = m.groupValues[2]
            return v.toIntOrNull() ?: romanMap[v]
        }
        Regex("""\b(\d+)(st|nd|rd|th)\s+(season|part|ss|cour)\b""").find(clean)?.let {
            return it.groupValues[1].toIntOrNull()
        }
        Regex("""\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b\s*$""").find(clean)?.let {
            return romanMap[it.groupValues[1]]
        }
        Regex("""\b(\d+)\b\s*$""").find(clean)?.let {
            return it.groupValues[1].toIntOrNull()
        }
        return null
    }

    fun norm(s: String): String =
        s.lowercase().replace(Regex("[^a-z0-9]"), " ").replace(Regex("\\s+"), " ").trim()

    fun score(
        candidateTitle: String,
        candidateYear: Int?,
        candidateEpisodes: Int?,
        targetTitle: String,
        targetYear: Int?,
        targetEpisodes: Int?,
        targetAiring: Boolean,
    ): Int {
        val t = norm(targetTitle)
        val c = norm(candidateTitle)
        var score = 0
        when {
            c == t -> score += 100
            c.contains(t) || t.contains(c) -> {
                val ratio = minOf(c.length, t.length).toDouble() / maxOf(c.length, t.length)
                score += Math.round(40 * ratio).toInt()
            }
            else -> {
                val tw = t.split(" ").toSet()
                val cw = c.split(" ")
                val overlap = cw.count { it in tw }
                score += Math.round(overlap.toDouble() / maxOf(tw.size, cw.size) * 30).toInt()
            }
        }
        // Prefix bonus (season-suffix variants still share the first words).
        val ta = t.split(" ")
        val ca = c.split(" ")
        var prefix = 0
        for (i in 0 until minOf(3, ta.size, ca.size)) {
            if (ta[i] == ca[i]) prefix++ else break
        }
        if (prefix >= 2) score += prefix * 10

        if (targetYear != null && candidateYear != null) {
            when (val diff = Math.abs(candidateYear - targetYear)) {
                0 -> score += 8
                1 -> score += 2
                2, 3 -> score -= 30
                else -> return -100
            }
        }

        val cs = seasonNumber(candidateTitle) ?: 1
        val ts = seasonNumber(targetTitle) ?: 1
        if (cs != ts) score -= 50

        if (targetEpisodes != null && candidateEpisodes != null) {
            val diff = Math.abs(candidateEpisodes - targetEpisodes)
            if (diff > 0 && !(targetAiring && candidateEpisodes < targetEpisodes)) {
                score -= when {
                    diff <= 1 -> 2
                    diff <= 3 -> 5
                    else -> 40
                }
            }
        }
        return score
    }
}
