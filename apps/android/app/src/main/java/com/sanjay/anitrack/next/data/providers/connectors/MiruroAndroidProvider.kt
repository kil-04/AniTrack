package com.sanjay.anitrack.next.data.providers.connectors

import android.app.Activity
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.ProviderAccess
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroBrowserSession
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroReadRequest
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroMediaParser
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Debug-only availability until normal-player and lifecycle testing is complete. */
object MiruroAndroidProvider : AnimeProvider {
    private val browser = MiruroBrowserSession()
    private val adapter = MiruroProvider({ request ->
        browser.read(request).also { payload ->
            if (BuildConfig.DEBUG && request is MiruroReadRequest.Sources) {
                val subs = payload.optJSONArray("subtitles")
                val details = (0 until minOf(subs?.length() ?: 0, 32)).joinToString(";") { i ->
                    val sub = subs?.optJSONObject(i)
                    fun safe(value: String?) = value?.lowercase()?.takeIf { it in setOf(
                        "vtt", "webvtt", "text/vtt", "srt", "subrip", "application/x-subrip",
                        "ass", "ssa", "text/x-ssa", "ttml", "dfxp", "application/ttml+xml",
                        "captions", "subtitles", "metadata", "thumbnails", "chapters",
                        "utf-8", "utf8", "utf-16", "gzip", "base64", "plain", "none", "null",
                    ) } ?: "unknown"
                    val extension = (sub?.opt("file") as? String)?.toHttpUrlOrNull()?.pathSegments?.lastOrNull()?.substringAfterLast('.', "")
                    "format=${safe(sub?.optString("format"))},ext=${safe(extension)},kind=${safe(sub?.optString("kind"))},encoding=${safe(sub?.optString("encoding"))}"
                }
                val accepted = MiruroMediaParser.directMedia(payload).firstOrNull()?.subtitles.orEmpty()
                android.util.Log.d("AniTrackMiruro", "subtitles offered=${subs?.length() ?: 0} accepted=${accepted.size} $details")
            }
        }
    }) { browser.userAgent }
    override val descriptor = adapter.descriptor
    override val access: ProviderAccess = browser
    override fun isEnabled(config: AndroidRuntimeConfig) = BuildConfig.DEBUG
    override fun acceptsResumeKey(key: String) = adapter.acceptsResumeKey(key)
    override suspend fun match(anime: Anime) = adapter.match(anime)
    override suspend fun resume(key: String) = adapter.resume(key)
    fun attach(activity: Activity) { if (BuildConfig.DEBUG) browser.attach(activity) }
    fun foreground(activity: Activity, active: Boolean) { if (BuildConfig.DEBUG) browser.foreground(activity, active) }
    fun detach(activity: Activity) { if (BuildConfig.DEBUG) browser.detach(activity) }
}
