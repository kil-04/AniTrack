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

    /** Which stream is loaded, so re-entering the player doesn't restart it. */
    var loadedKey: String? = null
    var lastResolved: PlaySession.Resolved? = null

    /** True while the floating mini player should be shown. */
    val miniActive = mutableStateOf(false)

    fun get(ctx: Context): ExoPlayer =
        player ?: ExoPlayer.Builder(ctx.applicationContext).build()
            .apply { playWhenReady = true }
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
            DefaultHttpDataSource.Factory()
                .setUserAgent(s.userAgent)
                .setDefaultRequestProperties(mapOf("Referer" to s.referer + "/"))
                .setAllowCrossProtocolRedirects(true)
        }
        val subtitleConfigs = s.subtitles.mapIndexed { i, sub ->
            MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub.url))
                .setMimeType(MimeTypes.TEXT_VTT)
                .setLanguage("en")
                .setLabel(sub.label)
                .setSelectionFlags(if (i == 0) C.SELECTION_FLAG_DEFAULT else 0)
                .build()
        }
        val item = MediaItem.Builder().setUri(s.url).setSubtitleConfigurations(subtitleConfigs).build()
        // Clear quality pins from the previous stream — a 1080p pin must not
        // leak onto a stream that only has 720p (or a different provider).
        p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
            .clearVideoSizeConstraints().build()
        p.setMediaSource(DefaultMediaSourceFactory(factory).createMediaSource(item))
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
