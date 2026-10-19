package com.sanjay.anitrack.next.data.manga.xcomic

import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.SourceLatest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as tests/xcomic.test.mjs (shapes from xcomic.me, 19 Oct 2026). */
class XComicParserTest {
    private fun card(id: String, flag: String, name: String, chapters: String, follows: String, latest: String, time: String, group: String?) =
        """<div :="$id" class="border border-base-300 hover:bg-base-200 relative"><div : class="flex"><div : class="flex-1 min-w-0 p-2 space-y-2"><div : class="flex items-baseline min-w-0"><span : class="md:truncate"><span class="font-family-NotoColorEmoji mr-1" :="c2_0">$flag</span><a href="/source/$id" : class="link-hover link-pri font-medium">$name</a></span></div><div : class="flex flex-nowrap items-baseline gap-2 min-w-0 text-md truncate"><span class="font-variant-small-caps text-success" :="fJ_0">Ongoing</span><span : class="opacity-60">$chapters chapters · $follows follows</span></div><div : class="flex flex-nowrap"><a href="/chapter/abc$id" : class="link-hover link-primary truncate">$latest</a><time class="opacity-60" data-time="$time" :="jq_1"><span>9d ago</span></time></div></div></div>""" +
            (if (group != null) """<div :="1a_8" class="absolute -left-1 -top-2"><span : class="px-1.5 border border-primary/30 bg-base-100 text-primary text-xs rounded-box whitespace-nowrap line-clamp-1 truncate">$group</span></div>""" else "") + "</div>"

    private val hub = """<h3 class="text-2xl">ONE PIECE</h3><a href="https://anilist.co/manga/30013">AniList</a><a href="https://myanimelist.net/manga/13">MAL</a><div : class="grid gap-3">""" +
        card("m78yb8", "🇬🇧", "One Piece", "1,199", "0", "Chapter 1195", "1791534731786", "TCB Scans") +
        card("8kybo", "🇬🇧", "One Piece", "1,172", "4,597", "Chapter 1171", "1768567503087", null) +
        card("ptbr1", "🇧🇷", "One Piece", "1,300", "9", "Capítulo 1180", "1791534731000", null) +
        card("8kybo", "🇬🇧", "dup", "1", "1", "Chapter 1", "1", null) + "</div>"

    private fun row(id: String, label: String, name: String?, time: String) =
        """<div class="break-inside-avoid px-2 py-2 flex justify-between items-baseline border border-base-300/90 rounded-box" :="Ev_5"><div : class="flex-1 min-w-0 truncate space-x-1"><a href="/chapter/$id" : class="link-hover link-primary visited:text-accent">$label</a>""" +
            (if (name != null) """<span :="Ev_1" class="opacity-80">: $name</span>""" else "") +
            """</div><div : class="flex-none"><dpv : class="pl-2"><time class="" data-time="$time" :="jq_1"><span>275d ago</span></time></dpv></div></div>"""

    private val edition = """<div class="gap-2 space-y-2 columns-1">""" +
        row("xj263r3", "Chapter 1171", "Ragnir", "1768567503087") + row("46x5qa2", "Vol.TBE Ch.1170", "Contradictions", "1768000000000") +
        row("vol9999", "Volume 105", null, "1") + row("xjqyjr3", "Volume 105 Chapter 1065.5", null, "1700000000000") +
        """</div><a href="/source/8kybo?page=1">1</a><a href="/source/8kybo?page=2">2</a><a href="/source/8kybo?page=6">6</a>"""

    @Test fun searchIds() {
        val html = """<a href="/title/kolxr"><img alt="ONE PIECE"></a><a href="/title/kolxr">ONE PIECE</a><a href="/title/x8jxo">x</a><a href="/title/BAD!">y</a>"""
        assertEquals(listOf("kolxr", "x8jxo"), XComicParser.searchIds(html))
    }

    @Test fun editionsAndTheBestEnglishOne() {
        val editions = XComicParser.editions(hub)
        assertEquals(3, editions.size)
        assertEquals(XComicParser.Edition("m78yb8", "One Piece", "🇬🇧", 1199, 0, 1195f, 1791534731786L, "TCB Scans"), editions[0])
        assertEquals(4597, editions[1].follows)
        assertEquals("m78yb8", XComicParser.bestEdition(editions)?.id)
    }

    @Test fun titleDetail() {
        val detail = XComicParser.detail(hub, "kolxr")!!
        assertEquals("kolxr.m78yb8", detail.ref)
        assertEquals("ONE PIECE", detail.title)
        assertEquals(30013, detail.anilistId)
        assertEquals(13, detail.malId)
        assertEquals(1195f, detail.latestChapter)
        assertEquals("kolxr" to "m78yb8", XComicParser.parseTitleRef(detail.ref))
        assertNull(XComicParser.parseTitleRef("kolxr"))
        assertNull(XComicParser.detail(hub.replace("🇬🇧", "🇫🇷"), "kolxr"))
    }

    @Test fun chapterRows() {
        val page = XComicParser.chapters(edition, "TCB Scans")
        assertEquals(6, page.lastPage)
        assertEquals(listOf(1171f, 1170f, 1065.5f), page.chapters.map { it.number })
        assertEquals(MangaChapter("xj263r3", 1171f, "Ragnir", "TCB Scans", null, 1768567503087L), page.chapters[0])
        assertNull(page.chapters[2].title)
        assertEquals(SourceLatest(1171f, 1768567503087L), XComicParser.latest(edition))
        assertNull(XComicParser.chapterNumber("Capítulo 12"))
        // Without a group passed in, the edition's badge above the list names it.
        val badged = """<span : class="px-1.5 text-xs rounded-box whitespace-nowrap">TCB Scans</span>""" + edition
        assertEquals("TCB Scans", XComicParser.chapters(badged).chapters[0].group)
        assertNull(XComicParser.chapters(edition).chapters[0].group)
        assertEquals(12f, XComicParser.chapterNumber("12"))
    }

    @Test fun pageImages() {
        val html = """..."vote_val",0,9.4],0,"imageUrls",4,[0,"https://i04.img00.org/_f/3b/Bp/lxXvpB/a.webp",0,"https://i09.img02.org/_f/3b/Bp/lxXvpB/b.webp",0,"https://evil.example/_f/c.webp",0,"https://i04.img00.org/_f/3b/Bp/lxXvpB/a.webp"],0,"next"..."""
        assertEquals(listOf("https://i04.img00.org/_f/3b/Bp/lxXvpB/a.webp", "https://i09.img02.org/_f/3b/Bp/lxXvpB/b.webp"), XComicParser.pages(html))
        assertTrue(XComicParser.pages("<p>no state</p>").isEmpty())
        assertTrue(XComicParser.isImage("https://i01.img02.org/_f/x.webp"))
        assertFalse(XComicParser.isImage("https://img02.org/_f/x.webp"))
        assertFalse(XComicParser.isImage("http://i01.img02.org/_f/x.webp"))
    }
}
