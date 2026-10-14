package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.SourceTitle
import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ComixSavedChaptersTest {
    @get:Rule val folder = TemporaryFolder()
    private val dir get() = File(folder.root, "comix-chapters")
    private val store get() = ComixSavedChapters(dir)
    private val list = listOf(
        MangaChapter("101", 1f, "Black Swordsman", "Group A", 52, 1_700_000_000_000L),
        MangaChapter("102", 1f, group = "Group B"),
        MangaChapter("103", 1.5f),
    )

    private fun stored(hid: String) = JSONObject(File(dir, "$hid.json").readText())
    private fun rewrite(hid: String, edit: (JSONObject) -> Unit) =
        File(dir, "$hid.json").writeText(stored(hid).also(edit).toString())

    @Test fun completeListSurvivesANewStoreInstance() {
        store.write("abc12", list, at = 1_760_000_000_000L)
        assertEquals(ComixSavedChapters.Saved(1_760_000_000_000L, list), ComixSavedChapters(dir).read("abc12"))
        assertNull(store.read("other"))
    }

    @Test fun laterCompleteListReplacesTheSavedOneWhole() {
        store.write("abc12", list)
        val fresh = list + MangaChapter("104", 2f)
        store.write("abc12", fresh)
        assertEquals(fresh, store.read("abc12")?.chapters)
        assertFalse(File(dir, "abc12.json.tmp").exists())
    }

    @Test fun emptyOversizedOrUnsafeIdsAreNeverWritten() {
        store.write("abc12", emptyList())
        store.write("../x", list)
        store.write("abc12", List(ComixSavedChapters.MAX_CHAPTERS + 1) { MangaChapter("$it", it.toFloat()) })
        assertNull(store.read("abc12"))
        assertNull(store.read("../x"))
        assertTrue(dir.listFiles().orEmpty().none { it.name.endsWith(".json") })
    }

    @Test fun anyInvalidRowRejectsTheWholeList() {
        val edits = listOf<(JSONObject) -> Unit>(
            { it.getJSONArray("chapters").getJSONObject(1).put("id", "x1") },
            { it.getJSONArray("chapters").getJSONObject(1).put("number", -1) },
            { it.getJSONArray("chapters").getJSONObject(1).put("number", "2") },
            { it.getJSONArray("chapters").getJSONObject(0).put("title", 7) },
            { it.getJSONArray("chapters").getJSONObject(0).put("group", "g".repeat(121)) },
            { it.getJSONArray("chapters").getJSONObject(0).put("pageCount", 1.5) },
            { it.getJSONArray("chapters").getJSONObject(0).put("uploadedAt", 0) },
            { it.getJSONArray("chapters").getJSONObject(2).put("id", "101") },
            { it.getJSONArray("chapters").remove(2) },
            { it.put("total", 4) },
            { it.put("total", "3") },
            { it.put("hid", "other") },
            { it.put("v", 2) },
            { it.remove("at") },
            { it.put("at", -5) },
            { it.put("at", "1760000000000") },
            { it.put("at", 1.5) },
        )
        for (edit in edits) {
            store.write("abc12", list)
            rewrite("abc12", edit)
            assertNull(store.read("abc12"))
        }
    }

    @Test fun corruptOrOversizedFilesReadAsNothing() {
        dir.mkdirs()
        File(dir, "abc12.json").writeText("{\"v\":1,")
        assertNull(store.read("abc12"))
        File(dir, "abc12.json").writeText(" ".repeat(ComixSavedChapters.MAX_FILE_BYTES.toInt() + 1))
        assertNull(store.read("abc12"))
    }

    @Test fun savedListCountIsBounded() {
        repeat(ComixSavedChapters.MAX_LISTS + 5) { i ->
            store.write("t$i", list)
            File(dir, "t$i.json").setLastModified(1_000_000L + i * 1000L)
        }
        store.write("newest", list)
        val kept = dir.listFiles().orEmpty().filter { it.name.endsWith(".json") }
        assertEquals(ComixSavedChapters.MAX_LISTS, kept.size)
        assertNotNull(store.read("newest"))
        assertNull(store.read("t0"))
    }

    @Test fun confirmedMatchesPersistAndAreBounded() {
        store.saveTitle(30002, SourceTitle("comix", "abc12", "Berserk"))
        assertEquals(SourceTitle("comix", "abc12", "Berserk"), ComixSavedChapters(dir).title(30002))
        assertNull(store.title(1))
        store.saveTitle(5, SourceTitle("mangadot", "abc12", "Other source"))
        store.saveTitle(6, SourceTitle("comix", "../bad", "Bad id"))
        assertNull(store.title(5))
        assertNull(store.title(6))
        repeat(ComixSavedChapters.MAX_TITLES + 3) { store.saveTitle(100 + it, SourceTitle("comix", "h$it", "T$it")) }
        assertNull(store.title(30002))
        assertNotNull(store.title(100 + ComixSavedChapters.MAX_TITLES + 2))
    }

    @Test fun tamperedMatchIsIgnored() {
        store.saveTitle(30002, SourceTitle("comix", "abc12", "Berserk"))
        File(dir, "titles.json").writeText("""{"30002":{"id":"../x","title":"Berserk"}}""")
        assertNull(store.title(30002))
        File(dir, "titles.json").writeText("not json")
        assertNull(store.title(30002))
    }
}
