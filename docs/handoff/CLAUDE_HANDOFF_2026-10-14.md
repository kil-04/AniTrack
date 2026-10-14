# Claude Code handoff — Comix timeout follow-up

Read this after `CLAUDE_HANDOFF_2026-10-13.md`. It supersedes that file's latest
tablet status, not its earlier implementation history. The worktree contains
substantial unrelated Claude/user changes; do not reset it.

## Current live evidence

- On October 13 the complete native Berserk chapter list loaded, but opening
  chapter 386 timed out after 35 seconds. Later an expired chapter-list reload
  stalled too. Neither produced a new allowed-API 403 in the observed logs.
- Passive REA observed a chapter XHR with no response during the capture window.
  The native callback did not observe an outgoing allowed chapter request.
  `resumeTimers()` and a one-off local lifecycle-active experiment did not fix
  it; neither workaround remains in production code.
- Keeping the isolated WebView attached to a real foreground Activity during
  a catalogue batch produced visible native-reader success: Berserk chapter 384,
  TAMT upload, page 1 of 26 (cover/credits and the next image were readable).
  Screenshot: `out/tmp/comix-host-1791907807927.png`. This supports the detached
  session hypothesis; it is not proof of every lifecycle edge case.
- On October 14, reopening the separate debug app after several hours reached
  the actual chapter API and returned **HTTP 502**, rather than silently
  stalling. One manual retry also failed. Restarting only the debug app,
  preserving its data/cookies, showed the website's actual **Bad gateway 502 /
  host error** page inside Connect. Screenshot:
  `out/tmp/comix-check-1791927875230.png`.
- The user reports that normal tablet Chrome still loads the chapter list and
  pages. Do not call this a universal Comix outage or assume the isolated session
  and Chrome use identical cached data/session/routing. The difference remains
  unresolved. Do not retry in a loop, automate checks, or transfer Chrome cookies.
- The fresh desktop smoke initially stopped at connection after three seconds.
  A separate harness asset-path defect was then fixed (below). That initial
  failure is not evidence that native desktop images fail.

## Changes

### Android catalogue lifecycle

`ComixCatalogueActivity.kt` is an unexported Activity in the existing `:comix`
process. It attaches the existing isolated WebView to a real window, covered by
native loading/Cancel UI. There is no website interaction, bridge, new network
allowance, account access, UA substitution or verification automation.

`ComixSource.kt` now leases one host per serialized find/chapters/pages batch,
only on the first uncached read. The same lease spans the complete chapter
traversal. A `finally` sends CLOSE_HOST on success, failure or cancellation.
`ComixSessionService.kt` validates the lease and awaits attachment before reads;
`ComixSessionEngine.kt` stops polling when that host has closed. The host expires
after 125 seconds; existing chapter 120-second / read 35-second bounds remain.
The manifest registers the host privately. Service destruction closes its host.

Cleanup holds the actual WebView reference; it never recreates an engine during
Activity destruction. A bounded closed-lease set handles close-before-create.
`ComixCatalogueForeground.kt` waits at most two seconds for the original app
window to regain focus, then fails instead of opening a window from background.
Consequently uncached Comix catalogue work for queued background downloads can
ask the user to return and retry; image downloads already resolved are unchanged.
This is not fully unattended background Comix support.

`ComixCatalogueTimeout.kt` fixes a distinct cancellation bug: only the read's own
deadline becomes a catalogue error. An enclosing chapter timeout or navigation
cancellation remains cancellation. Eight pure JVM cases cover this and the
foreground wait. They do not replace Activity/device acceptance testing.

### Desktop diagnostic asset resolution

`ComixSiteSession` accepts an optional locally supplied `connectionHelp` loader,
parallel to its existing transport loader. Normal production paths are unchanged.
The standalone smoke now supplies both bundled assets from the repository root;
previously its helper could resolve relative to Electron's standalone script app
directory and close the connection before catalogue work. Two regression cases
cover supplying the helper and failing closed when it is absent. The dedicated
desktop session suite passed **28/28** after this change.

## REA evidence retained

`out/tmp/comix-timeout-rea-20261013.json` contains three records (2,770,148 bytes).
The retry capture is
`ev_ce558b0abcef7f6e8a5adbf949eb72798894185b8c3561c95b2a753dd9fe9a73`;
the current module capture is
`ev_c4b393b1edd8fe96a35782bc06589d4a6d660dcd3600dc74f8eded10bce42649`.
The website build observed was `tmuncy`, not the earlier `tmssp0` build. The
45-second capture ended before the final native timeout, so do not claim it
observed the whole failure. No signatures, cookies or response keys belong here.

## Still required before calling Comix finished

- Fresh native page loading after idle/reconnection; chapter forward/back,
  resume, cancel/retry and offline-copy acceptance on the final APK.
- Fresh desktop smoke with both assets, followed by real app navigation/resume.
- Resolve the current Chrome-vs-isolated-session 502 difference from evidence,
  without weakening the website-session boundary.
- More precise Connect UI messaging for a main-frame 5xx page: it currently
  waits for a normal homepage rather than immediately identifying that status.

No release, push, commit, version bump, installed-release replacement, profile
wipe, CAPTCHA solver or cross-profile credential transfer was performed.

## Final validation / desktop observation

- `:app:testDebugUnitTest :app:assembleDebug --offline --console=plain` passed in
  5m16s. XML totals: **290 tests, 0 failures/errors, 3 skipped** (287 executed).
  The skips remain Windows symlink-capability fixtures, not passing tests.
- Final debug APK installed successfully with `adb install -r`, preserving data
  and leaving the separate installed release untouched. The final foreground
  safeguard/loading-layout changes still need device acceptance.
- Electron main compilation passed. The scoped desktop session regressions
  passed 28/28. Full desktop/shared regression counts in the October 13 file are
  historical; the entire suite was not rerun for this constructor-loader change.
- Corrected fresh desktop smoke stayed open at connection instead of closing
  immediately. The user completed a check and reported a blank page. Direct
  Windows capture confirmed a white page with title **Just a moment...**, not a
  normal Comix homepage. The window had been minimized; activating it did not
  reveal page content. No challenge control was automated. Search, catalogue
  and native desktop images were **not** reached in this fresh run.
  The bounded connection expired at 181 seconds with `verification-required`,
  zero catalogue/image counts, exit code 1; its own window closed automatically.
- No temporary Comix CDP adapter process or ADB forwarding entry remained when
  checked on October 14. Earlier REA evidence files are retained locally.

## Later diagnosis and tablet verification-return fix

A fresh desktop diagnostic with loopback CDP exposed an internal failed-navigation
frame (`chrome-error://chromewebdata/`) for Comix. A bounded sanitized network
capture during one reload observed **POST https://comix.to/ (Document)** followed
by **net::ERR_BLOCKED_BY_CLIENT**. No headers, cookies or bodies were collected.
The policy fixture independently confirmed GET / allowed and POST / rejected.
This is a confirmed local desktop navigation-policy defect, distinct from the
earlier tablet's actual allowed-API HTTP 502. REA discovered the target but could
not inspect the error-frame origin; the decisive trace came from direct local
CDP diagnostics, not REA Evidence. The test exited at its 180-second deadline.

The user then requested a **tablet-only fix**. `ComixProtocol.kt` now permits a
same-origin HTTPS homepage document POST **only while connecting**. Subresource,
hidden/native, account, title, API, foreign-origin, unsafe URL and non-POST write
requests retain their old restrictions. Nothing solves/submits a challenge or
copies another browser's session. The desktop production policy is unchanged
and still needs its corresponding narrowly scoped repair.

Two JVM regression cases cover the permitted navigation and negative cases.
Full Android tests and debug assembly passed in 26 seconds: **292 tests total,
0 failures/errors, 3 skipped** (289 executed). Device installation and live
connection result are recorded below; compilation alone does not prove the
tablet's previous 502 is resolved.

## Claude Code follow-up (14 October, ~04:10 IST)

Codex finished; Claude Code picked up from the state above. Fixed, uncommitted:

- Android: downloaded Comix chapters opened through `ComixSource.resolvePage`, which
  only accepts HTTPS image URLs, so every saved page failed. Saved pages inside the
  download folder now pass through (`MangaDownloads.localFile`).
- Android: tall pages (webtoon strips) failed in `PageStrips.file`, which only trusted
  the download folder. It now also accepts an exact decoded Comix cache page
  (`ComixCachedPageCopy.cachedFile`, same checks as the offline copy). Unscrambled
  Comix pages may be up to 60 million pixels (scrambled pages keep 12 million,
  since restoring tiles decodes the whole bitmap).
- Android: `MangaSource.foregroundOnly` (true for Comix). Updates and smart downloads
  skip it, so a bulk or background check never opens the Loading Comix window.
  Updates' connect card now names the source that asked (it always said MangaDot).
- Android: the manga detail screen's red/teal/white accents and the player's red
  accent now follow `AniColors.Accent` (midnight-blue theme; deep blue in manga mode).
- Shared transport: chapter lists request 100 rows per page again (the validated
  native contract; the 13 Oct desktop traversal read 1,710 uploads in 18 pages).
  The website UI's 20 rows meant five times the requests and a 4,000-upload ceiling.
- Desktop: `comixNetworkAllowed` permits a main-frame POST to `/` only while
  connecting, matching Android, so Cloudflare's "Just a moment..." page can return
  after the user completes it. Regression added in `tests/comix-protocol.test.mjs`.

Validation: `npm run typecheck` passed; `npm test` 323/323; `build:electron` passed;
Android `:app:testDebugUnitTest :app:assembleDebug` 292 tests, 0 failures/errors,
3 skipped (Windows symlink fixtures). Debug APK installed with `adb install -r`
(release app untouched). Not yet live-verified: desktop connect/read after the POST
fix, tablet reading after the 502s seen at 03:10, offline reading of a Comix chapter.
The six 03:10 chapter attempts were manual: the detail screen only reloads on Retry,
Connect or reopening.

### 502 follow-up (04:15–04:35 IST)

- The tablet's isolated Comix WebView got Cloudflare's "502 Host Error" page for the
  homepage itself, not only chapter lists. Chrome on the same tablet worked.
- Profile cookies were only `cf_clearance` and Comix's `waf_pass`. Removing
  `waf_pass` changed nothing. Clearing the profile's cookies let the homepage load
  once. Once Cloudflare issued a new `cf_clearance` (about a minute later), the
  chapter API and then the homepage returned 502 again.
- A passive capture of the failing chapter request (header names and the error body
  only) showed `retry-after: 60` and Cloudflare's "origin returned an invalid or
  incomplete response". The request was the site's own facade call, made over HTTP/3.
- The 100-row chapter page size was reverted to the website's 20 rows (as it was
  on 13 Oct when reading worked). It is not the cause: the homepage fails too.
- Stopped here. Faking a Chrome identity, or repeatedly dropping the profile's
  Cloudflare pass to dodge this, would be evading the site's bot handling. The
  user can retry later, try desktop, or read via MangaDot/MangaBall.
