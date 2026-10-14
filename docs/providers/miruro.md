# Miruro integration status

Status: **Desktop v1 diagnostic verified; Android ANIKOTO/HD-1 single-server playback verified, KAA/Vid rejected with HTTP 403; release-disabled**.
Last investigation: 2026-10-07. No release or remote enablement was performed.

The current desktop connector uses `/api/v1/` with a locally implemented public
wire decoder. Cowboy Bebop episode 1 passed video/audio progression beyond 65
seconds, caption loading, forward/backward seeks and a selected server switch
with position preservation. Android's active adapter now uses the same current
v1 catalogue and local decoder. Its build and JVM tests passed, and the connected
tablet passed one ANIKOTO/HD-1 soft-sub normal-player test. Android KAA/Vid and
position-preserving server switching remain unresolved. See the latest sections below;
earlier sections are dated investigation history, not the current API contract.

Selected address: **https://www.miruro.ru/**, explicitly confirmed working by
the user and listed by the [official domain directory](https://www.miruro.com/).
There is no automatic mirror rotation. The request protocol was initially
inspected on `.to`; `.ru` references the same frontend asset filenames.

## September frontend protocol (historical)

The site at <https://www.miruro.to/> identifies anime by AniList ID. Its public
frontend sends read operations through `/api/secure/pipe?e=...`. The `e` value is
base64url UTF-8 JSON containing `path`, `method: "GET"`, `query`, and `body: null`.
The frontend may include a protocol version, but does not require key loading
to finish before its read requests. This initial reader omits the optional version.

Observed reads:

| Operation | Path | Query |
| --- | --- | --- |
| Configuration | `config` | Empty |
| Show information | `info/{anilistId}` | Empty |
| Episodes | `episodes` | `anilistId` |
| Selected source | `sources` | `episodeId`, `provider`, `category`, `anilistId` |

The reader accepts plain JSON and the observed compressed response formats.
`x-obfuscated: 1` is base64url gzip; version `2` also XORs the compressed bytes
with the repeating public hexadecimal `VITE_PIPE_OBF_KEY` value from `/env2.js`.
Only the environment file's JSON literal is parsed. Remote JavaScript is never
executed. The key stays in memory, expires after 30 minutes, and is not logged or
stored in configuration. The committed test key is synthetic.

The inspected frontend assets were `index-DPT9Xg0u.js` and
`WatchRoute-CceGaX7g.js`. The watch component receives a direct video URL and
subtitle metadata, but that alone does not establish the current source response
schema or stream authorization requirements.

The [official source repository](https://github.com/Miruro-no-kuon/Miruro) has an
older Consumet-based request flow in `src/hooks/useApi.ts`; do not treat those
routes or payload types as verified documentation for today's deployed API.

## Implemented

- Desktop: `miruro-protocol.ts` and `miruro-client.ts` under the provider services.
- Android: `connectors/miruro/MiruroProtocol.kt` and `MiruroClient.kt`.
- Shared synthetic wire fixture: `tests/fixtures/miruro-protocol.json`.
- Node and Android tests cover request identity, plain/gzip/XOR decoding,
  environment parsing, size limits, challenge cooldown and no automatic retry.

Reads are serialized and have 15-second network timeouts. API responses and
decompressed output are capped at 2 MiB; environment input at 64 KiB. Network
requests are restricted to the original HTTPS site; redirects are rejected.
403/security-check and 429 responses start a five-minute cooldown. There is no
background polling: expiration only permits a subsequent caller request. Source
responses are never cached by this transport.

## Live verification blocker

The `.to` configuration request returned HTTP 403 and a Cloudflare
`Attention Required` security page, so further probes there were stopped. After
the user explicitly identified `.ru` as working in their browser, its homepage
returned HTTP 200 but one configuration request also returned the same 403
security page. Further API requests there were stopped too. The in-app browser
could not attach a tab, so normal interactive playback could not be checked.
No CAPTCHA, automatic mirror/proxy workaround, account tokens, or browser-session
transfer were used. Synthetic tests establish codec and safety behavior, **not working
search, episodes, playback, seeking, server switching, or downloads**.

## Normal Chrome playback check (2026-09-05)

With the user's explicit permission, the Chrome skill was used to navigate the
normal `.ru` website. No CAPTCHA or login prompt appeared. No cookies, account
storage, or session credentials were inspected or copied.

- Search found Cowboy Bebop (TV, 1998). Its watch page exposed 26 episodes and
  13 server/variant choices. This is a per-title observation, not a global count.
- The `bee` server played actual video; the media element reported 1448x1080,
  readyState 4, unpaused, and no media error. A screenshot confirmed video frames.
- A forward-seek control click completed with playback still active, but an
  exact forward time delta was not captured, so forward seeking is not signed off.
- The page subsequently showed a `strm.cx` host-resolution error and a switch-
  provider message. Selecting `pewe` restored playable 1448x1080 video.
- Backward seeking on `pewe` moved from approximately 348.62 to 343.03 seconds,
  with readyState 4, unpaused, and no media error. An immediate forward-key check
  did not show a confirmed jump. Server-switch timestamp preservation was not
  verified.
- The page labelled episode 1 "Stray Dog Strut" and placed "Asteroid Blues" at
  episode 13. Do not assume the site's displayed titles establish media order;
  validate episode identities against actual source responses before mapping.

This confirms browser playback, **not native connector access**. The direct
API security blocks remain unresolved. The browser was not used as an API proxy
and no expiring stream URLs were copied into AniTrack. The app provider remains
unregistered and disabled pending a supported, verified integration path.

## September integration gates (historical)

1. Obtain normal, successful current-site responses for configuration, search,
   episodes and one selected source. Redact expiring URLs and secrets before
   saving parser fixtures. Confirm search parameters rather than using old ones.
2. Implement normalized TypeScript and Kotlin adapters against those fixtures.
   Use one Miruro provider with its servers as variants. Keep AniList ID,
   episode number and sub/dub category stable while switching servers.
3. Validate direct HTTPS media/subtitle URLs and required request headers. Scope
   authorization to the exact URL or the verified HLS directory. Never load an
   advertising embed to discover a source, or fall back to a third-party proxy.
4. Add explicit registry entries and disabled configuration defaults on both
   platforms, plus a disabled entry in signed runtime configuration. Do not add
   an empty provider to the user-facing selector before it can resolve media.
5. Verify playback, seeking, switching and progress on desktop and Android.
   Keep downloads disabled until direct download resolution is verified.

Until then, both app registries and signed configuration are intentionally
unchanged by the Miruro work. Existing providers remain unaffected.

## Android-first native access diagnostic (2026-09-06)

The requested outcome is native-provider parity with Anikoto, not a website
wrapper. A short-lived website-player experiment was removed before building
or installing it. No browser-player entry is part of this implementation.

`MiruroAccessInstrumentation` in `app/src/androidTest/` exercises the actual
Kotlin `MiruroClient` on the tablet. It requires explicit `miruro_probe=true`,
reads configuration, one AniList info record and its episodes sequentially,
and stops on the first error. A persisted five-minute diagnostic cooldown
prevents repeated instrumentation runs from resetting the client cooldown.
Output contains bounded response structure only, not JSON values, cookies,
source URLs or decoding keys. No media is requested and no browser-session
transfer, header impersonation or security workaround is used.

Build the debug app and test APK with `:app:assembleDebug` and
`:app:assembleDebugAndroidTest`. Install them side-by-side with the signed
release (the debug application ID ends in `.debug`). Run the diagnostic only
against the connected, authorized device:

```text
adb -s DEVICE_SERIAL shell am instrument -w -e miruro_probe true -e anilist_id 1 com.sanjay.anitrack.next.debug.test/com.sanjay.anitrack.next.diagnostics.MiruroAccessInstrumentation
```

An HTTP security block observed on the development computer does not establish
the tablet's result. This device diagnostic is needed before choosing any
Android transport change or writing adapters against assumed response schemas.
Successful catalogue access would still not prove stream resolution, seeking,
server switching, downloads or progress synchronization.

### Device result (2026-09-06)

- Connected the user's Samsung SM-T735 running Android 14 over its advertised
  wireless debugging endpoint. The initially restricted debugging server could
  not connect; a separate authorized server succeeded without stopping it.
- Android JVM regression tests, debug APK and diagnostic APK builds passed.
- Updated only `com.sanjay.anitrack.next.debug` and installed the separate
  `.debug.test` instrumentation APK for the primary Android user. The signed
  release application was not replaced or uninstalled.
- The real Kotlin transport returned `STOPPED at config: SECURITY_CHECK`.
  The probe stopped before info/episode/source requests. It did not capture a
  successful payload, resolve media, launch a browser or copy browser cookies.
- This confirms the access blocker also affects this Android device with the
  current transport. It does not prove that all possible supported integration
  paths fail. Native provider registration remains intentionally unchanged.

### User-operated session verification experiment

After the user approved a one-time verification step (not browser playback), a
debug-only `MiruroVerificationActivity` was added under `app/src/debug/`. It is
not exported, not registered in the release manifest, and not a selectable
stream provider. Add `-e miruro_verify true` to the opted-in instrumentation
command above to open it. The user has three minutes to complete any site check
and tap **Test native access**, or cancel. No native request is triggered by a
page-load callback or cookie detection.

The screen loads only the ordinary Miruro home/verification flow. There is no
automated CAPTCHA interaction, injected scraping JavaScript, JS-to-native
bridge, browser fingerprint override or video-player embed extraction. The
native attempt uses the screen's genuine WebView user agent and an in-memory,
two-minute snapshot of the app-owned Miruro cookies for the two exact API/env
paths. It does not read Chrome's session or any other origin's cookies.

`MiruroRequestPolicy` validates the HTTPS host, port and path before looking up
session headers; redirects remain disabled. Invalid/oversized headers are
rejected. The ordinary `MiruroClient()` still makes sessionless requests unless
an explicit session transport is supplied. A new security response stops the
experiment; it does not launch another browser, rotate identities or retry.

This is an access experiment, not evidence that verification enables native
stream resolution or playback. The normalized Miruro adapter remains absent
until successful current-site payloads and playable media can be verified.

On-device verification experiment result (2026-09-06):

- All 46 Android JVM tests passed (including four new session-scope/header tests).
  Debug app and diagnostic APK builds passed and were installed to the debug
  packages only. The verification activity was confirmed resumed on SM-T735.
- The user-triggered **Test native access** path returned
  `STOPPED at config: SECURITY_CHECK`; no further native requests were made.
- The result does not establish whether the browser page itself completed
  verification. User confirmation of the visible page is still needed. It does
  establish that this user-agent/cookie session handoff did not yield usable
  native configuration data in this attempt. No further probe or fallback was
  automatically launched.

### Same-session catalogue access succeeded (2026-09-06)

The user confirmed that the homepage loaded before tapping the test button.
A separate explicit test (`-e miruro_verify true -e miruro_in_page true`) kept
requests inside that user-operated WebView session. The debug-only
`MiruroWebSessionTransport` performs a locally reviewed same-origin GET and
passes its bounded response to the Kotlin protocol decoder. It exposes no
JavaScript-to-native interface, copies no cookies, and does not intercept video
or execute downloaded resolver code. Polling observes only local completion
state, never repeats a network request. The user can cancel the visible session.

On SM-T735 this returned successful configuration, info and episode responses
for AniList ID 1. The live shapes confirm `config.streaming`, `providerOrder`,
`episodes.providers[server].episodes.sub/dub` and `info.media`. Twelve server
configuration entries were returned; this is not a count of working players.
Several providers returned 26 sub/dub episodes; others had empty episode data.

The current public watch component passes `episode.id` to source resolution
and uses `episode.number` for episode identity. It selects `ssub` when a server
supports soft subtitles instead of hard subtitles. The Kotlin and TypeScript
protocol validators now accept this observed category, with regression coverage.

The six mock tests in `tests/miruro-web-session.test.mjs` exercise the actual
locally authored GET script with no live site access. All 65 Node tests and 46
Android JVM tests passed, along with the debug app and diagnostic APK builds.

This removes the earlier catalogue-access blocker for this tested Android
session. It does not establish unattended startup, session expiry recovery,
source/media authorization, native playback, seeking or progress synchronization.
The native provider is still unregistered; no release configuration was enabled.

An optional `-e miruro_source bee` diagnostic reads only that server's episode
1 source after successful catalogue responses. It uses the returned episode ID
without logging it, preserves the reported subtitle category, stops on failure
and never resolves every server in parallel. Source response shape alone is not
proof that a playable media URL has been obtained.

### Selected episode source verified (2026-09-06)

After reconnecting the tablet by USB, the selected-source diagnostic completed
successfully for **bee / ssub / episode 1** of AniList ID 1. Its response contained
five stream entries and two subtitle entries. The live schema is:

- Episode: `id`, `number`, `title`, `image`, `airDate`, `duration`, `audio`,
  `description`, `filler`, `uncensored`, `fillerType`.
- Stream: `url`, `type`, `referer`, `server`, `default`.
- Subtitle: `file`, `label`, `kind`, `default`, `language`, `format`, `encoding`.

Only field types were recorded; real opaque episode IDs, signed media URLs and
credentials were not printed. Five entries do not imply five playable servers.

`MiruroMediaParser` accepts only direct HLS/MP4 entries, validates HTTPS URLs,
rejects credentials/local targets and unknown/embed types, and conservatively
includes VTT subtitles. Its normalized media handoff uses native playback with
exact/directory-scoped Referer authorization and downloads disabled.

The optional `-e miruro_native true` diagnostic uses a separate debug-only
Media3 playback activity. It does not write watch history or MAL progress. It
checks a rendered first frame, advancing video time and frames, and seeks to
approximately 120 seconds and back to 30 seconds. It has bounded timeouts and
disables load-error retries and source fallback. This is an engine smoke test,
not integration into AniTrack's normal provider selector/player route.

### Native playback and seeking verified (2026-09-06)

The USB SM-T735 test passed for AniList ID 1, **bee / ssub / episode 1**:

- Two direct HLS candidates were accepted from five entries; three embeds were
  ignored. Only the first accepted candidate was played, without source fallback.
- The native Media3 player rendered 1448 x 1080 video and advanced both playback
  time and decoded frames during the ten-second progression check.
- Seeking to 120 seconds resumed at 122,084 ms; seeking back to 30 seconds
  resumed at 32,031 ms. The test required new video frames after both seeks.
- No watch-history/MAL writes, release changes or provider enablement occurred.

The debug app and test APK built successfully; all 49 Android JVM tests passed.
This verifies this one native-engine session, not a full episode, all servers,
subtitle rendering, normal-player integration, session recovery or downloads.

### Staged normalized Android adapter

`connectors/MiruroProvider.kt` now implements `AnimeProvider` using an explicitly
supplied session reader. `miruro/MiruroCatalogue.kt` turns the observed catalogue
into numeric episode identities and stable server/category variants. It checks
show identity, respects configured server visibility/order, separates sub/dub
resume keys, and rejects an unavailable selection instead of silently changing
servers. Variant discovery uses metadata only; source resolution occurs only for
the selected episode/server and is repeated when requested, never cached.

`tests/fixtures/miruro-catalogue.json` is a synthetic observed-schema fixture;
it contains no real opaque episode IDs, session data or signed media URLs.
Adapter tests cover identity, ordering, lazy/fresh resolution, soft-sub categories,
hard-sub preference, dub resume, invalid selections and error/cancellation flow.
All 57 Android JVM tests passed (including eight adapter tests); both debug APK
builds passed after adding the adapter. That newer build has not been installed
or exercised through the ordinary player on the tablet.

The adapter is not in `Providers.registry`. Its ordinary UI/session owner is
still required: explicit verification entry, session lifetime across normal
player/navigation changes, cancellation, expiry and cooldown recovery. The
successful device run above exercised the protocol/media parser and diagnostic
Media3 activity, not this newly added adapter or AniTrack's normal PlayerScreen.

### Ordinary Android UI integration (staged, 2026-09-06)

`MiruroAndroidProvider` is now explicitly registered, available in debug builds
only. Release availability is hard-disabled; no signed remote config was changed.
The provider-neutral `ProviderAccess` contract adds explicit Connect/Reconnect/
Disconnect controls to the details page and player error UI. A Continue-Watching
tap or explicit in-player provider switch can request verification if needed;
background matching never opens the page.

`MiruroBrowserSession` owns a restricted ordinary-homepage WebView in the current
MainActivity. The user completes any check and presses **Continue to AniTrack**.
The dialog then hides while its app-owned session serves only reviewed same-origin
catalogue/source requests; native video does not use the WebView. Route changes
keep that session. Activity destruction/disconnect destroys the page, background
requests are refused, and 30 minutes of request inactivity expires access. Security
responses persist a five-minute cooldown across reconnects and process restarts.
Session generation checks discard stale or queued responses after closure.

Miruro media now carries a conservative network policy and explicit MIME type
through the normalized handoff. The ordinary player uses the same native source
factory path as the successful diagnostic: no playlist rewriting, ambient browser
cookies, load-error fallback or automatic playback/stall retries. Cronet is required
for that policy rather than falling back to the app's global cookie handler. A
403/429 closes access and enters cooldown. Application debug logging no longer
prints media paths or raw player exception stacks.

These integration changes still require the new debug build's regression results
and a normal-player device test. Prior diagnostic success is not proof of the new
session dialog, provider picker, resume or server-switching behavior.

Integration build result: all **63 Android JVM tests** and **65 Node tests** passed.
The final incremental debug app/test-APK build also passed after the last edits.
The updated debug app was installed with data preserved and MainActivity launched
on USB device SM-T735. The signed release app was not replaced. The user has been
asked to select Cowboy Bebop → Miruro → Connect and confirm whether the ordinary
episode list loads; normal-player device verification is pending that result.

The user subsequently confirmed **Episode list loaded** through the normal
Cowboy Bebop → Miruro → Connect flow. This verifies the ordinary activity-owned
session and catalogue adapter path on the tablet. The next requested device
check is episode 1 on BEE · Soft sub through the ordinary native player; playback,
longer-run stability and seeking in that route are not yet confirmed.

The user confirmed video and sound on BEE in the normal player, but reported no
subtitles. Two native-screen captures also show video with Miruro/BEE selected.
Subtitle diagnosis is in progress: the first implementation accepted only VTT,
lost language/default metadata, and could inherit a disabled text track from the
shared player. The next debug build preserves native subtitle MIME/language,
filters thumbnail/metadata tracks, supports declared VTT/SRT/SSA/ASS/TTML, and
synchronizes caption enablement with the visible CC setting. A debug-only source
summary logs offered/accepted track counts and sanitized format/extension/kind/
encoding names, never subtitle URLs or IDs. Those improvements are not yet proof
that BEE's reported missing subtitles are fixed.

The subtitle-handoff build passed all **66 Android JVM tests**, including new
format/language/thumbnail cases and PlaySession metadata propagation. Debug app
and diagnostic APK builds passed; the final debug app was installed preserving
data and MainActivity reopened. The user is retesting BEE captions. No live BEE
subtitle format/count report had been captured at that checkpoint.

## Android manual retry policy (2026-09-06)

Subsequent sanitized device logs reported BEE VTT captions offered/accepted as
2/2 and later 1/1, with UTF-8 encoding. Missing visible captions remain unresolved;
these counts only verify parsing and hand-off, not successful subtitle loading.

At the user's request, Android no longer imposes a five-minute cooldown. The old
`miruro_session_policy/cooldown_until` preference is removed on activity attach.
API security/rate-limit responses still stop the attempt and close the session,
but the user may immediately reconnect through the normal verification flow.
Media-server 403/429 responses stop playback without invalidating the catalogue
session, allowing manual server changes. There is no automatic retry or challenge
bypass. The separate 30-minute idle session expiry remains. Desktop is unchanged.

Episode-list failures now offer a manual Retry action. Unit regressions cover
immediate retries, immediate API reconnection and preserving catalogue access
after playback rejection. All 66 Android JVM tests and 65 Node regressions passed;
debug app and diagnostic APK builds succeeded. The updated debug app was installed
on the connected tablet with data preserved. Live playback/caption retesting is
still needed; this policy change does not establish that the subtitle issue is fixed.

## Cross-origin HLS playback rejection (2026-09-06)

Normal-player diagnostics on Cowboy Bebop episode 12 reproduced HTTP 403 on
BEE and HOP. HOP first loaded a small playlist and another media resource, then
the main media track failed with 403. This distinguishes the failure from the
Miruro catalogue API and points to an absolute HLS child URL on a rotating CDN.

Miruro HLS now uses the existing `PUBLIC_HLS` authorization scope. It carries
only the provider-supplied public Referer to recognized HTTPS playlist, segment,
key and subtitle paths across a host change; cookies and arbitrary pages remain
forbidden. MP4 remains exact-URL scoped. A connector regression verifies that a
cross-host `.ts` segment receives the Referer while a cross-host HTML page does
not. Device retesting after rebuild is still required.

## API replaced upstream (2026-10-02)

This checkpoint was superseded by the readable public frontend inspected on
2026-10-06. Its earlier decoder and episode-coordinate conclusions below are
not the current implementation contract.

Miruro (`www.miruro.ru`) no longer serves the reads this connector was built on.
Observed from a user-operated session page in the desktop test app:

- `/api/secure/pipe` still exists, but the old inner paths (`info/{id}`,
  `episodes`, `sources`) return HTTP 404. Both platform connectors therefore
  fail at their first catalogue read.
- The frontend now uses REST routes under `/api/v1/`: `anime` (lookup by
  `anilist_id_in`, comma-joined, cursor paging), `anime/{internalId}/episodes`,
  `.../episodes/{episodeId}` and `.../episodes/{episodeId}/play`. Show ids are
  opaque internal tokens, not AniList ids. The server accepts only an
  allow-list of exact query combinations (`limit=12` works where `limit=20`
  returns `400 Unsupported catalog request`).
- Responses are `application/octet-stream` payloads that are not JSON, gzip,
  deflate, Brotli, or XOR with the public `VITE_PROXY_OBF_KEY` (which replaced
  `VITE_PIPE_OBF_KEY`; `env2.js` is now a plain `window.env={...}` object).
  No readable bundle, chunk or the Workbox service worker contains the decoder.
- `/play` responses group streams as tracks (sub/ssub/dub) → providers →
  servers with required `headers` (typically only `Referer`) → streams
  (`url`, `format` hls/mp4, optional `embed`).

Decoding these payloads would require recovering deliberately hidden logic,
which this project does not do. Miruro stays disabled on both platforms.

Desktop now contains a staged connector (`miruro.ts`, `miruro-media.ts`) on a
reusable user-verified page session (`verified-page-session.ts`): AniList-based
search (no Miruro traffic during matching), identity-checked catalogue,
per-server variants, direct HLS/MP4 only, and playlist-directory authorization.
It is registered but off unless signed configuration enables it, and its
transport targets the retired routes. The desktop client now distinguishes
security-check and rate-limit cooldowns; requests queued behind a block still
stop.

## Desktop v1 migration and native verification (2026-10-06)

The current public [catalogue bundle](https://www.miruro.ru/assets/fa6-DizsrLyD.js)
exposes a readable binary codec: XOR bytes with the repeating UTF-8 public string
`miruro/catalog`, gzip-decompress, then parse JSON. AniTrack reimplements this
locally with bounded input/output and strict UTF-8; it does not invoke downloaded
decoder or resolver modules. This supersedes the 2 October conclusion that no
readable decoder was available. The user approved isolated site-module execution,
but this migration does not need that additional mechanism.

The [watch component](https://www.miruro.ru/assets/WatchRoute-C46TqFqs.js) and
successful current responses establish these exact catalogue reads:

| Operation | Current request |
| --- | --- |
| AniList lookup | `/api/v1/anime?anilist_id_in=ID&limit=100` |
| Episode list | `/api/v1/anime/SHOW_ID/episodes?limit=10000` |
| Playback choices | `/api/v1/anime/SHOW_ID/episodes/NUMBER/play` |

`SHOW_ID` is the returned opaque ID. `NUMBER` is the numeric episode number,
not an opaque episode ID, and may be fractional. Lookup requires an exact
`external_ids.anilist` match; incomplete or ambiguous results fail. The tested
Cowboy Bebop catalogue has 26 correctly ordered episodes, beginning with
"Session #1: Asteroid Blues".

`/play` groups track → provider → server → direct streams, with server headers
and provider subtitles. The tested episode exposed 11 accepted direct choices,
not 11 verified players. Embed-only choices are excluded. Soft sub, hard sub and
dub retain separate coordinates; disappearing choices do not silently resolve
another server. Each playback resolution reads fresh media. Only bounded show
and episode metadata is cached, never signed playback URLs.

The default transport uses the existing app-owned, sandboxed Miruro page session
with locally authored isolated-world same-origin GETs. Binary bodies cross that
boundary as base64, not lossy UTF-8 text. It has no AniTrack/account bridge and
exports no cookies. Redirects, declared/chunked size overruns and security/rate
responses stop the attempt. Any website check remains user-operated; the failed
request is not automatically retried. A security rejection offers reconnection;
rate rejection retains a one-minute backoff and queued requests stop.

Only validated public Referer/Origin headers are accepted. HLS traversal
authorizes observed media directories, and captions/direct MP4 use exact URLs.
The Miruro-only rendition allowance accommodates separate audio plus multiple
video qualities; other providers retain their existing bound. Downloads remain
unsupported. Background next-episode discovery is disabled because `/play`
already resolves media and may disturb the current session.

Live desktop verification used the actual default connector and registry in the
separate `anitrack-provider-smoke` profile, with local hls.js/native video:

- KICKASSANIME / Vid / soft sub: more than 65 seconds of advancing decoded
  video and audio; resolution up to 1920×1432; 215 WebVTT cues loaded.
- Forward seek resumed at approximately 819.75 seconds; backward seek resumed
  at 19.11 seconds, with advancing video and audio after each.
- Explicit switch to ANIKOTO / HD-1 / soft sub resumed from the saved 19.11-second
  position and advanced to 23.15 seconds; 217 cues loaded on the new stream.
- The expanded check completed in 120 seconds, with 67 HTTP 200 responses and
  no fatal media errors or rejected media requests. No fallback was needed.

All 176 Node regressions passed. Desktop typecheck and production build are
recorded in `playback-verification.md`. This is not a whole-episode soak, all-server
validation, caption translation/timing assessment or the production React-player
UI test. Both release configurations stay disabled. Android migration, device
playback/captions/switching, normal UI/session recovery and progress synchronization
remain required before enablement. No installer, APK, signed rollout or MAL write
was produced by this check.

## Android v1 migration implemented; verification pending (2026-10-06)

The active `MiruroAndroidProvider` now supplies the user-approved page session
to the migrated `MiruroProvider`. It no longer uses the retired secure-pipe
routes for matching, episodes or playback. The legacy protocol/catalogue helpers
remain for historical synthetic fixtures and diagnostics; their older successful
device results above do not validate the new v1 adapter.

`MiruroV1Protocol.kt` builds the same three exact reads verified on desktop:
AniList lookup with `limit=100`, episodes with `limit=10000`, and `/play` with the
numeric episode number, including fractional episodes. `MiruroV1Catalogue.kt`
requires a unique matching `external_ids.anilist` identity, complete catalogue
pages, numeric episode identities and distinct track/provider/server coordinates.
Incomplete, ambiguous or conflicting data fails rather than silently selecting
another show or episode.

The binary response decoder is locally implemented Kotlin: the public repeating
`miruro/catalog` XOR mask, bounded gzip decompression, strict UTF-8 and JSON.
Both incoming and decompressed data are limited to 2 MiB, with bounded nesting.
`MiruroStrictJson.kt` checks JSON grammar before Android's permissive JSON parser.
No downloaded catalogue decoder or resolver is evaluated in the native runtime.

`MiruroWebSessionTransport` retains the existing restricted, activity-owned
homepage session after the user's explicit **Continue to AniTrack** action.
Its fixed locally authored same-origin GET now returns base64 bytes and the
response Content-Type instead of prematurely decoding binary data as UTF-8.
Requests remain serialized, bounded and time-limited, with redirects forbidden,
no cookie export and no app/account bridge. Polling checks local completion only;
it does not repeat a request or automate website verification.

Server choice identities are stable
`track:provider:server:occurrence` values, independent of show and episode. The
episode resolver captures its own numeric coordinate, so the same selected
server can remain selected when changing episodes without losing episode
identity. Variant discovery reads `/play` only for the requested active episode;
it retains labels/identities, not its expiring media URLs. Every playback
resolution reads `/play` again and requires the exact requested server/track.
A removed selection fails instead of using an array-index or different-server
fallback. No embed is loaded, server fan-out performed or next-episode media
prefetched by this connector.

The fresh `ResolvedMedia` handoff preserves validated public Referer/Origin,
accepted caption URLs/MIME/language/default metadata, and intro/outro ranges.
Playback stays in AniTrack's normal native Media3 path with conservative network
behavior: no ambient browser-cookie import, playlist rewriting, automatic load
retry or source fallback. HLS uses the existing public-header-only `PUBLIC_HLS`
scope for recognized HTTPS media paths; MP4 remains exact-URL scoped and offered
captions are authorized as exact additional URLs. Downloads remain unsupported.

Security/rate-limit responses stop the failed request and queued reads. Android
retains the user's no-timed-cooldown policy: a new manual attempt is allowed, but
an API access rejection closes the catalogue session and requires explicit
user-approved reconnection. Media-server rejection does not close that catalogue
session, permitting a manual server switch. The separate 30-minute idle session
expiry and session-generation checks remain; no automatic challenge bypass,
identity rotation or retry is introduced.

Local validation at this checkpoint:

- All **194 Node regressions** passed in the final combined suite, including twelve actual extracted-session
  script tests. Android bridge checks cover arbitrary binary bytes, Unicode/plain
  JSON, retained legacy obfuscation text/markers, chunk boundaries, declared/raw
  byte caps, empty bodies, scoped browser credentials, no Cookie/User-Agent
  overrides or cookie export, and
  one-request 403/429 stopping before body reads. Desktop typecheck also passed.
- New Android JVM fixtures/regressions cover current request routes, strict and
  bounded decoding, show/episode identity, fresh exact-server choices, separate
  sub/dub tracks, captions/headers/skips, cancellation and user-operated access
  policy. All **187 Android JVM tests** passed, as did the debug app and test APK
  builds, including the final server-list retry refresh and DASH dependency.
- **Connected-tablet playback is pending** for the new v1 adapter and ordinary
  player: video/audio progression, visible captions, seeking, selected server
  switching with position preservation, session recovery and progress behavior
  still need current device evidence.

The debug app and instrumentation APK were installed for Android user 0 on the
connected SM-T735, preserving the signed release and existing app data. The
first ordinary-player probe stopped at **manual connection not completed**;
catalogue/server/media requests never began, so no playback pass is claimed.
The probe did not retry automatically. Its player disables watch/history/account
saving and uses the normal app-owned connection screen and native player.

Release availability and signed remote configuration remain unchanged/disabled.
This migration has not produced a release, remote enablement or replacement of
the signed installed app. Build success and narrow synthetic tests alone will
not establish that every Miruro server/title works.

## Current normal-player tablet attempt — 7 October

The user completed the ordinary Miruro homepage connection in the separate
debug app. The current v1 adapter then returned Cowboy Bebop's 26 episodes and
six direct server/track choices. The explicitly selected KICKASSANIME/Vid soft-
sub attempt reached the normal player but stopped before its first frame with
`ERROR_CODE_IO_BAD_HTTP_STATUS`, HTTP 403. No automatic retry or server rotation
followed. The original diagnostic did not record whether that rejected request
was the manifest, a segment or a caption; do not claim a specific resource cause.

This first attempt proves the listed catalogue/choice path on the tablet, not
KAA native playback. The user separately approved one test of the offered
ANIKOTO/HD-1 soft-sub choice. That subsequent test passed as recorded below;
the failed KAA choice remains unresolved.

The debug-only probe now supports an explicit single-server/no-switch run and
reports fixed resource categories plus header names on HTTP failure, without
exporting URLs, signed query fields or header values. Those names are from the
Media3 `DataSpec`, not every final wire header; the factory-configured User-Agent
is not included in that list. It requests Play when
media is ready without changing saved autoplay, samples offered captions after
a forward seek as well as the opening, and distinguishes the whole-run watchdog
from HTTP failure. Its outer bound is 720 seconds to contain the independently
bounded human connection and playback/seek/switch stages. Production networking
policy, retries and release configuration are unchanged.

### Authorized ANIKOTO/HD-1 single-server result

After the user explicitly completed the new ordinary connection and confirmed
visible video and sound, the normal `PlayerScreen`/`PlayerHolder` diagnostic
completed with `passed=true`:

- Cowboy Bebop episode 1: 26 episodes and six offered server/track choices.
- 65,139 ms of advancing decoded video, 1448 x 1080, with audio output.
- Offered captions rendered a nonempty cue (`caption_events=1`), including
  sampling after the forward seek rather than relying only on the opening.
- Forward-seek position 811,182 ms; backward-seek position 31,740 ms.
- `server_switch_tested=false`: the user approved this one server only, so the
  probe deliberately did not click another server or retry KAA.

The two new diagnostic-classifier JVM regressions also passed. The complete
Android JVM suite passed **191 tests**, and the debug app/test APK builds passed.
Both updated APKs were installed only to the separate debug packages for user 0;
the signed installed release was not replaced and no app data was cleared.

This is one native episode/server playback check, not every title/server, a
whole-episode soak, subtitle translation accuracy, session recovery or MAL/watch
progress synchronization. Saving history/account data was disabled in the probe.
KAA's first-frame HTTP 403 and Android position-preserving server switching
remain open, as does live MKissa playback. No release or remote enablement was
performed.

### Resumed tablet checks — 7 October

One fresh, explicitly selected KICKASSANIME/Vid soft-sub attempt again stopped
at the first-frame stage with HTTP 403. Its safe report identified only
`request_kind=unknown` and the DataSpec header name `Referer`; this does not
establish a missing wire User-Agent or which resource was rejected. No retry or
automatic alternate server followed. The user reported that the app closed
after Continue. Instrumentation reported the handled failure and deliberately
finished its diagnostic activity. The retained crash buffer contained no new
Miruro crash from this attempt; the closure is not a proven production crash.

The updated separate debug APKs were then installed for user 0. A catalogue-only
check passed with 26 episodes and six choices, without initializing playback.
The bounded diagnostic allowlist recognized ANIWAVES/Vidplay sub,
KICKASSANIME/Vid soft sub, and ANIKOTO/HD-1 soft sub. Three other choices were
deliberately not exported; do not infer their identities or availability.

Debug-only server selection now uses the ordinary player's exact server chip,
bounded scrolling and normal fullscreen exit. Missing, ambiguous, disabled or
foreign-window choices stop without fallback. Failure reports can additionally
use media-engine load context for extensionless URLs; they still do not export
request URLs or header values. All **201 JVM tests** and both debug APK builds
passed at this checkpoint. Neither production Android behavior nor the signed
installed release changed in this diagnostic phase.

A single ANIWAVES-to-ANIKOTO native switch check was offered to the user and
awaits explicit approval. The earlier ANIKOTO/HD-1 playback/seek pass remains
valid only for its recorded episode and attempt. KAA and actual Android
position-preserving switching remain unresolved.

The user subsequently continued the proposed ANIWAVES/Vidplay-to-ANIKOTO/HD-1
check and confirmed video and sound. ANIWAVES passed the normal-player
65-second decoded video/audio assertions and both seek stages (805,248 ms
forward; 31,840 ms backward, captured in fixed diagnostic logs). The test then
stopped at its server-control step with `IllegalStateException`, without a
reported HTTP rejection. Its final bundle did not retain earlier stage metrics;
the fixed progress logs establish those narrower successes. No switch/full-pass
result, exact control-failure cause or production switching defect is claimed.
The screen closed through handled diagnostic cleanup. There was no automatic
rerun, rejected KAA retry or release change.

The diagnostic now retains partial success metrics plus fixed server-control
outcomes. It also matches the actual panel heading when staged Miruro is absent
from enabled descriptors (`STREAM SERVERS` rather than assumed `MIRURO SERVERS`).
That expectation mismatch is covered offline; it does not establish the exact
cause of the earlier live control failure. Final validation passed all **207 JVM
tests**, both debug APK builds and installation to the separate user-0 debug
packages, preserving release/debug data. No additional media attempt followed.

### Continued tablet checks — 8 October

Two later user-authorized ANIWAVES/Vidplay-to-ANIKOTO/HD-1 checks did not reach
the server control. The first stopped with `IllegalStateException` at sustained
playback, without enough retained metrics to identify its failed assertion.
The second stopped before the first frame with
`ERROR_CODE_IO_NETWORK_CONNECTION_FAILED`; no HTTP 403/429 was reported. Neither
run establishes a successful switch or a production control defect.

The separate debug probe now records bounded playback/video/audio counters
throughout the sustained-playback stage and separates video-frame and audio-output
assertions. A listener's completed failure is preserved instead of generating a
secondary generic assertion. The updated debug build and all **207 JVM tests**
passed; the debug APK was reinstalled without clearing data. Signed release
8.0.0/data inode 186674 and debug data inode 539632 were rechecked unchanged.
The later network failure was not automatically retried or routed to another
server. Live position-preserving switching remains unverified.
