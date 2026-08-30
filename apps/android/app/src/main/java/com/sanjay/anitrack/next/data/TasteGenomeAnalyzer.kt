package com.sanjay.anitrack.next.data

import kotlin.math.min
import kotlin.math.log2
import kotlin.math.roundToInt

data class TasteGenomeInput(
    val status: String,
    val score: Double?,
    val year: Int?,
    val genres: List<String>,
    val format: String?,
)

data class TasteAffinity(
    val key: String,
    val label: String,
    val count: Int,
    val averageScore: Double?,
    val strength: Int,
)

data class TasteGenome(
    val analyzed: Int,
    val rated: Int,
    val meanScore: Double?,
    val classicShare: Int,
    val confidence: Int,
    val archetype: String,
    val summary: String,
    val eras: List<TasteAffinity>,
    val genres: List<TasteAffinity>,
    val formats: List<TasteAffinity>,
)

object TasteGenomeAnalyzer {
    private data class Bucket(
        val key: String,
        val label: String,
        var count: Int = 0,
        var weight: Double = 0.0,
        var scoreTotal: Double = 0.0,
        var rated: Int = 0,
    )

    private val formatLabels = mapOf(
        "TV" to "TV Series", "TV_SHORT" to "TV Shorts", "MOVIE" to "Films",
        "OVA" to "OVAs", "ONA" to "ONAs", "SPECIAL" to "Specials", "MUSIC" to "Music",
    )

    private fun weight(entry: TasteGenomeInput): Double {
        val statusWeight = when (entry.status) {
            "completed" -> 1.0
            "watching" -> 0.85
            "on_hold" -> 0.35
            "dropped" -> 0.15
            else -> 0.0
        }
        if (statusWeight == 0.0) return 0.0
        val ratingWeight = entry.score?.takeIf { it > 0 }?.let { 0.55 + it / 10.0 } ?: 0.75
        return statusWeight * ratingWeight
    }

    private fun add(map: MutableMap<String, Bucket>, key: String, label: String, entry: TasteGenomeInput, weight: Double) {
        val bucket = map.getOrPut(key) { Bucket(key, label) }
        bucket.count++
        bucket.weight += weight
        entry.score?.takeIf { it > 0 }?.let { bucket.scoreTotal += it; bucket.rated++ }
    }

    private fun finish(
        map: Map<String, Bucket>,
        limit: Int,
        rankScore: (Bucket) -> Double = { it.weight },
    ): List<TasteAffinity> {
        val ranked = map.values.map { it to rankScore(it) }
            .sortedWith(compareByDescending<Pair<Bucket, Double>> { it.second }
                .thenByDescending { it.first.count }
                .thenBy { it.first.label })
            .take(limit)
        val strongest = ranked.firstOrNull()?.second ?: 1.0
        return ranked.map { (bucket, score) ->
            TasteAffinity(
                bucket.key, bucket.label, bucket.count,
                if (bucket.rated > 0) (bucket.scoreTotal / bucket.rated * 100).roundToInt() / 100.0 else null,
                (score / strongest * 100).roundToInt(),
            )
        }
    }

    /** Decades measure preference rather than raw consumption volume. */
    private fun eraPreferenceScore(bucket: Bucket): Double {
        if (bucket.rated == 0) return 5.0 * 0.35 + log2((bucket.count + 1).toDouble()) * 0.15
        val averageRating = bucket.scoreTotal / bucket.rated
        val evidence = 0.72 + min(1.0, bucket.rated / 10.0) * 0.28
        return averageRating * evidence + log2((bucket.count + 1).toDouble()) * 0.15
    }

    fun analyze(entries: List<TasteGenomeInput>): TasteGenome {
        val watched = entries.filter { weight(it) > 0 }
        val eras = linkedMapOf<String, Bucket>()
        val genres = linkedMapOf<String, Bucket>()
        val formats = linkedMapOf<String, Bucket>()
        var rated = 0
        var scoreTotal = 0.0
        var classic = 0

        watched.forEach { entry ->
            val weight = weight(entry)
            entry.score?.takeIf { it > 0 }?.let { rated++; scoreTotal += it }
            entry.year?.let { year ->
                val decade = year / 10 * 10
                add(eras, decade.toString(), "${decade}s", entry, weight)
                if (year < 2000) classic++
            }
            entry.genres.distinct().forEach { add(genres, it.lowercase(), it, entry, weight) }
            entry.format?.let { add(formats, it, formatLabels[it] ?: it, entry, weight) }
        }

        val eraResults = finish(eras, 6, ::eraPreferenceScore)
        val genreResults = finish(genres, 8)
        val formatResults = finish(formats, 5)
        val leadEra = eraResults.firstOrNull()?.label
        val leadGenre = genreResults.firstOrNull()?.label
        val classicShare = if (watched.isEmpty()) 0 else (classic.toDouble() / watched.size * 100).roundToInt()
        val archetype = when {
            leadEra != null && leadGenre != null -> "$leadEra $leadGenre ${if (leadEra.take(4).toInt() < 2000) "Archivist" else "Explorer"}"
            leadGenre != null -> "$leadGenre Explorer"
            leadEra != null -> "$leadEra Time Traveller"
            else -> "Uncharted Viewer"
        }
        val summary = if (leadEra != null && leadGenre != null) {
            "Your strongest signal comes from ${leadGenre.lowercase()} anime of the $leadEra, with $classicShare% of your watched taste rooted before 2000."
        } else if (watched.isNotEmpty()) {
            "Your taste signal is forming as more list metadata is collected."
        } else "Watch or complete anime to reveal your taste signal."
        val metadataPoints = watched.sumOf { (if (it.year != null) 1 else 0) + (if (it.genres.isNotEmpty()) 1 else 0) + (if (it.format != null) 1 else 0) }
        val confidence = if (watched.isEmpty()) 0 else min(100, (min(1.0, watched.size / 80.0) * 0.55 + metadataPoints.toDouble() / (watched.size * 3) * 0.45).times(100).roundToInt())

        return TasteGenome(
            watched.size, rated,
            if (rated > 0) (scoreTotal / rated * 100).roundToInt() / 100.0 else null,
            classicShare, confidence, archetype, summary, eraResults, genreResults, formatResults,
        )
    }
}
