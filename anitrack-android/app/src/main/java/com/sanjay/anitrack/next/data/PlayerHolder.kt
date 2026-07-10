package com.sanjay.anitrack.next.data

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.mutableStateOf
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

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
                // Debug diagnosis: per-load lifecycle under the EventLogger tag
                // (shows exactly which post-seek load hangs on the pahe CDN).
                addAnalyticsListener(androidx.media3.exoplayer.util.EventLogger())
                // Load lifecycle — distinguishes the stall modes: started-but-
                // never-completed (blocked loader) vs never-started (load
                // control) vs cancel loops.
                addAnalyticsListener(object : androidx.media3.exoplayer.analytics.AnalyticsListener {
                    private fun tail(u: android.net.Uri) = u.lastPathSegment ?: u.toString()
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
                    ) { android.util.Log.w("AniTrackLoads", "error ${tail(l.uri)} canceled=$wasCanceled: ${e.message}") }
                })
            }
            .also { player = it }

    fun peek(): ExoPlayer? = player

    fun keyFor(index: Int): String =
        "${PlaySession.provider}|${PlaySession.resumeKey()}|$index|${PlaySession.subType}|${PlaySession.localFile}"

    /** Build the right data source (local file vs CDN with Referer/UA) and load. */
    fun setMedia(ctx: Context, s: PlaySession.Resolved) {
        val p = get(ctx)
        val isLocal = s.url.startsWith("file:")
        val factory: DataSource.Factory = if (isLocal) {
            DefaultDataSource.Factory(ctx.applicationContext)
        } else {
            val headers = mutableMapOf("Referer" to s.referer + "/")
            // Send the WebView's cookies for the stream host (kwik binding).
            runCatching {
                android.webkit.CookieManager.getInstance().getCookie(s.url)
                    ?.takeIf { it.isNotBlank() }?.let { headers["Cookie"] = it }
            }
            val engine = cronetEngine(ctx)
            if (engine != null) {
                androidx.media3.datasource.cronet.CronetDataSource.Factory(engine, cronetExecutor)
                    .setUserAgent(s.userAgent)
                    .setDefaultRequestProperties(headers)
                    .setHandleSetCookieRequests(true)
                    // A hung post-seek request now fails fast → onPlayerError
                    // recovery re-prepares, instead of buffering forever.
                    .setConnectionTimeoutMs(15_000)
                    .setReadTimeoutMs(15_000)
            } else {
                DefaultHttpDataSource.Factory()
                    .setUserAgent(s.userAgent)
                    .setDefaultRequestProperties(headers)
                    .setAllowCrossProtocolRedirects(true)
            }
        }
        val subtitleConfigs = s.subtitles.mapIndexed { i, sub ->
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub.url))
                .setMimeType(MimeTypes.TEXT_VTT)
                .setLanguage("en")
                .setLabel(sub.label)
                .setSelectionFlags(if (i == 0) C.SELECTION_FLAG_DEFAULT else 0)
                .build()
        }
        // Clear quality pins from the previous stream — a 1080p pin must not
        // leak onto a stream that only has 720p (or a different provider).
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .clearVideoSizeConstraints().build()

        // Wrap the CDN factory so every kwik .m3u8 reload is normalized to a
        // static VOD playlist. Without this, kwik re-serves the manifest with
        // no #EXT-X-ENDLIST after a seek → ExoPlayer flips it to live/dynamic →
        // the seek target is out of the "live" window → infinite buffering.
        val streamFactory: DataSource.Factory =
            if (isLocal) factory else VodManifestDataSource.Factory(factory)

        val isHls = s.url.contains(".m3u8") || isLocal
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
}
