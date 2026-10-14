package com.sanjay.anitrack.next.diagnostics

import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.PlaySession
import com.sanjay.anitrack.next.data.PlayerHolder
import com.sanjay.anitrack.next.data.providers.Providers
import com.sanjay.anitrack.next.data.providers.connectors.MiruroAndroidProvider
import com.sanjay.anitrack.next.data.providers.connectors.MkissaProvider
import com.sanjay.anitrack.next.ui.AniTrackTheme
import com.sanjay.anitrack.next.ui.PlayerScreen
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicLong
import java.io.IOException
import kotlin.math.abs

/** Opted-in real provider/player UI check, never shipped or allowed to save/sync watch data. */
@androidx.annotation.OptIn(UnstableApi::class)
class ProviderPlaybackProbeActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val frames = AtomicLong()
    private var cues = 0
    private var started = false
    private var stage = "startup"
    private val progressReport = Bundle()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (request == null || result == null) { finish(); return }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent { AniTrackTheme { Text("Provider playback verification · no watch/account data saved") } }
        MiruroAndroidProvider.attach(this)
        com.sanjay.anitrack.next.data.Pahe.attach(this)
    }

    override fun onResume() {
        super.onResume()
        MiruroAndroidProvider.foreground(this, true)
        if (started) return
        started = true
        val config = request ?: return
        scope.launch {
            try {
                MkissaProvider.init(applicationContext)
                val provider = Providers.registry.get(config.provider)
                stage = "manual connection"
                provider.access?.let { if (!it.state.value.ready) check(it.connect()) { "Connection cancelled" } }
                stage = "catalogue"
                val series = withTimeout(60_000) { provider.match(config.anime) } ?: error("No verified catalogue")
                val episodeIndex = series.episodes.indexOfFirst { abs(it.number - config.episode) < 0.001f }
                check(episodeIndex >= 0) { "Requested episode not listed" }
                stage = "server choices"
                val variants = withTimeout(45_000) { series.episodes[episodeIndex].variants() }
                val fixedLabels = if (config.provider == "miruro") variants.take(256)
                    .mapNotNull { ProviderProbeMiruroChoices.label(it.id) } else emptyList()
                val catalogueReport = Bundle().apply {
                    putInt("episode_count", series.episodes.size); putInt("server_count", variants.size)
                    putString("known_server_choices", fixedLabels.joinToString("\n"))
                    putInt("unreported_server_choices", variants.size - fixedLabels.size)
                }
                progressReport.putAll(catalogueReport)
                log("catalogue", "episodes=${series.episodes.size} choices=${variants.size} episode=${config.episode}")
                if (config.catalogueOnly) {
                    catalogueReport.putBoolean("passed", true)
                    catalogueReport.putBoolean("catalogue_only", true)
                    catalogueReport.putBoolean("server_switch_tested", false)
                    catalogueReport.putString("summary", "Selected episode catalogue only; no native playback attempted")
                    result?.complete(catalogueReport)
                    return@launch
                }
                val selected = if (config.provider in setOf("anikoto", "animepahe") && variants.isEmpty()) null
                    else variants.singleOrNull { it.label == config.serverLabel }
                        ?: error("Requested server not listed unambiguously")
                val switch = config.switchLabel?.let { label -> variants.singleOrNull { it.label == label }
                    ?: error("Requested switch server not listed unambiguously") }
                PlayerHolder.release()
                PlaySession.startSeries(series, episodeIndex, config.anime.id, config.anime.title,
                    config.anime.cover, config.anime)
                val player = PlayerHolder.get(this@ProviderPlaybackProbeActivity)
                // Retain at most eight in-memory keys; URLs are never exported.
                val deniedLoadKinds = mutableMapOf<String, String>()
                player.addAnalyticsListener(object : AnalyticsListener {
                    override fun onLoadError(eventTime: AnalyticsListener.EventTime, loadEventInfo: LoadEventInfo,
                        mediaLoadData: MediaLoadData, error: IOException, wasCanceled: Boolean) {
                        val rejected = generateSequence<Throwable>(error) { it.cause }
                            .filterIsInstance<androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException>()
                            .firstOrNull() ?: return
                        val requestUri = rejected.dataSpec.uri.toString()
                        if (deniedLoadKinds.size >= 8 && requestUri !in deniedLoadKinds) return
                        val resolved = PlayerHolder.lastResolved
                        val kind = when (mediaLoadData.dataType) {
                            C.DATA_TYPE_MANIFEST -> ProviderProbeRequestKind.EngineLoadKind.MANIFEST
                            C.DATA_TYPE_MEDIA_INITIALIZATION -> ProviderProbeRequestKind.EngineLoadKind.INITIALIZATION
                            C.DATA_TYPE_MEDIA -> ProviderProbeRequestKind.EngineLoadKind.MEDIA
                            else -> ProviderProbeRequestKind.EngineLoadKind.OTHER
                        }
                        deniedLoadKinds[requestUri] = ProviderProbeRequestKind.withEngineContext(
                            ProviderProbeRequestKind.classify(requestUri, resolved?.url, resolved?.subtitles?.map { it.url }.orEmpty()),
                            kind, mediaLoadData.trackType == C.TRACK_TYPE_TEXT,
                        )
                    }
                })
                player.addListener(object : Player.Listener {
                    override fun onCues(cueGroup: CueGroup) {
                        if (cueGroup.cues.any { !it.text.isNullOrBlank() }) cues++
                    }
                    override fun onPlayerError(error: PlaybackException) {
                        val rejected = generateSequence<Throwable>(error) { it.cause }
                            .filterIsInstance<androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException>()
                            .firstOrNull()
                        result?.complete(Bundle().apply {
                            putAll(progressReport)
                            putBoolean("passed", false); putString("stage", stage)
                            putString("error", error.errorCodeName)
                            ProviderProbeFailureSubtype.classify(error)?.let { putString("failure_subtype", it) }
                            rejected?.let {
                                putInt("http_status", it.responseCode)
                                val resolved = PlayerHolder.lastResolved
                                val uriKind = ProviderProbeRequestKind.classify(
                                    it.dataSpec.uri.toString(), resolved?.url, resolved?.subtitles?.map { sub -> sub.url }.orEmpty(),
                                )
                                putString("request_kind", if (uriKind != "unknown") uriKind else deniedLoadKinds[it.dataSpec.uri.toString()] ?: "unknown")
                                putString("uri_request_kind", uriKind)
                                putBoolean("request_resolution_available", resolved != null)
                                // Report names only, never values, URLs, cookies or signed query fields.
                                putString("request_header_names", it.dataSpec.httpRequestHeaders.keys
                                    .filter { name -> name.matches(Regex("[A-Za-z-]{1,80}")) }.sorted().joinToString(","))
                            }
                        })
                    }
                })
                player.setVideoFrameMetadataListener { _, _, _, _ -> frames.incrementAndGet(); Unit }
                player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false).build()
                setContent { AniTrackTheme { PlayerScreen(onBack = { finish() }, onHome = { finish() },
                    saveWatchProgress = false, initialVariantId = selected?.id) } }
                stage = "first frame"
                var playRequested = false
                withTimeout(45_000) {
                    while (!player.isPlaying || frames.get() < 5) {
                        // The test requests playback explicitly, without changing stored autoplay.
                        if (!playRequested && player.playbackState == Player.STATE_READY) {
                            playRequested = true
                            player.play()
                        }
                        delay(100)
                    }
                }
                check(player.videoSize.width > 0 && player.videoSize.height > 0) { "No decoded video size" }
                val start = player.currentPosition
                val initialFrames = frames.get()
                fun snapshot() {
                    progressReport.putLong("media_progress_ms", player.currentPosition - start)
                    progressReport.putLong("video_frames", frames.get() - initialFrames)
                    progressReport.putInt("video_width", player.videoSize.width)
                    progressReport.putInt("video_height", player.videoSize.height)
                    progressReport.putInt("audio_buffers", player.audioDecoderCounters?.renderedOutputBufferCount ?: 0)
                    progressReport.putInt("playback_state", player.playbackState)
                    progressReport.putBoolean("playing", player.isPlaying)
                }
                snapshot()
                stage = "sustained playback"
                withTimeout(110_000) {
                    var lastLog = 0L
                    while (player.currentPosition - start < 65_000) {
                        // A listener may already have completed a precise failure report.
                        if (result!!.isDone) return@withTimeout
                        snapshot()
                        if (player.currentPosition - lastLog > 10_000) {
                            lastLog = player.currentPosition
                            log("progress", "positionMs=$lastLog frames=${frames.get()} captionEvents=$cues")
                        }
                        delay(250)
                    }
                }
                if (result!!.isDone) return@launch
                snapshot()
                stage = "sustained video frames"
                check(frames.get() > initialFrames + 200) { "Video frames did not advance" }
                stage = "audio output"
                check((player.audioDecoderCounters?.renderedOutputBufferCount ?: 0) > 0) { "Audio output was not verified" }
                val captionsOffered = PlayerHolder.lastResolved?.subtitles?.isNotEmpty() == true
                val report = progressReport.apply {
                    putAll(catalogueReport)
                    putInt("episode_count", series.episodes.size); putInt("server_count", variants.size)
                    putLong("media_progress_ms", player.currentPosition - start)
                    putInt("video_width", player.videoSize.width); putInt("video_height", player.videoSize.height)
                    putBoolean("audio_output", true); putBoolean("caption_offered", captionsOffered)
                    putInt("caption_events", cues)
                }
                suspend fun seek(target: Long, name: String) {
                    stage = name
                    val before = frames.get()
                    player.seekTo(target)
                    withTimeout(30_000) { while (!player.isPlaying || abs(player.currentPosition - target) > 12_000 || frames.get() < before + 10) delay(100) }
                    delay(1500)
                    report.putLong(name, player.currentPosition)
                    log(name, "positionMs=${player.currentPosition}")
                }
                check(player.duration > 180_000) { "Insufficient duration for seeks" }
                // An opening may have no dialogue. Sample captions after a real
                // forward seek as well, rather than treating a silent intro as a failure.
                seek((player.duration * 0.55).toLong().coerceIn(120_000, player.duration - 30_000), "forward_position_ms")
                if (captionsOffered && cues == 0) {
                    stage = "caption sample"
                    withTimeout(25_000) { while (cues == 0) delay(100) }
                }
                report.putInt("caption_events", cues)
                seek(30_000, "backward_position_ms")
                switch?.let { target ->
                    stage = "server chip"
                    val saved = player.currentPosition
                    val previous = PlayerHolder.lastResolved
                    val before = frames.get()
                    cues = 0
                    check(withContext(Dispatchers.IO) { clickServer?.invoke(target.label) == true }) { "Server chip click was not available" }
                    stage = "server switch"
                    withTimeout(45_000) {
                        while (PlayerHolder.lastResolved === previous || !player.isPlaying ||
                            abs(player.currentPosition - saved) > 12_000 || frames.get() < before + 10) delay(100)
                    }
                    if (PlayerHolder.lastResolved?.subtitles?.isNotEmpty() == true) {
                        withTimeout(25_000) { while (cues == 0) delay(100) }
                    }
                    report.putLong("switch_saved_ms", saved); report.putLong("switch_resumed_ms", player.currentPosition)
                    report.putInt("switch_caption_events", cues)
                    log("server-switch", "savedMs=$saved resumedMs=${player.currentPosition} captionEvents=$cues")
                }
                report.putBoolean("passed", true)
                report.putBoolean("server_switch_tested", switch != null)
                report.putString("summary", "Normal provider/player UI: video/audio >65s, offered captions and seeks verified" +
                    if (switch != null) "; selected server switch verified" else "")
                result?.complete(report)
            } catch (error: Exception) {
                result?.complete(Bundle().apply {
                    putAll(progressReport)
                    putBoolean("passed", false); putString("stage", stage)
                    putString("error", error.javaClass.simpleName)
                    ProviderProbeFailureSubtype.classify(error)?.let { putString("failure_subtype", it) }
                    // Details can contain signed URLs; never export raw exception messages.
                })
            }
        }
    }

    override fun onPause() {
        MiruroAndroidProvider.foreground(this, false)
        PlayerHolder.peek()?.pause()
        super.onPause()
    }

    override fun onDestroy() {
        scope.cancel()
        MiruroAndroidProvider.detach(this)
        PlayerHolder.release()
        result?.complete(Bundle().apply { putBoolean("passed", false); putString("stage", "closed") })
        super.onDestroy()
    }

    private fun log(name: String, value: String) { Log.i("AniTrackProbe", "$name $value") }

    internal data class Request(val provider: String, val anime: Anime, val episode: Float,
        val serverLabel: String, val switchLabel: String?, val catalogueOnly: Boolean = false)
    companion object {
        @Volatile internal var request: Request? = null
        @Volatile internal var result: CompletableFuture<Bundle>? = null
        @Volatile internal var clickServer: ((String) -> Boolean)? = null
    }
}
