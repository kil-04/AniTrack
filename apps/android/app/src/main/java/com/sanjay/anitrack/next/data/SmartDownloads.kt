package com.sanjay.anitrack.next.data

import android.content.Context
import android.net.ConnectivityManager
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.sanjay.anitrack.next.data.manga.MangaChapters
import com.sanjay.anitrack.next.data.manga.MangaDownloads
import com.sanjay.anitrack.next.data.manga.MangaSources
import com.sanjay.anitrack.next.data.manga.MangaVerificationRequired
import com.sanjay.anitrack.next.data.manga.ReadState
import com.sanjay.anitrack.next.data.providers.ProviderEpisode
import com.sanjay.anitrack.next.data.providers.Providers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

/**
 * Smart downloads: keeps the next few episodes of the shows you're watching (and
 * the next chapters of manga you're reading) saved for offline, on Wi-Fi by
 * default, and clears the ones it saved once you've watched or read them.
 *
 * Runs when the app opens, when you leave the player, and every few hours in the
 * background. Only touches its own downloads: anything saved by hand stays put.
 */
object SmartDownloads {
    private const val PREFS = "anitrack_next"
    private const val KEY_ON = "smart_dl_on"
    private const val KEY_AHEAD = "smart_dl_ahead"
    private const val KEY_CHAPTERS = "smart_dl_chapters"
    private const val KEY_WIFI = "smart_dl_wifi"
    private const val KEY_CLEANUP = "smart_dl_cleanup"
    private const val KEY_OWNED = "smart_dl_owned"
    private const val KEY_OWNED_MANGA = "smart_dl_owned_manga"
    private const val KEY_LAST = "smart_dl_last"
    private const val KEY_STATUS = "smart_dl_status"
    private const val WORK = "smart-downloads"

    /** Episodes resolve without a browser check only on this connector. */
    private const val HEADLESS_PROVIDER = "anikoto"
    private const val WATCHED_PERCENT = 85
    private const val MAX_SHOWS = 4
    private const val MAX_MANGA = 4
    private val RECENT_MS = TimeUnit.DAYS.toMillis(21)
    private val FOREGROUND_GAP_MS = TimeUnit.MINUTES.toMillis(20)
    private val PLAYER_GAP_MS = TimeUnit.MINUTES.toMillis(2)
    private const val FIRST_RUN_DELAY_MS = 15_000L
    private const val MIN_FREE_BYTES = 1_500L * 1024 * 1024
    /** WorkManager stops a worker after ten minutes; leave room to finish cleanly. */
    private val BACKGROUND_BUDGET_MS = TimeUnit.MINUTES.toMillis(8)

    val EPISODE_CHOICES = listOf(1, 2, 3)
    val CHAPTER_CHOICES = listOf(0, 5, 10, 20)

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val running = Mutex()

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isOn(context: Context) = prefs(context).getBoolean(KEY_ON, false)
    fun episodesAhead(context: Context) = prefs(context).getInt(KEY_AHEAD, 2).coerceIn(1, 3)
    fun chaptersAhead(context: Context) = prefs(context).getInt(KEY_CHAPTERS, 0).coerceIn(0, 50)
    fun wifiOnly(context: Context) = prefs(context).getBoolean(KEY_WIFI, true)
    fun cleanup(context: Context) = prefs(context).getBoolean(KEY_CLEANUP, true)
    fun lastStatus(context: Context): String? = prefs(context).getString(KEY_STATUS, null)

    fun setOn(context: Context, on: Boolean) {
        prefs(context).edit().putBoolean(KEY_ON, on).apply()
        schedule(context)
        if (on) {
            // The first pass waits a moment so the counts can be set before anything downloads.
            val app = context.applicationContext
            scope.launch {
                delay(FIRST_RUN_DELAY_MS)
                kick(app, force = true)
            }
        }
    }

    fun setEpisodesAhead(context: Context, count: Int) = prefs(context).edit().putInt(KEY_AHEAD, count).apply()
    fun setChaptersAhead(context: Context, count: Int) = prefs(context).edit().putInt(KEY_CHAPTERS, count).apply()
    fun setCleanup(context: Context, on: Boolean) = prefs(context).edit().putBoolean(KEY_CLEANUP, on).apply()
    fun setWifiOnly(context: Context, on: Boolean) {
        prefs(context).edit().putBoolean(KEY_WIFI, on).apply()
        schedule(context)
    }

    /** Called at app start: keeps the background job in step with the setting. */
    fun init(context: Context) = schedule(context.applicationContext)

    private fun schedule(context: Context) {
        val work = WorkManager.getInstance(context)
        if (!isOn(context)) {
            work.cancelUniqueWork(WORK)
            return
        }
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(if (wifiOnly(context)) NetworkType.UNMETERED else NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .setRequiresStorageNotLow(true)
            .build()
        val request = PeriodicWorkRequestBuilder<SmartDownloadsWorker>(4, TimeUnit.HOURS, 1, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build()
        work.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /**
     * Starts a pass in the app's process unless one ran recently. [force] (leaving
     * the player, turning the feature on) only waits out a short gap.
     */
    fun kick(context: Context, force: Boolean = false) {
        val app = context.applicationContext
        if (!isOn(app)) return
        val gap = if (force) PLAYER_GAP_MS else FOREGROUND_GAP_MS
        if (System.currentTimeMillis() - prefs(app).getLong(KEY_LAST, 0L) < gap) return
        scope.launch { runCatching { run(app, background = false) } }
    }

    data class Summary(val episodes: Int, val chapters: Int, val cleared: Int, val note: String?)

    /** One pass: clear what's been watched, then queue what comes next. */
    suspend fun run(context: Context, background: Boolean): Summary = running.withLock {
        val app = context.applicationContext
        RemoteConfig.init(app)
        Db.init(app)
        AniList.init(app)
        Downloads.init(app)
        prefs(app).edit().putLong(KEY_LAST, System.currentTimeMillis()).apply()
        if (!isOn(app)) return Summary(0, 0, 0, null)

        val cleared = if (cleanup(app)) clearWatched(app) else 0
        dropFailed(app)
        val note = when {
            wifiOnly(app) && metered(app) -> "Waiting for Wi-Fi."
            app.filesDir.usableSpace < MIN_FREE_BYTES -> "Paused: less than 1.5 GB of storage free."
            else -> null
        }
        var episodes = 0
        var chapters = 0
        val queuedAnime = mutableSetOf<String>()
        val queuedManga = mutableSetOf<String>()
        if (note == null) {
            episodes = queueEpisodes(app, queuedAnime)
            if (chaptersAhead(app) > 0) chapters = queueChapters(app, queuedManga)
        }
        val summary = Summary(episodes, chapters, cleared, note)
        prefs(app).edit().putString(KEY_STATUS, describe(summary)).apply()
        // A background pass keeps the process alive until its downloads finish (or time runs out).
        if (background && (queuedAnime.isNotEmpty() || queuedManga.isNotEmpty())) {
            awaitDownloads(queuedAnime, queuedManga)
        }
        summary
    }

    private fun describe(summary: Summary): String {
        val stamp = java.text.SimpleDateFormat("MMM d, HH:mm", java.util.Locale.getDefault()).format(java.util.Date())
        val parts = listOfNotNull(
            summary.episodes.takeIf { it > 0 }?.let { "$it episode${if (it == 1) "" else "s"} queued" },
            summary.chapters.takeIf { it > 0 }?.let { "$it chapter${if (it == 1) "" else "s"} queued" },
            summary.cleared.takeIf { it > 0 }?.let { "$it cleared after watching" },
        )
        val body = summary.note ?: if (parts.isEmpty()) "Everything coming up is already saved." else parts.joinToString(" · ") + "."
        return "$stamp — $body"
    }

    private fun metered(context: Context): Boolean {
        val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return true
        return connectivity.isActiveNetworkMetered
    }

    private fun owned(context: Context, key: String): MutableSet<String> =
        prefs(context).getStringSet(key, emptySet()).orEmpty().toMutableSet()

    private fun saveOwned(context: Context, key: String, ids: Set<String>) =
        prefs(context).edit().putStringSet(key, ids).apply()

    /** Removes smart downloads that have been watched or read; returns how many. */
    private suspend fun clearWatched(context: Context): Int {
        var cleared = 0
        val anime = owned(context, KEY_OWNED)
        val present = Downloads.items.toList().associateBy { it.id }
        for (id in anime.toList()) {
            val item = present[id]
            if (item == null) { anime -= id; continue } // deleted by hand
            if (item.status != Downloads.Status.DONE) continue
            val percent = Db.positionsFor(item.animeId)[item.episode] ?: 0
            if (percent >= WATCHED_PERCENT) {
                Downloads.remove(id)
                anime -= id
                cleared++
            }
        }
        saveOwned(context, KEY_OWNED, anime)

        val manga = owned(context, KEY_OWNED_MANGA)
        val chapters = withContext(Dispatchers.Main) { MangaDownloads.items.toList() }.associateBy { it.key }
        val reads = mutableMapOf<Int, Map<Float, ReadState>>()
        for (key in manga.toList()) {
            val item = chapters[key]
            if (item == null) { manga -= key; continue }
            if (item.status != MangaDownloads.Status.DONE) continue
            val read = reads.getOrPut(item.mangaId) { Db.readingFor(item.mangaId) }[item.chapter.number]?.finished == true
            if (read) {
                withContext(Dispatchers.Main) { MangaDownloads.remove(key) }
                manga -= key
                cleared++
            }
        }
        saveOwned(context, KEY_OWNED_MANGA, manga)
        return cleared
    }

    /** Smart downloads that failed are dropped so the next pass can try again, quietly. */
    private suspend fun dropFailed(context: Context) {
        val anime = owned(context, KEY_OWNED)
        Downloads.items.toList().filter { it.id in anime && it.status == Downloads.Status.FAILED }.forEach {
            Downloads.remove(it.id)
            anime -= it.id
        }
        saveOwned(context, KEY_OWNED, anime)
        val manga = owned(context, KEY_OWNED_MANGA)
        withContext(Dispatchers.Main) {
            MangaDownloads.items.toList().filter { it.key in manga && it.status == MangaDownloads.Status.FAILED }.forEach {
                MangaDownloads.remove(it.key)
                manga -= it.key
            }
        }
        saveOwned(context, KEY_OWNED_MANGA, manga)
    }

    private suspend fun queueEpisodes(context: Context, queued: MutableSet<String>): Int {
        val runtime = RemoteConfig.current()
        if (!runtime.features.downloads) return 0
        val provider = Providers.registry.enabled(HEADLESS_PROVIDER, runtime)
            ?.takeIf { it.descriptor.capabilities.downloads && it.access == null } ?: return 0
        val now = System.currentTimeMillis()
        val ahead = episodesAhead(context)
        val owned = owned(context, KEY_OWNED)
        val shows = Db.continueWatching(12).filter { now - it.updatedAt in 0..RECENT_MS }.take(MAX_SHOWS)
        for (row in shows) {
            try {
                val anime = AniList.byId(row.animeId) ?: continue
                val series = provider.match(anime) ?: continue
                val wanted = SmartPlan.nextEpisodes(
                    series.episodes.map { it.number }, row.episode, Db.positionsFor(anime.id), ahead,
                )
                val have = Downloads.items.toList().filter { it.animeId == anime.id && it.status != Downloads.Status.FAILED }
                    .map { it.episode }.toSet()
                for (number in wanted) {
                    if (number in have) continue
                    val episode = series.episodes.firstOrNull { kotlin.math.abs(it.number - number) < 0.01f } ?: continue
                    val id = Downloads.idOf(anime.id, episode.number)
                    Downloads.enqueue(anime.id, episode.number, anime.title, anime.cover) { sourceFor(episode) }
                    owned += id
                    queued += id
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // One show failing to match or resolve never stops the others.
            }
        }
        saveOwned(context, KEY_OWNED, owned)
        return queued.size
    }

    /** What a download needs from an episode, with its preferred caption track. */
    private suspend fun sourceFor(episode: ProviderEpisode): Downloads.Source {
        val media = episode.resolve()
        check(media.downloadable) { "Downloads are not supported by this server" }
        val captions = media.subtitles.filter { it.mimeType == "text/vtt" }
        val caption = captions.firstOrNull { it.default }
            ?: captions.firstOrNull { it.language == "en" || it.label.contains("english", ignoreCase = true) }
            ?: captions.firstOrNull()
        return Downloads.Source(media.url, media.referer, media.userAgent, caption?.url)
    }

    private suspend fun queueChapters(context: Context, queued: MutableSet<String>): Int {
        val now = System.currentTimeMillis()
        val ahead = chaptersAhead(context)
        val owned = owned(context, KEY_OWNED_MANGA)
        val prefs = prefs(context)
        val series = Db.continueReading(12).filter { now - it.updatedAt in 0..RECENT_MS }.take(MAX_MANGA)
        for (row in series) {
            try {
                // A background job never opens Comix's foreground loading window.
                val source = MangaSources.all.firstOrNull { it.id == row.sourceId && !it.foregroundOnly } ?: continue
                val manga = AniList.mangaById(row.mangaId) ?: continue
                val title = source.find(manga) ?: continue
                val chapters = MangaChapters.normalize(source.chapters(title), prefs.getString("manga_group_${manga.id}", null))
                val wanted = SmartPlan.nextChapters(chapters.map { it.number }, Db.readingFor(manga.id), ahead).toSet()
                val targets = withContext(Dispatchers.Main) {
                    val held = MangaDownloads.held(manga.id).keys
                    chapters.filter { it.number in wanted && it.number !in held }.also {
                        MangaDownloads.enqueueAll(manga, source, title, it)
                    }
                }
                targets.forEach { chapter ->
                    val key = MangaDownloads.keyOf(manga.id, chapter.id)
                    owned += key
                    queued += key
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: MangaVerificationRequired) {
                // That source wants its one-time check in the app; try again after it's done.
            } catch (_: Exception) {
            }
        }
        saveOwned(context, KEY_OWNED_MANGA, owned)
        return queued.size
    }

    private suspend fun awaitDownloads(anime: Set<String>, manga: Set<String>) {
        withTimeoutOrNull(BACKGROUND_BUDGET_MS) {
            while (true) {
                val busyAnime = Downloads.items.toList().any {
                    it.id in anime && (it.status == Downloads.Status.QUEUED || it.status == Downloads.Status.DOWNLOADING)
                }
                val busyManga = withContext(Dispatchers.Main) { MangaDownloads.items.toList() }.any {
                    it.key in manga && (it.status == MangaDownloads.Status.QUEUED || it.status == MangaDownloads.Status.DOWNLOADING)
                }
                if (!busyAnime && !busyManga) break
                delay(5_000)
            }
        }
    }
}

/** What to keep downloaded, worked out from what's available and how far you are. */
object SmartPlan {
    private const val WATCHED = 85

    /**
     * Up to [ahead] episodes from the one to watch next: [lastWatched] itself while
     * it's unfinished, else the one after it. Episodes already watched are skipped.
     */
    fun nextEpisodes(available: List<Float>, lastWatched: Float?, positions: Map<Float, Int>, ahead: Int): List<Float> {
        if (lastWatched == null || ahead <= 0) return emptyList()
        val episodes = available.distinct().sorted()
        val at = episodes.indexOfFirst { kotlin.math.abs(it - lastWatched) < 0.01f }
        val start = when {
            at < 0 -> episodes.indexOfFirst { it > lastWatched }.takeIf { it >= 0 } ?: return emptyList()
            (positions[episodes[at]] ?: 0) >= WATCHED -> at + 1
            else -> at
        }
        return episodes.drop(start).filter { (positions[it] ?: 0) < WATCHED }.take(ahead)
    }

    /**
     * Up to [ahead] chapters from where reading continues (the chapter read last, or
     * the next one once it's finished). Finished chapters are skipped.
     */
    fun nextChapters(available: List<Float>, progress: Map<Float, ReadState>, ahead: Int): List<Float> {
        if (ahead <= 0) return emptyList()
        val latest = progress.maxByOrNull { it.value.updatedAt } ?: return emptyList()
        val chapters = available.distinct().sorted()
        val from = if (latest.value.finished) chapters.firstOrNull { it > latest.key } else latest.key
        from ?: return emptyList()
        return chapters.filter { it >= from && progress[it]?.finished != true }.take(ahead)
    }
}

class SmartDownloadsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        SmartDownloads.run(applicationContext, background = true)
        Result.success()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        Result.retry()
    }
}
