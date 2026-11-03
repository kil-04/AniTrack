package com.sanjay.anitrack.next.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AnikotoSearchTest {
    // Synthetic search page, mirroring tests/anikoto-provider.test.mjs: div.item cards hold
    // m-item children and a sidebar of m-item rows follows.
    private fun card(slug: String, title: String) = """<div class="item"><div class="ani poster"><a href="/watch/$slug"><img src="/p/$slug.jpg" alt="$title"></a></div>""" +
        """<div class="m-item rated"><div class="ep-status total"><span>12</span></div></div><a class="name" data-jp="$title" href="/watch/$slug">$title</a></div>"""
    private val sidebar = """<aside class="sidebar"><div class="m-item"><a href="/watch/stray-sidebar-show">Stray</a></div><div class="item"><a href="/watch/stray-sidebar-card">Stray</a></div></aside>"""

    @Test fun onlyResultCardsBecomeBlocks() {
        val blocks = Anikoto.searchCards("<main>${card("real-show", "Real Show")}<ul class=\"pagination\"></ul></main>$sidebar", "item")
        assertEquals(1, blocks.size)
        assertTrue(blocks[0].contains("/watch/real-show"))
        assertFalse(blocks[0].contains("stray-sidebar"))
        assertTrue(Anikoto.searchCards("""<div class="m-item">x</div>""", "item").isEmpty())
    }

    @Test fun pageTwoOnlyWhenLinkedOrPaginationMissing() {
        assertFalse(Anikoto.searchHasNextPage("""${card("a", "A")}<ul class="pagination"></ul>"""))
        assertTrue(Anikoto.searchHasNextPage("""<ul class="pagination"><li><a class="page-link" href="/filter?keyword=x&amp;page=2">2</a></li></ul>"""))
        assertFalse(Anikoto.searchHasNextPage("""<nav class="pagination"><a href="?page=12">12</a></nav>"""))
        assertTrue(Anikoto.searchHasNextPage(card("a", "A")))
    }
}
