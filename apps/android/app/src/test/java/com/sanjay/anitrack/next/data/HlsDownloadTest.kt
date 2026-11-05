package com.sanjay.anitrack.next.data

import com.sanjay.anitrack.next.data.HlsDownload.Attempt
import com.sanjay.anitrack.next.data.HlsDownload.Outcome
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.Collections

/** Resuming an episode with fake fetchers: what is kept, what is fetched again, how it waits. */
class HlsDownloadTest {
    @get:Rule val temp = TemporaryFolder()

    private fun ts(fill: Int) = ByteArray(376) { fill.toByte() }.also { it[0] = 0x47; it[188] = 0x47 }

    private fun playlist(urls: List<String>, key: String? = null) = buildString {
        append("#EXTM3U\n#EXT-X-TARGETDURATION:6\n")
        if (key != null) append("#EXT-X-KEY:METHOD=AES-128,URI=\"$key\"\n")
        urls.forEach { append("#EXTINF:6.006,\n$it\n") }
        append("#EXT-X-ENDLIST\n")
    }

    /** A fake CDN: [answer] gives (status, body, Retry-After) per URL; nothing reaches the network. */
    private inner class Cdn(var answer: (String) -> Triple<Int, ByteArray?, String?>) {
        val fetched: MutableList<String> = Collections.synchronizedList(mutableListOf())
        val waits: MutableList<Long> = Collections.synchronizedList(mutableListOf())
        @Volatile var online = true
        /** Whether the device has a network (by default [online]). */
        var connectivity: () -> Boolean = { online }
        val fetcher = HlsDownload.Fetcher(
            bytes = { url -> val (s, b, r) = answer(url); Attempt(s, r) to b?.takeIf { s in 200..299 } },
            toFile = { url, file ->
                fetched += url.substringBefore('?').substringAfterLast('/')
                val (s, b, r) = answer(url)
                if (s in 200..299) file.writeBytes(b!!)
                Attempt(s, r, b?.size?.toLong() ?: 0)
            },
            wait = { waits += it },
            online = { connectivity() },
        )
    }

    private fun run(
        dir: File, cdn: Cdn, url: String = "https://cdn.example/master.m3u8",
        reResolves: Int = 0, conservative: Boolean = false, captions: String? = null,
    ) = runBlocking {
        HlsDownload.run(dir, url, conservative, reResolves, System.currentTimeMillis(), cdn.fetcher, {}, captions)
    }

    /**
     * Runs the episode the way [Downloads] does: again after each stop, carrying the stall
     * streak through the shared rules, until it is done or gives up. Returns what each stop
     * carried on with, and the failure (null when done).
     */
    private fun runToTheEnd(dir: File, cdn: Cdn): Pair<List<Int>, String?> {
        var reResolves = 0
        var since: Long? = null
        val streak = mutableListOf<Int>()
        repeat(10) {
            val outcome = try {
                run(dir, cdn, reResolves = reResolves)
            } catch (e: Exception) {
                return streak to (e.message ?: "failed")
            }
            val (reason, progressed) = when (outcome) {
                is Outcome.Done -> return streak to null
                is Outcome.ReResolve -> DownloadResume.StopReason.EXPIRED to outcome.progressed
                is Outcome.Pause -> DownloadResume.StopReason.of(outcome.reason) to outcome.progressed
            }
            when (val verdict = DownloadResume.afterStop(reason, reResolves, since, progressed, System.currentTimeMillis())) {
                is DownloadResume.Verdict.Fail -> return streak to DownloadResume.stalledMessage(verdict.reason, DownloadResume.Subject.EPISODE)
                is DownloadResume.Verdict.Wait -> { reResolves = verdict.reResolves; since = verdict.stalledSince; streak += reResolves }
            }
        }
        error("never settled: $streak")
    }

    private val ok = { b: ByteArray -> Triple(200, b, null as String?) }

    @Test fun aDroppedNetworkKeepsTheSegmentsAndAReSignedStreamContinuesFromTheFirstMissingOne() {
        val dir = temp.newFolder()
        var token = "a"
        var online = true
        val cdn = Cdn { url ->
            if (url.contains("master.m3u8")) ok(playlist((0 until 8).map { "https://cdn$token.example/ep/1080/seg-$it.ts?token=$token&expires=4102444800" }).toByteArray())
            else {
                val i = Regex("seg-(\\d+)").find(url)!!.groupValues[1].toInt()
                if (!online) Triple(0, null, null) else { if (i == 2) online = false; ok(ts(i)) }
            }
        }
        cdn.connectivity = { online } // the device really is offline: a network wait, not a stall
        val paused = run(dir, cdn)
        assertTrue(paused is Outcome.Pause && paused.reason == DownloadResume.PauseReason.NETWORK && paused.progressed)
        assertFalse("not playable yet", File(dir, "index.m3u8").exists())
        val kept = dir.list()!!.filter { it.startsWith("seg") }.toSet()
        assertTrue(kept.isNotEmpty())
        token = "b"
        online = true
        cdn.fetched.clear()
        assertEquals(Outcome.Done, run(dir, cdn, "https://cdn.example/master.m3u8?token=b"))
        assertTrue("only missing pieces again: ${cdn.fetched}", cdn.fetched.none { name -> "seg%05d.ts".format(name.removePrefix("seg-").removeSuffix(".ts").toInt()) in kept })
        for (i in 0 until 8) assertArrayEquals(ts(i), File(dir, "seg%05d.ts".format(i)).readBytes())
        assertTrue(File(dir, "index.m3u8").readText().contains("seg00007.ts"))
    }

    @Test fun aRateLimitWaitsOutRetryAfterThenCarriesOn() {
        val dir = temp.newFolder()
        var limited = 2
        val cdn = Cdn { url ->
            when {
                url.contains("master.m3u8") -> ok(playlist(listOf("a.ts", "b.ts")).toByteArray())
                url.endsWith("b.ts") && limited-- > 0 -> Triple(429, null, "10")
                else -> ok(ts(1))
            }
        }
        assertEquals(Outcome.Done, run(dir, cdn))
        assertTrue("Retry-After: 10 honoured: ${cdn.waits}", cdn.waits.count { it == 10_000L } >= 2)
    }

    @Test fun aLongRetryAfterPausesInsteadOfHoldingTheDownload() {
        val dir = temp.newFolder()
        val cdn = Cdn { url -> if (url.contains("master")) ok(playlist(listOf("a.ts")).toByteArray()) else Triple(429, null, "3600") }
        val outcome = run(dir, cdn)
        assertTrue(outcome is Outcome.Pause && outcome.reason == DownloadResume.PauseReason.RATE_LIMIT && outcome.resumeAt!! > System.currentTimeMillis() + 3_000_000)
    }

    @Test fun anExpiredTokenAsksForAFreshStream() {
        val dir = temp.newFolder()
        val cdn = Cdn { url -> if (url.contains("master")) ok(playlist(listOf("a.ts", "b.ts")).toByteArray()) else if (url.endsWith("b.ts")) Triple(403, null, null) else ok(ts(1)) }
        val outcome = run(dir, cdn)
        assertTrue(outcome is Outcome.ReResolve)
        assertTrue(File(dir, "seg00000.ts").isFile)
    }

    @Test fun afterTwoStallsARunSavingSegmentsStillResolvesARefusedOrMissingStreamAgain() {
        for (status in listOf(403, 410, 404)) {
            val dir = temp.newFolder()
            val cdn = Cdn { url ->
                when {
                    url.contains("master") -> ok(playlist(listOf("a.ts", "b.ts")).toByteArray())
                    url.endsWith("a.ts") -> ok(ts(1))
                    else -> {
                        // Refused only once this run has saved a segment of its own.
                        while (!File(dir, "seg00000.ts").isFile) Thread.sleep(5)
                        Thread.sleep(20)
                        Triple(status, null, null)
                    }
                }
            }
            val outcome = run(dir, cdn, reResolves = 2)
            assertTrue("HTTP $status: $outcome", outcome is Outcome.ReResolve && outcome.progressed)
        }
    }

    @Test fun aCorruptedSegmentIsFetchedAgainAndAnotherQualityStartsOver() {
        val dir = temp.newFolder()
        var quality = "1080"
        val cdn = Cdn { url ->
            if (url.contains("master")) ok(playlist((0 until 3).map { "https://cdn.example/$quality/s$it.ts" }).toByteArray())
            else ok(ts(if (quality == "1080") 1 else 2))
        }
        assertEquals(Outcome.Done, run(dir, cdn))
        File(dir, "seg00001.ts").writeBytes(ByteArray(376))
        cdn.fetched.clear()
        assertEquals(Outcome.Done, run(dir, cdn))
        assertEquals(listOf("s1.ts"), cdn.fetched.toList())
        quality = "720"
        cdn.fetched.clear()
        assertEquals(Outcome.Done, run(dir, cdn))
        assertEquals("another rendition is never mixed in", 3, cdn.fetched.size)
        for (i in 0 until 3) assertArrayEquals(ts(2), File(dir, "seg0000$i.ts").readBytes())
    }

    @Test fun noAnswerWhileOnlineIsAServerStallAndOfflineWaitsForTheNetwork() {
        val dir = temp.newFolder()
        val cdn = Cdn { url -> if (url.contains("master")) ok(playlist(listOf("a.ts")).toByteArray()) else Triple(0, null, null) }
        val online = run(dir, cdn)
        assertTrue("online: the server didn't answer, $online", online is Outcome.Pause && online.reason == DownloadResume.PauseReason.SERVER && online.resumeAt != null && !online.progressed)
        assertEquals("four retries with backoff first", listOf(1000L, 2000L, 4000L, 8000L), cdn.waits.toList())
        cdn.online = false
        val offline = run(dir, cdn)
        assertTrue("offline: wait for the network, $offline", offline is Outcome.Pause && offline.reason == DownloadResume.PauseReason.NETWORK && offline.resumeAt == null)
    }

    @Test fun aRateSensitiveStreamPausesInsteadOfRetryingLongerWithEachStall() {
        val dir = temp.newFolder()
        val cdn = Cdn { url -> if (url.contains("master")) ok(playlist(listOf("a.ts")).toByteArray()) else Triple(502, null, null) }
        val before = System.currentTimeMillis()
        val first = run(dir, cdn, conservative = true)
        assertTrue(first is Outcome.Pause && first.reason == DownloadResume.PauseReason.SERVER && first.resumeAt!! >= before + 30_000)
        val third = run(dir, cdn, conservative = true, reResolves = 2)
        assertTrue("two stalls: two minutes", third is Outcome.Pause && third.resumeAt!! >= before + 120_000)
    }

    @Test fun reFetchedKeysArentProgressSoAnEncryptedStreamWhoseSegmentsReturn403Fails() {
        val dir = temp.newFolder()
        val cdn = Cdn { url ->
            when {
                url.contains("master") -> ok(playlist(listOf("a.ts", "b.ts"), key = "https://cdn.example/k.key").toByteArray())
                url.contains("k.key") -> ok(ByteArray(16) { 1 })
                else -> Triple(403, null, null)
            }
        }
        val (streak, failure) = runToTheEnd(dir, cdn)
        assertEquals("the key fetched again each run didn't reset the count", listOf(1, 2), streak)
        assertEquals("HTTP 403 from the media server", failure)
        assertEquals(3, cdn.fetched.count { it == "k.key" })
    }

    @Test fun aSegmentThatKeepsReturning5xxFailsAfterThreeStalls() {
        val dir = temp.newFolder()
        val cdn = Cdn { url -> if (url.contains("master")) ok(playlist(listOf("a.ts")).toByteArray()) else Triple(500, null, null) }
        val (streak, failure) = runToTheEnd(dir, cdn)
        assertEquals(listOf(1, 2), streak)
        assertEquals("The server kept failing on part of this episode. Try another server.", failure)
    }

    @Test fun aRunThatStartedOverForAnotherRenditionIsntProgress() {
        val dir = temp.newFolder()
        var rendition = 0
        val cdn = Cdn { url ->
            when {
                url.contains("master") -> { rendition++; ok(playlist(listOf("https://cdn.example/r$rendition/a.ts", "https://cdn.example/r$rendition/b.ts")).toByteArray()) }
                url.endsWith("b.ts") -> Triple(403, null, null)
                else -> ok(ts(rendition))
            }
        }
        val first = run(dir, cdn)
        assertTrue("the first run saved a segment of its own", first is Outcome.ReResolve && first.progressed)
        val second = run(dir, cdn, reResolves = 0)
        assertTrue("the second discarded it for another rendition: no progress", second is Outcome.ReResolve && !second.progressed)
    }

    @Test fun captionsAreBestEffortAndADroppedNetworkFetchesThemLater() {
        val failures: List<Triple<Int, ByteArray?, String?>> = listOf(Triple(503, null, null), Triple(404, null, null), Triple(429, null, "3600"), Triple(0, null, null))
        for (answer in failures) {
            val dir = temp.newFolder()
            var captionCalls = 0
            val cdn = Cdn { url ->
                when {
                    url.contains("master") -> ok(playlist(listOf("a.ts")).toByteArray())
                    url.contains("captions") -> { captionCalls++; answer }
                    else -> ok(ts(1))
                }
            }
            assertEquals("${answer.first}: finished without captions", Outcome.Done, run(dir, cdn, captions = "https://captions.example/en.vtt"))
            assertTrue("a couple of retries at most: $captionCalls", captionCalls <= 3)
            assertFalse(File(dir, HlsDownload.CAPTION_FILE).exists())
        }
        val dir = temp.newFolder()
        val cdn = Cdn { url ->
            when {
                url.contains("master") -> ok(playlist(listOf("a.ts")).toByteArray())
                url.contains("captions") -> Triple(0, null, null)
                else -> ok(ts(1))
            }
        }
        cdn.online = false
        val paused = run(dir, cdn, captions = "https://captions.example/en.vtt")
        assertTrue("offline: it waits to fetch them, $paused", paused is Outcome.Pause && paused.reason == DownloadResume.PauseReason.NETWORK)
        assertFalse(File(dir, "index.m3u8").exists())
        cdn.online = true
        cdn.answer = { url ->
            when {
                url.contains("master") -> ok(playlist(listOf("a.ts")).toByteArray())
                url.contains("captions") -> ok("WEBVTT\n\n00:00.000 --> 00:01.000\nBack online\n".toByteArray())
                else -> ok(ts(1))
            }
        }
        cdn.fetched.clear()
        assertEquals(Outcome.Done, run(dir, cdn, captions = "https://captions.example/en.vtt"))
        assertEquals("no segment was fetched again", emptyList<String>(), cdn.fetched.toList())
        assertTrue(File(dir, HlsDownload.CAPTION_FILE).readText().contains("Back online"))
    }

    @Test fun aChangedKeyDiscardsTheSegmentsItEncrypted() {
        val dir = temp.newFolder()
        var key = ByteArray(16) { 1 }
        val cdn = Cdn { url ->
            when {
                url.contains("master") -> ok(playlist(listOf("a.ts", "b.ts"), key = "https://cdn.example/k.key?token=x").toByteArray())
                url.contains("k.key") -> ok(key)
                else -> ok(ByteArray(32) { 7 })
            }
        }
        assertEquals(Outcome.Done, run(dir, cdn))
        cdn.fetched.clear()
        assertEquals(Outcome.Done, run(dir, cdn))
        assertEquals(listOf("k.key"), cdn.fetched.toList())
        key = ByteArray(16) { 2 }
        cdn.fetched.clear()
        assertEquals(Outcome.Done, run(dir, cdn))
        assertEquals(listOf("k.key", "k.key", "a.ts", "b.ts"), cdn.fetched.toList())
    }
}
