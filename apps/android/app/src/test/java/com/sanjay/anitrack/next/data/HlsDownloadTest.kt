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
        val fetcher = HlsDownload.Fetcher(
            bytes = { url -> val (s, b, r) = answer(url); Attempt(s, r) to b?.takeIf { s in 200..299 } },
            toFile = { url, file ->
                fetched += url.substringBefore('?').substringAfterLast('/')
                val (s, b, r) = answer(url)
                if (s in 200..299) file.writeBytes(b!!)
                Attempt(s, r, b?.size?.toLong() ?: 0)
            },
            wait = { waits += it },
        )
    }

    private fun run(dir: File, cdn: Cdn, url: String = "https://cdn.example/master.m3u8") = runBlocking {
        HlsDownload.run(dir, url, false, 0, System.currentTimeMillis(), cdn.fetcher, {})
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
