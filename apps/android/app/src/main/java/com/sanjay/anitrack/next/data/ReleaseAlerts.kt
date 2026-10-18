package com.sanjay.anitrack.next.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import androidx.compose.runtime.mutableStateOf
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import coil.imageLoader
import coil.request.ImageRequest
import com.sanjay.anitrack.next.MainActivity
import com.sanjay.anitrack.next.R
import com.sanjay.anitrack.next.data.manga.MangaChapters
import com.sanjay.anitrack.next.data.manga.MangaSources
import com.sanjay.anitrack.next.data.novel.NovelSourceId
import com.sanjay.anitrack.next.data.novel.NovelSources
import com.sanjay.anitrack.next.data.novel.NovelStore
import com.sanjay.anitrack.next.data.novel.Novels
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

/**
 * New-episode and new-chapter notifications. A periodic worker checks AniList's
 * airing schedule for the shows you watch (list "watching" / "plan to watch" and
 * Continue Watching) and, for the manga you follow, the newest chapter on the
 * source it reads from (only titles with a saved match: one small request each),
 * and for the novels you're reading, the chapter count of the copy you read (one
 * request each, on the novel sources' slow background lane; linked copies count once).
 * Every release notifies once; the first check only records where things stand.
 */
object ReleaseAlerts {
    const val EXTRA_ROUTE = "anitrack_route"
    private const val PREFS = "anitrack_next"
    private const val KEY_EPISODES = "alerts_episodes"
    private const val KEY_CHAPTERS = "alerts_chapters"
    private const val KEY_AIRING_CHECK = "alerts_airing_check" // epoch seconds
    private const val CHAPTER_PREFIX = "alerts_chapter_" // newest chapter seen per manga
    private const val NOVEL_PREFIX = "alerts_novel_" // chapter count seen per novel copy ("source:id")
    private const val CHANNEL_EPISODES = "new_episodes"
    private const val CHANNEL_CHAPTERS = "new_chapters"
    private const val WORK = "release-alerts"
    private const val MAX_ANIME = 150
    private const val MAX_MANGA = 40
    private const val MAX_NOVELS = 30
    /** On the very first check, episodes from the last day still count as new. */
    private const val FIRST_LOOKBACK_S = 24 * 60 * 60L
    private val ROUTE = Regex("^(anime|manga)/\\d{1,9}$")
    private val NOVEL_ROUTE = Regex("^novel/([a-z]+)/([A-Za-z0-9]{1,40})$")

    /** A detail page a notification asked to open; AppShell navigates and clears it. */
    val pendingRoute = mutableStateOf<String?>(null)

    data class Summary(val episodes: Int, val chapters: Int, val skipped: Int)

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun episodesOn(context: Context) = prefs(context).getBoolean(KEY_EPISODES, false)
    fun chaptersOn(context: Context) = prefs(context).getBoolean(KEY_CHAPTERS, false)

    fun init(context: Context) {
        createChannels(context)
        schedule(context)
    }

    fun setEpisodes(context: Context, on: Boolean) {
        prefs(context).edit().putBoolean(KEY_EPISODES, on).apply()
        schedule(context)
    }

    fun setChapters(context: Context, on: Boolean) {
        prefs(context).edit().putBoolean(KEY_CHAPTERS, on).apply()
        schedule(context)
    }

    fun canNotify(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            (Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)

    /** Reads a notification's route from [intent] into [pendingRoute] (validated: see [isRoute]). */
    fun takeRoute(intent: Intent?) {
        val route = intent?.getStringExtra(EXTRA_ROUTE) ?: return
        intent.removeExtra(EXTRA_ROUTE)
        if (isRoute(route)) pendingRoute.value = route
    }

    /** anime/N, manga/N, or novel/<source>/<id> with a known source and a valid id for it. */
    fun isRoute(route: String): Boolean {
        if (ROUTE.matches(route)) return true
        val m = NOVEL_ROUTE.matchEntire(route) ?: return false
        val source = NovelSourceId.of(m.groupValues[1]) ?: return false
        return Novels.isTitleId(source, m.groupValues[2])
    }

    /** The notification line for [fresh] new chapters, the newest labelled [latest]. */
    fun novelText(fresh: Int, latest: String?, source: String): String = when {
        fresh == 1 && latest != null -> "$latest is out on $source — tap to read."
        latest != null -> "$fresh new chapters on $source, up to $latest — tap to read."
        else -> "$fresh new chapter${if (fresh == 1) "" else "s"} on $source — tap to read."
    }

    private fun schedule(context: Context) {
        val work = WorkManager.getInstance(context)
        if (!episodesOn(context) && !chaptersOn(context)) {
            work.cancelUniqueWork(WORK)
            return
        }
        val request = PeriodicWorkRequestBuilder<ReleaseAlertsWorker>(2, TimeUnit.HOURS, 30, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        work.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    private fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_EPISODES, "New episodes", NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = "A new episode of a show you watch is out." },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_CHAPTERS, "New chapters", NotificationManager.IMPORTANCE_DEFAULT)
                .apply { description = "A new chapter of a manga or novel you read is out." },
        )
    }

    /** One pass over everything that's switched on. Network failures throw (the worker retries). */
    suspend fun check(context: Context): Summary {
        Db.init(context)
        AniList.init(context)
        var episodes = 0
        var chapters = 0
        var skipped = 0
        if (episodesOn(context)) episodes = checkEpisodes(context)
        if (chaptersOn(context)) {
            val (posted, missed) = checkChapters(context)
            NovelSources.init(context)
            val (novels, novelsMissed) = checkNovels(context)
            chapters = posted + novels
            skipped = missed + novelsMissed
        }
        return Summary(episodes, chapters, skipped)
    }

    private suspend fun checkEpisodes(context: Context): Int {
        val prefs = prefs(context)
        val now = System.currentTimeMillis() / 1000
        val since = prefs.getLong(KEY_AIRING_CHECK, 0L).takeIf { it > 0 } ?: (now - FIRST_LOOKBACK_S)
        val ids = buildList {
            Db.listByStatus("watching").forEach { add(it.animeId) }
            Db.continueWatching(40).forEach { add(it.animeId) }
            Db.listByStatus("plan_to_watch").forEach { add(it.animeId) }
        }.distinct().take(MAX_ANIME)
        if (ids.isEmpty()) {
            prefs.edit().putLong(KEY_AIRING_CHECK, now).apply()
            return 0
        }
        val aired = AniList.airedBetween(ids, since, now + 1)
        prefs.edit().putLong(KEY_AIRING_CHECK, now).apply()
        // One notification per show (a newer one replaces it); several episodes at once share it.
        for ((anime, episodes) in aired.groupBy { it.anime.id }.values.map { it.first().anime to it.map { a -> a.episode }.sorted() }) {
            notify(
                context,
                channel = CHANNEL_EPISODES,
                id = "episodes:${anime.id}".hashCode(),
                title = anime.title,
                text = if (episodes.size == 1) "Episode ${episodes.first()} is out — tap to watch."
                    else "Episodes ${episodes.first()}–${episodes.last()} are out — tap to watch.",
                cover = anime.cover,
                route = "anime/${anime.id}",
            )
        }
        return aired.size
    }

    /** New chapters on each followed title's source. Returns (notified, titles that couldn't be checked). */
    private suspend fun checkChapters(context: Context): Pair<Int, Int> {
        val prefs = prefs(context)
        val followed = LinkedHashMap<Int, Pair<String, String?>>()
        Db.continueReading(MAX_MANGA).forEach { followed[it.mangaId] = it.title to it.cover }
        Db.mangaList().filter { it.status == "reading" || it.status == "plan_to_read" }
            .forEach { followed.putIfAbsent(it.mangaId, it.title to it.cover) }
        var posted = 0
        var missed = 0
        for ((mangaId, info) in followed.entries.take(MAX_MANGA)) {
            val preferred = prefs.getString("manga_source_$mangaId", null)
            val sources = MangaSources.all.sortedBy { if (it.id == preferred) 0 else 1 }
            val match = sources.firstNotNullOfOrNull { source -> source.knownTitle(mangaId)?.let { source to it } }
            if (match == null) { missed++; continue }
            val (source, title) = match
            val latest = try { source.latest(title)?.chapter }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { null }
            if (latest == null) { missed++; continue }
            val key = "$CHAPTER_PREFIX$mangaId"
            val seen = prefs.getFloat(key, -1f)
            prefs.edit().putFloat(key, latest).apply()
            if (seen < 0f || latest <= seen) continue
            notify(
                context,
                channel = CHANNEL_CHAPTERS,
                id = "chapters:$mangaId".hashCode(),
                title = info.first,
                text = "Chapter ${MangaChapters.label(latest)} is out on ${source.label} — tap to read.",
                cover = info.second,
                route = "manga/$mangaId",
            )
            posted++
        }
        return posted to missed
    }

    /**
     * New chapters of the novels being read: Continue Reading (one copy per novel, the
     * one last read) plus "Reading" on My List. Returns (notified, novels that couldn't be checked).
     */
    private suspend fun checkNovels(context: Context): Pair<Int, Int> {
        val prefs = prefs(context)
        val followed = LinkedHashMap<String, Triple<NovelSourceId, String, String?>>() // novel key -> copy
        NovelStore.continueReading(MAX_NOVELS).forEach {
            followed.putIfAbsent(NovelStore.novelKey(it.source, it.titleId), Triple(it.source, it.titleId, it.title))
        }
        NovelStore.list().filter { it.status == "reading" }.forEach {
            followed.putIfAbsent(NovelStore.novelKey(it.source, it.titleId), Triple(it.source, it.titleId, it.title))
        }
        var posted = 0
        var missed = 0
        for ((source, id, _) in followed.values.take(MAX_NOVELS)) {
            val detail = try { NovelSources.title(source, id, NovelSources.Lane.Back) }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { null }
            val latest = detail?.latest
            if (detail == null || latest == null) { missed++; continue }
            val key = "$NOVEL_PREFIX${source.key}:$id"
            val seen = prefs.getInt(key, -1)
            prefs.edit().putInt(key, latest.count).apply()
            if (seen < 0 || latest.count <= seen) continue
            notify(
                context,
                channel = CHANNEL_CHAPTERS,
                id = "novel:${source.key}:$id".hashCode(),
                title = detail.card.title,
                text = novelText(latest.count - seen, latest.label, source.label),
                cover = detail.card.cover,
                route = "novel/${source.key}/$id",
            )
            posted++
        }
        return posted to missed
    }

    private suspend fun notify(
        context: Context,
        channel: String,
        id: Int,
        title: String,
        text: String,
        cover: String?,
        route: String,
    ) {
        if (!canNotify(context)) return
        val open = Intent(context, MainActivity::class.java)
            .putExtra(EXTRA_ROUTE, route)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(
            context, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setLargeIcon(coverBitmap(context, cover))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_RECOMMENDATION)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
            // Permission withdrawn between the check and the post.
        }
    }

    private suspend fun coverBitmap(context: Context, url: String?): Bitmap? {
        if (url.isNullOrBlank()) return null
        return withTimeoutOrNull(8_000) {
            runCatching {
                val result = context.imageLoader.execute(
                    ImageRequest.Builder(context).data(url).size(192).allowHardware(false).build(),
                )
                result.drawable?.toBitmap()
            }.getOrNull()
        }
    }
}

class ReleaseAlertsWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        ReleaseAlerts.check(applicationContext)
        Result.success()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        Result.retry()
    }
}
