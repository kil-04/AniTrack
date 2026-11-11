package com.sanjay.anitrack.next.data.novel

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Sources added after the first sync format (Novel Phoenix on) keep their rows under
// "more". Synthetic rows only; mirrors tests/novel-sync-more.test.mjs on desktop.
class NovelSyncMoreTest {
    private val now = 1_794_300_000_000L
    private val nb = "novelbuddy"
    private val np = "novelphoenix"
    private val ogNb = "WAY3LXDy"
    private val ssNp = "shadow-slave"

    private fun reading(paragraph: Int = 10, updatedAt: Long = now - 60_000) =
        NovelSyncMerge.LocalReading(NovelSyncMerge.Reading(nb, ogNb, "Chap0001", 0, "Chapter 1", paragraph, 100, updatedAt), "Overgeared", null)

    private fun npReading(paragraph: Int = 10, updatedAt: Long = now - 60_000) =
        NovelSyncMerge.LocalReading(NovelSyncMerge.Reading(np, ssNp, "12", 11, "Chapter 12: A Step", paragraph, 100, updatedAt), "Shadow Slave", null)

    private fun list(source: String = nb, titleId: String = ogNb, title: String = "Overgeared") =
        NovelSyncMerge.LocalList(NovelSyncMerge.ListRow(source, titleId, "reading", now - 60_000), title, null)

    private fun title(source: String = nb, titleId: String = ogNb, name: String = "Overgeared", novelKey: String = "$source:$titleId", linkAt: Long? = null, seen: Int? = null) =
        NovelSyncMerge.Title(source, titleId, name, null, novelKey, linkAt, seen)

    private fun local(reading: List<NovelSyncMerge.LocalReading> = emptyList(), list: List<NovelSyncMerge.LocalList> = emptyList(), titles: List<NovelSyncMerge.Title> = emptyList()) =
        NovelSyncMerge.Local(reading, list, titles)

    private val none = NovelSyncMerge.Removals()

    private fun remoteOf(l: NovelSyncMerge.Local, deleted: NovelSyncMerge.Removals = none) =
        NovelSyncMerge.parse(NovelSyncMerge.serialize(NovelSyncMerge.plan(l, NovelSyncMerge.Doc(), deleted, now).doc))

    private fun keys(o: JSONObject) = o.keys().asSequence().toSet()

    /** What an app from before Novel Phoenix accepts: the first sections, with its own key rules. */
    private fun olderAppAccepts(serialized: String): Boolean {
        val json = JSONObject(serialized)
        val copy = Regex("(novelbuddy|novelarchive):[A-Za-z0-9]{4,24}")
        val row = Regex("(novelbuddy|novelarchive):[A-Za-z0-9]{4,24}:[A-Za-z0-9]{1,24}")
        val titles = json.getJSONObject("titles")
        val deleted = json.getJSONObject("deleted")
        return keys(json.getJSONObject("reading")).all(row::matches) &&
            keys(json.getJSONObject("list")).all(copy::matches) &&
            keys(titles).all { copy.matches(it) && copy.matches(titles.getJSONObject(it).getString("novelKey")) } &&
            keys(deleted.getJSONObject("reading")).all { copy.matches(it) || row.matches(it) } &&
            keys(deleted.getJSONObject("list")).all(copy::matches)
    }

    private fun refused(content: JSONObject): String? = runCatching { NovelSyncMerge.parse(content.toString()) }.exceptionOrNull()?.message

    private fun rowJson(r: NovelSyncMerge.Reading) = JSONObject().put("sourceId", r.source).put("titleId", r.titleId).put("chapterId", r.chapterId)
        .put("chapterOrder", r.chapterOrder).put("chapterLabel", r.chapterLabel).put("paragraph", r.paragraph).put("paragraphCount", r.paragraphCount).put("updatedAt", r.updatedAt)

    @Test fun aLaterSourcesRowsLiveUnderMoreOutOfAnOlderAppsWay() {
        val plan = NovelSyncMerge.plan(
            local(
                reading = listOf(reading(), npReading()),
                list = listOf(list(), list(np, ssNp, "Shadow Slave")),
                titles = listOf(title(), title(np, ssNp, "Shadow Slave", seen = 3242)),
            ),
            NovelSyncMerge.Doc(),
            NovelSyncMerge.Removals(reading = mapOf("$np:$ssNp:3" to now - 5, "$nb:Other123" to now - 6), list = mapOf("$np:gone-novel" to now - 7)),
            now,
        )
        val text = NovelSyncMerge.serialize(plan.doc)
        val json = JSONObject(text)
        val more = json.getJSONObject("more")
        assertEquals(setOf("$nb:$ogNb:Chap0001"), keys(json.getJSONObject("reading")))
        assertEquals(setOf("$np:$ssNp:12"), keys(more.getJSONObject("reading")))
        assertEquals(setOf("$np:$ssNp"), keys(more.getJSONObject("list")))
        assertEquals(3242, more.getJSONObject("titles").getJSONObject("$np:$ssNp").getInt("seen"))
        assertEquals(setOf("$nb:Other123"), keys(json.getJSONObject("deleted").getJSONObject("reading")))
        assertEquals(now - 5, more.getJSONObject("deleted").getJSONObject("reading").getLong("$np:$ssNp:3"))
        assertEquals(now - 7, more.getJSONObject("deleted").getJSONObject("list").getLong("$np:gone-novel"))
        assertTrue(olderAppAccepts(text))
        // This version reads both parts back as one document.
        assertEquals(plan.doc, NovelSyncMerge.parse(text))
    }

    @Test fun aFileWithoutLaterSourceRowsHasNoMore() {
        val text = NovelSyncMerge.serialize(remoteOf(local(reading = listOf(reading()), list = listOf(list()), titles = listOf(title(seen = 5)))))
        assertFalse(JSONObject(text).has("more"))
        assertEquals(setOf("v", "titles", "reading", "list", "deleted"), keys(JSONObject(text)))
        assertTrue(olderAppAccepts(text))
    }

    @Test fun laterSourceProgressMergesLikeAnyOther() {
        val remote = remoteOf(local(reading = listOf(npReading(40, now - 10)), titles = listOf(title(np, ssNp, "Shadow Slave"))))
        val pull = NovelSyncMerge.plan(local(), remote, none, now)
        assertEquals(listOf(listOf(np, ssNp, "12", 40, "Shadow Slave")), pull.readingUpsert.map { listOf(it.row.source, it.row.titleId, it.row.chapterId, it.row.paragraph, it.title) })
        assertFalse(pull.changed)
        val newer = NovelSyncMerge.plan(local(reading = listOf(npReading(90, now - 1))), remote, none, now)
        assertEquals(90, newer.doc.reading["$np:$ssNp:12"]!!.paragraph)
        assertTrue(newer.changed)
        // A removal of the copy hides it for the other device too.
        val removed = NovelSyncMerge.plan(local(), remote, NovelSyncMerge.Removals(reading = mapOf("$np:$ssNp" to now)), now)
        assertTrue(removed.doc.reading.isEmpty())
        assertTrue(olderAppAccepts(NovelSyncMerge.serialize(removed.doc)))
    }

    @Test fun copiesLinkedAcrossFirstAndLaterSourcesKeepTheSmallestKey() {
        val key = "$nb:$ogNb"
        val plan = NovelSyncMerge.plan(
            local(titles = listOf(title(novelKey = key, linkAt = now - 3), title(np, "overgeared-novel", novelKey = key, linkAt = now - 3))),
            NovelSyncMerge.Doc(), none, now,
        )
        val text = NovelSyncMerge.serialize(plan.doc)
        val json = JSONObject(text)
        assertEquals(key, json.getJSONObject("titles").getJSONObject(key).getString("novelKey"))
        assertEquals(key, json.getJSONObject("more").getJSONObject("titles").getJSONObject("$np:overgeared-novel").getString("novelKey"))
        assertTrue(olderAppAccepts(text))
        assertEquals(plan.doc.titles, NovelSyncMerge.parse(text).titles)
        // A first-source copy filed under a later source's key can't sit where an older app reads.
        val odd = plan.doc.copy(titles = mapOf(key to NovelSyncMerge.DocTitle("Overgeared", null, "$np:a-novel", now, null)))
        val oddText = NovelSyncMerge.serialize(odd)
        assertTrue(olderAppAccepts(oddText))
        assertEquals("$np:a-novel", JSONObject(oddText).getJSONObject("more").getJSONObject("titles").getJSONObject(key).getString("novelKey"))
        assertEquals(odd.titles, NovelSyncMerge.parse(oddText).titles)
    }

    @Test fun aRowInTheWrongPartOfTheFileIsRefused() {
        fun of(name: String, value: JSONObject) = JSONObject().put(name, value)
        assertTrue(refused(of("reading", of("$np:$ssNp:12", rowJson(npReading().row))))!!.contains("reading row"))
        assertTrue(refused(of("more", of("reading", of("$nb:$ogNb:Chap0001", rowJson(reading().row)))))!!.contains("reading row"))
        val badSlug = JSONObject().put("sourceId", np).put("titleId", "Not_A_Slug").put("status", "reading").put("updatedAt", now)
        assertTrue(refused(of("more", of("list", of("$np:Not_A_Slug", badSlug))))!!.contains("list row"))
        assertTrue(refused(of("more", of("deleted", of("list", JSONObject().put("$nb:$ogNb", now)))))!!.contains("removal"))
        assertTrue(refused(JSONObject().put("more", JSONArray()))!!.contains("invalid section"))
        // An unknown source in the first sections is still an error (nothing there is ever skipped).
        val next = JSONObject().put("sourceId", "novelnext").put("titleId", "abc").put("status", "reading").put("updatedAt", now)
        assertTrue(refused(of("list", of("novelnext:abc", next)))!!.contains("list row"))
    }

    @Test fun rowsOfASourceOnlyANewerAppKnowsAreKeptAndWrittenBackUntouched() {
        val laterTitle = JSONObject().put("title", "Later").put("cover", JSONObject.NULL).put("novelKey", "novelnext:Some.Id_9").put("linkAt", JSONObject.NULL).put("seen", 4).put("extra", true)
        val future = JSONObject().put("v", 1)
            .put("titles", JSONObject()).put("reading", JSONObject()).put("list", JSONObject())
            .put("deleted", JSONObject().put("reading", JSONObject()).put("list", JSONObject()))
            .put("more", JSONObject()
                .put("titles", JSONObject()
                    .put("novelnext:Some.Id_9", laterTitle)
                    .put("$np:$ssNp", JSONObject().put("title", "Shadow Slave").put("cover", JSONObject.NULL).put("novelKey", "$np:$ssNp").put("linkAt", JSONObject.NULL).put("seen", JSONObject.NULL)))
                .put("reading", JSONObject()
                    .put("novelnext:Some.Id_9:c/1", JSONObject().put("anything", JSONArray().put(1).put(2).put(3)))
                    .put("$np:$ssNp:12", rowJson(npReading().row)))
                .put("list", JSONObject().put("novelnext:Some.Id_9", JSONObject().put("status", "reading")))
                .put("deleted", JSONObject().put("reading", JSONObject().put("novelnext:Some.Id_9:c/0", "soon")).put("list", JSONObject())))
        val doc = NovelSyncMerge.parse(future.toString())
        assertEquals(setOf("$np:$ssNp:12"), doc.reading.keys)
        assertEquals(setOf("novelnext:Some.Id_9:c/1"), doc.kept!!.reading.keys)
        // Nothing local to add: the file is left exactly as it was.
        assertFalse(NovelSyncMerge.plan(local(reading = listOf(npReading())), doc, none, now).changed)
        // A local change uploads, and the newer app's rows ride along unchanged.
        val plan = NovelSyncMerge.plan(local(reading = listOf(reading(), npReading())), doc, none, now)
        assertTrue(plan.changed)
        val out = JSONObject(NovelSyncMerge.serialize(plan.doc))
        val more = out.getJSONObject("more")
        val keptTitle = more.getJSONObject("titles").getJSONObject("novelnext:Some.Id_9")
        assertEquals(keys(laterTitle), keys(keptTitle))
        assertEquals(listOf("Later", "novelnext:Some.Id_9", 4, true), listOf(keptTitle.getString("title"), keptTitle.getString("novelKey"), keptTitle.getInt("seen"), keptTitle.getBoolean("extra")))
        assertTrue(keptTitle.isNull("cover") && keptTitle.isNull("linkAt"))
        assertEquals("[1,2,3]", more.getJSONObject("reading").getJSONObject("novelnext:Some.Id_9:c/1").getJSONArray("anything").toString())
        assertEquals("reading", more.getJSONObject("list").getJSONObject("novelnext:Some.Id_9").getString("status"))
        assertEquals("soon", more.getJSONObject("deleted").getJSONObject("reading").getString("novelnext:Some.Id_9:c/0"))
        assertEquals(setOf("$nb:$ogNb:Chap0001"), keys(out.getJSONObject("reading")))
        // A key that isn't even shaped like a source's is not kept: the file is refused.
        assertTrue(refused(JSONObject().put("more", JSONObject().put("list", JSONObject().put("No Source", JSONObject()))))!!.contains("list row"))
    }

    @Test fun theDesktopWireFormatWithMoreParses() {
        // Exactly what desktop's serializeNovelSyncDoc writes (sorted keys, null fields).
        val desktop = """{"v":1,"titles":{"novelbuddy:WAY3LXDy":{"title":"Overgeared","cover":null,"novelKey":"novelbuddy:WAY3LXDy","linkAt":1794299999995,"seen":2060}},"reading":{"novelbuddy:WAY3LXDy:Tab00005":{"sourceId":"novelbuddy","titleId":"WAY3LXDy","chapterId":"Tab00005","chapterOrder":4,"chapterLabel":"Chapter 5","paragraph":40,"paragraphCount":80,"updatedAt":1794299999970}},"list":{},"deleted":{"reading":{},"list":{"novelbuddy:Gone0001":1794299999992}},"more":{"titles":{"novelphoenix:overgeared-novel":{"title":"Overgeared","cover":null,"novelKey":"novelbuddy:WAY3LXDy","linkAt":1794299999995,"seen":null},"novelphoenix:shadow-slave":{"title":"Shadow Slave","cover":"https://novelphoenix.com/server-1/shadow-slave.jpg","novelKey":"novelphoenix:shadow-slave","linkAt":null,"seen":3242}},"reading":{"novelphoenix:shadow-slave:12":{"sourceId":"novelphoenix","titleId":"shadow-slave","chapterId":"12","chapterOrder":11,"chapterLabel":"Chapter 12: A Step","paragraph":10,"paragraphCount":100,"updatedAt":1794299999980}},"list":{"novelphoenix:shadow-slave":{"sourceId":"novelphoenix","titleId":"shadow-slave","status":"reading","updatedAt":1794299999990}},"deleted":{"reading":{"novelphoenix:shadow-slave:3":1794299999993},"list":{}}}}"""
        val doc = NovelSyncMerge.parse(desktop)
        assertEquals("novelbuddy:WAY3LXDy", doc.titles["novelphoenix:overgeared-novel"]!!.novelKey)
        assertEquals(3242, doc.titles["novelphoenix:shadow-slave"]!!.seen)
        assertEquals("https://novelphoenix.com/server-1/shadow-slave.jpg", doc.titles["novelphoenix:shadow-slave"]!!.cover)
        assertEquals(10, doc.reading["novelphoenix:shadow-slave:12"]!!.paragraph)
        assertEquals(40, doc.reading["novelbuddy:WAY3LXDy:Tab00005"]!!.paragraph)
        assertEquals("reading", doc.list["novelphoenix:shadow-slave"]!!.status)
        assertEquals(1794299999993L, doc.deleted.reading["novelphoenix:shadow-slave:3"])
        assertEquals(1794299999992L, doc.deleted.list["novelbuddy:Gone0001"])
        assertNull(doc.kept)
        // Reading it back and writing it again changes nothing: no needless upload.
        assertEquals(doc, NovelSyncMerge.parse(NovelSyncMerge.serialize(doc)))
    }
}
