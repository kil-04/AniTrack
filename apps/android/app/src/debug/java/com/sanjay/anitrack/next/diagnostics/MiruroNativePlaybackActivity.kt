package com.sanjay.anitrack.next.diagnostics

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import androidx.media3.ui.PlayerView
import com.sanjay.anitrack.next.data.ScopedRequestAuthorization
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroMedia
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/** Native Media3 smoke test with no DB/MAL writes, signed-URL logging or automatic server retries. */
@androidx.annotation.OptIn(UnstableApi::class)
class MiruroNativePlaybackActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val executor = Executors.newCachedThreadPool()
    private var engine: org.chromium.net.CronetEngine? = null
    private var player: ExoPlayer? = null
    private var firstFrame = false
    private val frames = AtomicLong()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val candidate = media ?: run { finish(); return }
        val resolved = candidate.resolved(userAgent)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        val status = TextView(this).apply {
            text = "Native Miruro playback test · no watch progress saved"
            textSize = 16f; setTextColor(Color.WHITE); setPadding(24, 24, 24, 12)
        }
        layout.addView(status)
        layout.addView(Button(this).apply { text = "Close test"; setOnClickListener { finish() } })
        val video = PlayerView(this)
        layout.addView(video, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(layout)
        try {
            engine = runCatching { androidx.media3.datasource.cronet.CronetUtil.buildCronetEngine(this) }.getOrNull()
            val base: DataSource.Factory = engine?.let {
                androidx.media3.datasource.cronet.CronetDataSource.Factory(it, executor)
                    .setUserAgent(userAgent).setConnectionTimeoutMs(15_000).setReadTimeoutMs(15_000)
            } ?: DefaultHttpDataSource.Factory().setUserAgent(userAgent)
                .setAllowCrossProtocolRedirects(false).setConnectTimeoutMs(15_000).setReadTimeoutMs(15_000)
            val auth = ScopedRequestAuthorization.create(candidate.url, requireNotNull(resolved.authorizationScope), resolved.requestHeaders)
            val data = ResolvingDataSource.Factory(base, ResolvingDataSource.Resolver { spec ->
                val headers = auth?.headersFor(spec.uri.toString()).orEmpty()
                if (headers.isEmpty()) spec else spec.withAdditionalHeaders(headers)
            })
            val factory = DefaultMediaSourceFactory(data).setLoadErrorHandlingPolicy(object : DefaultLoadErrorHandlingPolicy() {
                override fun getRetryDelayMsFor(info: LoadErrorHandlingPolicy.LoadErrorInfo) = C.TIME_UNSET
                override fun getFallbackSelectionFor(options: LoadErrorHandlingPolicy.FallbackOptions,
                    info: LoadErrorHandlingPolicy.LoadErrorInfo): LoadErrorHandlingPolicy.FallbackSelection? = null
            })
            val native = ExoPlayer.Builder(this).setMediaSourceFactory(factory).build()
            player = native
            video.player = native
            native.addListener(object : Player.Listener {
                override fun onRenderedFirstFrame() { firstFrame = true }
                override fun onPlayerError(error: PlaybackException) {
                    result?.complete(Bundle().apply {
                        putBoolean("passed", false)
                        generateSequence<Throwable>(error) { it.cause }
                            .filterIsInstance<androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException>()
                            .firstOrNull()?.let { putInt("http_status", it.responseCode) }
                        putString("summary", "Native player failed: ${error.errorCodeName}; no source fallback or retry")
                    })
                }
            })
            native.setVideoFrameMetadataListener { _, _, _, _ -> frames.incrementAndGet(); Unit }
            val subtitles = candidate.subtitles.map { sub ->
                MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub.url)).setMimeType(sub.mimeType)
                    .setLabel(sub.label).setLanguage(sub.language).build()
            }
            native.setMediaItem(MediaItem.Builder().setUri(candidate.url)
                .setMimeType(if (candidate.hls) MimeTypes.APPLICATION_M3U8 else MimeTypes.VIDEO_MP4)
                .setSubtitleConfigurations(subtitles).build())
            native.prepare()
            native.play()
            scope.launch {
                try {
                    withTimeout(30_000) { while (!firstFrame || !native.isPlaying) delay(100) }
                    val start = native.currentPosition
                    val startingFrames = frames.get()
                    delay(10_000)
                    check(native.currentPosition - start >= 5_000 && frames.get() > startingFrames + 10) { "Playback did not advance" }
                    val report = Bundle().apply {
                        putBoolean("first_frame", true)
                        putInt("width", native.videoSize.width)
                        putInt("height", native.videoSize.height)
                    }
                    suspend fun seekTo(target: Long, key: String) {
                        val before = frames.get()
                        native.seekTo(target)
                        withTimeout(25_000) {
                            while (!native.isPlaying || kotlin.math.abs(native.currentPosition - target) > 12_000 || frames.get() < before + 5) delay(100)
                        }
                        delay(2_000)
                        report.putLong(key, native.currentPosition)
                    }
                    status.text = "Native video rendered. Testing forward/backward seeking…"
                    check(native.duration > 180_000) { "Duration too short for the seek test" }
                    seekTo(120_000, "forward_position_ms")
                    seekTo(30_000, "backward_position_ms")
                    report.putBoolean("passed", true)
                    report.putString("summary", "Native video advanced and resumed after forward/backward seeks")
                    result?.complete(report)
                } catch (_: Exception) {
                    result?.complete(Bundle().apply {
                        putBoolean("passed", false)
                        putBoolean("first_frame", firstFrame)
                        putString("summary", "Native playback/seek test did not complete; no automatic retry")
                    })
                }
            }
        } catch (_: Exception) {
            result?.complete(Bundle().apply { putBoolean("passed", false); putString("summary", "Native player setup failed") })
        }
    }

    override fun onPause() { player?.pause(); super.onPause() }
    override fun onDestroy() {
        scope.cancel()
        player?.release(); player = null
        runCatching { engine?.shutdown() }; engine = null
        executor.shutdown()
        result?.complete(Bundle().apply { putBoolean("passed", false); putString("summary", "Native test closed") })
        super.onDestroy()
    }

    companion object {
        @Volatile internal var media: MiruroMedia? = null
        @Volatile internal var userAgent = "AniTrack"
        @Volatile internal var result: CompletableFuture<Bundle>? = null
    }
}
