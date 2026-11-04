package com.sanjay.anitrack.next.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Whether the device is online, and a way to wait until it is: downloads pause
 * while the network is gone (including while the phone sleeps in Doze) and
 * carry on as soon as a network is back.
 */
object NetworkWatch {
    private var connectivity: ConnectivityManager? = null
    private val back = Channel<Unit>(Channel.CONFLATED)

    fun init(context: Context) {
        if (connectivity != null) return
        val manager = context.applicationContext.getSystemService(ConnectivityManager::class.java) ?: return
        connectivity = manager
        runCatching {
            manager.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { back.trySend(Unit) }
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) back.trySend(Unit)
                }
            })
        }
    }

    fun online(): Boolean {
        val manager = connectivity ?: return true
        val caps = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** Returns once a network is up (at once when it already is). */
    suspend fun awaitOnline() {
        while (!online()) withTimeoutOrNull(30_000) { back.receive() }
    }

    /** Whether this is the app's main process (not a WebView helper process such as :comix). */
    fun isMainProcess(context: Context): Boolean {
        val name = runCatching { java.io.File("/proc/self/cmdline").readText().trimEnd('\u0000').trim() }.getOrNull()
        return name.isNullOrEmpty() || name == context.packageName
    }
}
