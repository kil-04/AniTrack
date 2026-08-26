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
