# AniChan connector — 20 Oct 2026

AniChan is registered after shonen.to in both maintained applications. It uses
AniList IDs directly. Search is `GET /api/suggest?q=…`; title metadata is
`GET /api/catalog/anime/<AniList ID>`. Availability arrays in `selfhost` and
`available_eps` determine playable episode rows. The announced total and future
`ep_meta` entries do not create episodes. Only titles without availability arrays
fall back to `/api/watch/episodes?anilistId=…`.

## Verified website protocol

The normal watch page `/anime/<id>/watch/1` creates its own watch session, after
the site's invisible check or a check completed by the user. Its expiry and
nonce remain in the website profile. AniTrack never manufactures challenge
tokens or exports the site's cookies/nonces to the app UI.

Server metadata comes from `/api/watch/servers` with `anilistId`, `ep`,
`category=sub|dub` and **`tier=fast|rest`**. Omitting `tier` returned an empty
list in initial research, even for working titles. The connector reads `fast`
first and uses `rest` only when no supported direct choice is available.

`anichan_page.js` is one locally bundled reader shared by Electron and Android.
It reads bounded literal protocol data from the current document's public API
chunk, supplies the observed version header and decodes optional AES-GCM JSON
using Web Crypto in the website context. Downloaded modules are never evaluated
by the connector. A changed protocol fails explicitly. HTTP 401/403 asks for a
new connection; HTTP 429 stops requests for a bounded cooldown.

The API chunk is watch-route-specific: navigating to the homepage loses it.
The connector therefore retains the verified watch document. Website video is
paused/muted, and foreign video, advertising and popup resources are blocked.
Only `anichan.to` and `challenges.cloudflare.com` are permitted in this page.
There is no account bridge, file chooser, download or permission grant.

## Native playback

Only direct HTTPS HLS/MP4 results on `anichan.to` or `c.toroplay.cymru` are
accepted. Embeds are excluded. Observed HLS and WebVTT use extensionless
`/api/watch/m3u8` and `/api/watch/vtt` proxy URLs; HLS is explicitly identified
for both players. Desktop verifies the selected playlist and grants CORS for
its child resources.
The public signed proxy's /assets/ prefix receives CORS only: no cookies,
Referer or Origin are attached. This also keeps per-segment token directories
from exhausting the bounded authorization list. Captions and intro/outro ranges
are carried into the native player. Stable server choices contain coordinates, never saved
expiring media URLs; resolving a choice reads that exact server freshly.

HLS downloads are enabled in both apps through their existing queues. A ready
AniChan connection resolves the selected episode immediately before downloading;
only coordinates are queued, so expiring media URLs are not reused. The queues
save the selected rendition, media/key/init files and a preferred WebVTT track
locally. Android marks only HLS results downloadable because the existing offline
transport saves HLS playlists; direct MP4 choices remain playback-only.
Background episode prefetch remains disabled. Older signed configuration files that omit this newly shipped connector retain its built-in
enablement; an explicit `enabled:false` still disables it.

## Evidence and checks

REA's public-module findings are preserved in the
[large-library survey](large-anime-catalogs-2026-10-20.md). Subsequent isolated
Electron research verified Overgeared (212888), episode 1: decoded 1920-pixel
video, readyState 4, no media error, duration approximately 23:40 and advancing
time beyond 22 seconds. That probe was muted and does not verify audible sound.
The actual shared reader then returned six server records from the watch page;
the same reader on the homepage failed as expected. Bebop (1) sub and dub each
returned four direct fast-tier choices in the preceding session probe.

Fixture media URLs are sanitized. The full catalog's claimed 17,000+ titles were
not crawled or independently verified as playable. The app playback results
below supersede the initial research-only status.

## App validation

The production desktop build played Overgeared (212888), episode 1 through
AniChan HD-1 Sub: 1920×1080 video, readyState 4, no media error and 4,349
decoded frames. After seeking to 02:00, playback advanced to 03:12. English
captions contained 635 cues; manifest, segment and caption responses were 200.
The separate audio diagnostic found four outputs and a running AudioContext;
this verifies the sound path, rather than human listening to the episode.

A desktop regression found during this check is fixed: provider session IDs
can coincide when both sources use AniList IDs. Player selection now matches
the provider ID together with the session, so AniChan stays selected instead
of being switched to shonen.to.

Android's real debug app on the Tab S7 FE connected through its normal website
page and played Overgeared episode 1 on vidstream Sub, with visible moving
video, English subtitles and 00:28 / 23:40 on the player. Native logs confirmed
successful serialized sub/dub server reads and media loads. Routine cancelled
reads now abort only their own request, retaining the verified page session;
the cancellation cleanup is covered by both asset and native tests.
The retained Android page stays attached beneath the opaque app UI while
AniTrack is in the foreground. Hiding its verification dialog alone suspended
WebView fetches and timers during delayed server changes; that behavior was
reproduced on the device before the lifecycle fix. After the fix, the page
remained visible to WebView while covered by native content. A manual switch
to HD-1 Sub about a minute after connecting completed its three server reads
in 1.34, 0.54 and 0.50 seconds, then played advancing video at 01:33 / 23:40.
The retained WebView and its host are marked to exclude their descendants from
accessibility; native content covers the website and supplies the app controls.

Validation: npm run typecheck, npm run build, the complete Node suite
(455 passed, using --test-concurrency=2 on this memory-constrained PC), and
npm run android:next:test with :app:assembleDebug all succeeded. Native results:
426 tests, zero failures or errors, three skipped. The debug APK was updated
in place; the user's release app and data were not changed. No commit, push
or release was made for this work.

## Download validation

Downloads now appear in both apps. Existing queues resolve fresh coordinates at
transfer time and preserve the preferred caption. The downloader fixture adds
AniChan's extensionless signed proxy manifests plus two differently tokenized
CSS/PNG-named MPEG-TS segments and a WebVTT caption; the resulting playlist
contains only local filenames and the saved bytes match.

Typecheck, production desktop build, all 456 Node tests, and native tests plus
debug APK assembly passed. Android results remain 426 tests with three skips
and zero failures/errors. The APK was updated in place.

Live sampling found HTTP 502 responses before download for Teekyuu episodes 1
and 2 on sampled mirrors, and AIURA episode 1 on vidstream. Those cached catalogue
entries did not establish playable media. Overgeared episode 1 on HD-1
resolved successfully and is the live download sample.

The tablet completed Overgeared episode 1: 356 local segments, approximately
478 MiB, plus a 42,994-byte WebVTT file with 635 cues. The local playlist has
no network references. Downloads → Play rendered moving video with English
subtitles. A simultaneous desktop transfer stopped on a CDN HTTP 429; it did
not rotate servers or keep retrying that rejection.

The resolved conservativeNetwork setting is now carried into both download
queues. Rate-sensitive downloads use one file at a time with a 500 ms spacing.
Android stops media retries for this mode; desktop already treats 429 as
terminal. Native requests also omit a blank Referer instead of sending '/'.
The desktop regression checks serialized, paced transfer as well as local
media/caption bytes. Download errors no longer display signed media URLs on
Android. Direct MP4 choices receive a clear HLS-only message on desktop.

Rate-sensitive desktop requests also use a bounded 90-second deadline, matching
the native Cronet transfer window. A slower CDN response interrupted the first
paced desktop attempt at the default 30-second deadline. The timeout regression
checks both normal and conservative modes, including a stalled transport that
ignores cancellation.

The final debug APK reopened the saved episode after a process restart, with
no connected AniChan page. Native playback advanced from 10:57 to 11:13 of
23:40 and rendered the saved English captions. Playback was stopped afterward.

The final desktop run completed all 356 segments: 237,337,508 bytes in the QA
folder, with a 40,850-byte English VTT containing 635 cues. The test selected
the server-provided 720p rendition to bound transfer size; the normal queue
continues to select the highest-bandwidth rendition. The saved playlist has
no network references. With HTTP/HTTPS requests blocked in the renderer, the
local player reached readyState 4 at 1280-pixel width, no media error and
English captions showing. Playback advanced from 195.78 to 210.87 seconds;
decoded frames increased from 184 to 597. The test player was paused afterward.

Final checks after the pacing/deadline changes: typecheck and production desktop
build succeeded; 456/456 Node tests passed; native tests and debug APK assembly
succeeded (426 tests, three skipped, zero failures/errors). Both live download
and offline-playback paths were exercised. No commit, push or release was made.

## Server dropdown validation

Both players now place a Server dropdown below Sources when the current source
offers multiple servers; a single server is shown as a label, and sources without
server choices omit the control. Labels retain Sub/Dub distinctions. The native
menu scrolls through longer lists and marks the current selection. Desktop also
exposes the dropdown in player settings, independently of video quality, so it
remains available in fullscreen.

The real desktop QA app switched Overgeared episode 1 from HD-1 Sub at 228.97
seconds to vidstream Sub, then played at 243.62 seconds with advancing decoded
frames and no media error. The tablet switched the same episode from vidstream
Sub to HD-1 Sub: screenshots show 15:19 before and 15:51 after, with moving video
and English captions. The native menu was scrolled to its final Dub entries.
Sources without server variants showed no server dropdown in both running apps.

Validation: typecheck, production build, all 456 Node tests, native unit tests
(426 tests, three skipped, zero failures/errors), and debug APK assembly passed.
The debug APK was installed in place. Test playback and QA processes were closed;
no commit, push, or release was made.
