# Miruro integration status

Status: **Android diagnostic native playback/seek verified; debug-only normal UI/session integration under test**.
Last investigation: 2026-09-06. No release or remote enablement was performed.

Selected address: **https://www.miruro.ru/**, explicitly confirmed working by
the user and listed by the [official domain directory](https://www.miruro.com/).
There is no automatic mirror rotation. The request protocol was initially
inspected on `.to`; `.ru` references the same frontend asset filenames.

## Confirmed from the current public frontend

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

## Remaining before integration can be enabled

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
