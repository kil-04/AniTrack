package com.sanjay.anitrack.next.data

import java.text.NumberFormat
import java.util.Locale

data class MuseumFact(val label: String, val value: String)

data class MuseumExhibit(
    val accession: String,
    val eyebrow: String,
    val room: String,
    val curatorLine: String,
    val facts: List<MuseumFact>,
    val tags: List<String>,
)

object LivingMuseumCurator {
    fun readableFormat(format: String?): String = when (format) {
        "TV" -> "television series"
        "TV_SHORT" -> "short-form television series"
        "MOVIE" -> "theatrical film"
        "OVA" -> "original video animation"
        "ONA" -> "original net animation"
        "SPECIAL" -> "television special"
        "MUSIC" -> "music animation"
        null -> "anime work"
        else -> format.lowercase().replace('_', ' ')
    }

    fun build(anime: Anime): MuseumExhibit {
        val year = anime.year
        val era = year?.let(TimeMachineArchive::eraFor)
        val format = readableFormat(anime.format)
        val studio = anime.studios.firstOrNull()
        val run = when {
            anime.episodes != null && anime.duration != null -> "${anime.episodes} × ${anime.duration} min"
            anime.episodes != null -> "${anime.episodes} episode${if (anime.episodes == 1) "" else "s"}"
            anime.duration != null -> "${anime.duration} min"
            else -> null
        }
        val facts = buildList {
            year?.let { add(MuseumFact("First broadcast", it.toString())) }
            add(MuseumFact("Artifact type", format))
            studio?.let { add(MuseumFact("Primary studio", it)) }
            run?.let { add(MuseumFact("Recorded length", it)) }
            anime.score?.let { add(MuseumFact("AniList score", "$it/100")) }
            anime.popularity?.let { add(MuseumFact("AniList audience", NumberFormat.getIntegerInstance(Locale.US).format(it))) }
        }
        val curatorLine = when {
            studio != null && year != null -> "Catalogued as a $year $format from $studio."
            year != null -> "Catalogued as a $year $format."
            else -> "Catalogued as a $format; its original year is not recorded here."
        }
        val formatCode = (anime.format ?: "ANIME").replace("_", "").take(4)
        return MuseumExhibit(
            accession = "${year ?: "UNDATED"}-$formatCode-${anime.id}",
            eyebrow = era?.let { "${it.label} collection" } ?: "Unsorted collection",
            room = era?.headline ?: "The uncharted archive",
            curatorLine = curatorLine,
            facts = facts,
            tags = anime.genres.distinct().take(6),
        )
    }
}
