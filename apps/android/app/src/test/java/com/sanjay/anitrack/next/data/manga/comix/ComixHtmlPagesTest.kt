package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.manga.SourceTitle
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class ComixHtmlPagesTest {
    private fun page(n: Int) = "https://img.example-cdn.net/c/42/$n.webp"

    @Test fun pageImagesInDocumentOrderOtherImagesIgnored() {
        val html = """<div class="rpage">
            <img class="site-logo" src="https://comix.to/logo.png">
            <img src="${page(1)}" class="rpage-page__img" alt="1">
            <img class='rpage-page__img is-loaded' alt=2 src='${page(2)}'/>
            <IMG CLASS="rpage-page__img" SRC=${page(3)}>
            <img class="rpage-page__img-wrapper" src="https://comix.to/x.png">
        </div>"""
        assertEquals(listOf(page(1), page(2), page(3)), extractMangaPages(html))
    }

    @Test fun relativeProtocolRelativeEntityAndLazySources() {
        val html = """
            <img class="rpage-page__img" src="/i/1.jpg?a=1&amp;b=2#frag">
            <img class="rpage-page__img" src="//img.example-cdn.net/2.jpg">
            <img class="rpage-page__img" src="data:image/gif;base64,R0lGOD" data-src="${page(3)}">
            <img class="rpage-page__img" data-alt=">" src="${page(4)}">"""
        assertEquals(listOf("https://comix.to/i/1.jpg?a=1&b=2", "https://img.example-cdn.net/2.jpg", page(3), page(4)),
            extractMangaPages(html))
    }

    @Test fun rejectsUnsafeUrlsAndDuplicatesAndNullInput() {
        val html = """
            <img class="rpage-page__img" src="http://img.example-cdn.net/1.jpg">
            <img class="rpage-page__img" src="https://user:pw@img.example-cdn.net/2.jpg">
            <img class="rpage-page__img" src="https://img.example-cdn.net:8443/3.jpg">
            <img class="rpage-page__img" src="javascript:alert(1)">
            <img class="rpage-page__img" src="${page(5)}"><img class="rpage-page__img" src="${page(5)}">"""
        assertEquals(listOf(page(5)), extractMangaPages(html))
        assertEquals(emptyList<String>(), extractMangaPages(null))
        assertEquals(emptyList<String>(), extractMangaPages(""))
    }

    @Test fun pagesFromHtmlApplyCatalogueImagePolicyAndFailClosed() {
        val html = """<img class="rpage-page__img" src="https://203.0.113.9/1.jpg">
            <img class="rpage-page__img" src="${page(2)}">"""
        assertEquals(listOf(MangaPage(page(2))), comixPagesFromHtml(html))
        assertThrows(MangaSourceException::class.java) { comixPagesFromHtml("<p>no pages</p>") }
        assertThrows(MangaSourceException::class.java) { comixPagesFromHtml("""<img class="rpage-page__img" src="https://203.0.113.9/1.jpg">""") }
    }

    @Test fun sourceUsesSuppliedSnapshotWithoutCatalogueHost(): Unit = runBlocking {
        val title = SourceTitle("comix", "abc123", "Example")
        val chapter = MangaChapter("42", 1f)
        ComixSource.readerHtml = ComixReaderHtmlSource { t, c ->
            assertEquals(title, t); assertEquals(chapter, c)
            """<img class="rpage-page__img" src="${page(1)}">"""
        }
        try {
            assertEquals(listOf(MangaPage(page(1))), ComixSource.pages(title, chapter))
            assertThrows(IllegalArgumentException::class.java) { runBlocking { ComixSource.pages(title, MangaChapter("../x", 1f)) } }
        } finally { ComixSource.readerHtml = null }
    }

    @Test fun boundedPageCount() {
        val html = (0..COMIX_HTML_MAX_PAGES).joinToString("") { """<img class="rpage-page__img" src="${page(it)}">""" }
        assertThrows(IllegalArgumentException::class.java) { extractMangaPages(html) }
    }
}
