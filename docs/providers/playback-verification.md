# Anime-provider verification — 6 October 2026

Manga is out of scope for this work. No version bump, release, signed-config
enablement or installed-profile replacement was performed.

## Reproducible desktop checks

```text
npm run providers:smoke:electron -- "Cowboy Bebop" 1 anikoto --download
npm run providers:smoke:electron -- "Cowboy Bebop" 1 animepahe --download
npm run providers:playback:electron -- --provider=anikoto
npm run providers:playback:electron -- --provider=animepahe
npm run providers:playback:electron -- --provider=miruro --staged --source=kickassanime --server=Vid --track=ssub --switch-source=anikoto --switch-server=HD-1
```

Both diagnostics use the app-owned `anitrack-provider-smoke` temporary profile,
not the installed user's profile. AnimePahe may open its ordinary homepage for
manual verification. A challenged attempt stops; the user completes the check
and explicitly reruns it. No CAPTCHA automation, browser-cookie transfer or
account/MAL writes are involved.

The playback check resolves fresh media through the real connector/registry,
uses scoped media headers, and runs the locally installed HLS library in a
sandboxed local diagnostic window. It checks advancing video frames and audio,
65 seconds of media progression, and forward/backward seeking. A separate
100-second wall-clock ceiling avoids confusing background-window scheduling
with media duration; a 12-second stall still fails. HTTP 403/429 stop immediately.
The whole diagnostic has a 200-second watchdog. Optional staged Miruro checks
also require offered caption cues and verify an explicitly selected server
switch at the saved position; `--staged` does not change release configuration.
Network request logs omit signed URLs, cookies and provider-decoding material.

This is a transport/engine integration check, not full production React-player
UI coverage, a whole-episode soak, every title/server, or subtitle accuracy.

## Observations

- Anikoto: search, 26 episodes, resolution, first/last MPEG-TS segments, an
  HTTP 206 range request and a bounded download write passed for Cowboy Bebop
  episode 1. The diagnostic download was cancelled and removed.
  Its final playback check passed 65 seconds of decoded 1448×1080 video/audio,
  forward seeking to about 816 seconds and backward seeking to 15 seconds,
  with no fatal events or rejected media requests.
- AnimePahe: after user-operated verification, search, 26 episodes, six quality
  choices, resolution and a bounded download write passed for that episode.
  Encrypted segment bytes were not recognized by the byte-sniff probe; its
  success alone is not proof of video decoding.
- AnimePahe's first no-retry playback attempt hit `fragLoadTimeOut`. A fresh
  attempt passed 65 seconds of decoded 1448×1080 video/audio and seeks to about
  816 seconds and back to 15 seconds, with no fatal events. The isolated timeout
  remains a transient observation, not proof of a repaired production-player
  network defect or a permanent outage.
- Miruro's migrated desktop v1 connector passed the expanded check on Cowboy
  Bebop episode 1: KICKASSANIME/Vid soft sub advanced beyond 65 media seconds,
  loaded 215 WebVTT cues, sought to approximately 819.75 seconds and back to
  19.11 seconds. Switching explicitly to ANIKOTO/HD-1 soft sub preserved that
  position and loaded 217 cues. The check completed in 120 wall-clock seconds,
  with 67 HTTP 200 responses and no fatal errors or rejected media requests.
  This uses the normal connector/session transport, not downloaded site modules.
- MKissa catalogue checks succeeded, but media did not pass. Cowboy Bebop's
  returned mirrors included a deleted file, a connection reset, an unsupported
  resolver and HTTP 500. A newer-title direct MP4 resolved once in Node, but
  the byte-range connection timed out and the Electron check failed before
  playback. Uni also failed before playback. See `mkissa.md` for exact scope;
  these failures are not enough to attribute the cause to an ISP.
- MKissa and Miruro remain release-disabled. Miruro Android was still on its
  retired protocol during the desktop-only phase; its subsequent v1 migration
  is described below and does not yet establish device playback.
- Tablet testing was deferred during the desktop-only phase. The tablet is now
  connected for a separate debug-build check; the installed release stays intact.

## Code fixes

Desktop HLS recovery previously treated every network failure as retryable.
The reviewed load policies now retain normal timeout/backoff limits but prohibit
403/429 retries. The React player's error handler catches those statuses even
on nonfatal events, stops loading and preserves the position for a manual retry.
It does not probe another mirror automatically after an access rejection.

Android Anikoto previously fell back to the first subtitle/audio group when the
requested type was missing, swallowed first-page search errors, and caught
security/rate responses while rotating origins/servers. Its new tested policies
keep the requested subtitle group, surface initial search failures, stop an
access rejection for one minute, preserve cancellation between server attempts,
disable HTTP connection retries, bound response bytes and omit request URLs from
HTTP-status errors. Ordinary unavailable servers can still fall through to at
most five advertised servers of the same type. These changes are built/tested
but have not been validated on-device.

Miruro desktop now uses exact current v1 catalogue reads, a bounded local public
wire decoder, correct numeric episode coordinates, exact show/server identities,
fresh selected media, scoped headers and captions. MKissa now refreshes playback
URLs, rejects a disappeared alias, stops unknown/oversized access denials without
crypto refresh, serializes protected reads, and identifies deleted files. Both
opt out of background next-episode prefetch. Synthetic regressions cover these
changes; the live evidence above remains limited to the listed title/server pairs.

Validation: 176 Node tests passed after the desktop Miruro/MKissa repairs.
Desktop typecheck/production build passed. The prior Anikoto phase also passed
143 Android unit tests and its debug build; those results do not validate these
desktop-only changes or the current Miruro API on Android. The successful live
playback checks closed their diagnostic windows on completion. No release was
published.

## Subsequent Android migration and newer MKissa server support

Both Android connectors now include the corresponding fresh-link, exact-server
and access-stop repairs. Miruro uses the current v1 coordinates and a bounded
local public decoder, retaining its app-owned user-operated website session.
MKissa's current Byse/Fm-Hls format has data-only local decoding and direct media
handoff on both platforms. HLS/DASH MIME types and Android's DASH dependency are
explicit; this is fixture coverage, not proof of live Byse playback.

Android Retry now forces fresh resolution while retaining position/play intent.
An unavailable explicit server is not replaced silently with a default. Offered
caption URLs get exact scoped authorization; cross-origin captions receive only
public hotlink headers. Private/nonpublic literal targets do not get credentials.

The debug-only `provider_probe` instrumentation uses the real `PlayerScreen` and
`PlayerHolder`, with database/history/account saving disabled. Its planned checks
cover decoded video/audio beyond 65 media seconds, offered subtitle cues, forward
and backward seeks and an actual selected-server chip click with position
preservation. It never clicks website verification controls, auto-retries a
denial, or enables staged providers in release configuration.

Current validation: **194 Node tests**, desktop typecheck/production build
(main-process compilation repeated after the cookie correction), **187 Android
JVM tests**, and app/test APK builds passed. The final incremental Android build
includes the server-list retry refresh. Both debug APKs were installed for user
0 on the SM-T735 without replacing the signed release or clearing data. The
Miruro ordinary-player probe stopped at manual connection not completed, before
catalogue/server/media requests; connected-tablet playback remains unverified.
The latest MKissa protected-source attempt returned `CAPTCHA_REQUIRED`; all
MKissa live probes stopped there. It remains unverified and release-disabled.

On 7 October, after explicit user approval for a separate isolated MKissa
website investigation, the opt-in ordinary-site diagnostic loaded its homepage
and observed bootstrap HTTP 200 without a recognized gate. No browser/account
cookies or source URLs were exported. Protected-source/native playback success
is not established; the manual title/episode step is still pending. See
`mkissa.md` for the diagnostic's guards and limits. This does not replace the
earlier failed connector attempts with a successful playback claim.

## Follow-up offline repair validation — 7 October

A desktop/Android parity audit reproduced further MKissa defects: desktop
`player` metadata bypassed known clock/embed extractors; malformed encrypted
envelopes caused a needless key refresh; Android matching/default-server loops
swallowed cancellation. Corrected routes now resolve known servers first, reject
unsupported generic pages, stop structural envelope failures after one read,
and propagate cancellation instead of continuing to another title/server.
Existing declared extensionless direct media and the single bounded refresh for
actual envelope authentication failure remain supported.

The new regressions initially failed against those paths. After their fixes,
the full Node suite passed **199 tests**, all **189 Android JVM tests** passed,
desktop typecheck/production build passed, and both Android debug APK builds
passed. The updated separate debug app was installed successfully with its data
inode unchanged. The signed 8.0.0 release and its data inode were checked before
and after installation and stayed unchanged. No release/config enablement or
profile deletion was performed.

One full Node run first failed in the Miruro fixture VM while Node lazily
initialized `Response`; its interrupted initialization also broke a subsequent
fixture. The test now initializes that mock response dependency before entering
the VM. The focused 49-test run and complete 199-test rerun passed; no production
transport timeout, security guard, assertion or test skip was weakened.

The earlier ordinary-site MKissa diagnostic is no longer running, and its final
output/manual title result was not captured. Homepage/bootstrap success remains
the last verified session evidence. No blocked request or verification was
automatically repeated. The tablet is connected, but manual Miruro connection
and current normal-player playback are still unverified. Fresh live checks await
the user being available to complete website checks themselves. These offline
passes must not be represented as working protected sources or native playback.

## Current Miruro normal-player tablet results — 7 October

The user completed the ordinary Miruro connection in the separate debug app on
SM-T735. The migrated v1 catalogue returned Cowboy Bebop's 26 episodes and six
server/track choices. KICKASSANIME/Vid soft sub then failed before its first
native frame with `ERROR_CODE_IO_BAD_HTTP_STATUS`, HTTP 403. The original report
did not identify the rejected resource type. That attempt stopped, without an
automatic retry or server rotation.

The user separately authorized one ANIKOTO/HD-1 soft-sub test and completed its
ordinary connection. The actual `PlayerScreen`/`PlayerHolder` probe passed:
65,139 ms of decoded 1448 x 1080 video and audio output, one rendered caption
cue, forward seeking to 811,182 ms and backward seeking to 31,740 ms. The user
also confirmed visible video and sound. `server_switch_tested=false` explicitly
records that this was a single-server test; the failed KAA server was not retried.
KAA playback and Android position-preserving server switching remain unresolved.

The updated debug diagnostic distinguishes bounded media/caption resource
categories and header names on failure without printing URLs or header values.
It explicitly starts ready media regardless of a stored autoplay preference,
samples captions after a forward seek, and reports its outer watchdog separately
from HTTP failure. Production request/retry policies are unchanged. The complete
Android JVM suite now passed **191 tests** and both debug APK builds passed;
both debug APKs were installed for user 0, without replacing the signed release
or clearing data. The earlier **199 Node tests** and desktop typecheck/production
build remain the latest desktop validation; no desktop code changed in this
debug-only diagnostic phase.

This pass covers one episode/server, not every Miruro title, whole-episode
playback, session recovery, subtitle accuracy or saved watch/MAL synchronization.
The probe disables history/account saving. MKissa's protected-source/manual
connection path and native playback remain unresolved. Both staged providers
remain release-disabled; no version bump, release or signed-config enablement
was performed.

### Subsequent MKissa capability fix and manual website check

Android MKissa advertised a hard/soft subtitle-mode switch but ignored the
requested preference. The capability is now false, removing that misleading
control without changing its server selector or caption handoff. A new
regression reproduced the old behavior before correction. The complete native
JVM suite then passed **192 tests** with zero failures/errors/skips; debug app
and test APK builds passed. The updated debug app was installed successfully,
retaining its data inode 539632. The signed 8.0.0 release and its data inode
186674 were unchanged.

In a separately approved MKissa ordinary-site window, the user reported a
verification/error screen for the manual Cowboy Bebop episode-page check. Its
exact visible message is pending. Terminal API observations were not retained
by that Windows direct-launch attempt, so it supplies no new protected-source
or native-playback pass. There was no automatic retry, identity rotation,
relaxation of verification rules, release or remote provider enablement.

The MKissa website diagnostic now saves a bounded, fixed-schema final summary
for future explicitly approved fresh sessions, distinguishing local guard/cap
blocks from HTTP/security stops without storing URLs, cookies or header values.
The old already-running session cannot be captured retroactively and was not
restarted. A response with no GET query evidence uses generic `api-read` rather
than guessing catalogue/protected identity. Verification flags remain false.

Its offline guard/redaction/exclusive-report checks now run in the normal Node
suite. The first newly added wrapper assertion expected the older success-line
wording; updating it to the new fixed wording corrected that test-only failure.
The complete rerun passed **200 Node tests**, with zero failures/cancellations/
skips. Native validation remains **192 JVM tests** and successful debug APK
builds. Desktop production code did not change in this reporting phase; the
previous desktop typecheck/production build remains the latest build check.

The subsequent completion audit found no further justified production change
without fresh live evidence. Android Miruro's KAA rejection/request identity and
actual switching, MKissa protected access/native playback on both platforms,
and normal production-player/session/progress behavior remain incomplete.
Green fixture suites are not completion proof for those gates. The stale old
MKissa diagnostic was stopped only after exact process/age validation; no files
or app data were deleted. No live request was repeated. Further website checks
await the user's error evidence or confirmation for one fresh manual test.

## Resumed desktop/native checks — 7 October

The desktop audit reproduced two further defects in actual player callbacks:
native MP4 errors could rotate servers after an HTTP 403/429 because Chromium's
MediaError omits HTTP status; next-episode warming could run before the provider
descriptor arrived, including providers which prohibit prefetch.

Each registry resolution now receives a fresh opaque, memory-only media receipt.
The main process snapshots it at native request start and reports a trusted
player's exact-authorized native-media 403/429. An immediate receipt/status event
stops and clears the native source; an authoritative status query backs up event
ordering. Stale receipts/results cannot stop a newer resolution or rotate a
server. Missing/expired/failed queries stop without fallback. Captions,
HLS-directory resources and unrelated windows do not trigger this native path.
Pending fractional position and same-episode play intent survive for a manual
retry. No signed media URL, credential or header is exposed by this new IPC.

Next-episode warming now requires `prefetch === true` on a known descriptor.
Anikoto explicitly opts in only to its tested metadata-only warm-up; Miruro and
MKissa remain opted out. The full Node suite passed **218 tests**, all 44 focused
desktop tests passed, and current-source desktop typecheck and production build
passed. These are offline callback/contract checks, not yet actual Electron
response-order or normal React-player live verification.

The refreshed tablet diagnostic passed **201 JVM tests** and both debug APK
builds, and both APKs were installed only to separate debug packages for user 0.
Release 8.0.0/data inode 186674 and debug data inode 539632 stayed unchanged.
One fresh Miruro KAA/Vid attempt stopped at first-frame HTTP 403; its screen was
closed by handled instrumentation cleanup, with no new Miruro crash entry found.
A later catalogue-only check passed with 26 episodes/six choices and no media.
The offered ANIWAVES-to-ANIKOTO native switch test awaits direct user approval.
No rejected KAA request was automatically repeated or silently replaced.

MKissa's captured desktop website check ended with bootstrap HTTP 200, zero
protected requests and six local guard blocks; it is not a new upstream 403 or
playback result. The tablet catalogue check stopped at server choices with the
typed access-policy exception, whose specific subtype was not recorded. No
native playback followed. See the provider notes for these evidence limits.

Normal desktop React-player integration, Miruro KAA, Android server switching,
MKissa protected access/native playback and durable progress/session recovery
remain incomplete. No packaging, release, signed-config enablement, MAL/Gist
write, installed-profile replacement or app-data clearing was performed.

### Additional offline integration checks

`npm run test:electron-media` now rebuilds the Electron main modules and runs a
repeatable local-only Chromium integration check. The real native-media observer,
authorization registry, opaque event/query IPC and renderer receipt filter passed
synthetic HTTP 403/429 and delayed/reused-URL cases. Chromium identified the
requests as `media`; a stale event did not reject the newer receipt. Zero external
requests were permitted or sent. A declared diagnostic-only projection maps exact
loopback fixture paths to synthetic public authorizations; the real registry's
private-host rejection is independently asserted and was not weakened.

This check uses a fresh temporary profile, hidden sandboxed local page and narrow
test preload, with no provider/DB/MAL/Gist connection. It does not mount the full
React `StreamPlayer` or establish live provider/session/progress behavior.

MKissa's ordinary-site diagnostic now saves capped fixed request-rejection
details, distinguishing unsupported request envelopes from query grammar without
storing queries, variable values, hashes, unknown root names, paths or headers.
Its self-test and complete **218-test Node suite** passed after this refinement.
The first newly added token-count fixture exceeded the earlier query-size cap;
shorter fixture identifiers corrected the test expectation. No guard or limit
was relaxed and no live website was reopened in this reporting phase.

The debug-only Android error reporter now exports reviewed enum subtypes through
a bounded, cycle-safe cause walk; messages and response bodies are never read.
The full **205-test JVM suite** passed with zero failures/errors/skips, and both
debug APK builds passed. Both APKs were installed for user 0, preserving the
release/debug versions and data inodes. The earlier MKissa denial's subtype
cannot be recovered retroactively. Production networking and cleanup behavior
remain unchanged.

### Current ANIWAVES tablet attempt

The user confirmed video and sound on ANIWAVES/Vidplay sub for Cowboy Bebop
episode 1. The normal-player diagnostic progressed through its 65-second
decoded video/audio assertions and forward/backward seek stages. Its fixed
progress logs recorded advancing frames, forward position 805,248 ms and
backward position 31,840 ms. It then stopped at the server-control step with
`IllegalStateException`; no switch or full-pass result is claimed. No HTTP
rejection was reported in this run. There was no automatic rerun or KAA retry.

The debug reporter is being refined to retain earlier stage results and fixed
control-navigation outcomes rather than discarding them when a later step
fails. This attempt alone does not establish a broken production server switch
or its precise cause. Actual ANIWAVES-to-ANIKOTO position preservation remains
unverified.

The next MKissa desktop observation was completed manually and closed by the
user after 265 seconds. The visible message was `NETWORK_ERROR: Failed to fetch`.
Its saved report showed bootstrap HTTP 200, no protected/API-denied requests and
42 locally blocked operations classified as `query-missing`, plus one route and
three origin blocks. The failure therefore occurred within the diagnostic's
request-format restriction; no new upstream 403 or playback pass is claimed.
Exact request envelopes remain unknown. The diagnostic can now distinguish a
standard persisted-query-only envelope without exporting a hash or permitting
the unreviewed operation. Existing allow rules and stop limits are unchanged.

The Android server-navigation report now retains fixed stop reasons, bounded
actions and the last safe visibility observation; completed playback/seek
metrics survive a later-stage failure. Its heading lookup also matches the
real panel's `STREAM SERVERS` fallback when a staged provider is absent from
enabled descriptors. That corrects a reproduced test/UI expectation mismatch,
not a proven production-switch defect. The failed live run was not repeated.

Final validation of these reporting/navigation changes passed **207 Android
JVM tests** across 36 suites, zero failures/errors/skips, and both debug APK
builds. Both refreshed APKs were installed only for user 0 to the separate debug
packages. Release 8.0.0/data inode 186674 and debug data inode 539632 remained
unchanged. The final **218-test Node rerun** and desktop typecheck passed;
desktop production build and the local-only Electron integration also passed.
No additional live provider attempt followed the completed checks above.

The subsequent MKissa inspection was limited to public static metadata, not a
protected API/media attempt: the homepage and four bounded JavaScript assets
(1,283,329 bytes total) were parsed locally without execution. The site's
request-building module contained both persisted-query metadata and an actual
query-removal expression. This corroborates its current query-free format; it
does not establish the exact operation/hash mapping or working API access.
Eight focused diagnostic tests passed, including AST nonexecution, fixed-schema
redaction and ignoring misleading comments/string values. Allowing unknown
hash-only operations or removing verification remains out of scope.

The final full Node suite including that public-inspection regression passed
**219 tests**, with zero failures/cancellations/skips. Native validation remains
**207 JVM tests**, successful debug APK builds and preserved installed data.

### Continued checks — 8 October

The next tablet switch attempt stopped at sustained playback with an insufficiently
classified assertion; a follow-up after improving partial metric reporting
stopped at first frame with `ERROR_CODE_IO_NETWORK_CONNECTION_FAILED`. Both
received the expected 26-episode/six-choice catalogue. No new server-switch
pass, HTTP rejection, or production control failure is claimed. No fallback
server was automatically selected. Debug build/JVM validation passed (207 tests)
and the debug APK was installed with both release and debug data inodes preserved.

MKissa's isolated diagnostic now supports exact content-addressed catalogue
requests from bounded static document parsing. Two reviewed candidates were
found, one `shows` and one `show`; opaque unknown operations remain blocked.
Offline regressions cover nonexecution, cycles, ambiguous bindings, document
bounds, exact GET/POST hashes, mutation/account rejection and conflicting
envelopes. **221 Node tests** passed; all ten focused diagnostic tests also passed
after additional malformed/duplicate-envelope assertions. These changes do not
repair or enable production MKissa playback. A new human-operated search check
is open; homepage/bootstrap success alone is not a search or protected-source pass.
