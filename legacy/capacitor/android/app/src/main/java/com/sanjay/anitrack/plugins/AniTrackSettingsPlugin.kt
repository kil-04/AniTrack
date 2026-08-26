package com.sanjay.anitrack.plugins

import android.content.Context
import android.os.Build
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AniTrackSettings")
class AniTrackSettingsPlugin : Plugin() {

    private fun prefs() = context.getSharedPreferences("anitrack_settings", Context.MODE_PRIVATE)

    /**
     * Enter Picture-in-Picture by playing the resolved HLS stream in a native
     * ExoPlayer overlay (the WebView's <video> can't composite into the PiP window).
     * Needs the stream url + referer (for CDN hotlink checks) + current position.
     */
    @PluginMethod
    fun enterPip(call: PluginCall) {
        val act = activity ?: return call.reject("no activity")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return call.reject("pip-unsupported")
        val url = call.getString("url")
        if (url.isNullOrEmpty()) return call.reject("url required")
        val referer = call.getString("referer")
        val position = call.getDouble("position") ?: 0.0
        val main = act as? com.sanjay.anitrack.MainActivity ?: return call.reject("no main activity")
        main.startNativePip(url, referer, position)
        val ret = com.getcapacitor.JSObject(); ret.put("ok", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun get(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        val value = prefs().getString(key, null)
        val ret = com.getcapacitor.JSObject()
        if (value != null) ret.put("value", value) else ret.put("value", com.getcapacitor.JSObject.NULL)
        call.resolve(ret)
    }

    @PluginMethod
    fun set(call: PluginCall) {
        val key   = call.getString("key")   ?: return call.reject("key required")
        val value = call.getString("value") ?: return call.reject("value required")
        prefs().edit().putString(key, value).apply()
        val ret = com.getcapacitor.JSObject(); ret.put("ok", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun del(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key required")
        prefs().edit().remove(key).apply()
        val ret = com.getcapacitor.JSObject(); ret.put("ok", true)
        call.resolve(ret)
    }
}
