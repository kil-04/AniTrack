package com.sanjay.anitrack.next.data

internal data class RecommendationSeedCandidate(
    val id: Int,
    val status: String,
    val score: Double?,
    val updatedAt: Long = 0,
    val year: Int?,
)

internal object RecommendationRanking {
    fun classicEraBoost(year: Int?): Double = when (year) {
        in 1980..1989 -> 3.0
        in 1970..1979, in 1990..1999 -> 2.5
        else -> 0.0
    }

    fun classicEraLabel(year: Int?): String? = if (classicEraBoost(year) > 0) {
        "Classic ${(year!! / 10) * 10}s match"
    } else null

    fun selectSeedIds(candidates: List<RecommendationSeedCandidate>, limit: Int = 8): List<Int> {
        if (limit <= 0) return emptyList()
        val eligible = candidates
            .filter { it.id > 0 && (it.status == "completed" || it.status == "watching") }
            .sortedWith(
                compareByDescending<RecommendationSeedCandidate> {
                    (it.score ?: 0.0) * 10 + classicEraBoost(it.year)
                }.thenByDescending { it.updatedAt },
            )
        val selected = mutableListOf<Int>()
        fun add(candidate: RecommendationSeedCandidate?) {
            if (candidate != null && candidate.id !in selected && selected.size < limit) {
                selected += candidate.id
            }
        }
        for (start in listOf(1970, 1980, 1990)) {
            add(eligible.firstOrNull {
                (it.score ?: 0.0) >= 7 && it.year != null && it.year in start..(start + 9)
            })
        }
        eligible.forEach(::add)
        return selected
    }
}
