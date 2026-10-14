package com.sanjay.anitrack.next.data.manga.comix

import com.sanjay.anitrack.next.data.manga.MangaChapter
import com.sanjay.anitrack.next.data.manga.MangaPage
import com.sanjay.anitrack.next.data.manga.MangaSourceException
import com.sanjay.anitrack.next.data.manga.SourceTitle
import java.net.URI

/**
 * Data-only parser for a host-supplied Comix reader outerHTML snapshot.
 * It performs no network I/O and never evaluates the payload; it only scans
 * `<img class="rpage-page__img">` tags for their page URLs.
 */
internal const val COMIX_HTML_MAX_PAYLOAD = 4_000_000
internal const val COMIX_HTML_MAX_PAGES = 500

private const val PAGE_CLASS = "rpage-page__img"
private val imgTag = Regex("""<img\b(?:[^>"']|"[^"]*"|'[^']*')*>""", RegexOption.IGNORE_CASE)
private val attribute = Regex("""([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?""")
private val entity = Regex("""&(#x[0-9a-f]+|#[0-9]+|[a-z]+);""", RegexOption.IGNORE_CASE)
private val controlChars = Regex("[\\x00-\\x1f\\x7f]")
// Lazy readers keep a placeholder in `src` until the page scrolls into view.
private val lazySources = listOf("data-src", "data-lazy-src", "data-original")
private val entities = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'",
    "#39" to "'", "#x27" to "'", "#x2f" to "/", "#47" to "/")

private fun decodeEntities(value: String): String =
    entity.replace(value) { entities[it.groupValues[1].lowercase()] ?: it.value }

private fun attributes(tag: String): Map<String, String> {
    val body = tag.substring(4).removeSuffix(">").removeSuffix("/")
    val result = LinkedHashMap<String, String>()
    for (match in attribute.findAll(body)) {
        val (name, double, single, bare) = match.destructured
        result.putIfAbsent(name.lowercase(), decodeEntities(double.ifEmpty { single.ifEmpty { bare } }.trim()))
    }
    return result
}

private fun absolutePageUrl(raw: String?, base: URI): String? {
    if (raw.isNullOrEmpty() || raw.length > 4096 || controlChars.containsMatchIn(raw)) return null
    val url = runCatching { base.resolve(raw.replace(" ", "%20")) }.getOrNull() ?: return null
    if (url.scheme != "https" || url.host.isNullOrEmpty() || url.rawUserInfo != null ||
        (url.port != -1 && url.port != 443)) return null
    return url.toASCIIString().substringBefore('#')
}

/**
 * Returns absolute HTTPS page-image URLs in document order, without duplicates.
 * Encoded pages still go through [MangaSource.resolvePage] / the Comix codec.
 */
fun extractMangaPages(rawHtmlPayload: String?, baseUrl: String = "${ComixProtocol.ORIGIN}/"): List<String> {
    if (rawHtmlPayload.isNullOrEmpty()) return emptyList()
    require(rawHtmlPayload.length <= COMIX_HTML_MAX_PAYLOAD) { "Comix reader HTML is too large." }
    val base = URI(baseUrl)
    val pages = LinkedHashSet<String>()
    for (tag in imgTag.findAll(rawHtmlPayload)) {
        val attrs = attributes(tag.value)
        if (PAGE_CLASS !in attrs["class"].orEmpty().split(Regex("\\s+"))) continue
        val url = absolutePageUrl(attrs["src"], base)
            ?: lazySources.firstNotNullOfOrNull { absolutePageUrl(attrs[it], base) }
            ?: continue
        pages += url
        require(pages.size <= COMIX_HTML_MAX_PAGES) { "Comix chapter has too many pages." }
    }
    return pages.toList()
}

/** Supplies a chapter's pre-fetched reader outerHTML, or null to use the catalogue API. Fetching stays with the host. */
fun interface ComixReaderHtmlSource {
    suspend fun readerHtml(title: SourceTitle, chapter: MangaChapter): String?
}

/** Reader pages from a static snapshot, revalidated with the catalogue's image-URL policy. Data only. */
internal fun comixPagesFromHtml(rawHtmlPayload: String?): List<MangaPage> {
    val urls = try { extractMangaPages(rawHtmlPayload) } catch (e: IllegalArgumentException) {
        throw MangaSourceException(e.message ?: "Comix reader HTML was not readable.")
    }
    if (urls.isEmpty()) throw MangaSourceException("Comix reader HTML has no pages for this chapter.")
    return urls.mapNotNull { url -> runCatching { MangaPage(ComixProtocol.imageUrl(url)) }.getOrNull() }
        .ifEmpty { throw MangaSourceException("Comix reader HTML has no usable pages for this chapter.") }
}
