package com.sanjay.anitrack.next.data

data class AnimeEra(
    val start: Int,
    val end: Int,
    val label: String,
    val headline: String,
    val atmosphere: String,
    val accent: Long,
)

object TimeMachineArchive {
    val eras = listOf(
        AnimeEra(1960, 1969, "1960s", "The television frontier", "Limited animation became a new visual language as weekly anime found its identity.", 0xFFD6C29E),
        AnimeEra(1970, 1979, "1970s", "Rebels, robots, and new worlds", "Bold directors expanded science fiction, drama, and the possibilities of televised animation.", 0xFFE0A44F),
        AnimeEra(1980, 1989, "1980s", "The age of impossible ambition", "The OVA boom, expressive cel work, and fearless experimentation made anime feel limitless.", 0xFFE95F8E),
        AnimeEra(1990, 1999, "1990s", "Analog dreams at full power", "A generation of landmark series joined cinematic craft with stranger, more personal stories.", 0xFF8D7CF6),
        AnimeEra(2000, 2009, "2000s", "The digital crossing", "Studios reinvented their look while late-night anime and global fandom accelerated together.", 0xFF4CA8DE),
        AnimeEra(2010, 2019, "2010s", "Anime goes everywhere", "Simulcasts, ambitious adaptations, and a worldwide audience reshaped the medium.", 0xFF55C99A),
        AnimeEra(2020, 2029, "2020s", "The borderless studio", "Hybrid pipelines and global collaboration are producing anime at an unprecedented scale.", 0xFFE65B52),
    )

    fun clampYear(year: Int, currentYear: Int = java.time.Year.now().value): Int =
        year.coerceIn(1960, currentYear.coerceIn(1960, 2029))

    fun eraFor(year: Int): AnimeEra {
        val safe = clampYear(year, 2029)
        return eras.firstOrNull { safe in it.start..it.end } ?: eras.first()
    }

    fun transmission(year: Int): String {
        val era = eraFor(year)
        return when (year - era.start) {
            in Int.MIN_VALUE..2 -> "Early ${era.label} transmission"
            in 7..Int.MAX_VALUE -> "Late ${era.label} transmission"
            else -> "Mid-${era.label} transmission"
        }
    }
}
