package com.sanjay.anitrack.next.data.manga.comix

import android.content.Context
import android.graphics.*
import com.sanjay.anitrack.next.data.manga.MangaPage
import java.io.File
import java.net.InetAddress
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.*

/** Exact-image requests, no cookies, redirects, global hotlink rules or retry loop. */
internal class ComixImages(context: Context) {
    private val directory = File(context.cacheDir, "comix-pages")
    private val lock = Mutex() // Bounded decode memory; duplicate prefetch joins cache.
    private val client = OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .callTimeout(25, TimeUnit.SECONDS)
        .dns(object : Dns {
            override fun lookup(hostname: String): List<InetAddress> = Dns.SYSTEM.lookup(hostname).also { addresses ->
                require(addresses.isNotEmpty() && addresses.none(::privateAddress)) { "Unsafe Comix image destination." }
            }
        }).build()

    suspend fun resolve(page: MangaPage): MangaPage = withContext(Dispatchers.IO) {
        lock.withLock {
            val url = ComixProtocol.imageUrl(page.url)
            directory.mkdirs()
            val digest = MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
            val file = File(directory,"$digest.page")
            if (file.exists() && file.length() in 1..MAX_BYTES.toLong()) {
                file.setLastModified(System.currentTimeMillis())
                return@withLock page.copy(url=file.toURI().toString(),headers=emptyMap())
            }
            val request = Request.Builder().url(url).header("Referer", "${ComixProtocol.ORIGIN}/")
                .header("Origin",ComixProtocol.ORIGIN).build()
            val call = client.newCall(request)
            val response = await(call)
            val tmp = File(directory,"$digest.tmp")
            try {
                response.use { r ->
                    check(r.isSuccessful) { "Comix image HTTP ${r.code}. Retry this page manually." }
                    val body = r.body ?: error("Comix image has no data.")
                    require(body.contentLength() <= MAX_BYTES) { "Comix image too large." }
                    val buffer = java.io.ByteArrayOutputStream()
                    body.byteStream().use { stream ->
                        val chunk = ByteArray(8192)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = stream.read(chunk)
                            if (n < 0) break
                            require(buffer.size() + n <= MAX_BYTES) { "Comix image too large." }
                            buffer.write(chunk,0,n)
                        }
                    }
                    val bytes = ComixImageCodec.bytes(buffer.toByteArray(), r.header("x-enc-seed")?.toLongOrNull()?.toInt(),
                        r.header("x-enc-len")?.toIntOrNull(),r.header("x-enc-algo"))
                    require(ComixImageCodec.imageSignature(bytes)) { "Comix did not return a supported image." }
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                    require(bounds.outWidth > 0 && bounds.outHeight > 0 && bounds.outWidth.toLong() * bounds.outHeight <= MAX_PIXELS) { "Comix image dimensions too large." }
                    val seed = r.header("x-scramble-seed")?.toLongOrNull()?.toInt()
                    if (seed != null && seed != 0) {
                        require(r.header("x-scramble-grid") == "5x5") { "Unsupported Comix image grid." }
                        val order = ComixImageCodec.tileSources(seed,r.header("x-scramble-algo"),r.header("x-scramble-hash"))
                        val input = BitmapFactory.decodeByteArray(bytes,0,bytes.size) ?: error("Comix image could not be decoded.")
                        val output = Bitmap.createBitmap(input.width,input.height,Bitmap.Config.ARGB_8888)
                        try {
                            val canvas = Canvas(output)
                            canvas.drawBitmap(input,0f,0f,null) // Keep trailing pixels outside the 5x5 grid.
                            val w = input.width / 5; val h = input.height / 5
                            require(w > 0 && h > 0) { "Invalid Comix image grid." }
                            for (dst in 0 until 25) {
                                val src = order[dst]
                                canvas.drawBitmap(input,Rect(src%5*w,src/5*h,(src%5+1)*w,(src/5+1)*h),
                                    Rect(dst%5*w,dst/5*h,(dst%5+1)*w,(dst/5+1)*h),null)
                            }
                            tmp.outputStream().use { out -> check(output.compress(Bitmap.CompressFormat.PNG,100,out)) { "Comix image save failed." } }
                        } finally { input.recycle(); output.recycle() }
                    } else tmp.outputStream().use { it.write(bytes) }
                    currentCoroutineContext().ensureActive()
                    check(tmp.length() in 1..MAX_BYTES.toLong() && tmp.renameTo(file)) { "Comix page cache could not be saved." }
                    prune(file)
                    page.copy(url=file.toURI().toString(),width=bounds.outWidth,height=bounds.outHeight,headers=emptyMap())
                }
            } finally { response.close(); tmp.delete() }
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private suspend fun await(call: Call): Response = suspendCancellableCoroutine { c ->
        c.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: java.io.IOException) { if (c.isActive) c.resumeWith(Result.failure(e)) }
            override fun onResponse(call: Call, response: Response) {
                c.resume(response) { response.close() }
            }
        })
    }

    private fun prune(current: File) {
        val files = directory.listFiles()?.filter { it.extension == "page" }?.sortedBy { it.lastModified() } ?: return
        var total = files.sumOf { it.length() }
        for (file in files) {
            if (total <= 128L * 1024 * 1024) break
            if (file != current) { val size = file.length(); if (file.delete()) total -= size }
        }
    }

    companion object {
        private const val MAX_BYTES = 24 * 1024 * 1024
        private const val MAX_PIXELS = 12_000_000L
        internal fun privateAddress(address: InetAddress): Boolean {
            if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
                address.isSiteLocalAddress || address.isMulticastAddress) return true
            val b = address.address
            return if (b.size == 4) {
                val first = b[0].toInt() and 255; val second = b[1].toInt() and 255
                first == 0 || first >= 224 || (first == 100 && second in 64..127) ||
                    (first == 198 && second in 18..19)
            } else (b[0].toInt() and 254) == 252 // IPv6 unique-local.
        }
    }
}
