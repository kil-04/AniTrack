package com.sanjay.anitrack.next.data

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.compose.runtime.mutableStateOf
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.providers.SeekMode
import com.sanjay.anitrack.next.data.providers.StreamAuthorizationScope

/**
 * App-wide ExoPlayer owner — the desktop app's persistent player. The player
 * screen borrows this instance instead of creating its own, so navigating
 * away can hand playback to a floating MINI-PLAYER (bottom-right overlay in
 * AppShell) instead of stopping. Close on the mini player releases it.
 */
object PlayerHolder {
    private var player: ExoPlayer? = null

    // Chromium network stack for CDN requests (built once; null → fallback).
    private var cronet: org.chromium.net.CronetEngine? = null
    private var cronetTried = false
    // Unbounded: HLS loads manifest + key + several segments concurrently; a
    // small fixed pool can starve callbacks and hang a seek's re-request.
    private val cronetExecutor by lazy { java.util.concurrent.Executors.newCachedThreadPool() }
    private fun cronetEngine(ctx: Context): org.chromium.net.CronetEngine? {
        if (!cronetTried) {
            cronetTried = true
            cronet = try {
                androidx.media3.datasource.cronet.CronetUtil.buildCronetEngine(ctx.applicationContext)
            } catch (e: Throwable) {
                null
            }
        }
        return cronet
    }

    /** Which stream is loaded, so re-entering the player doesn't restart it. */
    var loadedKey: String? = null
    var lastResolved: PlaySession.Resolved? = null

    /** True while the floating mini player should be shown. */
    val miniActive = mutableStateOf(false)

    fun get(ctx: Context): ExoPlayer =
        player ?: ExoPlayer.Builder(ctx.applicationContext).build()
            .apply {
                playWhenReady = true
                // Safe default until setMedia() applies the connector's
                // resolved seek policy for the active stream.
                setSeekParameters(androidx.media3.exoplayer.SeekParameters.CLOSEST_SYNC)
                // Per-segment EventLogger output is useful for diagnosing CDN
                // stalls, but doing it in release builds adds work to every
                // HLS load and exposes expiring stream paths in device logs.
                if (com.sanjay.anitrack.next.BuildConfig.DEBUG) {
                    // Avoid EventLogger: its exception dumps can expose signed URLs.
                    addAnalyticsListener(object : androidx.media3.exoplayer.analytics.AnalyticsListener {
                        private fun tail(u: android.net.Uri) = "media" // Never print signed paths.
                        override fun onLoadStarted(
                            t: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                            l: androidx.media3.exoplayer.source.LoadEventInfo,
                            m: androidx.media3.exoplayer.source.MediaLoadData,
                            retryCount: Int,
                        ) { android.util.Log.d("AniTrackLoads", "start ${tail(l.uri)} retry=$retryCount") }
                        override fun onLoadCompleted(
                            t: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                            l: androidx.media3.exoplayer.source.LoadEventInfo,
                            m: androidx.media3.exoplayer.source.MediaLoadData,
                        ) { android.util.Log.d("AniTrackLoads", "done  ${tail(l.uri)} ${l.bytesLoaded}B ${l.loadDurationMs}ms") }
                        override fun onLoadCanceled(
                            t: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                            l: androidx.media3.exoplayer.source.LoadEventInfo,
                            m: androidx.media3.exoplayer.source.MediaLoadData,
                        ) { android.util.Log.d("AniTrackLoads", "cancel ${tail(l.uri)} after ${l.loadDurationMs}ms") }
                        override fun onLoadError(
                            t: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                            l: androidx.media3.exoplayer.source.LoadEventInfo,
                            m: androidx.media3.exoplayer.source.MediaLoadData,
                            e: java.io.IOException,
                            wasCanceled: Boolean,
                        ) { android.util.Log.w("AniTrackLoads", "error ${tail(l.uri)} track=${m.trackType} canceled=$wasCanceled: ${e.javaClass.simpleName}") }
                    })
                }
            }
            .also { player = it }

    fun peek(): ExoPlayer? = player

    fun keyFor(index: Int): String =
        "${PlaySession.provider}|${PlaySession.resumeKey()}|$index|${PlaySession.subType}|${PlaySession.localFile}"

    /** Build the right data source (local file vs CDN with Referer/UA) and load. */
    fun setMedia(ctx: Context, s: PlaySession.Resolved) {
        val p = get(ctx)
        val isLocal = s.url.startsWith("file:")
        val isHls = s.mimeType == MimeTypes.APPLICATION_M3U8 || s.url.contains(".m3u8") || isLocal
        p.setSeekParameters(
            when (s.seekMode) {
                SeekMode.EXACT -> androidx.media3.exoplayer.SeekParameters.EXACT
                SeekMode.CLOSEST_SYNC -> androidx.media3.exoplayer.SeekParameters.CLOSEST_SYNC
            },
        )
        val factory: DataSource.Factory = if (isLocal) {
            DefaultDataSource.Factory(ctx.applicationContext)
        } else {
            val headers = s.requestHeaders
                .filter { (name, value) ->
                    name.matches(Regex("^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$")) &&
                        name.lowercase() !in BLOCKED_REQUEST_HEADERS &&
                        value.length <= 8192 && !value.contains(Regex("[\\r\\n\\u0000]"))
                }
                .toMutableMap()
            s.referer.trim().takeIf { it.isNotEmpty() && headers.keys.none { name -> name.equals("Referer", true) } }?.let {
                headers["Referer"] = it.trimEnd('/') + "/"
            }
            // Send the WebView's cookies for the stream host (kwik binding).
            if (!s.conservativeNetwork) runCatching {
                android.webkit.CookieManager.getInstance().getCookie(s.url)
                    ?.takeIf { it.isNotBlank() && headers.keys.none { name -> name.equals("Cookie", true) } }
                    ?.let { headers["Cookie"] = it }
            }
            val engine = cronetEngine(ctx)
            check(engine != null || !s.conservativeNetwork) { "Secure native transport is unavailable. Please use another provider." }
            val baseFactory: DataSource.Factory = if (engine != null) {
                androidx.media3.datasource.cronet.CronetDataSource.Factory(engine, cronetExecutor)
                    .setUserAgent(s.userAgent)
                    .setHandleSetCookieRequests(!s.conservativeNetwork)
                    // A hung post-seek request now fails fast → onPlayerError
                    // recovery re-prepares, instead of buffering forever.
                    .setConnectionTimeoutMs(15_000)
                    .setReadTimeoutMs(15_000)
            } else {
                DefaultHttpDataSource.Factory()
                    .setUserAgent(s.userAgent)
                    .setAllowCrossProtocolRedirects(false)
            }
            val scope = s.authorizationScope
                ?: if (isHls) StreamAuthorizationScope.DIRECTORY else StreamAuthorizationScope.EXACT
            val authorization = ScopedRequestAuthorization.create(s.url, scope, headers)
            if (BuildConfig.DEBUG && PlaySession.provider == "anikoto") {
                val root = Uri.parse(s.url)
                Log.d(
                    "AniTrackAuth",
                    "root host=${root.host.orEmpty()} file=${root.lastPathSegment.orEmpty()} " +
                        "scope=$scope headers=${headers.keys.sorted().joinToString(",")}",
                )
            }
            ResolvingDataSource.Factory(
                baseFactory,
                ResolvingDataSource.Resolver { dataSpec ->
                    val scopedHeaders = authorization?.headersFor(dataSpec.uri.toString()).orEmpty()
                    if (BuildConfig.DEBUG && PlaySession.provider == "anikoto") {
                        Log.d(
                            "AniTrackAuth",
                            "request host=${dataSpec.uri.host.orEmpty()} " +
                                "file=${dataSpec.uri.lastPathSegment.orEmpty()} authorized=${scopedHeaders.isNotEmpty()}",
                        )
                    }
                    if (scopedHeaders.isEmpty()) dataSpec else dataSpec.withAdditionalHeaders(scopedHeaders)
                },
            )
        }
        val subtitleConfigs = s.subtitles.mapIndexed { i, sub ->
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub.url))
                .setMimeType(sub.mimeType)
                .setLanguage(sub.language)
                .setLabel(sub.label)
                .setSelectionFlags(if (i == 0) C.SELECTION_FLAG_DEFAULT else 0)
                .build()
        }
        // Clear quality pins from the previous stream — a 1080p pin must not
        // leak onto a stream that only has 720p (or a different provider).
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .clearVideoSizeConstraints().build()

        if (s.conservativeNetwork) {
            val policy = object : androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy() {
                override fun getRetryDelayMsFor(info: androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy.LoadErrorInfo) = C.TIME_UNSET
                override fun getFallbackSelectionFor(
                    options: androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy.FallbackOptions,
                    info: androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy.LoadErrorInfo,
                ): androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy.FallbackSelection? = null
            }
            val item = MediaItem.Builder().setUri(s.url).setMimeType(s.mimeType)
                .setSubtitleConfigurations(subtitleConfigs).build()
            p.setMediaSource(DefaultMediaSourceFactory(factory).setLoadErrorHandlingPolicy(policy).createMediaSource(item))
            p.prepare()
            return
        }

        // Wrap the CDN factory so every kwik .m3u8 reload is normalized to a
        // static VOD playlist. Without this, kwik re-serves the manifest with
        // no #EXT-X-ENDLIST after a seek → ExoPlayer flips it to live/dynamic →
        // the seek target is out of the "live" window → infinite buffering.
        val streamFactory: DataSource.Factory =
            if (isLocal) factory else VodManifestDataSource.Factory(factory)

        if (isHls && subtitleConfigs.isEmpty()) {
            // Kwik's TS is loosely muxed (PesReader start-code spam) — these
            // flags make the TS reader tolerant like a browser player.
            // Only used when there are no sideloaded subs: hand-built subtitle
            // sources feed legacy text/vtt samples that media3's TextRenderer
            // rejects ("Legacy decoding is disabled" crash on Anikoto).
            val extractors = androidx.media3.exoplayer.hls.DefaultHlsExtractorFactory(
                androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES or
                    androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory.FLAG_DETECT_ACCESS_UNITS,
                true,
            )
            val video = androidx.media3.exoplayer.hls.HlsMediaSource.Factory(streamFactory)
                .setExtractorFactory(extractors)
                .setAllowChunklessPreparation(true)
                // THE kwik seek fix (verified via load logs): post-seek chunk
                // loads park forever inside TimestampAdjuster.waitUntilInitialized
                // — the segment you jump to waits for an earlier "primary"
                // segment to seed the shared HLS timestamp adjuster, which never
                // comes. This timeout unblocks it (media3's escape hatch for
                // exactly such streams); 2.5s keeps the post-seek pause short.
                .setTimestampAdjusterInitializationTimeoutMs(2_500)
                .createMediaSource(MediaItem.Builder().setUri(s.url).build())
            p.setMediaSource(video)
        } else {
            // Subtitled streams go through DefaultMediaSourceFactory, which
            // transcodes sideloaded subs to media3 cues (the supported path).
            val item = MediaItem.Builder().setUri(s.url).setSubtitleConfigurations(subtitleConfigs).build()
            p.setMediaSource(DefaultMediaSourceFactory(streamFactory).createMediaSource(item))
        }
        p.prepare()
    }

    /** Stop and free everything (mini player ✕, or app teardown). */
    fun release() {
        player?.release()
        player = null
        loadedKey = null
        lastResolved = null
        miniActive.value = false
    }

    private val BLOCKED_REQUEST_HEADERS = setOf(
        "connection",
        "content-length",
        "host",
        "proxy-authorization",
        "proxy-connection",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    )
}
