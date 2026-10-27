package com.sanjay.anitrack.next.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.sanjay.anitrack.next.data.BackgroundMusic
import com.sanjay.anitrack.next.data.CityPopTrack
import com.sanjay.anitrack.next.data.PlayerHolder
import com.sanjay.anitrack.next.data.ThemePlayer
import org.json.JSONArray
import org.json.JSONObject

/** Official visible YouTube player. The site owns decoding, ads, controls and playback. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
internal fun CityPopPlayerDialog(tracks: List<CityPopTrack>, start: Int, label: String, listen: Boolean, onClose: () -> Unit) {
    if (tracks.isEmpty()) return
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val origin = "https://${context.packageName}"
    val web = remember(tracks, start) {
        WebView(context).apply {
            // A wrap-content WebView lays its page out 0 px tall, so 100vh would be 0 and the
            // video would shrink to its 200 px minimum; Compose still sizes the view.
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(android.graphics.Color.rgb(24, 21, 45))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(false)
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.isForMainFrame || request.url.scheme != "https"
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            }
            setDownloadListener { _, _, _, _, _ -> /* Playback-only official embeds have no download endpoint. */ }
            loadDataWithBaseURL("$origin/", cityPopPlayerHtml(tracks, start, origin), "text/html", "utf-8", null)
        }
    }
    DisposableEffect(web, lifecycle) {
        ThemePlayer.pause()
        PlayerHolder.peek()?.pause()
        BackgroundMusic.setHold(BackgroundMusic.Hold.VIDEO, true)
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) {
                web.evaluateJavascript("window.cityPopPause && window.cityPopPause()", null)
                web.onPause()
            } else if (event == Lifecycle.Event.ON_RESUME) web.onResume()
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            web.evaluateJavascript("window.cityPopPause && window.cityPopPause()", null)
            web.stopLoading()
            web.onPause()
            web.removeAllViews()
            web.destroy()
            BackgroundMusic.setHold(BackgroundMusic.Hold.VIDEO, false)
        }
    }
    val configuration = LocalConfiguration.current
    // No taller than a 16:9 video at the dialog's width, so a phone held upright keeps the controls in view.
    val videoWidth = (configuration.screenWidthDp * 0.94f).coerceAtMost(1000f) - 32f
    val videoHeight = if (listen) 220.dp else minOf(configuration.screenHeightDp * 0.54f, videoWidth * 9f / 16f).dp.coerceIn(220.dp, 520.dp)
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.widthIn(max = if (listen) 580.dp else 1000.dp).fillMaxWidth(0.94f)
                .heightIn(max = (configuration.screenHeightDp - 32).coerceAtLeast(240).dp)
                .pixelPanel(CityPopColors.Panel, CityPopColors.Pink, Color(0xFF3D0A2C), 6.dp)
                .verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // As on desktop's player window: the pack and mode, then what was chosen.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    PixelText("City Pop · ${if (listen) "Listen" else "Watch"}", CityPopColors.Pink, 10.sp, maxLines = 1)
                    Text(label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 20.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Close player", tint = Color.White) }
            }
            // YouTube requires a visible player at least 200 × 200 CSS pixels in either mode.
            AndroidView(factory = { web }, modifier = Modifier.fillMaxWidth().height(videoHeight + 70.dp))
            if (tracks.size > 1) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
                CityPopButton("Previous", { web.evaluateJavascript("window.cityPopStep && window.cityPopStep(-1)", null) }, icon = Icons.Rounded.SkipPrevious, style = CityPopButtonStyle.Ghost)
                CityPopButton("Next", { web.evaluateJavascript("window.cityPopStep && window.cityPopStep(1)", null) }, icon = Icons.Rounded.SkipNext, style = CityPopButtonStyle.Ghost)
            }
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("YouTube player · Internet required. Keep the player visible while listening.", color = Color.White.copy(alpha = 0.55f), fontSize = 12.sp, modifier = Modifier.padding(vertical = 10.dp))
                // Destinations come from validated catalog/search video IDs, never iframe navigation.
                TextButton(onClick = {
                    web.evaluateJavascript("window.cityPopPause && window.cityPopPause()", null)
                    web.evaluateJavascript("window.cityPopCurrentId && window.cityPopCurrentId()") { value ->
                        val id = runCatching { JSONArray("[$value]").optString(0) }.getOrNull()
                        val track = tracks.firstOrNull { it.videoId == id } ?: tracks[start.coerceIn(tracks.indices)]
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(track.sourceUrl))) }
                    }
                }) { Text("Open on YouTube", color = Color(0xFF7FE1DB)) }
            }
        }
    }
}

/** Queue metadata is serialized as JSON rather than interpolated into executable code. */
internal fun cityPopPlayerHtml(tracks: List<CityPopTrack>, start: Int, origin: String): String {
    val rows = JSONArray(tracks.map { track ->
        JSONObject().put("videoId", track.videoId).put("title", track.title).put("artist", track.artist)
    }).toString().replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    val jsonOrigin = JSONObject.quote(origin)
    return """<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta name="referrer" content="strict-origin-when-cross-origin">
      <style>html,body{margin:0;background:#18152d;color:#fff;font:14px sans-serif}#player{width:100%;height:calc(100vh - 70px);min-height:200px;min-width:200px}#meta{padding:10px 4px;height:50px;box-sizing:border-box}#title{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:bold}#status{font-size:12px;color:#f49bc1;margin-top:5px}</style></head>
      <body><div id="player"></div><div id="meta"><div id="title"></div><div id="status">Loading YouTube…</div></div>
      <script>const tracks=$rows;let index=${start.coerceIn(tracks.indices)},player=null;
      const title=document.getElementById('title'),status=document.getElementById('status');
      function metadata(){title.textContent=tracks[index].title+' · '+tracks[index].artist;status.textContent=(index+1)+' / '+tracks.length;}
      window.cityPopStep=function(step){const at=index+step;if(at<0||at>=tracks.length)return;index=at;metadata();if(player)player.loadVideoById(tracks[index].videoId);};
      window.cityPopPause=function(){if(player&&player.pauseVideo)player.pauseVideo();};
      window.cityPopCurrentId=function(){return tracks[index].videoId;};
      window.onYouTubeIframeAPIReady=function(){player=new YT.Player('player',{videoId:tracks[index].videoId,width:'100%',height:'100%',playerVars:{autoplay:1,playsinline:1,origin:$jsonOrigin},events:{onReady:function(){metadata();},onStateChange:function(e){if(e.data===YT.PlayerState.PLAYING)metadata();if(e.data===YT.PlayerState.ENDED){if(index+1<tracks.length)window.cityPopStep(1);else status.textContent='Station finished.';}},onError:function(e){status.textContent=(e.data===101||e.data===150)?"This video can't be played here. Try Next or open it on YouTube.":e.data===153?"YouTube couldn't verify this player. Open the video on YouTube.":'This video is unavailable. Try Next or open it on YouTube.';}}});};
      metadata();</script><script src="https://www.youtube.com/iframe_api"></script></body></html>""".trimIndent()
}
