package com.sanjay.anitrack.plugins

import android.content.Context
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "AniTrackSettings")
class AniTrackSettingsPlugin : Plugin() {

    private fun prefs() = context.getSharedPreferences("anitrack_settings", Context.MODE_PRIVATE)

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
