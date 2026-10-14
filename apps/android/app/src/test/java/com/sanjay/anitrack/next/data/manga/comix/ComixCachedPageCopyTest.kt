package com.sanjay.anitrack.next.data.manga.comix

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.concurrent.CancellationException
import org.junit.Assert.*
import org.junit.Assume.assumeNoException
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ComixCachedPageCopyTest {
    @get:Rule val temporary = TemporaryFolder()
    private val name = "0123456789abcdef".repeat(4) + ".page"

    private fun fixture(): Triple<File, File, File> {
        val cache = temporary.newFolder("comix-pages")
        val page = File(cache, name).apply { writeBytes(ByteArray(100) { it.toByte() }) }
        val target = File(temporary.newFolder("offline"), "001.img")
        return Triple(cache, page, target)
    }

    private fun noPartial(target: File) = assertTrue(requireNotNull(target.parentFile).listFiles().orEmpty().none { it.name.endsWith(".part") })

    @Test fun decodedCacheBytesAreCopiedWithoutChangingTheOfflineFileName() {
        val (cache, page, target) = fixture()
        ComixCachedPageCopy(cache).copy("comix", page.toURI().toString(), target, 100) {}
        assertArrayEquals(page.readBytes(), target.readBytes())
        assertEquals("001.img", target.name)
        assertTrue(page.isFile)
        noPartial(target)
    }

    @Test fun successfulCopyAtomicallyReplacesAnExistingOfflinePage() {
        val (cache, page, target) = fixture()
        target.writeText("previous page")
        ComixCachedPageCopy(cache).copy("comix", page.toURI().toString(), target, 100) {}
        assertArrayEquals(page.readBytes(), target.readBytes())
        noPartial(target)
    }

    @Test fun declaredOversizeAndEmptySourcesNeverPublishOrLeaveAPartial() {
        val (cache, page, target) = fixture()
        val copy = ComixCachedPageCopy(cache)
        target.writeText("previous page")
        assertThrows(IOException::class.java) { copy.copy("comix", page.toURI().toString(), target, 99) {} }
        page.writeBytes(byteArrayOf())
        assertThrows(IOException::class.java) { copy.copy("comix", page.toURI().toString(), target, 100) {} }
        assertEquals("previous page", target.readText())
        noPartial(target)
    }

    @Test fun aFileGrowingAfterTheSizeCheckStillHitsTheStreamingBound() {
        val (cache, page, target) = fixture()
        page.writeBytes(ByteArray(4))
        var checks = 0
        assertThrows(IOException::class.java) {
            ComixCachedPageCopy(cache).copy("comix", page.toURI().toString(), target, 8) {
                if (++checks == 2) page.appendBytes(ByteArray(10))
            }
        }
        assertFalse(target.exists())
        noPartial(target)
    }

    @Test fun cancellationDuringTheCopyPreservesTheOldPageAndCleansThePartial() {
        val (cache, page, target) = fixture()
        target.writeText("previous page")
        var checks = 0
        assertThrows(CancellationException::class.java) {
            ComixCachedPageCopy(cache).copy("comix", page.toURI().toString(), target, 100) {
                if (++checks == 3) throw CancellationException("removed")
            }
        }
        assertTrue(checks > 1)
        assertEquals("previous page", target.readText())
        noPartial(target)
    }

    @Test fun anotherProviderCannotOptIntoFileCopies() {
        val (cache, page, target) = fixture()
        for (sourceId in listOf("mangadot", "mangaball", "Comix", "", "comix ")) {
            assertThrows(IllegalArgumentException::class.java) {
                ComixCachedPageCopy(cache).copy(sourceId, page.toURI().toString(), target, 100) {}
            }
        }
        assertFalse(target.exists())
        noPartial(target)
    }

    @Test fun foreignDirectoriesNestedFilesTraversalAndNonHashNamesAreRejected() {
        val (cache, page, target) = fixture()
        val foreign = File(temporary.newFolder("accounts"), name).apply { writeText("secret") }
        val nested = File(cache, "nested").apply { mkdir() }
        val nestedPage = File(nested, name).apply { writeText("nested") }
        val badNames = listOf("a".repeat(63) + ".page", "A".repeat(64) + ".page", "a".repeat(64) + ".tmp", "token.json")
        val invalid = mutableListOf(foreign.toURI().toString(), nestedPage.toURI().toString(), cache.toURI().toString())
        invalid += page.toURI().toString().replace("/comix-pages/", "/comix-pages/../comix-pages/")
        invalid += page.toURI().toString().replace("/comix-pages/", "/comix-pages//")
        invalid += badNames.map { File(cache, it).apply { writeText("invalid") }.toURI().toString() }
        for (url in invalid) {
            assertThrows("Rejected $url", IllegalArgumentException::class.java) {
                ComixCachedPageCopy(cache).copy("comix", url, target, 100) {}
            }
        }
        assertFalse(target.exists())
        noPartial(target)
    }

    @Test fun fileAuthoritiesQueriesFragmentsOpaqueUrlsAndEncodedAliasesAreRejected() {
        val (cache, page, target) = fixture()
        val url = page.toURI().toString()
        val invalid = listOf(
            "https://example.com/$name", "file:$name", "FILE:${page.toURI().rawPath}",
            "file://localhost${page.toURI().rawPath}", "file://account@localhost${page.toURI().rawPath}",
            "$url?session=x", "$url#page", url.replace(name, "%30" + name.drop(1)),
            url.replace(name, "%00$name"), url.replace(name, "%2e%2e/$name"),
            url.replace(name, "%2f$name"), url.replace(name, "%5c$name"),
            url + "\n", "file:\\" + page.path,
        )
        for (invalidUrl in invalid) {
            assertThrows(IllegalArgumentException::class.java) {
                ComixCachedPageCopy(cache).copy("comix", invalidUrl, target, 100) {}
            }
        }
        assertFalse(target.exists())
        noPartial(target)
    }

    @Test fun missingCachePagesAndInvalidSizeBoundsAreRejected() {
        val (cache, page, target) = fixture()
        val copy = ComixCachedPageCopy(cache)
        for (bound in listOf(0L, -1L)) assertThrows(IllegalArgumentException::class.java) {
            copy.copy("comix", page.toURI().toString(), target, bound) {}
        }
        page.delete()
        assertThrows(IllegalArgumentException::class.java) { copy.copy("comix", page.toURI().toString(), target, 100) {} }
        assertFalse(target.exists())
    }

    @Test fun legitimateEscapedSpacesInTheTrustedCacheRootRemainSupported() {
        val parent = temporary.newFolder("app cache")
        val cache = File(parent, "comix-pages").apply { mkdir() }
        val page = File(cache, name).apply { writeText("image") }
        val target = File(temporary.newFolder("offline"), "001.img")
        ComixCachedPageCopy(cache).copy("comix", page.toURI().toString(), target, 100) {}
        assertEquals("image", target.readText())
        noPartial(target)
    }

    private fun link(link: File, destination: File) {
        try { Files.createSymbolicLink(link.toPath(), destination.toPath()) }
        catch (e: IOException) { assumeNoException("The host must permit creating a test symlink.", e) }
        catch (e: UnsupportedOperationException) { assumeNoException(e) }
        catch (e: SecurityException) { assumeNoException(e) }
    }

    @Test fun symlinkedCachePageCannotReadAnAccountFile() {
        val (cache, page, target) = fixture()
        val account = File(temporary.root, "account.json").apply { writeText("secret") }
        page.delete()
        link(page, account)
        assertThrows(IllegalArgumentException::class.java) {
            ComixCachedPageCopy(cache).copy("comix", page.toURI().toString(), target, 100) {}
        }
        assertFalse(target.exists())
        assertEquals("secret", account.readText())
    }

    @Test fun symlinkedCacheDirectoryIsRejectedEvenWhenInitializedAsTheApprovedPath() {
        val (cache, page, target) = fixture()
        val aliasParent = temporary.newFolder("alias")
        val alias = File(aliasParent, "comix-pages")
        link(alias, cache)
        assertThrows(IllegalArgumentException::class.java) {
            ComixCachedPageCopy(alias).copy("comix", File(alias, page.name).toURI().toString(), target, 100) {}
        }
        assertFalse(target.exists())
    }

    @Test fun symlinkedDestinationCannotOverwriteAnotherFile() {
        val (cache, page, target) = fixture()
        val account = File(temporary.root, "account.json").apply { writeText("secret") }
        link(target, account)
        assertThrows(IOException::class.java) {
            ComixCachedPageCopy(cache).copy("comix", page.toURI().toString(), target, 100) {}
        }
        assertEquals("secret", account.readText())
        noPartial(target)
    }
}
