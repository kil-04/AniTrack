package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.providers.EpisodeOrigin
import com.sanjay.anitrack.next.data.providers.OriginCapture
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

/**
 * The queue part of [Downloads], free of Android so it runs in unit tests with a
 * fake [Host]. One episode downloads at a time ([lock]). Every wait has an end and
 * holds only what it must: an episode that has to wait parks QUEUED outside the
 * lock, so the others download meanwhile, for
 * - a timed pause (a server error, a rate limit; a rate limit also holds its
 *   provider's other episodes, whose CDN asked to wait),
 * - the network (only while the device is offline),
 * - the app (a source that resolves only with it in front).
 * A run that saves no segment is a stall, and a few in a row fail the episode
 * ([DownloadResume.afterStop]), offline waits aside. Removing an episode cancels
 * its job, which ends its wait and any hold it set.
 */
internal class EpisodeQueue(private val host: Host) {
    /** What the queue needs from the app (storage, the network, the clock); a fake in tests. */
    interface Host {
        fun now(): Long
        suspend fun sleep(ms: Long)
        fun online(): Boolean
        suspend fun awaitOnline()
        fun appVisible(): Boolean
        /** Whether [providerId]'s streams can't be resolved now because the app isn't in front. */
        fun waitsForApp(providerId: String?): Boolean
        fun show(id: String, status: Downloads.Status, progress: Int, error: String? = null)
        fun progress(id: String): Int
        /**
         * One pass at the stream (and its captions), reporting progress through [show]. [onProgressed]
         * runs once, when the pass saves its first media piece.
         */
        suspend fun download(id: String, source: Downloads.Source, reResolves: Int, resolvedAt: Long, onProgressed: () -> Unit): HlsDownload.Outcome
        fun readOrigin(id: String): EpisodeOrigin?
        fun readStall(id: String): Stall
        fun writeMeta(item: Downloads.Item, origin: EpisodeOrigin?, stall: Stall)
        fun writeStall(id: String, stall: Stall)
        fun writeFailure(id: String, message: String)
        fun writeProgress(id: String)
        /** An episode parked: keep the background job in step with the earliest wake. */
        suspend fun parked()
    }

    /** A run's stall streak (see [DownloadResume.afterStop]), persisted across restarts. */
    data class Stall(
        val reResolves: Int = 0,
        val stalledSince: Long? = null,
        /** A timed pause still to wait out, and why. */
        val resumeAt: Long? = null,
        val reason: DownloadResume.PauseReason? = null,
    )

    /** A source that can only resolve with the app's Activity, or its WebView session in front. */
    class NeedsAppException : Exception("Waiting for the app")

    /** What a parked episode is waiting for, so the background job knows when it can help. */
    private sealed class Wait {
        data class Until(val at: Long) : Wait()
        object Network : Wait()
        object App : Wait()
    }

    /** What one turn holding the queue lock ended with. */
    private sealed class Turn {
        object Done : Turn()
        /** Wait (outside the queue) until [until], or for the network when null. */
        data class Park(val reason: DownloadResume.PauseReason, val until: Long?) : Turn()
        /** Another episode's rate limit holds [provider]. */
        data class Held(val provider: String) : Turn()
        object NeedsApp : Turn()
        object Offline : Turn()
    }

    private class Run(val item: Downloads.Item, var origin: EpisodeOrigin?, var stall: Stall)

    private val lock = Mutex()
    private val waits = ConcurrentHashMap<String, Wait>()
    /** Rate limits: episode id → (provider, until). */
    private val rateHolds = ConcurrentHashMap<String, Pair<String, Long>>()
    /** Episodes asked for again while parked on a pause: their wait ends now. */
    private val wakeNow: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /** Whether [id] is parked (and so not downloading, nor ready to). */
    fun parked(id: String): Boolean = waits[id] != null

    /** The earliest moment a parked episode continues on its own, or null. */
    fun nextWake(): Long? = waits.values.mapNotNull { (it as? Wait.Until)?.at }.minOrNull()

    fun waitingForNetwork(): Boolean = waits.values.any { it is Wait.Network }

    /**
     * Asked for again: an episode parked on a pause (or for the app) starts now and lifts its
     * hold; one waiting for the network still waits for it. False when [id] isn't parked.
     */
    fun wake(id: String): Boolean {
        val wait = waits[id] ?: return false
        if (wait is Wait.Until || wait is Wait.App) {
            rateHolds.remove(id)
            wakeNow += id
        }
        return true
    }

    /** Ends [id]'s rate-limit hold (it was removed). */
    fun forget(id: String) {
        rateHolds.remove(id)
    }

    /**
     * One download from first resolve to DONE or FAILED (shown through the host), waiting
     * parked and resolving again as needed. [resumed]: carried on after a restart, keeping its
     * stall streak and a pause that outlived the process; asked for again, it starts afresh.
     */
    suspend fun run(item: Downloads.Item, resolve: suspend () -> Downloads.Source, resumed: Boolean) {
        val id = item.id
        val run = Run(item, host.readOrigin(id), if (resumed) host.readStall(id) else Stall())
        try {
            // Persist metadata first so a process/device restart can surface
            // (and resume) an interrupted item instead of leaking invisible files.
            host.writeMeta(item, run.origin, run.stall)
            run.stall.resumeAt?.let { at ->
                if (run.stall.reason == DownloadResume.PauseReason.RATE_LIMIT) run.origin?.let { rateHolds[id] = it.providerId to at }
                waitUntil(id, at, label(run.stall.reason ?: DownloadResume.PauseReason.SERVER))
            }
            loop@ while (true) {
                // An episode whose provider another one's rate limit holds waits without asking its CDN.
                run.origin?.providerId?.let { awaitHold(id, it) }
                when (val turn = lock.withLock { turn(run, resolve) }) {
                    Turn.Done -> break@loop
                    is Turn.Park -> when {
                        turn.until != null -> waitUntil(id, turn.until, label(turn.reason))
                        // Offline when it stopped but back already (a blip): look again in a minute, as desktop does.
                        host.online() -> waitUntil(id, host.now() + DownloadResume.UNREACHABLE_PAUSE_MS, label(turn.reason))
                        else -> awaitNetwork(id)
                    }
                    is Turn.Held -> awaitHold(id, turn.provider)
                    Turn.NeedsApp -> awaitApp(id)
                    Turn.Offline -> awaitNetwork(id)
                }
            }
            host.show(id, Downloads.Status.DONE, 100)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val message = e.message?.replace(Regex("https?://\\S+"), "the media server") ?: "The download failed. Start it again to continue."
            // The saved pieces stay: asking for the episode again continues from them.
            host.show(id, Downloads.Status.FAILED, host.progress(id), message)
            host.writeFailure(id, message)
        } finally {
            waits.remove(id)
            rateHolds.remove(id)
            wakeNow.remove(id)
        }
    }

    /**
     * One turn holding the queue lock: resolve, download, and resolve again at once while the
     * stream keeps expiring (with progress, or within the stall budget). Returns why it has to
     * wait, or throws when the episode fails.
     */
    private suspend fun turn(run: Run, resolve: suspend () -> Downloads.Source): Turn {
        val id = run.item.id
        rateHolds.remove(id) // its own hold ends as it runs
        while (true) {
            if (!host.online()) return Turn.Offline
            host.show(id, Downloads.Status.DOWNLOADING, host.progress(id))
            val capture = OriginCapture()
            val source = try {
                withContext(capture) { resolve() }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Offline while resolving: wait for the network. Without the app, a source that needs it: wait for the app.
                if (!host.online()) return Turn.Offline
                if (e is NeedsAppException || host.waitsForApp(capture.providerId ?: run.origin?.providerId)) return Turn.NeedsApp
                throw e
            }
            capture.origin?.let { found ->
                if (found != run.origin) {
                    run.origin = found
                    host.writeMeta(run.item, found, run.stall)
                }
            }
            run.origin?.providerId?.let { provider -> if (heldUntil(provider, id) != null) return Turn.Held(provider) }
            val outcome = host.download(id, source, run.stall.reResolves, host.now()) { streakEnded(run) }
            val now = host.now()
            when (outcome) {
                is HlsDownload.Outcome.Done -> return Turn.Done
                is HlsDownload.Outcome.ReResolve -> {
                    settle(run, DownloadResume.StopReason.EXPIRED, outcome.progressed, null, null, now)
                    continue // a fresh stream at once, still holding the queue
                }
                is HlsDownload.Outcome.Pause -> {
                    settle(run, DownloadResume.StopReason.of(outcome.reason), outcome.progressed, outcome.reason, outcome.resumeAt, now)
                    if (outcome.reason == DownloadResume.PauseReason.RATE_LIMIT && outcome.resumeAt != null) {
                        run.origin?.let { rateHolds[id] = it.providerId to outcome.resumeAt }
                    }
                    return Turn.Park(outcome.reason, outcome.resumeAt)
                }
            }
        }
    }

    /**
     * A run saved a media piece: it is no stall, so its streak ends on disk now. Should the
     * process be killed before the run stops, the resumed episode doesn't carry the old streak.
     * [Run.stall] stays as it began until the run stops: [settle] then judges the run with it
     * (one that went on to discard what it saved, for another rendition or key, still stalled).
     */
    private fun streakEnded(run: Run) {
        if (run.stall == Stall()) return
        host.writeStall(run.item.id, Stall())
    }

    /** Applies the shared stall rules to a stopped run: carries the streak on (persisted), or fails the episode. */
    private fun settle(run: Run, reason: DownloadResume.StopReason, progressed: Boolean, pause: DownloadResume.PauseReason?, resumeAt: Long?, now: Long) {
        when (val verdict = DownloadResume.afterStop(reason, run.stall.reResolves, run.stall.stalledSince, progressed, now)) {
            is DownloadResume.Verdict.Fail -> throw Exception(DownloadResume.stalledMessage(verdict.reason, DownloadResume.Subject.EPISODE))
            is DownloadResume.Verdict.Wait -> {
                run.stall = Stall(verdict.reResolves, verdict.stalledSince, resumeAt, pause)
                host.writeStall(run.item.id, run.stall)
            }
        }
    }

    /** Until when another episode's rate limit holds [providerId] (null: not held). */
    private fun heldUntil(providerId: String, except: String): Long? {
        val now = host.now()
        return rateHolds.entries.filter { it.key != except && it.value.first == providerId && it.value.second > now }
            .maxOfOrNull { it.value.second }
    }

    private fun label(reason: DownloadResume.PauseReason) = when (reason) {
        DownloadResume.PauseReason.NETWORK -> "Waiting for the network"
        DownloadResume.PauseReason.RATE_LIMIT -> "The server asked to wait"
        DownloadResume.PauseReason.SERVER -> "The server is busy"
    }

    /** Shows [id] waiting ([label]), QUEUED, and keeps its progress for a restart. */
    private suspend fun park(id: String, label: String, wait: Wait) {
        val p = host.progress(id)
        host.show(id, Downloads.Status.QUEUED, p, label + if (p > 0) " · $p% saved" else "")
        host.writeProgress(id)
        waits[id] = wait
        // Should the process die meanwhile, the background job carries on at the earliest wake.
        host.parked()
    }

    /** Waits, parked outside the queue, until [until] or until the episode is asked for again. */
    private suspend fun waitUntil(id: String, until: Long, label: String) {
        if (until <= host.now()) return
        park(id, label, Wait.Until(until))
        try {
            while (true) {
                val left = until - host.now()
                if (left <= 0 || wakeNow.remove(id)) return
                host.sleep(minOf(left, WAIT_SLICE_MS))
            }
        } finally {
            waits.remove(id)
        }
    }

    /**
     * Waits, parked, while another episode's rate limit holds [provider]. The hold is read
     * again every slice, so it ends early when that episode is removed or runs again.
     */
    private suspend fun awaitHold(id: String, provider: String) {
        var until = heldUntil(provider, id) ?: return
        park(id, label(DownloadResume.PauseReason.RATE_LIMIT), Wait.Until(until))
        try {
            while (!wakeNow.remove(id)) {
                until = heldUntil(provider, id) ?: return
                waits[id] = Wait.Until(until)
                host.sleep(minOf(until - host.now(), WAIT_SLICE_MS))
            }
        } finally {
            waits.remove(id)
        }
    }

    /** Waits, parked, until the app is in front (sources that resolve only with it). */
    private suspend fun awaitApp(id: String) {
        park(id, "Waiting for the app", Wait.App)
        try {
            while (!host.appVisible() && !wakeNow.remove(id)) host.sleep(WAIT_SLICE_MS)
        } finally {
            waits.remove(id)
        }
    }

    /** Returns once a network is up (at once when it already is), parked meanwhile. */
    private suspend fun awaitNetwork(id: String) {
        if (host.online()) return
        park(id, label(DownloadResume.PauseReason.NETWORK), Wait.Network)
        try {
            host.awaitOnline()
        } finally {
            waits.remove(id)
        }
    }

    companion object {
        /** Waits are slept in slices this long, so asking again ends one promptly. */
        const val WAIT_SLICE_MS = 2_000L
    }
}
