# Claude Code handoff — Comix and provider investigation

Latest continuation: [October 14 timeout/session follow-up](CLAUDE_HANDOFF_2026-10-14.md).
Read that checkpoint before treating historical live successes below as current acceptance.

## User request and boundaries

The user authorized changes again and prioritized making Comix work on **both
Electron desktop and the native Kotlin tablet app**, then writing this handoff
for Claude Code. Other providers were investigated with REA; MKissa remains
aside at the user's request. No Flutter app exists; Capacitor is legacy.

The checkout was already extensively dirty with Claude's manga/UI/provider work.
Do not reset it or assume every modified/untracked file belongs to this pass.
No commit, push, release, version bump, profile deletion, solver installation or
installed-release replacement was performed. Any website verification remains
user-operated. No token, cookie, signed page/media URL or decoder secret belongs
in this handoff or fixtures.

## Outcome so far

Comix is now an explicit third manga source after MangaDot and MangaBall on both
maintained platforms. Existing preferences/defaults are preserved. Website-owned
catalogue signing/decoding runs only in its user-approved isolated website
session; AniTrack owns its normal reader and native image decoder.

The **desktop live integration smoke passed**, not just fixtures/builds:

- Fresh temporary userData, isolated sandboxed Comix session, no MAL/Gist/DB
  imports or installed profile. No global `no-sandbox` switch.
- Search Berserk: 20 hits; first detail confirmed AniList manga ID 30002.
- Complete stable-total traversal: 18 catalogue pages, 1,710 upload entries.
  These are grouped uploads, not 1,710 distinct chapter numbers.
- Selected chapter number 1: 38 page images.
- First three images loaded through the actual native desktop Comix transport.
- App-owned diagnostic reader rendered page 1 at 1571 x 1100. Screenshot was
  visually inspected and was readable, without shuffled tiles.
- Entire smoke completed in approximately 32 seconds with exit code 0.

Runtime screenshot (ignored, local only):
`out/tmp/comix-smoke-reader-1791847173121.png`.
This is an integration diagnostic using production session/protocol/image
modules, not a test of every full renderer navigation/resume/download path or
every title/image encoding. Tablet live acceptance is recorded below when done.

## Main causes and fixes

### Shared Comix website transport

`apps/android/app/src/main/assets/comix_transport.js` is the reviewed shared
asset, explicitly included in desktop packaging too.

The old `env-*.js` export discovery no longer matched the website. The current
homepage main module imports a catalogue module whose public five-method HTTP
facade has renamed aliases. The local recognizer follows **observed** module
hints/static imports, inspects source as inert text, identifies the unique
async Axios `.data` wrapper and its GET method/export, and imports only that
normal website module **inside the browser**. No hardcoded live asset hash,
prototype interception, downloaded-module Node execution or native secure-VM
execution is added.

A live-only discovery bug was then found: the hydrated homepage adds unrelated
third-party module hints. Rejecting one of these aborted legitimate discovery.
They are now ignored as out-of-scope, never fetched/imported by the connector;
same-origin/route limits remain in force. Added a regression covering foreign,
query-bearing and non-asset hints alongside a valid catalogue module.

Bounds: 12 candidates, 2 MB per asset, 4 MB discovery total, 30-second operation,
200 KB projected result. Only bounded public title/chapter/page fields cross the
boundary. Cancellation is identity-bound and aborts the selected operation;
errors are fixed categories, never upstream bodies or signed coordinates.

### Desktop implementation

New local files:

- `apps/desktop/main/services/manga/comix-session.ts`: explicit connect flow,
  `persist:comix`, sandbox/context isolation, no Node/preload/account bridge,
  denied permissions/popups/downloads, reviewed catalogue routes, serialized
  bounded reads, manual reconnect on access rejection, crash/close cleanup.
- `.../comix-protocol.ts`: request/network policy, identity/pagination/page
  parsing, absolute/base-relative URLs and signed-query-safe `v3` flag.
- `.../comix-image-codec.ts` and `.../comix-images.ts`: locally reviewed image
  byte/tile restoration, bounded direct public HTTPS transport and WebP fallback.

Integration changes:

- `.../manga/sources.ts`: Comix registry entry, matcher, chapters, latest,
  protocol pages/raw download images, native fetch dispatch and connect dispatch.
- `apps/desktop/main/ipc/manga.ts`: connect dispatches the selected source.
- `packages/shared/manga.ts`: decimal Comix chapter-ID support.
- `apps/desktop/main/main.ts`: removed the unconditional global `no-sandbox`
  switch, which defeated isolated provider-window sandboxing. Other existing
  changes in this file predate this pass. Sandboxed live Windows smoke started
  and passed; full installed-desktop startup still needs release acceptance.
- `package.json`: registers new regression files and bundles the exact shared
  transport plus existing image-format/Apache notices; no dependencies added.

Images send **no Origin/Referer/cookies/account headers**; current image hosts
reject those hotlink headers. Public/private-address checks apply to the actual
HTTPS DNS lookup, with TLS verification intact. No redirects/retries. One active
fetch/decode, bounded queue, abort-safe reservation, 25-second deadline after
slot acquisition, 24 MB compressed / 12 million pixel limits. The WebP fallback
is an ephemeral app-owned data-only sandbox with all network/permissions denied,
not the provider window. Android's image cache remains platform-owned.

Both chapter collectors now require a numeric stable `total`, reject duplicate
IDs/excess/empty contradictory pages and verify the final unique-ID count before
caching. Desktop rechecks the 120-second traversal budget after every awaited
read and immediately before cache/disk write; Android checks cancellation before
cache. No partial list is cached as a success.

Incidental proven desktop fix in `sources.ts`: MangaDot Connect no longer treats
a 200 HTML challenge or arbitrary JSON error as success; it requires a parsed
JSON `suggestions` array. This is separate from Comix.

### Native Android

- `data/manga/MangaSource.kt`: Comix third registry entry.
- `data/manga/comix/ComixProtocol.kt`: absolute/base-relative image URLs and
  `v3` flag preservation; tracker precedence, strict tracker URLs and conservative
  unlinked matching using actual publication year and non-conflicting country.
- `ComixImages.kt`: removes rejected hotlink headers, keeps TLS/public DNS,
  cache/decode bounds and serial native bitmap restoration.
- `ComixSessionEngine.kt`: typed connection-required failures, 35-second host
  deadline, invalidation on catalogue access/session changes.
- `ComixSessionService.kt`: fixed `verify:true` response for those failures.
- `ComixSource.kt`: native `MangaVerificationRequired` projection so the normal
  UI shows Connect, 40-second caller deadline, complete chapter accumulator.
- Existing `MainActivity` attach/detach and separate `:comix` profile/process
  are retained. No app/account bridge added.

Debug-only real-reader entry:
`apps/android/app/src/debug/java/com/sanjay/anitrack/next/diagnostics/ComixMangaActivity.kt`.
It defaults to AniList manga ID 30002 and accepts only an optional positive
`manga_id`, not arbitrary scripts/URLs/tokens. It is absent from release manifests.

## Validation ledger

- `npm run typecheck`: passed after desktop changes.
- `npm test`: **302/302 passed**, zero failures/skips/cancellations.
- `npm run build`: production renderer and Electron compiled successfully;
  final Electron-only rebuild after the completeness guard also passed.
- Android `:app:testDebugUnitTest :app:assembleDebug`: final identity patch
  passed, **254/254** tests, zero failures/errors/skips; debug APK assembled.
- Desktop live smoke: passed as above.
- Native tablet: connected Samsung SM-T735, serial `R52T70951XT`; live Comix
  acceptance is not yet confirmed at this checkpoint.

Commands:

```text
npm run typecheck
npm test
npm run build
apps\android\gradlew.bat -p apps/android :app:testDebugUnitTest :app:assembleDebug --console=plain
node_modules\.bin\electron.cmd scripts/electron-comix-smoke.cjs --run --screenshot --display
```

The smoke requires explicit `--run`, preserves its fresh temp profile, uses safe
stage/category/count logging and stops on a rejection. It never logs raw errors,
Response objects, module signing values or image URLs.

Tests added/updated: `tests/comix-transport.test.mjs`, `comix-protocol.test.mjs`,
`comix-session.test.mjs`, `comix-images.test.mjs`, `comix-chapters.test.mjs`,
`tests/manga.test.mjs`; native `ComixProtocolTest`, `ComixImageCodecTest`,
`ComixChapterAccumulatorTest`, `MangaSourcesTest`.

## REA and other source investigation

Full finding ledger and pre-fix artifact Evidence/digests:
`docs/providers/rea-source-audit-2026-10-13.md`.
Its old hashes are **not** identities of the newly rebuilt artifacts. Source
review/post-fix smoke observations are explicitly separate from REA static
artifact Evidence. Semantic graph coverage is partial/unknown, not 100% decoded.
JADX's configured external engine was absent; no decompiler/dependencies were
installed. REA ADB capture was also unavailable because its configured `adb`
path was missing; the already-installed Android SDK ADB works normally.

A fresh post-fix REA analysis of the rebuilt desktop manga subtree was also
completed: 9/9 JavaScript files parsed, 109,105 bytes, 136 static findings,
zero parse/UTF-8 failures. Subtree SHA-256:
`70af2da3de1b14202c38e48f3a24fc7a2a90ecc19a230abe3510791af642b9da`.
Parent Evidence:
`ev_4642b1c94f61b070a688cf666e0abb01870836eb7a6c3e9f1d6ba86f4abdf79c`.
Summary-view Evidence:
`ev_353aa9c129070dc1861e965c3a4c4ff5091f9dd06c81d6661a948d7b3bf4d4d4`.
Application coverage remains partial; 3,500 semantic unknowns remain. This static
result is not the live desktop smoke Evidence and does not prove execution.
Its two retained records were exported to ignored
`out/tmp/rea-provider-evidence-2026-10-13.json` (17,964,199 bytes); the parent REA
session was then closed. This local export does not include all earlier workers'
pre-fix Evidence, whose immutable IDs/digests remain in the audit report.

Useful remaining findings, outside the main Comix implementation:

- Miruro native registration remains debug-only. Current v1 XOR/gzip catalogue
  decoding was inspected; that is not proof every offered media server plays.
- `VerifiedPageSession` has a reproduced concurrent-window race; Comix uses its
  new separate session class, but the existing Miruro path still needs repair.
- Anikoto opaque encrypted HLS references remain unsupported; an Android catch
  can misclassify access failures as cipher failures.
- Native Pahe session timeout/close readiness and 403/429 retry paths need
  review. The Kwik generic button click and missing player-429 stop need review.
- `PUBLIC_HLS` authorization can drop allowed public headers when an ambient
  Cookie is present. Keep credentials stripped without discarding other headers.
- MangaDot previously returned 403 in direct unauthenticated checks; that alone
  does not establish the precise challenge cause. Do not silently retry/rotate.
- MKissa was inventoried offline only; do not restart its investigation unless
  the user brings it back into scope.

Do not claim a universal Cloudflare/CAPTCHA bypass or guaranteed source uptime.
Normal browser-session catalogue decoding works for the tested Comix flow;
human verification/access rejection still requires user action.

## Final acceptance/update checkpoint

Tablet live **did not pass**: after user-operated Continue, search and title
detail reached response-format successfully, but the first chapter-list GET
returned HTTP 403 with `permitted=true`. This is a real allowed catalogue
request rejection, distinct from the locally denied account/background calls
(`permitted=false`), and no fatal process crash was observed. Reconnecting
manually did not resolve it. Pages/navigation/resume remain untested.

The release
package `com.sanjay.anitrack.next` and its data must remain unchanged; testing
uses only `com.sanjay.anitrack.next.debug` with an in-place data-preserving update.

Android review found a name-only fallback accepted unknown/conflicting year or
country and did not confirm returned detail HID. The scoped fix now requires
actual numeric publication year (±1) for unlinked exact-name/synonym matches,
rejects supplied country/language conflicts, validates tracker URL authority,
and confirms detail HID before caching its title. Search hits may omit metadata,
so only bounded sequential detail results can confirm a match (20 hits per
query, two query names, deduplicated HIDs). Four new regression groups cover
these cases. Final unit/build validation passed (254 tests). The separate debug
APK was installed with `adb install -r` successfully. Debug data-directory inode
remained `539632`; the installed release's APK path remained unchanged before
and after installation. The real Comix debug detail activity was then launched.
No live tablet inference is made from the desktop result.

The ordering hypothesis was checked and rejected: the actual Android framework
JSONObject uses LinkedHashMap and preserves the existing page/limit/order
insertion order through Source→Service→Engine; sorting Object.keys in the shared
validator does not mutate parameters. Do not "fix" this by spoofing headers,
rotating domains/servers or silently retrying. A debug-only fixed metadata log
now classifies rejection MIME as json/html/other or `cf-mitigated: challenge`,
without logging bodies, URLs, signatures, cookies or cipher material. Its final
incremental unit/build run passed. The response was subsequently classified as
JSON, not HTML or a `cf-mitigated` challenge. No response body or verification
secret was logged.

## Manual Comix connection follow-up (2026-10-13)

The user reported that opening a title inside Android's Connect Comix window
was empty even though the ordinary tablet browser/PWA worked. Source inspection
found a local obstruction: the connection policy only allowed the homepage,
and denied Comix's own same-origin manual image-CAPTCHA routes.

REA passive captures of the already-open tablet Chrome and isolated WebView
showed identical current catalogue/security/main module identities. Evidence:
`ev_1b47cf7114e64289288183c4d7f39f03244bab9bf552a9f419e35951a38b0abc`
(Chrome) and
`ev_6f5c7d7417aada7eb5647298d175c4c9579952846891d036501aea05bb9b25b9`
(WebView). The WebView capture observed zero new requests; it did **not** capture
the earlier HTTP 403. Both are policy-filtered, attach-window-limited evidence,
not a claim that all code executed. REA 6.4's Android discovery rejected the
browser socket path; temporary loopback metadata/direct-page transport adapters
were used without modifying REA, website requests, authentication or browser UA.

The captured public facade declares the normal manual WAF modal and its one
original-request retry after a human-completed check. A separate ordinary GET
of `/@waf/challenge` returned HTTP 200, title `Security check`, 9,967 bytes,
SHA-256 `d82605ea6f7d0435b0357d0ae0fbc7cde3c94011ee37181ee7ccb6c5af565734`.
That document declares GET `/@waf/generate` and human-operated POST
`/@waf/verify`, with inline data-image challenges and same-origin
`waf-captcha-solved` messaging. No generate/verify request, solver or challenge
interaction was performed by the investigation. This is Comix's own manual
flow, not evidence of a universal Cloudflare bypass.

Android `ComixProtocol`, `ComixSessionEngine` and `ComixConnectActivity` now
permit normal homepage/browse/title navigation while connecting and those exact
manual WAF routes. Generate/verify are subresource-only; hidden/native reads
still stop on refusal. The visible website may complete its ordinary manual
flow without AniTrack blocking the site's own retry. Continue rejects visible
same-origin WAF or exact Cloudflare verification iframes, returns to a validated
homepage in the **same** session, then enables the bounded bundled transport.
Account/ad requests, arbitrary POSTs, reader navigation, popups, permissions and
app/account access remain denied. New policy fixtures and boolean DOM probes
cover these boundaries. Build and live acceptance for this follow-up must be
recorded below before claiming tablet reading works.

Important static follow-up: the captured current main module's `pm.ZI` handler
intercepts same-origin title-card anchors and calls `pm.zx`, which fetches the
destination HTML as a GET **subresource**, parses it and replaces
`script#initial-data`; `pm.init()` is invoked at startup. Merely allowing title
main-frame navigation would leave the empty-page bug. Both platforms' manual
connection policies therefore need the same narrowly reviewed public page GETs
as subresources too. No additional API, account or reader path is needed.
Artifact: ignored `out/tmp/comix-rea-main-20261013.js`, from the passive WebView
Evidence above. This is static evidence for the required request, not by itself
a successful live title click.

### Latest validated checkpoint (supersedes earlier acceptance status)

- `npm run typecheck`: passed for renderer and main after the manual-flow edits.
- `npm test`: **308/308 passed**, zero failures/skips/cancellations (45,509 ms).
- `npm run build:electron`: passed after the desktop edits.
- Android `:app:testDebugUnitTest :app:assembleDebug`: **260/260 passed**,
  zero failures/errors/skips; final run successful in 3m54s.
- Latest debug APK installed with `adb install -r`; release APK path unchanged.
  No release app update, profile reset, commit, push or release was performed.
- Tablet: the normal website search found Berserk, and the formerly empty title
  now renders at `https://comix.to/title/zjem-berserk`. Its normal human image
  verification dialog also renders correctly. User has been asked to complete
  it, then Continue; native chapters/images are still awaiting that step.
- REA confirms the actual title page plus its same-origin `/@waf/challenge`
  child frame: `ev_c7b17432d8fe6caa252635d0064fdae14afca8a383b4f30b081e109e6cf8392a`.
  This three-second passive capture had zero new network requests and remains
  attach-window/policy-filtered; it does not establish a solved check.
- Fresh desktop smoke **did not complete**: search (20 hits) and exact identity
  passed, but the first chapter-list attempt required verification and stopped.
  The earlier desktop image success is historical, not this fresh profile's
  latest acceptance. Desktop's manual recovery branch is covered by fixtures,
  but still needs a live user-operated verification and reader check.

Desktop now permits the same exact public-page HTML fetches and manual WAF
routes while connecting. The isolated window has an app-owned AniTrack menu
with Continue/Cancel. Fresh ordinary homepage connections retain automatic
completion; after native 401/403/429 it stays visible until explicit Continue.
Continue cannot dismiss a visible check, returns to exact root in the same
profile, validates initial data and reprobes after transport injection. All
hidden website traffic stops after a native refusal; no solver/retry loop added.

Ten retained runtime records were exported to ignored
`out/tmp/comix-rea-runtime-20261013.json` (3,651,105 bytes). It is a separate
runtime bundle, not a replacement for the earlier static manga artifact bundle.
REA was then closed, both temporary loopback adapters stopped and only the
task-owned ADB forwards 54124/54128 removed. The tablet's normal Comix connection
screen remains open for the user; no app/profile/browser data was removed.

## Reader/download and connection follow-up (13 October evening IST)

The user reported a chapter list after manual verification, but fresh observation
on reopening the debug detail subsequently showed Connect Comix again. Safe
diagnostic logs showed a chapter response reaching response-format followed by
a later permitted chapter GET returning JSON 403. Thus the user's report is
retained, but full native chapter/image acceptance is still not established.

Additional implemented fixes:

- `MangaReaderScreen.kt` + pure `MangaReaderProgress.kt`: progress observes both
  settled pager position and successful image display. Late image completion
  now triggers saving; failed paired pages are not counted and an unloaded final
  page cannot finish the chapter. Seven pure unit regressions added.
- `ComixImages.kt`: restored bitmap tiles use PorterDuff SRC, not SRC_OVER, so
  transparent pixels replace old scrambled pixels. The added JVM guard inspects
  native source; it is **not** a real device alpha-rendering test.
- `MangaDownloads.kt` + `ComixCachedPageCopy.kt`: decoded Comix cache files copy
  into the existing offline chapter without another HTTP request. This branch
  requires source ID `comix`, the Context-derived `cacheDir/comix-pages`, an exact
  canonical direct-child 64-lowerhex `.page` file, no symlinks, no URL credentials/
  authority/query/fragment/encoded alias, bounded bytes and cancellation checks.
  Unique partial files are atomically published and cleaned on failure. Other
  file URLs remain denied; existing HTTPS downloads/metadata remain unchanged.
  Thirteen pure fixtures added; the Windows symlink capability skipped three
  of these in the first native run. Do not call skipped cases passed.
- Debug-only `ComixMangaActivity` initializes the existing manga-download service
  so the real detail/reader test can exercise offline chapters.
- `scripts/electron-comix-smoke.cjs --manual-recovery`: an opt-in diagnostic
  catches only the first chapter verification failure, waits for a user-operated
  same-session connection/menu Continue, then discards partial counters and
  starts one fresh page-1 traversal. A second failure stops; default mode still
  stops immediately. Five offline fixtures cover these limits.

The user then reported website chapters visible inside Connect but chapter
links showing `unknown page`. Website reader routes are deliberately outside
the connection policy. New bundled `comix_connection_help.js` intercepts only
strict known same-origin chapter anchors and displays a static Continue-to-
AniTrack hint instead of letting the website fetch a locally denied reader
document. No bridge, challenge action or readiness signal is exposed. Both
sessions dispose of this listener before entering the native-ready phase.
The asset is included in Android assets and desktop packaging `package.json`.

Retained public main component `jo` also unconditionally requests public
`/api/v1/manga/HID/groups`. That exact GET is now permitted as a subresource
**only while connecting**; it is not a native catalogue operation. Account,
reader, ad and external image-host policy is otherwise unchanged. Missing
website covers remain a known visual limitation of the connection screen.

Retained website code showed normal chapter queries use 20 rows and nested
`order:{number:'asc'}` (descending initially; start-reading selects ascending).
`comix_transport.js` now snapshots validated native flat parameters into that
normal website shape before asynchronous discovery. Search keeps limit 20 and
nested relevance order; chapter queries use 20-row server pagination. Native
caller validation remains limit 100 for compatibility, but actual returned
pagination drives traversal; 200 pages/120 seconds/stable-total guards remain.
No inspected evidence proves that query shape or size caused HTTP 403. This is
alignment with the current normal website, awaiting a fresh live check.

Validation at this interim checkpoint: 313 desktop/shared tests passed outside
the restricted filesystem. The restricted run had seven download-fixture
storage failures; rerunning those 13 mocked fixtures with normal access passed
all 13, with no production-download code change. Native reader/download units
and APK build passed: 281 tests, 0 failures/errors, **3 skipped** (278 executed),
in 9m32s. Final query/connection-helper changes are undergoing another coordinated
test/build run; record that result and actual tablet installation below.

The fresh desktop diagnostic timed out during initial connection at 182 seconds
before search, awaiting a website check; it did not validate new recovery/reader
behavior. No installed release/profile change or universal verification bypass
is claimed.

### Final build checkpoint for the evening fixes

- Renderer/main type checks and Electron compilation passed.
- Full desktop/shared regressions: **320/320 passed**, no skips/failures.
- Android final cached-dependency build succeeded in 38 seconds. **282 tests**,
  no failures/errors, **3 skipped** Windows symlink-capability cases, so 279
  actually executed. These are not full device/rendering acceptance tests.
- Shared helper asset is packaged beside the shared transport. It does not
  permit website reader navigation; the native reader remains the destination.
- Final debug APK installed with `adb install -r`: success. The release APK path
  and debug data-directory inode were unchanged. Berserk's real debug detail
  activity was reopened. Fresh manual native reading and desktop verification
  still require live acceptance; do not report the provider fully working yet.
