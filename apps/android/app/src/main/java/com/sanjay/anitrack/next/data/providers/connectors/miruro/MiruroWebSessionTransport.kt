package com.sanjay.anitrack.next.data.providers.connectors.miruro

import android.webkit.WebView
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroHttpResponse
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroProtocol
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroRequestPolicy
import com.sanjay.anitrack.next.data.providers.connectors.miruro.MiruroTransport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.util.UUID
import kotlin.coroutines.resume

/**
 * Explicit app-owned session after user verification: a reviewed, bounded same-origin GET.
 * No remote helper code, JS-to-native interface, media interception or cookie export.
 */
internal class MiruroWebSessionTransport(
    private val web: WebView,
    private val isOpen: () -> Boolean,
) : MiruroTransport {
    override suspend fun get(url: String, maximumBytes: Int): MiruroHttpResponse = withContext(Dispatchers.Main) {
        MiruroRequestPolicy.request(url) // Check origin and path before executing any browser operation.
        require(maximumBytes in 1..MiruroProtocol.MAX_RESPONSE_BYTES)
        if (!isOpen()) throw IOException("Verification session was closed")
        val slot = JSONObject.quote("__anitrack_read_" + UUID.randomUUID().toString().replace("-", ""))
        val quotedUrl = JSONObject.quote(url)
        val origin = JSONObject.quote(MiruroProtocol.ORIGIN)
        try {
            withTimeout(16_000) {
                // This fixed, locally reviewed code performs no challenge handling.
                // Its only variable inputs are the validated URL, cap and random slot.
                evaluate("""
                    (() => {
                      if (location.origin !== $origin) return false;
                      const controller = new AbortController();
                      const state = {done:false, controller};
                      window[$slot] = state;
                      const timer = setTimeout(() => controller.abort(), 15000);
                      (async () => {
                        try {
                          const response = await fetch($quotedUrl, {
                            method:'GET', credentials:'same-origin', redirect:'error', cache:'no-store',
                            headers:{Accept:'application/json, text/plain, */*'}, signal:controller.signal
                          });
                          if (!response.ok) {
                            if (response.body) await response.body.cancel();
                            state.result = {status:response.status, text:'', obfuscated:null};
                            return;
                          }
                          if (Number(response.headers.get('content-length')) > $maximumBytes) throw new Error('size');
                          const reader = response.body.getReader();
                          const chunks = []; let count = 0;
                          while (true) {
                            const part = await reader.read();
                            if (part.done) break;
                            count += part.value.byteLength;
                            if (count > $maximumBytes) { await reader.cancel(); throw new Error('size'); }
                            chunks.push(part.value);
                          }
                          const bytes = new Uint8Array(count); let offset = 0;
                          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
                          state.result = {status:response.status,
                            text:new TextDecoder('utf-8', {fatal:true}).decode(bytes),
                            obfuscated:response.headers.get('x-obfuscated')};
                        } catch (_) { state.failed = true; }
                        finally { clearTimeout(timer); state.done = true; }
                      })();
                      return true;
                    })()
                """.trimIndent()).let { if (it != "true") throw IOException("Verification page left Miruro") }
                var response: MiruroHttpResponse? = null
                while (response == null) {
                    if (!isOpen()) throw IOException("Verification session was closed")
                    // Poll only local completion state, never repeat the HTTP request.
                    val encoded = evaluate("""
                        (() => {
                          if (location.origin !== $origin) return JSON.stringify({failed:true});
                          const state = window[$slot];
                          if (!state) return JSON.stringify({failed:true});
                          if (!state.done) return null;
                          return JSON.stringify(state.failed ? {failed:true} : state.result);
                        })()
                    """.trimIndent())
                    if (encoded != "null") {
                        if (encoded.length > maximumBytes * 12 + 4096) throw IOException("Verification response exceeded its limit")
                        val text = JSONTokener(encoded).nextValue() as? String ?: throw IOException("Invalid verification response")
                        val result = JSONObject(text)
                        if (result.optBoolean("failed")) throw IOException("Same-session request failed")
                        val status = result.optInt("status", 0)
                        if (status !in 100..599) throw IOException("Invalid verification status")
                        val body = result.opt("text") as? String ?: throw IOException("Invalid verification body")
                        if (body.toByteArray(Charsets.UTF_8).size > maximumBytes) throw IOException("Verification response exceeded its limit")
                        response = MiruroHttpResponse(status, body, result.opt("obfuscated") as? String)
                    } else delay(200)
                }
                response
            }
        } finally {
            withContext(NonCancellable) {
                // Navigation/closure drops the slot with the page. Otherwise abort and erase it.
                if (isOpen()) web.evaluateJavascript(
                    "(() => { const s=window[$slot]; if(s) {s.controller.abort(); delete window[$slot];} })()", null,
                )
            }
        }
    }

    private suspend fun evaluate(script: String): String = suspendCancellableCoroutine { continuation ->
        web.evaluateJavascript(script) { result -> if (continuation.isActive) continuation.resume(result) }
    }
}
