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
 */
class DownloadResumeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
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
            while (pending()) delay(5_000)
            true
        } ?: false
        // Time's up with work left (WorkManager stops a worker after ten minutes): continue later.
        if (!finished) schedule(app, TimeUnit.MINUTES.toMillis(15))
        Result.success()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        Result.retry()
    }

    private suspend fun pending(): Boolean =
        Downloads.hasPending() || withContext(Dispatchers.Main) { MangaDownloads.hasPending() } || NovelDownloads.hasPending()

    companion object {
        private const val WORK = "download-resume"
        private val BUDGET_MS = TimeUnit.MINUTES.toMillis(8)

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
