package com.sanjay.anitrack.next.diagnostics

/** Bounded normal-player UI navigation; never selects a substitute server or retries a click. */
internal object ProviderProbeServerNavigation {
    // Match PlayerEpisodePanel: staged providers may be absent from enabled descriptors.
    fun panelHeading(enabledProviderName: String?): String =
        "${enabledProviderName?.uppercase() ?: "STREAM"} SERVERS"

    data class Observation(
        val exactMatches: Int,
        val targetVisible: Boolean = false,
        val targetEnabled: Boolean = false,
        val panelVisible: Boolean = false,
        val fullscreenControlVisible: Boolean = false,
        val videoVisible: Boolean = false,
    )

    enum class Action { SHOW_TARGET, SCROLL_TARGET_ANCESTOR, REVEAL_CONTROLS, EXIT_FULLSCREEN, CLICK_TARGET }

    enum class StopReason { UNOWNED_OR_UNREADY_WINDOW, AMBIGUOUS_TARGET, TARGET_DISABLED,
        TARGET_UNAVAILABLE, ACTION_REJECTED, CLICK_REJECTED, NAVIGATION_LIMIT }

    data class Result(val selected: Boolean, val stopReason: StopReason?,
        val lastObservation: Observation?, val actions: List<Action>)

    interface Driver {
        /** Null means the focused window is no longer this debug probe's own player. */
        fun observe(): Observation?
        fun act(action: Action): Boolean
        fun settle()
    }

    fun select(driver: Driver): Boolean = selectResult(driver).selected

    fun selectResult(driver: Driver): Result {
        var lastObservation: Observation? = null
        val actions = mutableListOf<Action>()
        fun stopped(reason: StopReason) = Result(false, reason, lastObservation, actions.toList())
        var showedTarget = false
        var ancestorScrolls = 0
        var revealedControls = false
        var exitedFullscreen = false
        var layoutWaits = 0
        repeat(14) {
            val state = driver.observe() ?: return stopped(StopReason.UNOWNED_OR_UNREADY_WINDOW)
            lastObservation = state
            if (state.exactMatches !in 0..1) return stopped(StopReason.AMBIGUOUS_TARGET)
            if (state.exactMatches == 1 && state.targetVisible && state.targetEnabled) {
                // Exactly one click, even if its result is false. No fallback or click retry.
                actions += Action.CLICK_TARGET
                return if (driver.act(Action.CLICK_TARGET)) Result(true, null, state, actions.toList())
                    else stopped(StopReason.CLICK_REJECTED)
            }
            val action = when {
                state.exactMatches == 1 && state.targetVisible -> {
                    if (layoutWaits++ >= 4) return stopped(StopReason.TARGET_DISABLED)
                    driver.settle()
                    return@repeat
                }
                state.exactMatches == 1 && !showedTarget -> {
                    showedTarget = true
                    Action.SHOW_TARGET
                }
                state.exactMatches == 1 && ancestorScrolls++ < 4 -> Action.SCROLL_TARGET_ANCESTOR
                state.exactMatches == 1 || state.panelVisible -> return stopped(StopReason.TARGET_UNAVAILABLE)
                state.fullscreenControlVisible && !exitedFullscreen -> {
                    exitedFullscreen = true
                    Action.EXIT_FULLSCREEN
                }
                state.videoVisible && !revealedControls -> {
                    revealedControls = true
                    Action.REVEAL_CONTROLS
                }
                (revealedControls || exitedFullscreen) && layoutWaits++ < 4 -> {
                    driver.settle()
                    return@repeat
                }
                else -> return stopped(StopReason.TARGET_UNAVAILABLE)
            }
            actions += action
            val performed = driver.act(action)
            // SHOW_ON_SCREEN is optional accessibility support. A bounded scroll
            // of that same target's ancestors is the only permitted alternative.
            if (!performed && action != Action.SHOW_TARGET) return stopped(StopReason.ACTION_REJECTED)
            driver.settle()
        }
        return stopped(StopReason.NAVIGATION_LIMIT)
    }
}
