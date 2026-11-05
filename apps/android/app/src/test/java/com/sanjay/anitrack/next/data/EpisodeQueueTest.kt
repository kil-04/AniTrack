package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.HlsDownload.Outcome
import com.sanjay.anitrack.next.data.providers.EpisodeOrigin
import com.sanjay.anitrack.next.data.providers.OriginCapture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.coroutineContext

/** The Android episode queue with a fake app and a virtual clock: what waits, what holds what, and when it gives up. */
class EpisodeQueueTest {
    private val start = 1_000_000L
    private val pause = DownloadResume.PauseReason.SERVER
    private val limit = DownloadResume.PauseReason.RATE_LIMIT

    /** A fake app: a virtual clock (sleeping advances it), a switchable network and app, scripted downloads. */
    private inner class Fake : EpisodeQueue.Host {
        @Volatile var clock = start
        @Volatile var network = true
        @Volatile var visible = true
        /** What each download of an episode returns: (id, how many times before) → outcome. */
        var script: (String, Int) -> Outcome = { _, _ -> Outcome.Done }
        /** What a download does before it returns: (id, how many times before, its first segment saved). */
        var during: suspend (String, Int, () -> Unit) -> Unit = { _, _, _ -> }
        val states = ConcurrentHashMap<String, Triple<Downloads.Status, Int, String?>>()
        val stalls = ConcurrentHashMap<String, EpisodeQueue.Stall>()
        val failures = ConcurrentHashMap<String, String>()
        /** (id, clock) for every download, in order. */
        val downloads: MutableList<Pair<String, Long>> = Collections.synchronizedList(mutableListOf())
        override fun now() = clock
        override suspend fun sleep(ms: Long) { clock += ms; yield() }
        override fun online() = network
        override suspend fun awaitOnline() { while (!network) { clock += 1_000; yield() } }
        override fun appVisible() = visible
        override fun waitsForApp(providerId: String?) = !visible && providerId == "anichan"
        override fun show(id: String, status: Downloads.Status, progress: Int, error: String?) { states[id] = Triple(status, progress, error) }
        override fun progress(id: String) = states[id]?.second ?: 0
        override suspend fun download(id: String, source: Downloads.Source, reResolves: Int, resolvedAt: Long, onProgressed: () -> Unit): Outcome {
            val before = downloads.count { it.first == id }
            downloads += id to clock
            during(id, before, onProgressed)
            yield()
            return script(id, before)
        }
        override fun readOrigin(id: String): EpisodeOrigin? = null
        override fun readStall(id: String) = stalls[id] ?: EpisodeQueue.Stall()
        override fun writeMeta(item: Downloads.Item, origin: EpisodeOrigin?, stall: EpisodeQueue.Stall) { stalls[item.id] = stall }
        override fun writeStall(id: String, stall: EpisodeQueue.Stall) { stalls[id] = stall }
        override fun writeFailure(id: String, message: String) { failures[id] = message }
        override fun writeProgress(id: String) {}
        override suspend fun parked() {}

        fun status(id: String) = states[id]?.first
        fun label(id: String) = states[id]?.third
        fun ofs(id: String) = downloads.filter { it.first == id }
    }

    private fun item(id: String) = Downloads.Item(id, 1, 1f, "Queue fixture", null, Downloads.Status.QUEUED, 0)

    /** Resolves like a provider episode: the source is known (and captured) for holds. */
    private fun resolver(provider: String): suspend () -> Downloads.Source = {
        coroutineContext[OriginCapture]?.let { it.providerId = provider; it.origin = EpisodeOrigin(provider, "show", 1f) }
        Downloads.Source("https://cdn.example/episode.m3u8", "", "ua")
    }

    /**
     * A source whose resolve fails without the app (as AniChan's does in the background).
     * Built outside any CoroutineScope block: inside one, `coroutineContext` would be that scope's.
     */
    private fun needingTheApp(provider: String): suspend () -> Downloads.Source = {
        coroutineContext[OriginCapture]?.providerId = provider
        throw IllegalStateException("Return to AniTrack to load AniChan.")
    }

    private fun CoroutineScope.start(queue: EpisodeQueue, id: String, provider: String = "anikoto", resumed: Boolean = false): Job =
        launch { queue.run(item(id), resolver(provider), resumed) }

    private suspend fun until(what: String, condition: () -> Boolean) {
        withTimeout(5_000) { while (!condition()) yield() }
        assertTrue(what, condition())
    }

    @Test fun aPausedEpisodeWaitsOutsideTheQueueSoTheNextOneDownloadsMeanwhile() = runBlocking {
        val app = Fake()
        app.script = { id, n -> if (id == "a" && n == 0) Outcome.Pause(pause, app.clock + 300_000, false) else Outcome.Done }
        val queue = EpisodeQueue(app)
        val a = start(queue, "a")
        val b = start(queue, "b")
        a.join(); b.join()
        assertEquals(listOf("a", "b", "a"), app.downloads.map { it.first })
        assertTrue("a waited its five minutes", app.ofs("a")[1].second >= start + 300_000)
        assertTrue("b didn't wait for them", app.ofs("b")[0].second < start + 300_000)
        assertEquals(Downloads.Status.DONE, app.status("a"))
        assertEquals(Downloads.Status.DONE, app.status("b"))
    }

    @Test fun anExpiredStreamIsResolvedAgainAtOnceKeepingItsTurn() = runBlocking {
        val app = Fake()
        app.script = { id, n -> if (id == "a" && n == 0) Outcome.ReResolve(progressed = true) else Outcome.Done }
        val queue = EpisodeQueue(app)
        val a = start(queue, "a")
        val b = start(queue, "b")
        a.join(); b.join()
        assertEquals(listOf("a", "a", "b"), app.downloads.map { it.first })
    }

    @Test fun aRateLimitHoldsOnlyItsProviderAndEndsEarlyWhenThatEpisodeIsRemoved() = runBlocking {
        val app = Fake()
        app.script = { id, _ -> if (id == "a") Outcome.Pause(limit, app.clock + 3_600_000, false) else Outcome.Done }
        val queue = EpisodeQueue(app)
        val a = start(queue, "a", "anikoto")
        until("a is waiting out its rate limit") { queue.parked("a") }
        val b = start(queue, "b", "anikoto")
        val c = start(queue, "c", "anichan")
        c.join()
        until("b is held by a's rate limit") { queue.parked("b") }
        assertTrue(app.ofs("b").isEmpty())
        assertEquals("The server asked to wait", app.label("b"))
        val removedAt = app.clock
        a.cancel(); queue.forget("a") // what Downloads.remove does
        b.join()
        assertEquals(Downloads.Status.DONE, app.status("b"))
        assertTrue("b didn't sit out a's hour", app.ofs("b")[0].second < removedAt + 10_000)
    }

    @Test fun askingAgainForAPausedEpisodeStartsItNow() = runBlocking {
        val app = Fake()
        app.script = { _, n -> if (n == 0) Outcome.Pause(pause, app.clock + 300_000, false) else Outcome.Done }
        val queue = EpisodeQueue(app)
        val a = start(queue, "a")
        until("a is waiting") { queue.parked("a") }
        assertEquals(start + 300_000, queue.nextWake())
        assertTrue(queue.wake("a"))
        a.join()
        assertTrue("it didn't wait five minutes", app.ofs("a")[1].second < start + 10_000)
    }

    @Test fun anEpisodeThatStallsThreeTimesInARowFailsWithItsReason() = runBlocking {
        val app = Fake()
        app.script = { _, _ -> Outcome.Pause(pause, app.clock + 300_000, false) }
        val queue = EpisodeQueue(app)
        start(queue, "a").join()
        assertEquals(3, app.ofs("a").size)
        assertEquals(Downloads.Status.FAILED, app.status("a"))
        assertEquals("The server kept failing on part of this episode. Try another server.", app.failures["a"])
        assertFalse(queue.parked("a"))
    }

    @Test fun progressEndsTheStreakSoAnEpisodeThatKeepsSavingCarriesOn() = runBlocking {
        val app = Fake()
        app.script = { _, n -> if (n < 5) Outcome.Pause(pause, app.clock + 60_000, progressed = n % 2 == 0) else Outcome.Done }
        val queue = EpisodeQueue(app)
        start(queue, "a").join()
        assertEquals(Downloads.Status.DONE, app.status("a"))
        assertEquals(6, app.ofs("a").size)
    }

    @Test fun waitingForTheNetworkNeverCounts() = runBlocking {
        val app = Fake()
        app.script = { _, n -> if (n < 5) { app.network = false; Outcome.Pause(DownloadResume.PauseReason.NETWORK, null, false) } else Outcome.Done }
        val queue = EpisodeQueue(app)
        val a = start(queue, "a")
        repeat(5) {
            until("waiting for the network") { queue.waitingForNetwork() }
            assertEquals("Waiting for the network", app.label("a"))
            app.network = true
            until("back") { !queue.waitingForNetwork() }
        }
        a.join()
        assertEquals(Downloads.Status.DONE, app.status("a"))
        assertEquals(0, app.stalls["a"]?.reResolves ?: 0)
    }

    @Test fun aSourceThatNeedsTheAppWaitsForItInsteadOfFailing() = runBlocking {
        val app = Fake()
        app.visible = false
        val queue = EpisodeQueue(app)
        var opened = false
        val resolve = needingTheApp("anichan")
        val a = launch {
            queue.run(item("a"), { if (opened) Downloads.Source("https://cdn.example/episode.m3u8", "", "ua") else resolve() }, resumed = true)
        }
        until("a waits for the app") { queue.parked("a") }
        assertEquals("Waiting for the app", app.label("a"))
        assertEquals(Downloads.Status.QUEUED, app.status("a"))
        assertNull("a wait for the app has no clock", queue.nextWake())
        // MainActivity: the app is in front again, and its sources resolve.
        opened = true
        app.visible = true
        a.join()
        assertEquals(Downloads.Status.DONE, app.status("a"))
    }

    @Test fun aPauseThatOutlivedTheProcessIsWaitedOutWithItsStreak() = runBlocking {
        val app = Fake()
        app.stalls["a"] = EpisodeQueue.Stall(reResolves = 1, stalledSince = start - 60_000, resumeAt = start + 600_000, reason = limit)
        app.script = { _, _ -> Outcome.Pause(pause, app.clock + 60_000, false) }
        val queue = EpisodeQueue(app)
        start(queue, "a", resumed = true).join()
        assertTrue("it waited until the persisted time", app.ofs("a")[0].second >= start + 600_000)
        assertEquals("one stall carried over, so the second run here is the third in a row", 2, app.ofs("a").size)
        assertEquals(Downloads.Status.FAILED, app.status("a"))
    }

    @Test fun aRunThatSavesASegmentEndsTheStreakOnDiskSoAKilledRunDoesntCarryItOn() = runBlocking {
        val app = Fake()
        app.stalls["a"] = EpisodeQueue.Stall(reResolves = 2, stalledSince = start - 60_000)
        // The first run saves a segment, then the process is killed mid-episode.
        app.during = { _, n, saved -> if (n == 0) { saved(); awaitCancellation() } }
        app.script = { _, n -> if (n == 1) Outcome.Pause(pause, app.clock + 60_000, false) else Outcome.Done }
        val first = start(EpisodeQueue(app), "a", resumed = true)
        until("the saved segment ended the streak on disk") { app.stalls["a"] == EpisodeQueue.Stall() }
        first.cancel(); first.join()
        // Restarted: it carries on with a fresh streak, so one stall doesn't fail it.
        start(EpisodeQueue(app), "a", resumed = true).join()
        assertEquals(3, app.ofs("a").size)
        assertEquals(Downloads.Status.DONE, app.status("a"))
    }

    @Test fun askedForAgainAnEpisodeStartsAFreshStreak() = runBlocking {
        val app = Fake()
        app.stalls["a"] = EpisodeQueue.Stall(reResolves = 2, stalledSince = start - 60_000)
        app.script = { _, n -> if (n == 0) Outcome.Pause(pause, app.clock + 60_000, false) else Outcome.Done }
        val queue = EpisodeQueue(app)
        start(queue, "a", resumed = false).join()
        assertEquals(Downloads.Status.DONE, app.status("a"))
    }
}
