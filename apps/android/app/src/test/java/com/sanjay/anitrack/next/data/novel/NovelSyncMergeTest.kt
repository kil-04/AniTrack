package com.sanjay.anitrack.next.data.novel

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Synthetic rows shaped like the app's tables (no real reading data). Mirrors tests/novel-sync.test.mjs.
class NovelSyncMergeTest {
    private val now = 1_792_300_000_000L
    private val nb = "novelbuddy"
    private val na = "novelarchive"
    private val ogNb = "WAY3LXDy"
    private val ogNa = "6a1637414f942c668d69a5a9"

    private fun reading(
        chapterId: String = "Chap0001", label: String = "Chapter 1", paragraph: Int = 10, updatedAt: Long = now - 60_000,
        source: String = nb, titleId: String = ogNb, title: String = "Overgeared",
    ) = NovelSyncMerge.LocalReading(NovelSyncMerge.Reading(source, titleId, chapterId, 0, label, paragraph, 100, updatedAt), title, null)

    private fun list(status: String = "reading", updatedAt: Long = now - 60_000) =
        NovelSyncMerge.LocalList(NovelSyncMerge.ListRow(nb, ogNb, status, updatedAt), "Overgeared", null)

    private fun title(source: String = nb, titleId: String = ogNb, novelKey: String = "$source:$titleId", linkAt: Long? = null, seen: Int? = null) =
        NovelSyncMerge.Title(source, titleId, "Overgeared", null, novelKey, linkAt, seen)

    private fun local(reading: List<NovelSyncMerge.LocalReading> = emptyList(), list: List<NovelSyncMerge.LocalList> = emptyList(), titles: List<NovelSyncMerge.Title> = emptyList()) =
        NovelSyncMerge.Local(reading, list, titles)

    private val none = NovelSyncMerge.Removals()

    /** The gist after another device uploaded [l] with [deleted] removals (through the wire format). */
    private fun remoteOf(l: NovelSyncMerge.Local, deleted: NovelSyncMerge.Removals = none) =
        NovelSyncMerge.parse(NovelSyncMerge.serialize(NovelSyncMerge.plan(l, NovelSyncMerge.Doc(), deleted, now).doc))

    @Test fun parseIsStrictButIgnoresNewerSections() {
        assertEquals(NovelSyncMerge.Doc(), NovelSyncMerge.parse(null))
        assertEquals(NovelSyncMerge.Doc(), NovelSyncMerge.parse(JSONObject().put("v", 2).put("future", JSONObject()).toString()))
        val wrongKey = JSONObject().put("reading", JSONObject().put("novelbuddy:WAY3LXDy:Other999", JSONObject()
            .put("sourceId", nb).put("titleId", ogNb).put("chapterId", "Chap0001").put("chapterOrder", 0).put("chapterLabel", "Chapter 1")
            .put("paragraph", 1).put("paragraphCount", 2).put("updatedAt", now)))
        assertTrue(runCatching { NovelSyncMerge.parse(wrongKey.toString()) }.isFailure)
        val badRemoval = JSONObject().put("deleted", JSONObject().put("reading", JSONObject().put("../etc", now)))
        assertTrue(runCatching { NovelSyncMerge.parse(badRemoval.toString()) }.isFailure)
    }

    @Test fun newerProgressWinsBothWays() {
        val mine = reading(paragraph = 50, updatedAt = now - 10_000)
        var plan = NovelSyncMerge.plan(local(listOf(mine)), remoteOf(local(listOf(reading(paragraph = 5, updatedAt = now - 20_000)))), none, now)
        assertTrue(plan.readingUpsert.isEmpty())
        assertEquals(50, plan.doc.reading["novelbuddy:WAY3LXDy:Chap0001"]!!.paragraph)
        assertTrue(plan.changed)

        plan = NovelSyncMerge.plan(local(listOf(mine)), remoteOf(local(listOf(reading(paragraph = 90, updatedAt = now - 1_000)))), none, now)
        assertEquals(90, plan.readingUpsert.single().row.paragraph)
        assertEquals("Overgeared", plan.readingUpsert.single().title)
        assertFalse(plan.changed)

        plan = NovelSyncMerge.plan(local(listOf(mine)), remoteOf(local(listOf(mine))), none, now)
        assertFalse(plan.touchesLocal)
        assertFalse(plan.changed)
    }

    @Test fun aNewDevicePullsEverythingWithNames() {
        val other = local(
            listOf(reading(), reading(chapterId = "1735", label = "Chapter 1734", source = na, titleId = ogNa, title = "Overgeared (NA)")),
            listOf(list("plan_to_read")),
            listOf(title(seen = 2060)),
        )
        val plan = NovelSyncMerge.plan(local(), remoteOf(other), none, now)
        assertEquals(listOf("Overgeared", "Overgeared (NA)"), plan.readingUpsert.map { it.title }.sorted())
        assertEquals("plan_to_read", plan.listUpsert.single().row.status)
        assertEquals(2060, plan.titles.first { it.titleId == ogNb }.seen)
        assertFalse(plan.changed)
    }

    @Test fun removalsHideOtherDevicesRowsUntilReadAgain() {
        val theirs = remoteOf(local(listOf(reading(updatedAt = now - 50_000), reading(chapterId = "Chap0002", label = "Chapter 2", updatedAt = now - 40_000))))
        var plan = NovelSyncMerge.plan(local(), theirs, NovelSyncMerge.Removals(reading = mapOf("$nb:$ogNb" to now - 30_000)), now)
        assertTrue(plan.readingUpsert.isEmpty())
        assertTrue(plan.doc.reading.isEmpty())
        assertTrue(plan.changed)
        val after = NovelSyncMerge.parse(NovelSyncMerge.serialize(plan.doc))
        plan = NovelSyncMerge.plan(local(listOf(reading(updatedAt = now - 50_000))), after, none, now)
        assertEquals(listOf(Triple(nb, ogNb, "Chap0001")), plan.readingRemove)
        plan = NovelSyncMerge.plan(local(listOf(reading(updatedAt = now - 1_000))), after, none, now)
        assertTrue(plan.readingRemove.isEmpty())
        assertTrue(NovelSyncMerge.readingRemoved(mapOf("$nb:$ogNb:Chap0002" to now), reading(chapterId = "Chap0002").row))
        assertFalse(NovelSyncMerge.readingRemoved(mapOf("$nb:$ogNb:Chap0002" to now), reading().row))
    }

    @Test fun listEntriesMergeByTimeAndRemovalsStick() {
        val theirs = remoteOf(local(list = listOf(list("completed", now - 5_000))))
        var plan = NovelSyncMerge.plan(local(list = listOf(list("on_hold", now - 9_000))), theirs, none, now)
        assertEquals("completed", plan.listUpsert.single().row.status)
        plan = NovelSyncMerge.plan(local(), theirs, NovelSyncMerge.Removals(list = mapOf("$nb:$ogNb" to now - 1_000)), now)
        assertTrue(plan.listUpsert.isEmpty())
        assertTrue(plan.doc.list.isEmpty())
    }

    @Test fun linksMergeByLinkTime() {
        val key = "$na:$ogNa" // the smaller copy key names the novel
        val linked = listOf(title(novelKey = key, linkAt = now - 5_000), title(source = na, titleId = ogNa, novelKey = key, linkAt = now - 5_000))
        var plan = NovelSyncMerge.plan(local(titles = listOf(title())), remoteOf(local(titles = linked)), none, now)
        assertEquals(listOf(na to key, nb to key), plan.titles.map { it.source to it.novelKey }.sortedBy { it.first })
        val unlinked = listOf(title(linkAt = now - 1_000), title(source = na, titleId = ogNa, novelKey = key, linkAt = now - 1_000))
        plan = NovelSyncMerge.plan(local(titles = unlinked), remoteOf(local(titles = linked)), none, now)
        assertTrue(plan.titles.isEmpty())
        assertEquals("$nb:$ogNb", plan.doc.titles["$nb:$ogNb"]!!.novelKey)
        plan = NovelSyncMerge.plan(local(titles = listOf(title(titleId = "Lone1234"))), NovelSyncMerge.Doc(), none, now)
        assertTrue(plan.doc.titles.isEmpty())
        assertFalse(plan.changed)
    }

    @Test fun seenCountsMergeByMaximum() {
        val theirs = remoteOf(local(listOf(reading()), titles = listOf(title(seen = 2060))))
        var plan = NovelSyncMerge.plan(local(listOf(reading()), titles = listOf(title(seen = 2000))), theirs, none, now)
        assertEquals(2060, plan.titles.single().seen)
        plan = NovelSyncMerge.plan(local(listOf(reading()), titles = listOf(title(seen = 2100))), theirs, none, now)
        assertTrue(plan.titles.isEmpty())
        assertEquals(2100, plan.doc.titles["$nb:$ogNb"]!!.seen)
    }

    @Test fun oldRemovalsExpireUnlessStillPending() {
        val old = now - NovelSyncMerge.TOMBSTONE_TTL_MS - 1_000
        val doc = NovelSyncMerge.Doc(deleted = NovelSyncMerge.Removals(mapOf("$nb:$ogNb" to old), mapOf("$na:$ogNa" to old)))
        assertEquals(NovelSyncMerge.Removals(), NovelSyncMerge.plan(local(), doc, none, now).doc.deleted)
        val kept = NovelSyncMerge.plan(local(), doc, NovelSyncMerge.Removals(reading = mapOf("$nb:$ogNb" to old)), now).doc.deleted
        assertEquals(old, kept.reading["$nb:$ogNb"])
    }

    @Test fun rowsTheOtherDeviceWouldRefuseAreNeverUploaded() {
        val plan = NovelSyncMerge.plan(
            local(listOf(reading(), reading(chapterId = "bad/id"), reading(chapterId = "Chap0003", label = "")), listOf(list("watching")), listOf(title(novelKey = "elsewhere:1"))),
            NovelSyncMerge.Doc(), none, now,
        )
        assertEquals(setOf("$nb:$ogNb:Chap0001"), plan.doc.reading.keys)
        assertTrue(plan.doc.list.isEmpty())
        assertEquals(plan.doc, NovelSyncMerge.parse(NovelSyncMerge.serialize(plan.doc)))
    }

    @Test fun theDesktopWireFormatParses() {
        // Exactly what desktop's serializeNovelSyncDoc writes (sorted keys, null fields).
        val desktop = """{"v":1,"titles":{"novelbuddy:WAY3LXDy":{"title":"Overgeared","cover":null,"novelKey":"novelarchive:6a1637414f942c668d69a5a9","linkAt":1792316963869,"seen":2060}},""" +
            """"reading":{"novelbuddy:WAY3LXDy:Tab00005":{"sourceId":"novelbuddy","titleId":"WAY3LXDy","chapterId":"Tab00005","chapterOrder":4,"chapterLabel":"Chapter 5","paragraph":40,"paragraphCount":80,"updatedAt":1792316993869}},""" +
            """"list":{"novelbuddy:WAY3LXDy":{"sourceId":"novelbuddy","titleId":"WAY3LXDy","status":"reading","updatedAt":1792316993869}},""" +
            """"deleted":{"reading":{"novelbuddy:SoloQA01:Gone0001":1792317003869},"list":{}}}"""
        val doc = NovelSyncMerge.parse(desktop)
        assertEquals("novelarchive:6a1637414f942c668d69a5a9", doc.titles["novelbuddy:WAY3LXDy"]!!.novelKey)
        assertEquals(40, doc.reading["novelbuddy:WAY3LXDy:Tab00005"]!!.paragraph)
        assertEquals("reading", doc.list["novelbuddy:WAY3LXDy"]!!.status)
        assertNull(doc.titles["novelbuddy:WAY3LXDy"]!!.cover)
        assertEquals(1792317003869L, doc.deleted.reading["novelbuddy:SoloQA01:Gone0001"])
    }
}
