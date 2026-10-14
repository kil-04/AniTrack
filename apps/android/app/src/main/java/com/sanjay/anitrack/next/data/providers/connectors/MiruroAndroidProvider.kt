package com.sanjay.anitrack.next.data.providers.connectors

import android.app.Activity
import com.sanjay.anitrack.next.BuildConfig
import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.ProviderAccess
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroBrowserSession

/** Debug-only availability until normal-player and lifecycle testing is complete. */
object MiruroAndroidProvider : AnimeProvider {
    private val browser = MiruroBrowserSession()
    private val adapter = MiruroProvider({ request -> browser.read(request) }) { browser.userAgent }
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
