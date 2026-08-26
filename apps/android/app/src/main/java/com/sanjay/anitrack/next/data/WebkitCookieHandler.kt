package com.sanjay.anitrack.next.data

import java.net.CookieHandler
import java.net.URI

/**
 * Bridges the WebView's CookieManager into java.net so ExoPlayer's
 * HttpURLConnection-based data source sends the kwik/CF cookies the stream
 * CDN expects (the old app did this per-request in its native fetch helper).
 * Installed once via CookieHandler.setDefault() in MainActivity. okhttp is
 * unaffected — it only uses CookieHandler when explicitly configured.
 */
class WebkitCookieHandler : CookieHandler() {
    override fun get(uri: URI, requestHeaders: Map<String, List<String>>): Map<String, List<String>> {
        val c = android.webkit.CookieManager.getInstance().getCookie(uri.toString())
        return if (c.isNullOrEmpty()) emptyMap() else mapOf("Cookie" to listOf(c))
    }

    override fun put(uri: URI, responseHeaders: Map<String, List<String>>) {
        val mgr = android.webkit.CookieManager.getInstance()
        for ((k, v) in responseHeaders) {
            if (k != null && (k.equals("Set-Cookie", true) || k.equals("Set-Cookie2", true))) {
                v.forEach { mgr.setCookie(uri.toString(), it) }
            }
        }
    }
}
