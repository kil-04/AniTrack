package com.sanjay.anitrack.next.data

import java.time.Instant
import java.time.ZoneId
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Year in Review: a recap of one calendar year built only from what this device has
 * recorded. The Kotlin twin of packages/shared/year-review.ts, so both apps decide alike.
 */
data class RecapWatch(
    val animeId: Int,
    val episode: Float,
    val positionSec: Double,
    val durationSec: Double,
    val updatedAt: Long,
    val title: String? = null,
    val cover: String? = null,
    val genres: List<String> = emptyList(),
)

/** One chapter's reading row. [progress] is how far into the chapter, 0..1. */
data class RecapRead(
    val kind: String, // "manga" or "novel"
    val key: String,
    val chapter: String,
    val progress: Double,
    val updatedAt: Long,
    val title: String? = null,
    val cover: String? = null,
)

data class RecapTitle(val key: String, val title: String, val cover: String?, val count: Int, val minutes: Int)
data class RecapDay(val year: Int, val month: Int, val day: Int, val count: Int)
data class RecapGenre(val label: String, val count: Int)
data class RecapPersona(val title: String, val line: String)

enum class TimeOfDay(val label: String) { MORNING("mornings"), AFTERNOON("afternoons"), EVENING("evenings"), NIGHT("late nights") }

data class YearRecap(
    val year: Int,
    val hasActivity: Boolean,
    val episodes: Int,
    val minutes: Int,
    val shows: Int,
    val topShows: List<RecapTitle>,
    val firstShow: RecapTitle?,
    val topGenres: List<RecapGenre>,
    val monthMinutes: List<Int>,
    val monthChapters: List<Int>,
    val busiestMonth: Int?,
    val biggestDay: RecapDay?,
    val activeDays: Int,
    val longestStreak: Int,
    val timeOfDay: TimeOfDay?,
    val timeOfDayShare: Int,
    val mangaChapters: Int,
    val novelChapters: Int,
    val titlesRead: Int,
    val topManga: RecapTitle?,
    val topNovel: RecapTitle?,
    val persona: RecapPersona,
)

object YearReview {
    /** Watched through: the same 85% that marks an episode watched on MAL. */
    const val WATCHED_RATIO = 0.85
    /** Read: at least half of the chapter's pages or paragraphs. */
    const val READ_RATIO = 0.5
    /** Rows of one title stamped closer together than this came from a bulk "mark read". */
    const val BULK_GAP_MS = 1500L

    val MONTH_NAMES = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )

    private data class Local(val year: Int, val month: Int, val day: Int, val hour: Int, val dayKey: Long)
    private data class At<T>(val row: T, val at: Local)

    private fun local(ts: Long, zone: ZoneId): Local {
        val t = Instant.ofEpochMilli(ts).atZone(zone)
        return Local(t.year, t.monthValue - 1, t.dayOfMonth, t.hour, t.toLocalDate().toEpochDay())
    }

    fun timeOfDayFor(hour: Int): TimeOfDay = when (hour) {
        in 5..11 -> TimeOfDay.MORNING
        in 12..16 -> TimeOfDay.AFTERNOON
        in 17..21 -> TimeOfDay.EVENING
        else -> TimeOfDay.NIGHT
    }

    private fun isWatched(w: RecapWatch) = w.durationSec > 0 && w.positionSec / w.durationSec >= WATCHED_RATIO
    private fun isRead(r: RecapRead) = !(r.progress < READ_RATIO)

    private fun <T> withoutBulk(rows: List<T>, keyOf: (T) -> String, at: (T) -> Long): List<T> {
        val kept = ArrayList<T>()
        for (list in rows.groupBy(keyOf).values) {
            val sorted = list.sortedBy(at)
            sorted.forEachIndexed { i, row ->
                val prev = if (i > 0) at(row) - at(sorted[i - 1]) else Long.MAX_VALUE
                val next = if (i < sorted.size - 1) at(sorted[i + 1]) - at(row) else Long.MAX_VALUE
                if (prev >= BULK_GAP_MS && next >= BULK_GAP_MS) kept += row
            }
        }
        return kept
    }

    /** Years with any recorded watching or reading, newest first. */
    fun years(watches: List<RecapWatch>, reads: List<RecapRead>, zone: ZoneId = ZoneId.systemDefault()): List<Int> {
        val years = HashSet<Int>()
        watches.filter { it.positionSec > 0 }.forEach { years += local(it.updatedAt, zone).year }
        reads.forEach { years += local(it.updatedAt, zone).year }
        return years.sortedDescending()
    }

    private fun cleanTitle(title: String?, fallback: String): String {
        val t = title?.trim().orEmpty()
        return if (t.isNotEmpty() && t != "Unknown") t else fallback
    }

    private fun topTitle(rows: List<RecapRead>): RecapTitle? {
        data class Acc(var title: String, var cover: String?, var count: Int, var last: Long)
        val map = LinkedHashMap<String, Acc>()
        for (r in rows) {
            val acc = map.getOrPut(r.key) { Acc(cleanTitle(r.title, "Untitled"), r.cover, 0, 0) }
            acc.count++
            if (r.updatedAt > acc.last) {
                acc.last = r.updatedAt
                if (r.cover != null) acc.cover = r.cover
                if (!r.title.isNullOrBlank() && r.title != "Unknown") acc.title = r.title.trim()
            }
        }
        val best = map.entries.sortedWith(compareByDescending<Map.Entry<String, Acc>> { it.value.count }.thenByDescending { it.value.last }).firstOrNull()
            ?: return null
        return RecapTitle(best.key, best.value.title, best.value.cover, best.value.count, 0)
    }

    private fun persona(r: YearRecap): RecapPersona {
        val genre = r.topGenres.firstOrNull()?.label
        val top = r.topShows.firstOrNull()
        val chapters = r.mangaChapters + r.novelChapters
        val hours = (r.minutes / 60.0).roundToInt()
        val genreLine = genre?.let { " $it led the way." } ?: ""
        return when {
            !r.hasActivity -> RecapPersona("A Quiet Year", "Nothing was watched or read on this device in ${r.year} yet.")
            chapters > 0 && chapters >= r.episodes * 2 ->
                RecapPersona("The Page Turner", "$chapters chapters read against ${r.episodes} episodes watched. The story was on the page this year.")
            top != null && r.episodes >= 12 && top.count.toDouble() / r.episodes >= 0.5 ->
                RecapPersona("The Devotee", "${top.title} took ${(top.count * 100.0 / r.episodes).roundToInt()}% of your episodes.$genreLine")
            r.timeOfDay == TimeOfDay.NIGHT && r.timeOfDayShare >= 45 ->
                RecapPersona("The Night Owl", "${r.timeOfDayShare}% of your watching and reading happened after 10 pm.$genreLine")
            r.longestStreak >= 14 -> RecapPersona("The Daily Ritual", "${r.longestStreak} days in a row without missing a day.$genreLine")
            r.shows >= 25 -> RecapPersona("The Explorer", "${r.shows} different shows, $hours hours in all.$genreLine")
            hours >= 200 -> RecapPersona("The Marathoner", "$hours hours of anime: more than ${hours / 24} full days.$genreLine")
            else -> RecapPersona("The Steady Watcher", "${r.episodes} episodes across ${r.shows} shows.$genreLine")
        }
    }

    fun build(year: Int, watches: List<RecapWatch>, reads: List<RecapRead>, zone: ZoneId = ZoneId.systemDefault()): YearRecap {
        val yearWatches = watches.filter { it.positionSec > 0 }.map { At(it, local(it.updatedAt, zone)) }.filter { it.at.year == year }
        val finished = withoutBulk(yearWatches.filter { isWatched(it.row) }, { it.row.animeId.toString() }, { it.row.updatedAt })
        val finishedSet = finished.toHashSet()
        // A bulk-marked episode is not watching time either.
        val timed = yearWatches.filter { !isWatched(it.row) || it in finishedSet }
        val yearReads = withoutBulk(
            reads.map { At(it, local(it.updatedAt, zone)) }.filter { it.at.year == year && isRead(it.row) },
            { "${it.row.kind}:${it.row.key}" }, { it.row.updatedAt },
        )

        val monthMinutes = DoubleArray(12)
        val monthChapters = IntArray(12)
        val days = HashMap<Long, RecapDay>()
        val activeDays = HashSet<Long>()
        val hours = LinkedHashMap<TimeOfDay, Int>().apply { TimeOfDay.entries.forEach { put(it, 0) } }

        class Show(val key: String, var title: String, var cover: String?, var count: Int, var minutes: Double, var first: Long, var last: Long, var genres: List<String>)
        val shows = LinkedHashMap<Int, Show>()
        var minutes = 0.0

        for ((row, at) in timed) {
            val m = min(row.positionSec, if (row.durationSec > 0) row.durationSec else row.positionSec) / 60.0
            minutes += m
            monthMinutes[at.month] += m
            activeDays += at.dayKey
            hours[timeOfDayFor(at.hour)] = hours.getValue(timeOfDayFor(at.hour)) + 1
            val show = shows.getOrPut(row.animeId) {
                Show(row.animeId.toString(), cleanTitle(row.title, "Unknown show"), row.cover, 0, 0.0, row.updatedAt, 0, row.genres)
            }
            show.minutes += m
            show.first = min(show.first, row.updatedAt)
            if (row.updatedAt > show.last) {
                show.last = row.updatedAt
                if (row.cover != null) show.cover = row.cover
            }
            if (show.genres.isEmpty() && row.genres.isNotEmpty()) show.genres = row.genres
        }
        for ((row, at) in finished) {
            shows.getValue(row.animeId).count++
            val day = days[at.dayKey] ?: RecapDay(at.year, at.month, at.day, 0)
            days[at.dayKey] = day.copy(count = day.count + 1)
        }
        for ((_, at) in yearReads) {
            monthChapters[at.month]++
            activeDays += at.dayKey
            hours[timeOfDayFor(at.hour)] = hours.getValue(timeOfDayFor(at.hour)) + 1
        }

        val watched = shows.values.filter { it.count > 0 || it.minutes >= 10 }
        val toTitle = { s: Show -> RecapTitle(s.key, s.title, s.cover, s.count, s.minutes.roundToInt()) }
        val topShows = watched
            .sortedWith(compareByDescending<Show> { it.count }.thenByDescending { it.minutes }.thenByDescending { it.last })
            .take(5).map(toTitle)
        val first = watched.minByOrNull { it.first }?.let(toTitle)

        val genreCounts = HashMap<String, Int>()
        for (s in watched) for (g in s.genres) genreCounts[g] = (genreCounts[g] ?: 0) + max(1, s.count)
        val topGenres = genreCounts.entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .take(5).map { RecapGenre(it.key, it.value) }

        var longestStreak = 0
        var run = 0
        val sortedDays = activeDays.sorted()
        sortedDays.forEachIndexed { i, d ->
            run = if (i > 0 && d - sortedDays[i - 1] == 1L) run + 1 else 1
            longestStreak = max(longestStreak, run)
        }

        val biggestDay = days.values.sortedWith(compareByDescending<RecapDay> { it.count }.thenBy { it.month }.thenBy { it.day }).firstOrNull()
        val activity = DoubleArray(12) { monthMinutes[it] + monthChapters[it] * 5 } // a chapter is roughly five minutes
        var busiest = 0
        for (i in 1 until 12) if (activity[i] > activity[busiest]) busiest = i
        val totalSessions = hours.values.sum()
        var timeOfDay: TimeOfDay? = null
        if (totalSessions > 0) {
            var best = TimeOfDay.MORNING
            for ((k, v) in hours) if (v > hours.getValue(best)) best = k
            timeOfDay = best
        }

        val manga = yearReads.map { it.row }.filter { it.kind == "manga" }
        val novels = yearReads.map { it.row }.filter { it.kind == "novel" }

        val base = YearRecap(
            year = year,
            hasActivity = watched.isNotEmpty() || yearReads.isNotEmpty(),
            episodes = finished.size,
            minutes = minutes.roundToInt(),
            shows = watched.size,
            topShows = topShows,
            firstShow = first,
            topGenres = topGenres,
            monthMinutes = monthMinutes.map { it.roundToInt() },
            monthChapters = monthChapters.toList(),
            busiestMonth = if (activity[busiest] > 0) busiest else null,
            biggestDay = biggestDay,
            activeDays = activeDays.size,
            longestStreak = longestStreak,
            timeOfDay = timeOfDay,
            timeOfDayShare = timeOfDay?.let { (hours.getValue(it) * 100.0 / totalSessions).roundToInt() } ?: 0,
            mangaChapters = manga.size,
            novelChapters = novels.size,
            titlesRead = yearReads.map { "${it.row.kind}:${it.row.key}" }.toSet().size,
            topManga = topTitle(manga),
            topNovel = topTitle(novels),
            persona = RecapPersona("", ""),
        )
        return base.copy(persona = persona(base))
    }

    /** "45 minutes", or "1,500 hours" past two hours. */
    fun formatWatchTime(minutes: Int): Pair<String, String> =
        if (minutes < 120) minutes.toString() to (if (minutes == 1) "minute" else "minutes")
        else "%,d".format(java.util.Locale.US, (minutes / 60.0).roundToInt()) to "hours"
}
