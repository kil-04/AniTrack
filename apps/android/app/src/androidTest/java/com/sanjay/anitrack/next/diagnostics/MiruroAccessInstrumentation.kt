package com.sanjay.anitrack.next.diagnostics

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.os.Bundle
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroClient
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroProtocolException
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroReadRequest
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroMediaParser
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * Tests the actual Android connector on a device, not a desktop proxy or a WebView.
 * Requires -e miruro_probe true. No browser sessions, stream URLs or keys are exported.
 * The test APK is separate from the app and is never included in production APKs.
 */
class MiruroAccessInstrumentation : Instrumentation() {
    private var optedIn = false
    private var animeId = 1
    private var verifySession = false
    private var inPageRequests = false
    private var sourceProvider: String? = null
    private var nativePlayback = false

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        optedIn = arguments?.getString("miruro_probe") == "true"
        animeId = arguments?.getString("anilist_id")?.toIntOrNull() ?: 1
        verifySession = arguments?.getString("miruro_verify") == "true"
        inPageRequests = arguments?.getString("miruro_in_page") == "true"
        sourceProvider = arguments?.getString("miruro_source")
        nativePlayback = arguments?.getString("miruro_native") == "true"
        start()
    }

    override fun onStart() {
        val report = Bundle()
        if (!optedIn || animeId <= 0 || sourceProvider?.matches(Regex("[a-zA-Z0-9_-]{1,64}")) == false) {
            report.putString("result", "SKIPPED: requires miruro_probe=true and a positive anilist_id")
            finish(Activity.RESULT_CANCELED, report)
            return
        }
        // Every run is explicitly opted in; errors still stop the entire run.
        var stage = "config"
        var verificationActivity: Activity? = null
        var playbackActivity: Activity? = null
        try {
            val transport = if (verifySession) {
                stage = "manual verification"
                val completion = CompletableFuture<com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroTransport?>()
                MiruroVerificationActivity.completion = completion
                MiruroVerificationActivity.inPageRequests = inPageRequests
                verificationActivity = startActivitySync(Intent(targetContext, MiruroVerificationActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                completion.get(180, TimeUnit.SECONDS) ?: run {
                    report.putString("result", "CANCELLED: no native requests made")
                    finish(Activity.RESULT_CANCELED, report)
                    return
                }
            } else null
            runBlocking {
                val client = if (transport == null) MiruroClient() else MiruroClient(transport)
                val captured = mutableMapOf<String, JSONObject>()
                val reads = listOf(
                    "config" to MiruroReadRequest.Config,
                    "info" to MiruroReadRequest.Info(animeId),
                    "episodes" to MiruroReadRequest.Episodes(animeId),
                )
                // First error exits the entire probe. No retry or alternate-host fallback.
                for ((name, request) in reads) {
                    stage = name
                    val payload = client.read(request)
                    captured[name] = payload
                    report.putString(name, shape(payload).toString().take(12_000))
                }
                sourceProvider?.let { provider ->
                    stage = "selected episode mapping"
                    val episodes = captured.getValue("episodes").getJSONObject("providers")
                        .getJSONObject(provider).getJSONObject("episodes").getJSONArray("sub")
                    val first = (0 until episodes.length()).mapNotNull { episodes.optJSONObject(it) }
                        .firstOrNull { it.optDouble("number", -1.0) == 1.0 }
                        ?: throw IllegalStateException("Episode one identity was not available")
                    report.putString("selected_episode", shape(first).toString())
                    val capabilities = captured.getValue("config").getJSONObject("streaming")
                        .getJSONObject(provider).getJSONObject("capabilities")
                    val category = when {
                        capabilities.optBoolean("sub") -> "sub"
                        capabilities.optBoolean("ssub") -> "ssub"
                        else -> throw IllegalStateException("No supported subtitle category")
                    }
                    // These fields are used by the inspected public watch component.
                    // The opaque episode ID stays on-device and is never logged.
                    val episodeId = first.opt("id") as? String
                        ?: throw IllegalStateException("Missing episode id")
                    stage = "sources"
                    val source = client.read(MiruroReadRequest.Sources(animeId, episodeId, provider, category))
                    report.putString("selected_source", "$provider / $category / episode 1")
                    report.putString("source", shape(source).toString().take(12_000))
                    val candidates = MiruroMediaParser.directMedia(source)
                    report.putInt("direct_media_candidates", candidates.size)
                    val streams = source.optJSONArray("streams")
                    report.putString("stream_formats", (0 until minOf(streams?.length() ?: 0, 32)).joinToString(",") {
                        streams?.optJSONObject(it)?.optString("type")?.lowercase()
                            ?.takeIf { type -> type in setOf("hls", "m3u8", "mp4", "embed", "dash", "mpd") } ?: "other"
                    })
                    if (nativePlayback) {
                        stage = "native playback"
                        val media = candidates.firstOrNull() ?: throw IllegalStateException("No supported direct media")
                        val completion = CompletableFuture<Bundle>()
                        MiruroNativePlaybackActivity.media = media
                        MiruroNativePlaybackActivity.userAgent = MiruroVerificationActivity.mediaUserAgent
                        MiruroNativePlaybackActivity.result = completion
                        playbackActivity = startActivitySync(Intent(targetContext, MiruroNativePlaybackActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        val nativeReport = completion.get(90, TimeUnit.SECONDS)
                        nativeReport.keySet().forEach { key -> report.putString("native_$key", nativeReport.get(key).toString()) }
                        check(nativeReport.getBoolean("passed")) { "Native playback was not verified" }
                    }
                }
            }
            report.putString("result", if (sourceProvider == null)
                "SUCCESS: catalogue access only; native video playback remains unverified"
                else if (nativePlayback) "SUCCESS: native video and forward/backward seeks verified in diagnostic player"
                else "SUCCESS: selected source response received; native video playback remains unverified")
            finish(Activity.RESULT_OK, report)
        } catch (error: Exception) {
            val kind = (error as? MiruroProtocolException)?.failure?.name ?: error.javaClass.simpleName
            // Exception messages and JSON values may contain request tokens; omit both.
            report.putString("result", "STOPPED at $stage: $kind; no further requests made")
            finish(Activity.RESULT_CANCELED, report)
        } finally {
            MiruroVerificationActivity.completion = null
            MiruroVerificationActivity.inPageRequests = false
            MiruroVerificationActivity.mediaUserAgent = "AniTrack"
            playbackActivity?.let { activity -> runOnMainSync { if (!activity.isFinishing) activity.finish() } }
            MiruroNativePlaybackActivity.media = null
            MiruroNativePlaybackActivity.result = null
            MiruroNativePlaybackActivity.userAgent = "AniTrack"
            verificationActivity?.let { activity -> runOnMainSync { if (!activity.isFinishing) activity.finish() } }
        }
    }

    /** Bounded schema-only output; primitive values, credentials and URLs are never printed. */
    private fun shape(value: Any?, depth: Int = 0): Any {
        if (depth >= 5) return "[depth limit]"
        return when (value) {
            is JSONObject -> JSONObject().apply {
                value.keys().asSequence().take(24).forEachIndexed { index, key ->
                    val label = key.takeIf { it.matches(Regex("[A-Za-z_][A-Za-z0-9_-]{0,47}")) } ?: "field_$index"
                    put(label, shape(value.opt(key), depth + 1))
                }
            }
            is JSONArray -> JSONObject().put("length", value.length())
                .put("firstItem", if (value.length() == 0) "empty" else shape(value.opt(0), depth + 1))
            is String -> "string"
            is Number -> "number"
            is Boolean -> "boolean"
            else -> "null"
        }
    }
}
