# Comix manga (desktop and native Android)

Comix is an explicit third choice after MangaDot and MangaBall in both maintained
apps. Existing source preferences remain unchanged. This implementation is in
the working tree; it has not been released or remotely deployed. No legacy
Capacitor implementation is added.

## Public website flow re-inspected on 2026-10-13

- Homepage: <https://comix.to/>
- Search: `/browse?q=...&sort=relevance%3Adesc`
- Title: `/title/{hid}-{slug}`; public detail includes AniList/MAL manga links.
- Chapter reader: `/title/{hid}-{slug}/{chapterId}-chapter-{number}`.
- Website API `/api/v1`: `/manga`, `/manga/{hid}`,
  `/manga/{hid}/chapters`, `/chapters/{chapterId}`.
- The homepage's observed main-module imports lead to a public HTTP facade with
  renamed methods. The reviewed transport structurally identifies its GET
  wrapper and unique export, then imports only that website catalogue module in
  the isolated browser. Asset hashes and method aliases are not hardcoded.
- Unrelated third-party or query-bearing module hints are ignored, never fetched
  or executed by the connector. Discovery is bounded to 12 same-origin assets,
  2 MB per module and 4 MB total. Ambiguous or changed wrappers fail closed.
- Website modules perform ordinary request signing and response decoding.
  Plain HTML alone does not contain the complete chapter/page catalogue. Native
  code never evaluates downloaded JavaScript or exports signing/cipher material.

Protocol/image-format reference (not an executable runtime dependency):
<https://github.com/keiyoushi/extensions-source/tree/main/src/en/comix/src/eu/kanade/tachiyomi/extension/en/comix>.
The locally reviewed image codec's format attribution/license is bundled in
`apps/android/app/src/main/assets/licenses/`.

## User-approved website-session exception

The user explicitly asked to remove the blanket prohibition on running website
code for this connector. The exception permits Comix's ordinary same-origin
website modules in a dedicated Android `:comix` process with the `comix` WebView
data directory suffix (Android 9+), or a sandboxed Electron window using
`persist:comix`. It does **not** permit remotely downloaded native connectors,
app-account access or automatic verification bypass.

- `WebsiteSessionApplication` establishes the separate profile before WebView
  initialization. Comix has no shared MAL/Pahe/Miruro website cookie profile.
- `ComixConnectActivity` shows the normal homepage after the user selects
  **Connect Comix**. No account sign-in is needed. Any verification is manual.
- During Android connection, normal `/browse` and public title pages may also
  load. Comix's observed manual image-check routes are narrowly permitted:
  GET `/@waf/challenge` as a page/frame, GET `/@waf/generate` and POST
  `/@waf/verify` as subresources only. These routes are disabled for hidden
  native catalogue reads. No challenge is solved automatically.
- Android Continue refuses visible WAF/Cloudflare verification frames and
  returns to a normal homepage in the same profile, checking bounded, valid
  initial-data queries before enabling the transport. This fixes the local
  empty-title obstruction; it is not by itself live tablet acceptance.
- The exact public title-group GET is permitted only while connecting, so the
  website can populate scanlator options. Known website chapter anchors show a
  bundled app-owned Continue-to-AniTrack hint instead of a misleading denied
  `unknown page`. Website reader routes are not enabled; read in AniTrack after
  Continue. The helper exposes no bridge and is removed before native readiness.
- Desktop `ComixSiteSession` similarly opens the normal homepage, verifies public
  homepage initial data, injects only the bundled reviewed transport and hides
  the window. Its window has no preload or Node bridge. The unconditional global
  `no-sandbox` switch was removed so the requested Chromium sandbox is effective.
- Desktop permits the same manual browse/title HTML fetches and exact WAF
  routes while connecting. Its app-owned AniTrack menu offers Continue/Cancel;
  recovery after native rejection remains visible until explicit Continue.
  A fresh ordinary homepage still connects automatically. Readiness is checked
  again after transport injection and never granted by a challenge message.
- No `JavascriptInterface`, file/content access, mixed content, popup, chooser,
  permission grant, site-initiated download or app-account bridge is exposed.
- The internal, non-exported service accepts only reviewed public catalogue GET
  paths and bounded parameters. It cannot accept arbitrary script/URL commands.
- The website transport exports selected public title/chapter/page fields only;
  no cookies, signature values, account details or cipher material are exported.
- Only Comix website assets/catalogue routes and the explicitly displayed manual
  verification flow can load. Advertising, account and unrelated hosts are
  blocked. Certificate checks and Android safe browsing remain enabled.
- Security rejections stop the native attempt and require a new manual
  connection. No provider/mirror rotation, timed lockout or automatic retry loop
  is introduced. A page-image failure does not invalidate catalogue access.

## Native reader integration

`ComixSource` searches English/romaji names, checks tracker identity and rejects
conflicting same-named titles. Chapter pages are sequential; IDs, fractional
numbers and groups are retained before the existing generic chapter dedup/order
logic. Missing/repeated pagination fails instead of silently returning a partial
list. Both collectors require a stable advertised total, reject duplicate IDs
and cache only when the final unique-ID count equals that total. Title/chapter
metadata caches are bounded; image lists resolve on demand.
Android also verifies the returned detail HID against the searched HID. An
unlinked title requires an exact normalized name/synonym and actual publication
year within one year; known country/language conflicts are rejected. Genuine
AniList/MAL tracker identities retain precedence over name-only matching.

`MangaSource.resolvePage` is a default pass-through extension point for ordinary
sources. Comix overrides it to fetch and, if necessary, decode one image into a
native cache file. Coil and the existing Compose reader still own page display,
width controls, chapter changes, prefetch and reading progress. Failed/unloaded
pages must not be marked read merely because their placeholders were visible.

Image requests deliberately send no Origin, Referer, cookies or account headers:
the current image hosts reject those hotlink headers. There are no redirects or
connection retries. HTTPS URLs, credential/port checks and DNS
private-address rejection protect the native fetcher. Encoding versions/grid
metadata are validated; unknown formats fail rather than showing scrambled data.
Relative pages use `baseUrl` as a directory; absolute page URLs remain independent.
The `s=1` marker adds a bare `v3` query flag without rewriting signed query bytes.
Desktop uses the app-owned page-image protocol and a locally reviewed decoder.
Its WebP fallback is an ephemeral, network-denied, sandboxed data-only compositor,
not a website session. Android uses the existing native bitmap/cache pipeline.

Bounds: 200 KB catalogue response, 30-second website operation, 35-second session
request, 100 uploads per catalogue page, at most 200 pagination pages/120 seconds,
500 images per chapter, 24 MB compressed image, 12 million decoded pixels, one
native image decode at a time, 25-second image deadline after acquiring its slot,
128 MB Android decoded-file cache target. No live source
response, signed image URL, token or decoding material is saved in test fixtures.

The shared transport snapshots its flat native query contract into the current
website's nested `order` form. Chapter requests use the observed 20-row website
query and actual server pagination, still subject to 200 pages/120 seconds and
stable-total completion. This is normal-client alignment, not a proven HTTP 403
cause or a verification bypass.

Native offline downloads copy only Comix's locally decoded, bounded cache file:
source ID, Context-derived directory, exact hash filename, canonical direct-child
path and no-symlink checks are required. No arbitrary file URL, extra network
request or cookie copying is permitted. Paged reading progress now observes late
image success and never counts a failed pair member/unloaded final page. Restored
bitmap tiles use replacement compositing for transparent pixels.

## Validation

### 2026-10-14 evening: 502 diagnosis and live acceptance

**Rate limit, not session failure.** Comix limits by rows served. A sixth 20-row
chapter page within ~2 s, or a second 100-row page, returns HTTP 502 with
`Retry-After: 60` (JSON, via Cloudflare). 20-row pages ~1.9 s apart passed 60 times
in a row. Both apps now pace chapter-list pages 2 s apart
(`COMIX_CHAPTER_PAGE_INTERVAL_MS` / `CHAPTER_PAGE_INTERVAL_MS`). A 429/502/503 with
Retry-After starts a bounded (1 s–5 min) cooldown: reads fail fast with "Comix is
limiting requests. Try again in N s." No automatic retry, no forced reconnect.
A paced traversal is bounded at 480 s; Berserk (1,710 chapters, 86 pages) takes ~3 min.
The transport's 20-row page size remains correct.

**Saved chapter lists (Android).** Like desktop `savedChapters`, Android keeps each
title's last complete list (`ComixSavedChapters`, `filesDir/comix-chapters/<hid>.json`,
at most 40 lists, 20,000 rows and 4 MB each) plus confirmed AniList matches
(`titles.json`, at most 200). Only a list that passed `ComixChapterAccumulator` is
written, atomically, with the time that traversal finished; on read any invalid row,
duplicate ID, total mismatch or bad field rejects the whole file. After a restart the
title page shows the saved list at once while a refresh runs; a failed or cancelled
refresh keeps the saved list.

The refresh is a quick check first (`readComixChapters`): page 1 and the last page
(the newest uploads), two ordinary allowed requests, ~2 s apart. If the total and both
pages match the saved list exactly (every field), the saved list stays and nothing is
rewritten. Any difference reads every page as before, and only a list that passes
`ComixChapterAccumulator` replaces the saved one. Accepted limit: an upload swapped on
a middle page with the total unchanged is not seen by the check, so a saved list is
re-read in full once it is 7 days old (`ComixChapterCheck.FULL_REFRESH_MS`).
A newest-first incremental refresh (`order[number]=desc`, stop at known IDs) was not
adopted: it would widen the reviewed request allowlist in both apps and could not
produce a list verified by the stable-total rule.

**Android WebView is accepted.** WebView 154.0.8037.106 and Chrome 154.0.8037.127 are
the same Chromium branch. A debug-only fresh-profile probe
(`diagnostics/ComixProfileProbeActivity`, its own `:comixprobe` process and data
directory) used the genuine WebView UA and client hints (`; wv`, `Android WebView/154`,
`webdriver=false`; no `X-Requested-With`). It passed Cloudflare's automatic managed
challenge by itself and loaded the real homepage. No UA, header or fingerprint
change is needed or made. The homepage "Bad gateway / Host Error" seen that morning
was specific to the long-lived `comix` profile. It had cleared about 12 hours later
without wiping data. Its exact cause (likely a server-side penalty tied to that
profile's cookies after earlier bursts) is unconfirmed.

**Connect race fixed.** Android destroys `ComixConnectActivity` after the next
`ComixCatalogueActivity` has adopted the shared WebView. Its `onDestroy` detached the
WebView from the new host, so the first post-connect batch failed with "Comix loading
was cancelled." Each Activity now detaches the WebView only from its own layout.

**Live acceptance.**
- **Desktop smoke** (fresh profile) completed: connect, search, AniList identity,
  86/86 chapter pages, 38 pages, 3 images decoded and rendered.
- **Tablet debug app** (SM-T735) completed:
  - connect, with no manual check needed;
  - the full paced chapter list in AniTrack's own screen;
  - chapter 384 opened in the native reader with decoded images;
  - Next (385) and Previous chapter;
  - three chapter downloads, two verified complete on disk (24 and 28 decoded
    pages) and the third still in progress.

Android still re-traverses the chapter list after every process restart (memory
cache only).

### Earlier status

Latest device status (2026-10-14): the complete native chapter list and readable
tablet images were observed after attaching the isolated WebView to a bounded
native loading Activity. Fresh checks after a long idle now reach the API but
return HTTP 502; even the fresh Connect homepage showed the website's host-error
page. Normal Chrome still works according to the user. The session difference
and final navigation/download acceptance remain unresolved. See
`docs/handoff/CLAUDE_HANDOFF_2026-10-14.md`; earlier outcomes below are historical.

The fresh corrected desktop diagnostic remained a blank `Just a moment...`
window after the user's verification attempt; native catalogue/image acceptance
was not reached. Current scoped validation is 28 desktop session tests plus
Android 290 tests (287 executed, three skipped), with successful main compilation,
debug assembly and separate debug installation. These are not live acceptance.

Uncached Android Comix catalogue batches require the app in the foreground.
The temporary host has no app/account bridge and closes after the batch or its
deadline. Background catalogue work fails with a return-to-app message instead
of bringing a loading window over another app. This does not alter native image
transport or add automatic retries/verification.

Synthetic JVM fixtures cover identity, routes, response shapes, pagination,
fractional chapters, image URL/DNS policy, byte decoding and tile permutations.
Desktop fixtures additionally cover module discovery, session isolation,
cancellation, image transport/compositing and chapter completeness. Run:

```text
npm run typecheck
npm test
npm run build
apps\android\gradlew.bat -p apps/android :app:testDebugUnitTest :app:assembleDebug --console=plain
```

The debug-only `ComixMangaActivity` opens the **real** manga detail/reader screens
for tablet checks; it is absent from release manifests. The test entry contains
only an optional positive AniList manga ID, not tokens or arbitrary URLs.

The isolated desktop live smoke test on 2026-10-13 passed: Berserk was confirmed
by AniList ID 30002, all 1,710 chapter entries traversed across 18 catalogue pages,
chapter 1 returned 38 images, and three native page images loaded. The app-owned
diagnostic reader displayed a readable 1571 x 1100 page; its screenshot was
visually checked. This confirms that selected test, not every title, encoded
format, installed release or reader navigation path.

Explicitly run that diagnostic with:

```text
node_modules\.bin\electron.cmd scripts/electron-comix-smoke.cjs --run --screenshot --display
```

It uses fresh isolated userData and no app/account profile; any website check is
user-operated. Runtime screenshots live in ignored `out/tmp/`.

The tablet live test on 2026-10-13 remains **blocked**: search and title detail
succeeded in the isolated WebView, but the first allowed chapter-list GET
returned HTTP 403 after user-operated Continue. Manual reconnect did not resolve
it. No fatal app crash was observed. Locally denied account/background requests
are separate and must not be confused with this permitted catalogue rejection.
The response was subsequently classified as JSON. A later REA-assisted fix
allows Comix's public HTML title fetches and its own manual image verification
inside Connect. Live tablet search and the Berserk title now render, including
the human verification dialog. The user must complete that check before native
chapter/page acceptance; build success does not make this tablet flow working.

Latest validation of the manual-flow changes: desktop/shared 308 tests and
Android 260 tests passed; TypeScript checks, Electron compilation and debug APK
assembly passed. A fresh desktop smoke stopped at chapter verification after
successful search/identity. The earlier native-image desktop smoke above is
historical; the new manual recovery branch still needs live acceptance.

Evening follow-up: all 320 desktop/shared regressions passed. Android compiled
and reported 282 tests, zero failures/errors, with three Windows symlink fixtures
skipped (279 executed). The final separate debug update was installed without
changing the release APK or clearing debug data. Fresh real-image/navigation/
resume/download acceptance remains pending a manual connection and native read.

Tablet acceptance still requires a successful connection, correct series and
complete chapter list, visibly readable images (including an encoded sample),
forward/back chapter changes, resume, retry/cancellation and regression checks
of existing anime providers. Do not call the provider production-verified based
on compilation or ordinary-browser success alone.
