package com.sanjay.anitrack.next.diagnostics

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Rect
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import androidx.media3.ui.PlayerView

/** App-owned player controls only. No WebView, website, verification or account UI actions. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class ProviderProbeServerUi(
    private val instrumentation: Instrumentation,
    private val activity: Activity,
    private val label: String,
    private val serverHeading: String,
) : ProviderProbeServerNavigation.Driver {
    private val expectedPackage = instrumentation.targetContext.packageName

    override fun observe(): ProviderProbeServerNavigation.Observation? {
        val root = ownedRoot() ?: return null
        val targets = exactText(root, label)
        val target = targets.singleOrNull()
        val clickable = target?.let(::clickableAncestor)
        return ProviderProbeServerNavigation.Observation(
            exactMatches = targets.size,
            targetVisible = target?.isVisibleToUser == true,
            targetEnabled = clickable?.isEnabled == true,
            panelVisible = exactText(root, serverHeading).any { it.isVisibleToUser },
            fullscreenControlVisible = fullscreenControl(root) != null,
            videoVisible = videoBounds() != null,
        )
    }

    override fun act(action: ProviderProbeServerNavigation.Action): Boolean {
        val root = ownedRoot() ?: return false
        if (action == ProviderProbeServerNavigation.Action.REVEAL_CONTROLS) {
            if (exactText(root, serverHeading).any { it.isVisibleToUser }) return false
            val bounds = videoBounds() ?: return false
            val downTime = SystemClock.uptimeMillis()
            val down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN,
                bounds.exactCenterX(), bounds.exactCenterY(), 0).apply { source = InputDevice.SOURCE_TOUCHSCREEN }
            val pressed = try { instrumentation.uiAutomation.injectInputEvent(down, true) } finally { down.recycle() }
            if (!pressed) return false
            SystemClock.sleep(50)
            val up = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP,
                bounds.exactCenterX(), bounds.exactCenterY(), 0).apply { source = InputDevice.SOURCE_TOUCHSCREEN }
            return try { instrumentation.uiAutomation.injectInputEvent(up, true) } finally { up.recycle() }
        }
        if (action == ProviderProbeServerNavigation.Action.EXIT_FULLSCREEN) {
            // Never turn fullscreen ON while the panel already exists.
            if (exactText(root, serverHeading).any { it.isVisibleToUser } || exactText(root, label).isNotEmpty()) return false
            return fullscreenControl(root)?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
        }
        val target = exactText(root, label).singleOrNull() ?: return false
        return when (action) {
            ProviderProbeServerNavigation.Action.CLICK_TARGET -> target.isVisibleToUser &&
                clickableAncestor(target)?.takeIf { it.isEnabled && it.isVisibleToUser }
                    ?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
            ProviderProbeServerNavigation.Action.SHOW_TARGET ->
                target.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.id)
            ProviderProbeServerNavigation.Action.SCROLL_TARGET_ANCESTOR -> scrollTargetAncestor(target)
            else -> false
        }
    }

    override fun settle() { SystemClock.sleep(400) }

    private fun ownedRoot(): AccessibilityNodeInfo? {
        var focused = false
        instrumentation.runOnMainSync { focused = !activity.isFinishing && activity.hasWindowFocus() }
        if (!focused) return null
        return instrumentation.uiAutomation.rootInActiveWindow
            ?.takeIf { it.packageName?.toString() == expectedPackage }
    }

    private fun exactText(root: AccessibilityNodeInfo, text: String): List<AccessibilityNodeInfo> =
        root.findAccessibilityNodeInfosByText(text).filter {
            it.packageName?.toString() == expectedPackage && it.text?.toString() == text && !insideWebView(it)
        }

    private fun clickableAncestor(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        var current: AccessibilityNodeInfo? = node
        repeat(16) {
            val candidate = current ?: return null
            if (candidate.packageName?.toString() != expectedPackage || candidate.className?.toString() == "android.webkit.WebView") return null
            if (candidate.isClickable) return candidate
            current = candidate.parent
        }
        return null
    }

    private fun insideWebView(node: AccessibilityNodeInfo): Boolean {
        var current: AccessibilityNodeInfo? = node
        repeat(24) {
            val candidate = current ?: return false
            if (candidate.className?.toString() == "android.webkit.WebView") return true
            current = candidate.parent
        }
        return true // Unexpectedly deep trees fail closed.
    }

    private fun fullscreenControl(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val matches = mutableListOf<AccessibilityNodeInfo>()
        var visited = 0
        fun visit(node: AccessibilityNodeInfo, depth: Int) {
            if (++visited > 512 || depth > 24 || node.packageName?.toString() != expectedPackage || node.className?.toString() == "android.webkit.WebView") return
            if (node.contentDescription?.toString() == "Fullscreen" && node.isVisibleToUser) {
                clickableAncestor(node)?.takeIf { it.isEnabled && it.isVisibleToUser }?.let(matches::add)
            }
            for (index in 0 until minOf(node.childCount, 128)) node.getChild(index)?.let { visit(it, depth + 1) }
        }
        visit(root, 0)
        return matches.singleOrNull()
    }

    private fun scrollTargetAncestor(target: AccessibilityNodeInfo): Boolean {
        val targetBounds = Rect().also(target::getBoundsInScreen)
        var current = target.parent
        repeat(16) {
            val parent = current ?: return false
            if (parent.packageName?.toString() != expectedPackage || parent.className?.toString() == "android.webkit.WebView") return false
            if (parent.isScrollable && parent.isVisibleToUser) {
                val viewport = Rect().also(parent::getBoundsInScreen)
                val backwards = targetBounds.bottom <= viewport.top || targetBounds.right <= viewport.left
                val action = if (backwards) AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                return parent.performAction(action)
            }
            current = parent.parent
        }
        return false
    }

    private fun videoBounds(): Rect? {
        var result: Rect? = null
        instrumentation.runOnMainSync {
            var visited = 0
            fun visit(view: View, depth: Int) {
                if (++visited > 512 || depth > 24 || result != null || !view.isShown || view is android.webkit.WebView) return
                if (view is PlayerView) {
                    val bounds = Rect()
                    if (view.getGlobalVisibleRect(bounds) && bounds.width() > 0 && bounds.height() > 0) result = bounds
                } else if (view is ViewGroup) {
                    for (index in 0 until minOf(view.childCount, 128)) visit(view.getChildAt(index), depth + 1)
                }
            }
            visit(activity.window.decorView, 0)
        }
        return result
    }
}
