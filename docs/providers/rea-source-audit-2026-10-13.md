# Provider REA audit — 2026-10-13

## Scope and status

Read-only, pre-fix audit of the existing AniTrack desktop build artifacts and
Android debug APK, cross-checked against repository source. The implementation
work for Comix is running separately. This report does not claim that the
artifacts below include those new fixes.

Questions covered: provider registration, catalogue/source decoding, session
boundaries, packaged website/player assets, and remaining compatibility gaps.
Anikoto, AnimePahe, Miruro, Comix, MangaDot and MangaBall were reviewed. MKissa was
inventoried offline only, respecting the user's decision to leave it aside.
MangaDex/MangaPill remain unregistered reference implementations, not active
providers in this snapshot. Legacy Capacitor is not a maintained application.

No live protected requests, website code execution, CAPTCHA solver, credentials
inspection, app build, install, release or commit was performed by this audit.
Only this report was added. No cookies, tokens, source cipher values or signed
media/image URLs are recorded here.

## Exact artifact identities

REA 6.4.0 analyzed two existing extracted CommonJS subtrees, not a packaged
desktop installer. File modification times below are filesystem observations,
not proof of the original compilation time. The desktop files were modified
2026-10-11 23:40:01–23:40:10 UTC (2026-10-12 05:10 IST). APK modified:
2026-10-12 19:11:08.4097178 UTC (2026-10-13 00:41:08 IST).

| Target relative to repository | SHA-256 | REA parent Evidence |
| --- | --- | --- |
| `dist-electron/apps/desktop/main/services/providers/` | `c776b632b1444249247ae32969cef4c89231955c923fee04f62b8f824945f3f2` | `ev_71878a79a9667cdf6fb41d05586832daafe45c09ca36332a5194a9a43130a440` |
| `dist-electron/apps/desktop/main/services/manga/` | `9ae5721a8cfbcee9b7e5dbf8d571c3d6900fc8a3b4c90606568469d2d70f2967` | `ev_c20bdcdac0f1a6ea93e7d20f0d2e80b60231f7eadefdf680cadba3ccf0db718a` |
| `apps/android/app/build/outputs/apk/debug/app-debug.apk` | `0daaaebaaaad6cb577085d43be211e50ddc04f758f6d5c147ff29f3b5c2498d7` | `ev_18b5cb6ebc3f290b1be18ae095e488944034f77ed6d9a2c4c616bb1cd557d23c` |

The APK is 30,897,524 bytes. Its adjacent output metadata identifies
`com.sanjay.anitrack.next.debug`, versionCode 11, versionName `8.0.0-debug`.
That identity is from build metadata; REA did not decompile or verify manifest
semantics or APK signing.

Selected compiled file digests:

| File in the desktop provider subtree | SHA-256 |
| --- | --- |
| `anikoto-source.js` | `2280b11ce4376561e5dbd7575d8b2ba6286db8760711c3721787f1ce225e6a1f` |
| `animepahe-kwik-parser.js` | `6d06e6dbe3f794706ff8c7284e199c9b32614c522629af3612df2f7af755e5c9` |
| `miruro-v1-client.js` | `ff44cf301ffcf7824a640b2cf610dcdaffdbd0d174a32d45ba66127add2ba734` |
| `mkissa-crypto.js` | `b16ab7cb235816c537462038f9d23748449e03510b4c54cce3ac0cae5064ddc0` |
| `index.js` | `aad668ff9e57b6eb2b025badd10a0fe2afd3f2a9a20d2320bc037d78adc71070` |
| `verified-page-session.js` | `a57ef95cd29cad7960b0c0d9080e0668ecbcedb4f9cb4e33abc3fe169419ed59` |

Desktop manga `sources.js`:
`4f2901c130b27ba561682991b32c33cf47f8b06accd63b7682a02aa6bbd1f37f`.

## REA findings and coverage

- Providers: 32 relevant files, all 32 parsed; 307,375 text bytes; 330 static
  findings; no invalid UTF-8 or parse failures. Application graph is **partial**;
  semantic coverage is **unknown**, with 9,374 unresolved semantic observations.
- Manga: five relevant files, all five parsed; 57,343 text bytes; 71 static
  findings; no invalid UTF-8 or parse failures. Application graph is **partial**;
  semantic coverage is **unknown**, with 2,013 unresolved observations.
- Analysis used a 512 MiB source-analyzer heap and 15,000 ms per-source deadline.
  No timeout was returned. Static imports are resolved only inside each selected
  subtree; Electron/Node dependencies and shared-package imports outside the
  subtree remain external/unresolved. This is not proof that they are missing.
- APK archive inspection completed: 423 distinct nodes, 498 occurrences, 497
  edges, no integrity contradictions. Manifest:
  `agm_21eac660ca47e645eba075d195b45ab6e3e5cec090e61336dc1a7fd849213ba4`.
  Inspection Evidence:
  `ev_2e0eaa985d0d88865959d6a5434a1034a6c5f266251a04fc023314b0d03a9ef5`.
  This is central-directory/member inventory, not APK signature validation.
- Android code inspection returned `capability_unavailable`: the separately
  supplied `jadx-headless-mcp 0.7.1` JAR is not configured through
  `REA_JADX_MCP_JAR`. Nothing was downloaded or installed. Kotlin findings below
  are repository-source observations, not decompiled APK behavior.

REA recovered the compiled Anikoto `decodeAnikotoCiphertext` export at
`anikoto-source.js:34` (item Evidence
`ev_2714ba85a353090ea95718ca236f2b737dd032cb9a61181f6eaa6b161322d893`),
Miruro `decodeMiruroV1` at `miruro-v1-client.js:28` (item Evidence
`ev_23cc804b74ad21f6690dccaf110e687980e52baedb36e7e1a3d8857f2aecc9a3`),
AnimePahe `readKwikHtml` (item Evidence
`ev_d8c7d8e6b175e89498f5972070ae9c8a1193f60222845e1257a7bde65dcc599d`),
and desktop manga `connectMangaDot` (item Evidence
`ev_d24b601f915396a4ebe5ab18876f3b4959b4a3eb80435c50ac3132dbfd45fd7b`).
These identify syntax/bindings and source ranges; none establishes execution.

### Packaged asset/source equality

| APK member | Bytes | Verified member SHA-256 | Source equality at audit |
| --- | --- | --- | --- |
| `assets/comix_transport.js` | 6,807 | `225b3cd85ead8e50f8576669efc15ffe016b31787001a9125d1d963cbb3adf8c` | Exact match to existing Android asset |
| `assets/pahe_player.html` | 3,651 | `5651c9cd4b8d6cdf5f95a76c6d2056f7d5e2c264343ca5fdf19ad644746411fe` | Exact match to existing Android asset |
| `assets/hls.min.js` | 543,002 | `442f599c34f103c3355b375a23bdff560592d7117d09a8c847242ea3de2d40e0` | Inventoried only |

Equality proves these specific packaged bytes, not that an application screen
invoked them. `ComixProtocol.kt` was modified at
2026-10-12 19:39:50.8773731 UTC, later than this APK; its newer image handling
cannot be assumed to exist in the packaged code.

## Source cross-check: current decoding and registration map

| Source | Observed decoding flow | Registration/session limits |
| --- | --- | --- |
| Anikoto | Public player literals parsed as bounded data; source envelope decoded with AES-256-CBC; validated media URL; HLS playlist inspection | Registered on both apps. Desktop uses its own persistent partition. Android carries a public-HLS authorization scope. Source metadata decoding is separate from segment/media decoding. |
| AnimePahe | Desktop parses bounded P.A.C.K.E.R string data without eval, extracts media candidates; Android uses its website/WebView resolver and packaged hls.js player | Registered on both. Homepage and Kwik are separate access stages; completing one does not establish the other. |
| Miruro | Current `/api/v1` byte response: fixed XOR transform, gzip expansion with an output cap, UTF-8/JSON validation; normalized direct media choices | Registered desktop, gated by signed runtime config; Android adapter explicitly DEBUG-only. Legacy secure-pipe decoder remains in files but is not the current v1 path. |
| Comix | Same-origin website catalogue facade signs/decodes requests inside the dedicated Comix website session; reviewed native byte/image signature decoding plus optional 5×5 tile restoration | Existing Android implementation remains unregistered at audit start. No Comix implementation/registration in the analyzed desktop manga subtree. Packaged transport only recognizes the older `env-*.js` layout. |
| MangaDot | Plain JSON suggestions/details/chapter lists/page references; no source cryptographic decoder | Registered both. Desktop `persist:mangadot`; Android user-verified WebView cookies/agent. Catalogue and protected images need valid access independently. |
| MangaBall | Plain JSON search/detail/chapter/image records; one POST listing with paged GET fallback; normal image bytes | Registered both. Host-specific API/CDN handling. No encrypted catalogue decoder in reviewed source. |
| MKissa | Offline code contains bounded public bundle/boot metadata parsing, HMAC/SHA-256, AES-256-GCM request/response handling, source XOR formats, and Byse AES-GCM decoding | Unregistered both. No live site/server requests made; no claim that these formats still match the current site. |

Relevant source entry points: `apps/desktop/main/services/providers/`,
`apps/desktop/main/services/manga/sources.ts`, `packages/shared/manga.ts`,
`apps/android/app/src/main/java/com/sanjay/anitrack/next/data/providers/`,
`.../data/manga/`, `.../data/Anikoto.kt`, `.../data/Pahe.kt`, and Android assets.
No decoder bypasses DRM, license enforcement, account authorization or a website
verification challenge merely by interpreting an already-readable response.

## Actionable gaps (pre-fix source snapshot)

1. **Comix catalogue discovery is brittle.** Android
   `assets/comix_transport.js:16–58` requires an `env-*.js` preload or static import
   and one object-shaped five-method HTTP facade. APK asset equality above
   confirms this exact old loader is packaged. Repair discovery/normalization
   against the currently observed website structure; add both layout fixtures.
   Preserve isolated execution, route bounds and data-only native output.
2. **Comix is not available through the regular source registries.** Android
   `data/manga/MangaSource.kt:54` and desktop `manga/sources.ts:382` list MangaDot
   and MangaBall only. Registration must accompany the working connector and
   lifecycle/reader/download integration, not just a diagnostic activity.
3. **MangaDot can report a false-positive connection.** Desktop
   `manga/sources.ts:449` marks any successful text fetch connected without parsing
   its catalogue shape. Android `MangaDotSource.kt:73` does parse JSON but catches
   only two provider exception types; malformed JSON can escape the Boolean
   connection check. Require a supported response shape and a safe false/error
   result. No live malformed response was fetched in this audit.
4. **Desktop verified-session window lifecycle needs a regression test.**
   `verified-page-session.ts:176` can create another window when an existing one
   is unverified and the readiness promise has been cleared. Static inference:
   reuse the live verification window and retain single-owner readiness. This
   audit did not execute that state transition.
5. **Miruro Android release availability is still gated.**
   `MiruroAndroidProvider.kt:17–23` explicitly uses `BuildConfig.DEBUG` for
   enablement and browser lifecycle. Release readiness requires an intentional
   configuration change and release-mode verification, not a debug-only success.
6. **Anikoto supports only part of the media-format family.**
   `anikoto-hls.ts:60` rejects long opaque `/segment/…` references by pattern. That
   alone does not establish encryption or Cloudflare denial. Android
   `Anikoto.kt:328` also converts all `IllegalStateException` instances to a missing
   cipher; an access exception of that type can be mislabeled as a format change.
7. **Android access-stop policies are inconsistent.** `Pahe.kt:205,238` can set
   readiness on close/timeout; `Pahe.kt:383` retries 403/503/429 and the broad catch
   can try another configured domain. `PlayerScreen.kt:983` excludes 429 from its
   refused-code set for nonconservative playback. Distinguish manual verification,
   rate limiting and decoder failures; do not amplify an access rejection.
8. **Android public-HLS header preparation can cancel its own authorization.**
   `PlayerHolder.kt:126` may attach ambient cookies for nonconservative media,
   while `ScopedRequestAuthorization.kt:42` rejects PUBLIC_HLS authorization when
   any nonpublic header is present. Static conditional failure, not reproduced
   playback evidence here. Provider-supplied public headers should remain scoped
   and independent of unrelated WebView cookies.

## Remaining acceptance work

Registration and decoder structure are answered statically. Current server-side
compatibility, session expiry/reconnection, real Comix catalogue results and
decoded page readability are unresolved in this audit. It intentionally does
not repeat earlier network checks as new evidence.

After Comix implementation/build: verify search identity, complete pagination,
one ordinary and one encoded image, chapter forward/back, resume, cancellation,
manual retry, downloads, app restart and persistent session isolation on the
actual desktop/tablet. Verify failed pages never advance reading progress.
Re-run representative anime-provider regression tests. Build success or the
existence of an image codec is not proof of this acceptance checklist.

REA session was deliberately left open for the parent investigation; closing it
clears retained Evidence references. This report preserves immutable IDs and
digests but is not a complete exported portable Evidence bundle.

## Post-fix addendum — 2026-10-13 (IST), later implementation pass

This addendum supersedes the pre-fix Comix registration/loader status, not the
artifact identities or REA coverage above. The prior directory/APK hashes and
Evidence IDs remain **pre-fix snapshots**. No new REA artifact analysis,
decompilation, build or network request was performed for this addendum.
Implementation status was cross-checked using the current local source. The
desktop live results below were reported by the parent agent's isolated smoke
test, not observed anew by this read-only audit or issued as REA runtime Evidence.

### Changes confirmed in current source

- Comix is now registered on both maintained apps, after MangaDot/MangaBall in
  the existing preference order. Desktop has `comix-session.ts`, pure protocol
  helpers, image transport/codec, source-registry wiring and the normal native
  reader/download path. Android registers the existing `ComixSource` and retains
  its non-exported service/activity in the separate `:comix` process/profile.
- Desktop and Android now use the same bundled reviewed catalogue transport.
  It recognizes the bounded structural website HTTP facade and its renamed
  export/read method, rather than requiring one `env-*.js` filename or a stable
  method name. Identification parses data/syntax; only the ordinary same-origin
  website module executes inside the isolated provider browser session. No
  downloaded provider code is evaluated in Node or Kotlin.
- Unrelated/foreign/query-bearing preloads and imports are filtered out of the
  Comix candidate set rather than breaking discovery. Candidate host/path rules,
  per-module/total-byte bounds and ambiguity rejection remain enforced. The
  current limits are 12 candidates, 2 MB per module and 4 MB aggregate module text.
- Catalogue operations are allow-listed and serialized. Transport cancellation
  aborts pending fetches and removes the operation; browser/native timeouts and
  output caps remain bounded. No app/account bridge, permissions, popup access
  or cross-provider credential sharing was introduced.
- Image handling preserves absolute URLs, directory-relative base joins,
  per-image `s=1`/`v3` flags and existing query values. Native image requests do
  not send catalogue cookies or Origin/Referer. Byte-prefix decoding and 5×5 tile
  restoration are locally reviewed; unknown formats fail. Desktop rejects
  private DNS destinations and serializes bounded image decode work. Images are
  delivered to AniTrack's reader, not a provider embed.
- Chapter collection now requires a finite integer declared total ≤20,000 that
  stays stable across pages. Both implementations reject duplicate chapter IDs,
  an incomplete final page/total and a changing total without saving a partial
  list. Page-count/time guards remain in place; desktop also checks the overall
  deadline after each awaited catalogue read.

### Desktop live smoke reported by parent agent

The isolated Comix desktop smoke succeeded for **Berserk, AniList ID 30002**:

- 20 search results were returned and the target identity was selected.
- 18 catalogue pages yielded 1,710 chapter/upload entries.
- The selected chapter 1 returned 38 page-image records.
- Three native image responses loaded successfully; page 1 was rendered at
  1571×1100 in the app-owned diagnostic reader and visually inspected.
- The smoke took approximately 32 seconds.

This establishes that representative live desktop search, full chapter
collection, page discovery and native image rendering worked in that run. It
does not establish every series/image format, persisted-session expiry,
downloads, app restart or full reading-progress acceptance.

### Remaining limits

No post-fix tablet live acceptance has been confirmed in this addendum. Android
source/build readiness is not the same as readable real tablet images. The
manual connection, complete chapters, encoded-image readability, chapter
forward/back, resume, cancellation, downloads and app-restart checks above remain
necessary there. No automated website challenge solver or blanket Cloudflare
access guarantee is part of these changes.

## Passive runtime and manual-navigation follow-up — 2026-10-13 (IST)

The user subsequently reported an empty title page/HTTP 403 in Android's
connection window while the ordinary tablet browser/PWA worked. This follow-up
separates the reported symptom from what the passive captures actually observed.

| Evidence or artifact | Observation and boundary |
| --- | --- |
| Chrome `ev_1b47cf7114e64289288183c4d7f39f03244bab9bf552a9f419e35951a38b0abc` | Passive capture of the already-open tablet browser; current catalogue/security/main module identities matched the isolated WebView. |
| Native WebView `ev_6f5c7d7417aada7eb5647298d175c4c9579952846891d036501aea05bb9b25b9` | Passive, policy-filtered attach-window capture. Zero new requests were observed; the earlier HTTP 403 was **not** captured. |
| `out/tmp/comix-rea-main-20261013.js` | Ignored native-captured main-module artifact, 196,789 bytes, SHA-256 `c25e77680e99997ec1ae77ab8ce697a99fb58682d678955c34df4f65d1ab61f7`. |
| `out/tmp/comix-rea-catalogue-facade-20261013.js` | Ignored captured facade, 38,084 bytes, SHA-256 `bc9efff9d060df39e088963cf9dc9e696d2fcfc037d719bff8e372c23d603c51`. |

Neither capture observed a new provider API request or proves that all recovered
code executed. REA 6.4 Android browser discovery rejected the browser socket
path. Temporary **in-memory**, loopback discovery/direct-page adapters were used
to reach the already-selected page; no REA files, website requests, authentication
headers or browser user-agent were modified. These limits are recorded in the
parent handoff, not hidden by a claim of complete runtime coverage.

The local JavaScript copies above include an added terminal newline. Their
listed byte counts/hashes identify those inert local files, not the exact CDP
source-string bytes or V8 script hashes.

### Exact manual WAF flow

The captured facade distinguishes HTTP 403 JSON `captcha_required` from an
ordinary denial. It dispatches `waf:captcha:open`, waits for the site's normal
human-operated flow, then retries only the original request once after
`waf:captcha:solved`. `waf:captcha:cancelled` rejects that wait. This is Comix's
own website flow; no AniTrack CAPTCHA solver is implied.

One separate ordinary GET of `/@waf/challenge` returned HTTP 200, title
`Security check`, 9,967 bytes; document SHA-256:
`d82605ea6f7d0435b0357d0ae0fbc7cde3c94011ee37181ee7ccb6c5af565734`.
Its inert inline code declares GET `/@waf/generate` and human-button-operated
POST `/@waf/verify`. Challenge images are inline data URLs, not an additional
image host. Embedded success sends same-origin `waf-captcha-solved`; top-level
success returns to a validated relative target, default `/`. No generate/verify
request, challenge interaction or solver was performed by this investigation.
The external Cloudflare Insights beacon is not a declared dependency of the
manual challenge UI. These WAF routes must remain available only during the
explicit visible connection flow; hidden catalogue reads still stop on refusal.

### Why a title can remain blank despite allowing main-frame navigation

Static inspection of the captured current main module found that startup calls
`pm.init()`. Its `pm.ZI` handler intercepts same-origin title-card links and calls
`pm.zx`, which fetches destination HTML as a GET **subresource**, parses it, and
replaces `script#initial-data`. The previous homepage-only policy locally denied
that document fetch. Allowing a title URL only as main-frame navigation therefore
does not address this path; the same narrowly reviewed public homepage/browse/
title GETs must also be allowed as subresources while manually connecting.
No extra account, reader, arbitrary POST or provider API route is justified.

This is static request-path evidence corroborated by passive module identity,
not a recorded successful title click or a captured server 403. At this ledger
step, fresh live acceptance of the scoped navigation-policy repair was pending;
subsequent results are recorded below. No additional build, network call,
decompilation or app-source edit was made to prepare this ledger.

The subsequent Android identity review found and fixed an unlinked name-only
fallback and missing detail-HID check. Exact real tracker identities retain
precedence; otherwise an exact normalized title/synonym needs actual numeric
publication year (±1), with known country/language conflicts rejected. Detail HID
must equal the selected search HID before caching. Final Android units/build
passed 254 tests; this remains build/source evidence until the tablet live check.

Later tablet live check did not pass: search and title detail reached successful
response-format phases, but the first permitted chapter-list GET returned HTTP
403 after user-operated Continue. Manual reconnect did not resolve it. No fatal
process crash was observed. Separate locally denied account/background 403s
had `permitted=false`; the chapter request had `permitted=true`. No page-image,
chapter-navigation, resume or download acceptance was established on tablet.

## Fresh rebuilt desktop manga artifact analysis

After the final Electron rebuild, the parent performed a new REA summary
analysis of `dist-electron/apps/desktop/main/services/manga/`. This is distinct
from the old artifact and from the successful live smoke:

- SHA-256: `70af2da3de1b14202c38e48f3a24fc7a2a90ecc19a230abe3510791af642b9da`.
- Parent Evidence: `ev_4642b1c94f61b070a688cf666e0abb01870836eb7a6c3e9f1d6ba86f4abdf79c`.
- Summary-view Evidence: `ev_353aa9c129070dc1861e965c3a4c4ff5091f9dd06c81d6661a948d7b3bf4d4d4`.
- 9/9 files parsed, 109,105 bytes, 136 static findings, zero parse/UTF-8 failures.
- Application graph partial, semantic coverage unknown, 3,500 semantic unknowns.
  No website bootstrap/module code was executed by this static analysis.

The parent exported the two records retained in this fresh session to ignored
`out/tmp/rea-provider-evidence-2026-10-13.json` (17,964,199 bytes), then closed its
REA session. That export preserves the fresh manga analysis/view only; it is
not a complete portable export of all earlier workers' Evidence IDs above.

## Latest navigation-fix checkpoint

Final scoped changes passed TypeScript checks, Electron compilation, 308
desktop/shared tests and 260 Android tests; the debug APK assembled and was
installed over the separate debug package without changing the release APK.

Tablet live search and the Berserk public title now render inside Connect,
including the previously blocked manual verification dialog. REA
`ev_c7b17432d8fe6caa252635d0064fdae14afca8a383b4f30b081e109e6cf8392a`
observed the actual `/title/zjem-berserk` page and its same-origin
`/@waf/challenge` child frame. Its three-second passive window had zero new
requests; it does not establish that the check was solved. An earlier attempted
click-window capture also observed zero requests and is not claimed as a title
fetch/403 trace. Native chapter/image acceptance awaits the user's manual check.

A fresh desktop smoke passed search and exact identity but stopped at the first
chapter request with verification required. The earlier complete desktop/image
success is historical; the current manual recovery branch needs live acceptance.
Runtime Evidence was exported separately to
`out/tmp/comix-rea-runtime-20261013.json` (10 records, 3,651,105 bytes).
