package com.sanjay.anitrack.next.data.manga.comix

import java.io.File
import java.io.IOException
import java.net.URI
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption

/**
 * Copies only a decoded Comix cache page into the existing offline chapter.
 * The approved directory comes from Context.cacheDir, never from website data.
 * There is no network request, cookie access or arbitrary file-URL fallback.
 */
internal class ComixCachedPageCopy(approvedDirectory: File, private val expectedSource: String = "comix") {
    private val directory = approvedDirectory.absoluteFile
    private val canonicalDirectory = directory.canonicalFile

    init {
        require(expectedSource in setOf("comix", "toonkotsu") && directory.name == "$expectedSource-pages") { "Invalid decoded page cache directory." }
    }

    fun copy(
        sourceId: String,
        sourceUrl: String,
        target: File,
        maxBytes: Long,
        checkActive: () -> Unit,
    ) {
        require(maxBytes > 0) { "Invalid page size bound." }
        checkActive()
        val source = checkedSource(sourceId, sourceUrl)
        val size = Files.size(source.toPath())
        if (size !in 1..maxBytes) throw IOException("A cached page is empty or too large.")
        val parent = target.absoluteFile.parentFile ?: throw IOException("Couldn't save a page.")
        if (!parent.isDirectory || Files.isSymbolicLink(parent.toPath()) ||
            Files.isSymbolicLink(target.toPath()) || source.canonicalFile == target.canonicalFile) {
            throw IOException("Refused an unsafe page destination.")
        }
        val partial = Files.createTempFile(parent.toPath(), target.name + ".", ".part")
        try {
            Files.newInputStream(source.toPath(), StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS).use { input ->
                Files.newOutputStream(partial, StandardOpenOption.WRITE, StandardOpenOption.TRUNCATE_EXISTING).use { out ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        checkActive()
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        if (total > maxBytes) throw IOException("A cached page is too large.")
                        checkActive()
                        out.write(buffer, 0, count)
                    }
                    if (total == 0L) throw IOException("A cached page is empty.")
                }
            }
            checkActive()
            // Reject a cache link/replacement before publishing the completed copy.
            checkedSource(sourceId, sourceUrl)
            if (Files.isSymbolicLink(target.toPath())) throw IOException("Refused an unsafe page destination.")
            Files.move(partial, target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally {
            Files.deleteIfExists(partial)
        }
    }

    /** The decoded cache file behind a resolved Comix page, under the same exact-name checks as [copy]. */
    fun cachedFile(rawUrl: String): File = checkedSource(expectedSource, rawUrl)

    private fun checkedSource(sourceId: String, rawUrl: String): File {
        require(sourceId == expectedSource) { "Page source does not match its cache." }
        require(rawUrl.none { it.isISOControl() || it == '\\' }) { "Refused an unsafe cached page address." }
        val uri = try { URI(rawUrl) } catch (_: Exception) {
            throw IllegalArgumentException("Refused an unsafe cached page address.")
        }
        require(uri.scheme == "file" && !uri.isOpaque && uri.rawAuthority == null &&
            uri.rawQuery == null && uri.rawFragment == null && uri.path != null &&
            uri.path.none { it.isISOControl() || it == '\\' }) { "Refused an unsafe cached page address." }
        val source = try { File(uri).absoluteFile } catch (_: Exception) {
            throw IllegalArgumentException("Refused an unsafe cached page address.")
        }
        require(PAGE_NAME.matches(source.name) && source.parentFile == directory &&
            uri.rawPath == File(directory, source.name).toURI().rawPath) { "Refused an unsafe cached page address." }
        require(directory.isDirectory && !Files.isSymbolicLink(directory.toPath()) &&
            directory.canonicalFile == canonicalDirectory &&
            Files.isRegularFile(source.toPath(), LinkOption.NOFOLLOW_LINKS) &&
            !Files.isSymbolicLink(source.toPath()) &&
            source.canonicalFile == File(canonicalDirectory, source.name)) { "Refused an unsafe cached page address." }
        return source
    }

    private companion object {
        val PAGE_NAME = Regex("^[0-9a-f]{64}\\.page$")
    }
}
