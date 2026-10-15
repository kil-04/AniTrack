# Custom NSIS hooks for electron-builder.
#
# Overrides the stock CHECK_APP_RUNNING macro. The default implementation
# (tasklist | find piped through nsExec) false-positives on this machine —
# it loops "AniTrack cannot be closed. Please close it manually and click
# Retry" forever even when no AniTrack.exe exists (AV interferes with the
# probe). We don't need the interactive loop at all: just force-close any
# running instance and proceed. taskkill exits harmlessly when nothing runs,
# and the installer exe is never named AniTrack.exe, so no self-kill risk.
!macro customCheckAppRunning
  DetailPrint `Closing running "${PRODUCT_NAME}"...`
  nsExec::Exec `taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
  # Give Windows a moment to release file locks.
  Sleep 800
!macroend

# Chromium runs its sandboxed processes (provider websites, the GPU process,
# the audio service) as app-container identities, which must be able to read
# the app's own files. Program Files grants them that; this per-user folder
# (%LOCALAPPDATA%\Programs) does not, and on some PCs every sandboxed process
# died at launch: no GPU (9.0.0), no audio and no provider windows (9.0.2).
# Grant read and execute to ALL APPLICATION PACKAGES and ALL RESTRICTED
# APPLICATION PACKAGES, by SID so it works in every Windows language.
!macro customInstall
  DetailPrint `Letting sandboxed processes read "${PRODUCT_NAME}"...`
  nsExec::Exec `icacls "$INSTDIR" /grant *S-1-15-2-1:(OI)(CI)(RX) *S-1-15-2-2:(OI)(CI)(RX) /T /C /Q`
!macroend
