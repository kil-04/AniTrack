package com.sanjay.anitrack.next.data.manga

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Rect
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Long-strip pages (webtoon chapters stitched into one image, e.g. 1200×16848)
 * are taller than the GPU can draw as one bitmap and render blank. They are
 * downloaded once to a bounded cache file and decoded in horizontal slices,
 * so only the slices on screen occupy memory and each stays sharp.
 */
object PageStrips {
    /** Source pixels per slice: well under every GPU texture limit. */
    const val SLICE_HEIGHT = 2048
    private const val MAX_BYTES = 40L * 1024 * 1024
    private const val CACHE_BYTES = 300L * 1024 * 1024

    private var directory: File? = null
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val decoders = object : LinkedHashMap<String, BitmapRegionDecoder>(4, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, BitmapRegionDecoder>): Boolean {
            if (size <= 3) return false
            eldest.value.recycle()
            return true
        }
    }
    private val client by lazy {
        OkHttpClient.Builder()
            .dns(MangaPublicDns)
            .connectTimeout(15, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .build()
    }

    fun init(context: Context) {
        directory = File(context.cacheDir, "manga-strips")
    }

    /** Pages too tall to draw as one bitmap. Unknown sizes are not strips. */
    fun isTall(width: Int?, height: Int?): Boolean =
        width != null && height != null && width > 0 && height > 0 && (height > 4096 || height > width * 3)

    /** Slice boundaries; a short remainder joins the previous slice. */
    fun slices(height: Int): List<IntRange> {
        if (height <= 0) return emptyList()
        val out = ArrayList<IntRange>()
        var top = 0
        while (top < height) {
            var bottom = minOf(height, top + SLICE_HEIGHT)
            if (height - bottom in 1 until SLICE_HEIGHT / 4) bottom = height
            out += top until bottom
            top = bottom
        }
        return out
    }

    /** Power-of-two downsampling only when the source is at least twice the target width. */
    fun sampleSize(sourceWidth: Int, targetWidth: Int): Int {
        var sample = 1
        while (targetWidth > 0 && sourceWidth / (sample * 2) >= targetWidth) sample *= 2
        return sample
    }

    /** The page image as a local file, downloaded once (headers apply to this URL only). */
    suspend fun file(page: MangaPage): File = withContext(Dispatchers.IO) {
        // Downloaded chapters are already on disk (only inside AniTrack's download folder).
        if (page.url.startsWith("file:")) {
            val local = runCatching { File(java.net.URI(page.url)).canonicalFile }.getOrNull()
            val downloads = MangaDownloads.directory()?.canonicalFile
            if (local != null && downloads != null && local.path.startsWith(downloads.path + File.separator) && local.isFile) {
                return@withContext local
            }
            throw MangaSourceException("This downloaded page is missing. Download the chapter again.")
        }
        val dir = directory ?: throw MangaSourceException("The reader isn't ready yet. Reopen AniTrack.")
        val url = MangaUrlPolicy.publicHttps(page.url)?.toASCIIString()
            ?: throw MangaSourceException("Refused an unsafe page address.")
        val name = MessageDigest.getInstance("SHA-256").digest(url.toByteArray())
            .joinToString("") { "%02x".format(it) }
        val target = File(dir, "$name.img")
        locks.getOrPut(name) { Mutex() }.withLock {
            if (target.isFile && target.length() > 0) {
                target.setLastModified(System.currentTimeMillis())
                return@withLock target
            }
            dir.mkdirs()
            val request = Request.Builder().url(url)
                .apply { page.headers.forEach { (k, v) -> header(k, v) } }
                .build()
            val partial = File(dir, "$name.part")
            client.newCall(request).await().use { response ->
                if (!response.isSuccessful) throw MangaSourceException("This page didn't load (HTTP ${response.code}). Retry.")
                val body = response.body ?: throw MangaSourceException("This page came back empty. Retry.")
                if (body.contentLength() > MAX_BYTES) throw MangaSourceException("This page is too large to show.")
                partial.outputStream().use { out ->
                    body.byteStream().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        var total = 0L
                        while (true) {
                            val n = input.read(buffer)
                            if (n < 0) break
                            total += n
                            if (total > MAX_BYTES) throw MangaSourceException("This page is too large to show.")
                            out.write(buffer, 0, n)
                        }
                    }
                }
            }
            if (!partial.renameTo(target)) {
                partial.delete()
                throw MangaSourceException("Couldn't save this page. Retry.")
            }
            evict(dir)
            target
        }
    }

    /** Decodes source rows [rows] of [file] for display at about [targetWidth] pixels wide. */
    suspend fun decode(file: File, rows: IntRange, sourceWidth: Int, targetWidth: Int): Bitmap = withContext(Dispatchers.IO) {
        val options = BitmapFactory.Options().apply {
            inSampleSize = sampleSize(sourceWidth, targetWidth)
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        synchronized(decoders) {
            val decoder = decoders.getOrPut(file.path) {
                @Suppress("DEPRECATION")
                if (Build.VERSION.SDK_INT >= 31) BitmapRegionDecoder.newInstance(file.path)
                else BitmapRegionDecoder.newInstance(file.path, false)
                    ?: throw MangaSourceException("This page couldn't be decoded.")
            }
            val bottom = minOf(rows.last + 1, decoder.height)
            val rect = Rect(0, rows.first, minOf(sourceWidth, decoder.width), bottom)
            decoder.decodeRegion(rect, options) ?: throw MangaSourceException("This page couldn't be decoded.")
        }
    }

    private fun evict(dir: File) {
        val files = dir.listFiles { f -> f.name.endsWith(".img") }?.sortedBy { it.lastModified() } ?: return
        var total = files.sumOf { it.length() }
        for (file in files) {
            if (total <= CACHE_BYTES) break
            total -= file.length()
            synchronized(decoders) { decoders.remove(file.path)?.recycle() }
            file.delete()
        }
    }
}
