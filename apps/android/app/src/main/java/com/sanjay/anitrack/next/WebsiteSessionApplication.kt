package com.sanjay.anitrack.next

import android.app.Application
import android.os.Build
import android.webkit.WebView
import coil.ImageLoader
import coil.ImageLoaderFactory

/** Establish the Comix cookie/storage profile before any WebView in that process. */
class WebsiteSessionApplication : Application(), ImageLoaderFactory {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= 28 && getProcessName().endsWith(":comix")) {
            WebView.setDataDirectorySuffix("comix")
        }
        com.sanjay.anitrack.next.data.manga.mangadot.MangaDotSource.init(this)
        com.sanjay.anitrack.next.data.manga.PageStrips.init(this)
        com.sanjay.anitrack.next.data.manga.MangaDownloads.init(this)
    }

    /**
     * Coil with room for cover-heavy screens: more parallel downloads per host
     * (OkHttp allows 5, so a grid of covers arrived in waves), a larger disk
     * cache, and MangaDex@Home load reporting (only affects *.mangadex.network).
     */
    override fun newImageLoader(): ImageLoader = ImageLoader.Builder(this)
        .okHttpClient {
            okhttp3.OkHttpClient.Builder()
                .dispatcher(okhttp3.Dispatcher().apply { maxRequests = 64; maxRequestsPerHost = 16 })
                .addInterceptor(com.sanjay.anitrack.next.data.manga.mangadex.MangaDexHomeReporter)
                .build()
        }
        .memoryCache { coil.memory.MemoryCache.Builder(this).maxSizePercent(0.25).build() }
        .diskCache {
            coil.disk.DiskCache.Builder()
                .directory(cacheDir.resolve("image_cache"))
                .maxSizeBytes(300L * 1024 * 1024)
                .build()
        }
        .build()
}
