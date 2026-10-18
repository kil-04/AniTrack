package com.sanjay.anitrack.next.data

import kotlin.math.log10
import kotlin.math.roundToInt
import kotlin.random.Random

data class AnimeEra(
    val start: Int,
    val end: Int,
    val label: String,
    val headline: String,
    val atmosphere: String,
    val accent: Long,
)

/** A relation of a Time Machine title: AniList's relation type, the related anime and when it started. */
data class TimeMachineRelation(val type: String, val id: Int, val startYear: Int?, val startMonth: Int? = null)

/** A title that premiered in a Time Machine year, with what's needed to tell new shows from sequels. */
data class TimeMachineCandidate(
    val anime: Anime,
    /** 1–12, or null when AniList only knows the year. */
    val startMonth: Int?,
    /** Follows a show from an earlier year (AniList PREQUEL). */
    val prequelBefore: Boolean,
    /** A prequel story made after its sequel (AniList SEQUEL that started earlier). */
    val sequelBefore: Boolean,
    /** A side story, spin-off or compilation of an earlier show (AniList PARENT). */
    val parentBefore: Boolean,
    /** Another version of an earlier show: a remake, a retelling or a recap film (AniList ALTERNATIVE). */
    val alternativeBefore: Boolean,
    /** Follows a prequel or a parent story that started earlier in the same year: a Season 2 in the fall. */
    val followsEarlierThisYear: Boolean,
    /** Its title or description calls it a recap, compilation or retelling. */
    val recap: Boolean,
    /** AniList ids of the anime it's related to within its franchise. */
    val franchise: List<Int>,
    /** It came from the hidden-gems list. */
    val fromGems: Boolean = false,
)

data class TimeMachineStats(
    /** The most-followed new show or film. */
    val biggestDebut: Anime?,
    /** The best-rated new show or film with a real audience. */
    val bestRated: Anime?,
    /** The studio behind the most titles shown and how many, when it made at least two. */
    val busiestStudio: Pair<String, Int>?,
    /** Up to three genres the new shows and films share most. */
    val topGenres: List<String>,
)

data class TimeMachineYear(
    /** First seasons and new shows, best first, one per franchise. */
    val newShows: List<Anime>,
    /** New and franchise films without recap films, one per franchise. */
    val films: List<Anime>,
    /** New seasons, sequels and spin-offs of earlier shows, one per franchise. */
    val sequels: List<Anime>,
    /** Well-rated new titles with a smaller audience than the year's hits. */
    val gems: List<Anime>,
    /** The three most-followed new shows and films: "The year of …". */
    val headliners: List<Anime>,
    /** How many titles the rows were picked from. */
    val titleCount: Int,
    val stats: TimeMachineStats,
)

/**
 * The Time Machine's eras and how it sorts a year's titles into rows. Mirrors
 * packages/shared/time-machine.ts, so both apps show the same picks.
 */
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

    /** Where a year sits in its decade: "Early 1980s", "Mid-1980s", "Late 1980s". */
    fun yearInDecade(year: Int): String {
        val era = eraFor(year)
        return when (year - era.start) {
            in Int.MIN_VALUE..2 -> "Early ${era.label}"
            in 7..Int.MAX_VALUE -> "Late ${era.label}"
            else -> "Mid-${era.label}"
        }
    }

    // ── A year's titles ──────────────────────────────────────────────────────

    /** Formats in a year's sample; music videos are left out. */
    val SAMPLE_FORMATS = listOf("TV", "TV_SHORT", "MOVIE", "OVA", "ONA", "SPECIAL")
    /** Formats a hidden gem can have. */
    val GEM_FORMATS = listOf("TV", "TV_SHORT", "MOVIE", "OVA", "ONA")
    /** Titles a row leads with; gems come from beyond this. */
    const val ROW = 20

    // Relations that keep two titles in one franchise. CHARACTER and OTHER (crossovers,
    // shared casts) don't, or unrelated shows would merge.
    private val FRANCHISE_RELATIONS = setOf("PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SUMMARY", "ALTERNATIVE", "SPIN_OFF", "COMPILATION", "CONTAINS")
    // How AniList's own descriptions mark recaps: "Compilation recap movie…", "theatrical film
    // remake of…", "Soushuuhen", "A retelling of the first season…". A retelling of anything
    // else ("…of the final Manga story", "…of a fairy tale") is a film in its own right.
    private val RECAP_WORDS = Regex(
        """\b(?:recaps?|compilation|soushuuhen|(?:film|movie|theatrical) remake)\b|総集編|\b(?:retelling|summary|summari[sz]es|condensed|re-?edit(?:ed)?|digest)\b[^.]{0,40}?\b(?:season|series|episodes?|tv|anime|show)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val SEASON_MONTHS = mapOf("WINTER" to 1..3, "SPRING" to 4..6, "SUMMER" to 7..9, "FALL" to 10..12)

    /** Members a hidden gem needs: 1% of the year's most-followed title, and at least 250. */
    fun gemPopularityFloor(topPopularity: Int): Int = maxOf(250, (topPopularity * 0.01).roundToInt())

    fun candidate(
        anime: Anime,
        year: Int,
        startMonth: Int?,
        relations: List<TimeMachineRelation>,
        fromGems: Boolean = false,
    ): TimeMachineCandidate {
        // A prequel or a parent story always came first, even when AniList doesn't date it.
        // An undated alternative version is usually an announced remake, not an older show.
        fun before(type: String, undatedCounts: Boolean) = relations.any { relation ->
            relation.type == type && (relation.startYear?.let { it < year } ?: undatedCounts)
        }
        val text = listOfNotNull(anime.title, anime.titleRomaji, anime.synopsis?.take(400)).joinToString(" ")
        val month = startMonth?.takeIf { it in 1..12 }
        // Only a dated, earlier month counts: AniList also calls a later-released OVA a "prequel".
        val followsEarlierThisYear = month != null && relations.any { relation ->
            (relation.type == "PREQUEL" || relation.type == "PARENT") && relation.startYear == year &&
                relation.startMonth != null && relation.startMonth < month
        }
        return TimeMachineCandidate(
            anime = anime,
            startMonth = month,
            prequelBefore = before("PREQUEL", true),
            sequelBefore = before("SEQUEL", false),
            parentBefore = before("PARENT", true),
            alternativeBefore = before("ALTERNATIVE", false),
            followsEarlierThisYear = followsEarlierThisYear,
            recap = RECAP_WORDS.containsMatchIn(text),
            franchise = relations.filter { it.type in FRANCHISE_RELATIONS }.map { it.id }.distinct(),
            fromGems = fromGems,
        )
    }

    private fun popularity(c: TimeMachineCandidate) = c.anime.popularity ?: 0

    /** Runs long enough to be a show of its own rather than an extra or a film. */
    private fun seriesLength(c: TimeMachineCandidate): Boolean = when (c.anime.format) {
        "TV", "TV_SHORT", "ONA" -> true
        "OVA" -> c.anime.episodes == null || c.anime.episodes >= 3
        else -> false
    }

    /** Tied to an earlier work: a sequel, a later-made prequel, a side story, or a short alternate take. A series-length remake is a new show. */
    private fun continuesEarlier(c: TimeMachineCandidate): Boolean =
        c.prequelBefore || c.sequelBefore || c.parentBefore || (c.alternativeBefore && !seriesLength(c))

    /**
     * Sorts a year's titles into the rows. Franchises are worked out from the whole
     * year, so a season's Part 2 still counts as a sequel when its Part 1 aired
     * earlier that year.
     */
    fun curate(candidates: List<TimeMachineCandidate>, season: String = "ALL"): TimeMachineYear {
        // One entry per title; the main lists win over the gems list.
        val byId = LinkedHashMap<Int, TimeMachineCandidate>()
        for (candidate in candidates) {
            val known = byId[candidate.anime.id]
            if (known == null || (known.fromGems && !candidate.fromGems)) byId[candidate.anime.id] = candidate
        }
        val all = byId.values.toList()
        val top = maxOf(1, all.maxOfOrNull(::popularity) ?: 0)
        // Titles a handful of people follow are noise, as are music videos and recaps.
        val minimum = maxOf(150, (top * 0.002).roundToInt())
        val kept = all.filter { c ->
            c.anime.format != "MUSIC" && popularity(c) >= minimum &&
                !(c.recap && !seriesLength(c) && (c.prequelBefore || c.parentBefore || c.alternativeBefore))
        }

        // Franchises: titles joined through their relations, including relatives outside the year.
        val parent = HashMap<Int, Int>()
        fun root(id: Int): Int {
            var at = id
            while (parent[at] != null && parent[at] != at) at = parent.getValue(at)
            return at
        }
        fun join(a: Int, b: Int) {
            parent.putIfAbsent(a, a)
            parent.putIfAbsent(b, b)
            val ra = root(a)
            val rb = root(b)
            if (ra != rb) parent[rb] = ra
        }
        for (c in kept) {
            join(c.anime.id, c.anime.id)
            for (related in c.franchise) join(c.anime.id, related)
        }
        fun franchiseOf(c: TimeMachineCandidate) = root(c.anime.id)
        // A franchise continues when any of its titles this year follows an earlier one.
        val continuing = kept.filter(::continuesEarlier).map(::franchiseOf).toSet()
        // A new franchise's later entries (its fall Season 2) are sequels too: the whole
        // year shows the franchise once, as a new show, and a season view without the first
        // entry shows them under sequels.
        fun kind(c: TimeMachineCandidate): String? = when {
            c.anime.format == "MOVIE" -> "film"
            franchiseOf(c) in continuing || c.followsEarlierThisYear -> "sequel"
            c.anime.format == "SPECIAL" -> null
            else -> "new"
        }
        fun newWork(c: TimeMachineCandidate) = !continuesEarlier(c) && !c.followsEarlierThisYear &&
            (c.anime.format == "MOVIE" || franchiseOf(c) !in continuing)

        val months = SEASON_MONTHS[season]
        fun inSeason(c: TimeMachineCandidate) = months == null || (c.startMonth != null && c.startMonth in months)
        // Audience size relative to the year's biggest title, then score: neither an
        // obscure 90% nor a forgettable hit leads.
        fun blend(c: TimeMachineCandidate): Double {
            val reach = log10(popularity(c) + 1.0) / log10(top + 1.0)
            val score = c.anime.score?.let { ((it - 35) / 55.0).coerceIn(0.0, 1.0) } ?: 0.35
            return 0.6 * reach + 0.4 * score
        }
        fun ranked(k: String, fromGems: Boolean) = kept
            .filter { kind(it) == k && inSeason(it) && it.fromGems == fromGems }
            .sortedWith(compareByDescending<TimeMachineCandidate> { blend(it) }.thenByDescending(::popularity).thenBy { it.anime.id })
        fun onePerFranchise(list: List<TimeMachineCandidate>, skip: (Int, TimeMachineCandidate) -> Boolean): List<TimeMachineCandidate> {
            val seen = HashSet<Int>()
            return list.filter { c ->
                val franchise = franchiseOf(c)
                if (franchise in seen || skip(franchise, c)) false else { seen += franchise; true }
            }
        }

        val newShows = onePerFranchise(ranked("new", false)) { _, _ -> false }
        val newFranchises = newShows.map(::franchiseOf).toSet()
        // A franchise that premiered this year shows once, as a new show.
        val films = onePerFranchise(ranked("film", false)) { franchise, _ -> franchise in newFranchises }
        val filmFranchises = films.map(::franchiseOf).toSet()
        // A franchise's film doesn't hide its new season, but does hide its extras.
        val sequels = onePerFranchise(ranked("sequel", false)) { franchise, c ->
            franchise in newFranchises || (franchise in filmFranchises && !seriesLength(c))
        }

        val debuts = newShows + films.filter(::newWork)
        val scores = debuts.mapNotNull { it.anime.score }.sorted()
        val gemScore = (if (scores.isEmpty()) 100 else scores[(scores.size * 0.75).toInt()]).coerceIn(70, 80)
        val floor = gemPopularityFloor(top)
        val shownFranchises = (newShows + films + sequels).map(::franchiseOf).toSet()
        val fromGemsList = onePerFranchise((ranked("new", true) + ranked("film", true)).filter(::newWork)) { franchise, _ -> franchise in shownFranchises }
        val gems = (newShows.drop(ROW) + films.drop(ROW).filter(::newWork) + fromGemsList)
            .filter { (it.anime.score ?: 0) >= gemScore && popularity(it) >= floor }
            .sortedWith(compareByDescending<TimeMachineCandidate> { it.anime.score ?: 0 }.thenByDescending(::popularity))
            .take(ROW)

        val byPopularity = compareByDescending(::popularity)
        val rated = debuts.filter { it.anime.score != null && popularity(it) >= floor }
            .sortedWith(compareByDescending<TimeMachineCandidate> { it.anime.score ?: 0 }.thenByDescending(::popularity))
        val studios = LinkedHashMap<String, Pair<Int, Long>>()
        for (c in newShows + films + sequels) {
            val name = c.anime.studios.firstOrNull() ?: continue
            val (count, reach) = studios[name] ?: (0 to 0L)
            studios[name] = (count + 1) to (reach + popularity(c))
        }
        val busiest = studios.entries.sortedWith(compareByDescending<Map.Entry<String, Pair<Int, Long>>> { it.value.first }.thenByDescending { it.value.second }).firstOrNull()
        val genres = LinkedHashMap<String, Int>()
        for (c in debuts) for (genre in c.anime.genres.toSet()) genres[genre] = (genres[genre] ?: 0) + 1

        return TimeMachineYear(
            newShows = newShows.map { it.anime },
            films = films.map { it.anime },
            sequels = sequels.map { it.anime },
            gems = gems.map { it.anime },
            headliners = (newShows + films).sortedWith(byPopularity).take(3).map { it.anime },
            titleCount = kept.count { !it.fromGems && inSeason(it) },
            stats = TimeMachineStats(
                biggestDebut = debuts.sortedWith(byPopularity).firstOrNull()?.anime,
                bestRated = rated.firstOrNull()?.anime,
                busiestStudio = busiest?.takeIf { it.value.first >= 2 }?.let { it.key to it.value.first },
                topGenres = genres.entries.filter { it.value >= 2 }
                    .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
                    .take(3).map { it.key },
            ),
        )
    }

    /** "A", "A and B", "A, B and C". */
    fun joinTitles(titles: List<String>): String =
        if (titles.size <= 1) titles.firstOrNull().orEmpty()
        else "${titles.dropLast(1).joinToString(", ")} and ${titles.last()}"

    /** A random new show or gem from the year that isn't in your list yet (any new title when you've seen them all). */
    fun mysteryPick(year: TimeMachineYear, listed: Set<Int>, random: Random = Random.Default): Anime? {
        val pool = year.newShows.take(ROW) + year.gems
        val fresh = pool.filter { it.id !in listed }
        val choices = fresh.ifEmpty { pool.ifEmpty { year.films } }
        return if (choices.isEmpty()) null else choices[random.nextInt(choices.size)]
    }
}
