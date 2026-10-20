package com.sanjay.anitrack.next.data.providers.connectors

import android.app.Activity
import com.sanjay.anitrack.next.data.AndroidRuntimeConfig
import com.sanjay.anitrack.next.data.Anime
import com.sanjay.anitrack.next.data.manga.MangaHttp
import com.sanjay.anitrack.next.data.providers.AnimeProvider
import com.sanjay.anitrack.next.data.providers.ProviderAccess
import com.sanjay.anitrack.next.data.providers.connectors.anichan.AniChan
import com.sanjay.anitrack.next.data.providers.connectors.anichan.AniChanBrowserSession
import com.sanjay.anitrack.next.data.providers.connectors.anichan.AniChanException
import org.json.JSONObject

object AniChanAndroidProvider : AnimeProvider {
    private val browser = AniChanBrowserSession()
    private val http = MangaHttp("AniChan", setOf("anichan.to"), { MangaHttp.USER_AGENT }, 500)
    private suspend fun json(url: String): JSONObject = try {
        JSONObject(http.get(url, "application/json", AniChan.MAX_CATALOG_BYTES))
    } catch (_: org.json.JSONException) { throw AniChanException("AniChan sent an unreadable catalogue response.") }
    private val adapter = AniChanProvider(
        metadata = { id -> browser.prepare(id); json("${AniChan.ORIGIN}/api/catalog/anime/$id") },
        episodeCount = { id -> json("${AniChan.ORIGIN}/api/watch/episodes?anilistId=$id") },
        servers = { id, episode, category, tier -> browser.servers(id, episode, category, tier) },
        userAgent = { browser.userAgent },
    )
    override val descriptor = adapter.descriptor
    override val access: ProviderAccess = browser
    override fun isEnabled(config: AndroidRuntimeConfig) = adapter.isEnabled(config)
    override fun acceptsResumeKey(key: String) = adapter.acceptsResumeKey(key)
    override suspend fun match(anime: Anime) = adapter.match(anime)
    override suspend fun resume(key: String) = adapter.resume(key)
    fun attach(activity: Activity) = browser.attach(activity)
    fun foreground(activity: Activity, active: Boolean) = browser.foreground(activity, active)
    fun detach(activity: Activity) = browser.detach(activity)
}
