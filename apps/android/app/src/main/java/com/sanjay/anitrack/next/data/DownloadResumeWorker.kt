package com.sanjay.anitrack.next.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.sanjay.anitrack.next.data.manga.MangaDownloads
import com.sanjay.anitrack.next.data.novel.NovelDownloads
import com.sanjay.anitrack.next.data.novel.NovelSources
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

/**
 * Carries on unfinished downloads (episodes, manga chapters, novel chapters)
 * when the app isn't open: after it was closed or killed, or while the phone
 * slept and the network was gone. WorkManager runs it once a network is
 * available; starting the download objects restores and resumes what was
 * interrupted, and this keeps the process alive while they work.
 *
 * It holds the process (and its wakelock) only while something downloads: a
 * download waiting out a pause doesn't count. It then ends at once and asks
 * for the next pass at the earliest timed wake; a network wait relies on the
 * job's network constraint, and a wait for the app on the app's next start.
 */
class DownloadResumeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        running = true
        val app = applicationContext
        RemoteConfig.init(app)
        Db.init(app)
        AniList.init(app)
        Downloads.init(app)
        NovelSources.init(app)
        withContext(Dispatchers.Main) {
            MangaDownloads.init(app)
            NovelDownloads.init(app)
        }
        // Give the restore a moment to find the unfinished downloads.
        delay(5_000)
        val finished = withTimeoutOrNull(BUDGET_MS) {
            while (busy()) delay(5_000)
            true
        } ?: false
        running = false
        // Time's up with work left (WorkManager stops a worker after ten minutes): continue later.
        // Otherwise the next pass waits for the earliest moment a download can continue.
        if (!finished) schedule(app, TimeUnit.MINUTES.toMillis(15)) else scheduleNext(app, fromWorker = true)
        Result.success()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        Result.retry()
    } finally {
        running = false
    }

    companion object {
        private const val WORK = "download-resume"
        private val BUDGET_MS = TimeUnit.MINUTES.toMillis(8)
        private val NETWORK_RECHECK_MS = TimeUnit.MINUTES.toMillis(15)
        /** A pass is running: it schedules the next one itself when it ends. */
        @Volatile private var running = false

        /** Something is downloading, or ready to: not parked for a pause, the network or the app. */
        private suspend fun busy(): Boolean =
            Downloads.busy() || withContext(Dispatchers.Main) { MangaDownloads.busy() } || NovelDownloads.busy()

        /**
         * Keeps the next pass in step with the downloads (call it whenever one parks): now when one is
         * ready, at the earliest timed wake, or once a network is back for one that waits for it.
         * A running pass is left alone.
         */
        suspend fun reschedule(context: Context) {
            if (!running) scheduleNext(context, fromWorker = false)
        }

        private suspend fun scheduleNext(context: Context, fromWorker: Boolean) {
            val now = System.currentTimeMillis()
            val manga = withContext(Dispatchers.Main) { Triple(MangaDownloads.busy(), MangaDownloads.nextWake(), MangaDownloads.waitingForNetwork()) }
            val wake = listOfNotNull(Downloads.nextWake(), manga.second, NovelDownloads.nextWake()).minOrNull()
            val network = Downloads.waitingForNetwork() || manga.third || NovelDownloads.waitingForNetwork()
            when {
                Downloads.busy() || manga.first || NovelDownloads.busy() -> schedule(context)
                // A wait for the network runs once there is one (the constraint); from a pass that just
                // saw a network, only after a while, so a disagreeing network check can't spin it.
                network -> schedule(context, if (fromWorker) minOf(NETWORK_RECHECK_MS, wake?.minus(now) ?: NETWORK_RECHECK_MS) else 0L)
                wake != null -> schedule(context, wake - now)
            }
        }

        /** Asks for a pass once a network is available, after at least [delayMs]. */
        fun schedule(context: Context, delayMs: Long = 0L) {
            runCatching {
                val request = OneTimeWorkRequestBuilder<DownloadResumeWorker>()
                    .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .setInitialDelay(delayMs.coerceAtLeast(0L), TimeUnit.MILLISECONDS)
                    .build()
                WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, request)
            }
        }
    }
}
