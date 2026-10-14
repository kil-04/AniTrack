package com.sanjay.anitrack.next.data.manga

import com.sanjay.anitrack.next.data.manga.MangaSyncMerge.Doc
import com.sanjay.anitrack.next.data.manga.MangaSyncMerge.LocalRow
import com.sanjay.anitrack.next.data.manga.MangaSyncMerge.Meta
import com.sanjay.anitrack.next.data.manga.MangaSyncMerge.Row
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MangaSyncMergeTest {
    private val now = 1_792_022_400_000L // 2026-10-15T00:00:00Z
    private fun row(mangaId: Int = 30013, chapter: Double = 1195.0, chapterId: String = "user:9001", page: Int = 3,
                    pageCount: Int = 17, sourceId: String = "mangadot", updatedAt: Long = now - 60_000) =
        Row(mangaId, chapter, chapterId, page, pageCount, sourceId, updatedAt)
    private fun local(r: Row, title: String = "One Piece", cover: String? = "https://img.example/op.jpg") = LocalRow(r, title, cover)
    private fun remoteOf(vararg rows: LocalRow, deleted: Map<String, Long> = emptyMap()) = Doc(
        manga = rows.associate { it.row.mangaId.toString() to Meta(it.title, it.cover) },
        reading = rows.associate { MangaSyncMerge.readingKey(it.row.mangaId, it.row.chapter) to it.row },
        deleted = deleted,
    )

    @Test fun sameFileAndChapterKeysAsDesktop() {
        assertEquals("anitrack-manga-sync.json", MangaSyncMerge.FILE)
        assertEquals("1194", MangaSyncMerge.chapterKey(1194.0))
        assertEquals("7.2", MangaSyncMerge.chapterKey(7.2))
        assertEquals("7.2", MangaSyncMerge.chapterKey(7.2f.toDouble()))
        assertEquals("12.25", MangaSyncMerge.chapterKey(12.25))
        assertEquals("1200", MangaSyncMerge.chapterKey(1200.0))
        assertEquals("0", MangaSyncMerge.chapterKey(0.0))
        assertEquals("30013:1195", MangaSyncMerge.readingKey(30013, 1195.0))
    }

    @Test fun newerRowsWinBothWaysAndTiesChangeNothing() {
        val mine = local(row(page = 5, updatedAt = now - 10_000))
        var plan = MangaSyncMerge.plan(listOf(mine), remoteOf(local(row(page = 2, updatedAt = now - 20_000))), emptyMap(), now)
        assertTrue(plan.upsert.isEmpty())
        assertEquals(5, plan.doc.reading.getValue("30013:1195").page)
        assertTrue(plan.changed)

        val theirs = local(row(page = 9, updatedAt = now - 1_000, chapterId = "user:9002", sourceId = "mangaball"))
        plan = MangaSyncMerge.plan(listOf(mine), remoteOf(theirs), emptyMap(), now)
        assertEquals(listOf(9), plan.upsert.map { it.row.page })
        assertEquals("mangaball", plan.upsert[0].row.sourceId)
        assertFalse(plan.changed)

        plan = MangaSyncMerge.plan(listOf(mine), remoteOf(mine), emptyMap(), now)
        assertTrue(plan.upsert.isEmpty() && plan.remove.isEmpty())
        assertFalse(plan.changed)
    }

    @Test fun androidFloatChaptersMatchDesktopRows() {
        // The local table hands back 7.2f; the gist holds desktop's 7.2.
        val fromDb = local(row(mangaId = 7, chapter = 7.2f.toDouble(), updatedAt = now - 5_000))
        val fromDesktop = local(row(mangaId = 7, chapter = 7.2, updatedAt = now - 5_000))
        val plan = MangaSyncMerge.plan(listOf(fromDb), remoteOf(fromDesktop), emptyMap(), now)
        assertTrue(plan.upsert.isEmpty())
        assertFalse(plan.changed)
        assertEquals(setOf("7:7.2"), plan.doc.reading.keys)
    }

    @Test fun removalIsNotResurrectedButReadingAgainWins() {
        val old = local(row(updatedAt = now - 100_000))
        val removedAt = now - 50_000
        var plan = MangaSyncMerge.plan(emptyList(), remoteOf(old), mapOf("30013" to removedAt), now)
        assertTrue(plan.upsert.isEmpty())
        assertTrue(plan.doc.reading.isEmpty())
        assertEquals(removedAt, plan.doc.deleted["30013"])
        plan = MangaSyncMerge.plan(listOf(old), remoteOf(deleted = mapOf("30013" to removedAt)), emptyMap(), now)
        assertEquals(listOf(30013 to 1195.0), plan.remove)
        val again = local(row(chapter = 1196.0, chapterId = "user:2", updatedAt = now - 1_000))
        plan = MangaSyncMerge.plan(listOf(again), remoteOf(deleted = mapOf("30013" to removedAt)), emptyMap(), now)
        assertTrue(plan.remove.isEmpty())
        assertNotNull(plan.doc.reading["30013:1196"])
    }

    @Test fun unmarkingOneChapterHidesOnlyThatChapter() {
        val ch1 = local(row(chapter = 1.0, chapterId = "c1", page = 16, updatedAt = now - 90_000))
        val ch2 = local(row(chapter = 2.0, chapterId = "c2", page = 16, updatedAt = now - 80_000))
        val plan = MangaSyncMerge.plan(listOf(ch1), remoteOf(ch1, ch2), mapOf("30013:2" to now - 10_000), now)
        assertTrue(plan.upsert.isEmpty())
        assertEquals(setOf("30013:1"), plan.doc.reading.keys)
    }

    @Test fun oldRemovalsArePrunedUnsentOnesKept() {
        val ancient = now - MangaSyncMerge.TOMBSTONE_TTL_MS - 1
        var plan = MangaSyncMerge.plan(emptyList(), remoteOf(deleted = mapOf("1" to ancient, "2" to now - 5)), emptyMap(), now)
        assertEquals(mapOf("2" to now - 5), plan.doc.deleted)
        plan = MangaSyncMerge.plan(emptyList(), remoteOf(), mapOf("3" to ancient), now)
        assertEquals(mapOf("3" to ancient), plan.doc.deleted)
    }

    @Test fun parsesDesktopFilesAndRefusesMalformedOnes() {
        assertEquals(Doc(), MangaSyncMerge.parse(null))
        assertEquals(Doc(), MangaSyncMerge.parse(""))
        // Exactly what desktop's serializeMangaSyncDoc writes.
        val desktop = """{"v":1,"manga":{"30013":{"title":"One Piece","cover":null}},""" +
            """"reading":{"30013:7.2":{"mangaId":30013,"chapter":7.2,"chapterId":"user:1","page":0,"pageCount":20,"sourceId":"mangadot","updatedAt":1792022340000}},""" +
            """"deleted":{"105398":1792022000000,"30013:5":1792021000000}}"""
        val doc = MangaSyncMerge.parse(desktop)
        assertEquals(Meta("One Piece", null), doc.manga["30013"])
        assertEquals(7.2, doc.reading.getValue("30013:7.2").chapter, 0.0)
        assertEquals(1_792_022_000_000L, doc.deleted["105398"])
        assertEquals(doc, MangaSyncMerge.parse(MangaSyncMerge.serialize(doc)))
        assertThrows(Exception::class.java) { MangaSyncMerge.parse("[]") }
        assertThrows(Exception::class.java) { MangaSyncMerge.parse("""{"reading":{"x":{"mangaId":-1}}}""") }
        assertThrows(Exception::class.java) { MangaSyncMerge.parse("""{"reading":{},"deleted":{"abc":5}}""") }
        val pageTooFar = JSONObject(desktop).getJSONObject("reading").getJSONObject("30013:7.2").put("page", 20)
        assertThrows(Exception::class.java) { MangaSyncMerge.parse("""{"reading":{"k":$pageTooFar}}""") }
    }
}
