# MKissa provider status and runbook

## Status

MKissa is a staged, disabled provider. Signed runtime configuration revision 6
declares its origins and routes with `providers.mkissa.enabled: false`, so no
signed release client should expose it or send background health traffic yet.
Debug builds intentionally expose the staged connector for explicit device tests.

As of 2026-10-06, the current Byse Frontend/Fm-Hls flow has locally reviewed
desktop and Android implementations with synthetic fixture coverage. This is
not proof of working upstream media. The latest protected-source read returned
`CAPTCHA_REQUIRED`, so MKissa live probing stopped. Release enablement remains
blocked on current native playback, seeking and server-switch verification.

The connector is intentionally one provider with multiple server variants. It
must not register each server as a separate provider. The staged origins are:

- site: `https://mkissa.to`
- API origin: `https://api.mkissa.net`
- GraphQL route: `/api`

The client bootstrap values and source aliases are upstream implementation
details, not stable configuration. During the 2026-08-31 investigation the
site exposed build `149`, key selector `k7`, and five episode-server aliases for
the verification title: `Default`, `Yt`, `Luf-Mp4`, `Mp4` and `Ok`. Treat this
only as a dated observation. The upstream site can change it without notice.

Search, series metadata, sub/dub episode lists and protected source resolution
were observed working. Actual video bytes, seeking and every server were not
validated: the browser test reached third-party player/content-blocker errors.
That is why the provider remains disabled.

### Verification on 2026-09-05

The staged Android debug build exposes MKissa for device testing; release
configuration remains disabled. The current public crypto bundle (build 162)
uses four decoder fragments per mask value, an inline-object decoder offset,
and scientific notation inside two-argument crypto-setting expressions. Both
platform parsers now accept those bounded static forms. Android computes seed
candidates once instead of repeatedly scanning the full bundle for each build
candidate. Literal regex braces must be escaped for Android's ICU engine even
when the desktop JVM unit tests accept them.

Verified against the public service and the connected SM-T735 tablet:

- Desktop handshake succeeded on the first bootstrap request and returned
  `Yt-mp4`, `Fm-Hls`, `Uni`, `Mp4`, and `Ok` for episode 1 of *The Oblivious Saint
  Can't Contain Her Power*.
- Android parsed build 162 in approximately 1.1 seconds, completed its first
  bootstrap request successfully, and played visible video through Yt-mp4.
  Forward seeking to approximately 6:34 and backward seeking to 3:06 worked.
- Fm-Hls currently returns a small Byse Frontend application shell rather than
  a packed embed containing media. Both current extractors fail cleanly on that
  format. Its new data/API flow still needs investigation and fixtures before
  Fm-Hls can be considered supported.
- Returning from Fm-Hls to Yt-mp4 subsequently triggered a provider security
  challenge. The app displayed its cooldown message and live testing stopped.
  Successful server switching and position preservation are not yet verified.
- Desktop/shared regression tests, desktop type-checks and production build,
  and Android unit tests/debug build passed. Full playback validation of the
  other mirrors and desktop playback/downloads remains outstanding.

These observations do not clear the release verification gate below.

## Connector flow

1. Read the signed provider origins and routes.
2. Fetch the site bootstrap and parse the minimum bounded build/key metadata.
   Never execute downloaded JavaScript.
3. Use the persisted GraphQL operations for search, series and episode data.
4. Return one stable `StreamLink` for each available server alias and preserve
   the selected sub/dub track.
5. Resolve only the chosen alias. Validate and decode the result as data, reject
   unsafe URLs, and return direct media plus narrowly scoped request headers.
6. If it fails, surface the selected server's error. A security/rate rejection
   stops the attempt without trying another mirror. For ordinary failures the
   caller may select another advertised server or use bounded provider fallback;
   a disappearing alias must never silently resolve the old list index instead.

AniTrack must never render a third-party ad/player page as its playback surface,
leak headers to sibling hosts, evaluate remote code, or attempt to solve/bypass
a CAPTCHA. Logs and fixtures must redact cookies, authorization headers,
bootstrap secrets and expiring source URLs.

## Verification gate

Keep MKissa disabled until all of the following pass on desktop and native
Android:

- saved fixtures cover search, series, sub and dub episodes, all known source
  shapes, malformed input and challenge responses;
- a title can be matched by external ID without silently choosing a similarly
  named result;
- each currently returned server either produces direct media or fails cleanly
  without opening its embed page;
- HLS manifests/segments/keys and direct MP4 range requests use only the headers
  returned by the connector and only within their declared authorization scope;
- playback begins, seeks forward and backward, and survives a server switch at
  the same episode and timestamp;
- downloads, where advertised by the connector, resolve a fresh URL immediately
  before transfer and complete at least one media unit;
- CAPTCHA/403/429 and actual 503 security pages stop quickly without automatic
  crypto refresh or mirror rotation. Desktop retains its bounded cooldown;
  Android cancels already queued reads but permits a distinct immediate manual
  retry, as explicitly requested below;
- provider contract tests, desktop type-check/build and Android tests/build pass.

The health report intentionally lists disabled MKissa origins without probing
them. If configuration enables MKissa before a reviewed automated probe exists,
the health script fails closed rather than silently reporting success.

## Enable and rollback

Enabling is a data rollout only after released desktop and Android builds already
contain the verified connector. Set `providers.mkissa.enabled` to `true`, bump
the configuration revision and timestamp, sign it with the existing local
automation key, and run the signature verification before publishing. Never put
the private signing key or provider credentials in the JSON or repository.

For an upstream breakage, set the provider back to `false`, bump and re-sign the
configuration, and publish the signed rollback. This kill switch disables new
MKissa resolutions without requiring another installer or APK; it cannot replace
executable connector code in already installed applications.

## Android manual retry policy (2026-09-06)

At the user's request, Android no longer imposes the previous 30-minute
in-memory cooldown. A challenge or rate-limit response still ends the current
attempt immediately without automatic retries or mirror rotation. A separate
manual retry is allowed immediately; upstream restrictions can still reject it.
The episode-list error panel now offers Retry rather than caching a failed
attempt until the user leaves the screen. Desktop cooldown behavior is unchanged.
Regression coverage checks that each manual call makes one request when challenged.
All 66 Android JVM tests and 65 Node regressions passed; debug app and diagnostic
APK builds succeeded. The updated debug app was installed on the connected tablet
with data preserved. Live site restrictions may still reject individual attempts.

## Live check (2026-10-02)

On the user's network, Cowboy Bebop episode 1 listed Mp4 (mp4upload.com), Ok
(ok.ru), Sl-mp4 (streamlare.com) and Uv-mp4 (MKissa's internal clock API).
mp4upload.com and ok.ru resolved to the same address and reset the TLS
handshake within ~50 ms, and streamlare.com failed with a TLS alert. These
observations alone do not establish whether an ISP, intermediary or upstream
host caused the failure; the earlier attribution to an ISP block was too strong.
AniTrack does not work around network blocks. Uv-mp4 returned HTTP 500.
Earlier labels (Yt-mp4, Fm-Hls, Uni) were not
offered. After three title lookups the protected source API answered with a
security check and stayed challenged an hour later, so live testing stopped.
MKissa remains disabled; no connector change resulted from this check.

## Desktop repairs and live check (2026-10-06)

The current [MKissa site](https://mkissa.to/) and catalogue/protected source
bootstrap worked on this network without a verification prompt. Server lists
are title-dependent rather than a fixed set of five:

- Cowboy Bebop, AniList 1: 26 sub and 26 dub episodes; episode 1 returned
  Mp4, Ok, Sl-mp4 and Uv-mp4. The MP4Upload page returned "File was deleted";
  OK reset the connection; Sl-mp4 has no supported resolver; Uv-mp4 returned
  HTTP 500. None produced verified native playback in this check.
- The Oblivious Saint, AniList 196219: 12 sub episodes; episode 1 returned
  Fm-Hls, Uni, Mp4 and Ok. A Node request resolved Mp4 into a direct MP4Upload
  URL, but a bounded media-range request timed out. The Electron Mp4 check
  subsequently failed during resolution ("fetch failed"). Electron Uni
  returned a server-response failure before playback. Fm-Hls's previously
  observed new frontend-shell flow remains unimplemented and was not newly
  signed off or live-resolved during this check.

The connector now refreshes source URLs immediately before playback and matches
the chosen alias rather than falling back to its previous array index. Background
prefetch is forbidden. Different episode source reads are serialized; queued
requests stop after an access rejection. Resetting configuration cannot clear
that rejection. Unknown HTTP 403 and HTML security pages are no longer treated
as permission to refresh crypto keys or try more bootstrap tokens; only a
specific stale-crypto error permits a bounded refresh. Oversized/unreadable 403
bodies also stop the attempt. Wrong-show, empty and malformed source responses
fail without crypto refresh. Deleted MP4Upload files produce an actionable error.
Access-error markers survive IPC so the desktop player will not rotate mirrors
after a security rejection.

All 176 Node regressions passed, including fresh URLs, disappeared/reordered
aliases, wrong-show responses, one-request challenge stops and oversized denials.
No workaround, proxy, cookie transfer or automated verification was attempted.
MKissa remains release-disabled: this fixes app-side bugs but does not establish
working desktop media, seeking, captions, downloads or server switching. Android
was not changed or tested for these repairs; its historical results above do not
verify the current upstream server set.

## Android repair port and current Byse fixture support (2026-10-06)

The desktop app-side repairs above have now been ported to the Android MKissa
connector. Source discovery may reuse bounded metadata, but default playback
and explicitly selected variants always read current sources immediately before
resolution. Selection matches the original alias/type/occurrence after a reorder;
if that alias disappears, the app reports it instead of playing the old array
index or silently choosing another server. Existing SUB/DUB resume-key behavior
is unchanged.

Android serializes protected-source reads. A CAPTCHA/rate rejection invalidates
the tickets of reads already queued, including denials with oversized/unreadable
bodies. A later user-initiated request receives a fresh ticket and may retry
immediately: no timed Android cooldown was reintroduced. Unknown HTTP 403,
HTML verification pages, ordinary network failures, malformed or empty data and
another show's catalogue/episode are not permission to refresh keys. Only an
explicit stale-crypto error or authenticated-envelope decryption failure allows
one bounded source-key refresh. Arbitrary bootstrap failures stop at the first
token; verification does not trigger token candidate rotation.

Known MP4Upload redirects are followed only between `mp4upload.com` and its
canonical `www` host after validating public HTTPS; sensitive headers are
stripped on origin changes. Advertising/private/other-host redirects are not
followed. Deleted files produce an actionable message. The existing Cronet TLS
compatibility path is now limited to reviewed embed-host handshake failures
before an HTTP response; API calls, network resets, unsafe DNS and HTTP denials
must not automatically change network stacks. Native media uses conservative
network mode rather than automatic retry or ambient WebView cookies. MP4 uses
`video/mp4` with exact URL authorization; HLS and complete DASH manifests use
their declared MIME type and same-origin/path-directory authorization. Root
integration adds the native DASH playback dependency; split raw DASH tracks are
still not assembled by this connector.

### Byse Frontend / Fm-Hls

Both platforms now recognize the observed Byse Frontend shell as data and use
only its reviewed same-origin operations:

1. `/api/videos/{validated-file-id}/embed/settings`
2. `/api/videos/{validated-file-id}/embed/playback`, only after settings permits it

The readable public AES-GCM response codec and version-specific key-part mapping
are implemented locally, with bounded input, canonical Base64 and authenticated
UTF-8 JSON validation. No downloaded JavaScript/module is executed. Neither
platform calls fingerprint, CAPTCHA, attestation or proof-of-work endpoints;
those explicit gates stop before playback or fallback. Premium-account and
processing-lock responses also fail cleanly.

The parser returns only validated direct HLS/MP4 media, WebVTT captions and
bounded intro metadata to AniTrack's native player. Byse catalogue context
headers remain on the embed-origin API requests, not media. Android currently
rejects every Byse API redirect; desktop permits only validated same-origin
redirects. Without observed current manifests, Android HLS authorization has
not been broadened to unrelated hosts. Synthetic tests cover the codec/version
mapping, malformed/tampered envelopes, unsafe or embed-only sources, MIME
mismatches, caption filtering/defaults, skip handoff, settings gates, redirects
and immediate manual retry without automatic server rotation.

This supersedes the earlier dated statement that Byse/Fm-Hls was unimplemented;
it does not supersede the earlier failed live checks with a playback claim.
Sl-mp4/Streamlare still has no reviewed dedicated extractor. The earlier
deleted-file, internal HTTP 500 and media connection failures remain upstream
limitations, not confirmed repaired media.

### Verification state for this repair phase

The latest desktop protected-source attempt ended with `CAPTCHA_REQUIRED`.
All further MKissa live probes were stopped; there was no proxy, network-stack
rotation after denial, cookie transfer or automated verification. No new
successful MKissa video/audio, seeking, captions or position-preserving server
switch is established on desktop or the connected tablet by this phase.

The current desktop Node suite passed all **194 tests**, desktop type-checking
and the production build passed (the main-process build was repeated after the
cookie-continuity change below). All **187 Android JVM tests** passed and both
debug app/diagnostic APKs built. These builds do not establish current MKissa
device playback. MKissa remains release-disabled; no release was published.

### Ordinary desktop API cookie continuity

Desktop bootstrap and protected API now share a bounded app-owned, exact-HTTPS-
API-origin cookie jar. The old bootstrap flat cookie map was not exported or
blindly reused. Matching preserves cookie path/default path, domain
applicability, Secure prefixes, expiry/Max-Age and per-redirect-hop scope, with
32-cookie/8 KiB header bounds and a maximum 24-hour in-memory lifetime. Explicit
imported Cookie headers and ambient browser credentials are omitted. Cookies
cannot flow to media/site/CDN origins. Seven new offline regressions cover this
conditional continuity correction; the focused MKissa suite passed 32 tests.

There is no saved evidence that a bootstrap cookie caused the observed
`CAPTCHA_REQUIRED`, and this change must not be represented as a demonstrated
CAPTCHA fix. Android already uses its own ordinary HTTP jar. Neither production
MKissa adapter currently has a verified user-operated connection flow. The user
approved a separate isolated website-session investigation, with manual checks
and no app/account access; that is not release enablement or a playback pass.

### Isolated ordinary-website observation (2026-10-07)

The explicitly opted-in `scripts/electron-mkissa-session-smoke.js --live`
diagnostic opens a fresh app-owned sandboxed browser session, not the installed
app or a personal browser profile. It has no preload/account bridge, file
access, permission grants, downloads, popups or third-party player/ad frames.
Media fetches are blocked, including media fetched as XHR. Catalogue traffic is
restricted to the reviewed single-root `shows`, `show` and `episode` reads;
unknown/account/verification mutations are not sent. Any website check is for
the user to complete normally, not the diagnostic to solve.

Expanded offline self-checks cover entry/import safety, request guards, normal
Cloudflare surfaces, bounded POST query validation, response inspection and
HTTP/JSON access-stop behavior. No Cookie, private header, request body or source
URL is exported. Known security/rate responses freeze subsequent API/preflight
traffic; a homepage alone is never reported as protected-API verification.

Two local startup faults were corrected before any MKissa website request:
Electron's main-entry detection, and observer initialization before a renderer
existed. The latter now uses an empty local page and a 15-second timeout. Only
the confirmed diagnostic processes were stopped; no user app or data was removed.

The successful session then loaded MKissa's ordinary homepage and observed one
bootstrap HTTP 200 response with no recognized access gate. At this observation
point, no successful protected episode response or native playback was
established. The user was asked to complete any check manually, search Cowboy
Bebop and open episode 1 once; that response is pending. The session has a
six-minute whole-session watchdog and does not automatically rerun after denial.

### Follow-up offline parity repairs (2026-10-07)

The later check found neither the diagnostic handle nor an Electron diagnostic
process still running. Its final output was not captured, and no manual
title/episode result was received. The homepage/bootstrap observation remains
the last verified evidence; the window was not automatically reopened.

Three additional defects were reproduced with injected offline fixtures before
their corrections:

- Desktop treated every `type: player` URL as native video before dispatching
  known clock/embed routes. An absolute clock URL or MP4Upload page therefore
  reached the player unchanged. Known resolver routes now take precedence;
  generic unsupported pages are rejected, while declared extensionless HLS/MP4
  sources and ordinary direct media retain their existing handoff.
- Desktop incorrectly classified invalid base64, short or unsupported encrypted
  envelopes as stale keys, triggering a second protected request. Structural
  failures now stop as `INVALID_RESPONSE`. Only a structurally valid envelope's
  authentication failure retains the single bounded refresh; no challenge retry
  is added.
- Android's match and default-server fallback loops swallowed coroutine
  cancellation, potentially searching another title or returning another server.
  Those loops now propagate the original cancellation without fallthrough.

Five desktop and two Android regressions cover these cases. The focused desktop
MKissa/Miruro-session run passed 49 tests; the subsequent full Node run passed
all **199 tests**. A test-only lazy `Response` initialization was moved outside
the fixture VM timeout after the first busy-machine full run failed; production
transport limits were not changed. Android subsequently passed all **189 JVM
tests** and both debug APK builds, including the two cancellation regressions.
Desktop type-checking and the complete production build also passed. The updated
debug app was installed with `-r` for tablet user 0. Its package remains
`com.sanjay.anitrack.next.debug`, 8.0.0-debug, data inode 539632. The signed
release remains `com.sanjay.anitrack.next`, 8.0.0, data inode 186674; neither app's
data was cleared. These results do not prove live MKissa playback, add a
production Connect flow, or enable releases.

### Android capability correction and new manual observation — 7 October

The Android descriptor advertised a hard/soft-subtitle preference although
neither of its resolver closures consumes that preference and sources have no
reliable hard/soft coordinate. `subtitleModes` is now false so the player does
not offer that ignored switch. Server choices and resolved caption metadata are
unchanged; the existing conservative SUB/DUB series behavior is not expanded.
A new descriptor regression first failed against the old value and passed after
the correction. The full Android JVM run passed **192 tests**, with zero failed,
errored or skipped tests, and both debug APK builds passed. The updated debug app
was installed only to `com.sanjay.anitrack.next.debug` for user 0. The signed
release remains 8.0.0 with data inode 186674, and the debug app retains inode
539632; no data was cleared or release replaced.

The user explicitly approved another single ordinary-site observation in the
separate computer window. The diagnostic's offline guards passed before launch.
The user then reported **"Verification or error shown"** when asked about the
Cowboy Bebop episode-page step. The exact visible message was requested; this
does not establish which API request/status or local request guard caused it.
The Windows direct Electron launch did not retain terminal observation output,
so no new protected-response evidence is claimed from this session. No direct
protected-source retry or native-playback test followed that report.

MKissa's normal website is `mkissa.to` but its API/bootstrap is `api.mkissa.net`.
Miruro's same-origin GET session is not an interchangeable transport. Homepage
or bootstrap success, or a disconnected Connect UI shell, would not justify
cookie export, an unreviewed cross-origin bridge or a working-access claim.
Current native playback and a functional user-operated MKissa connection remain
unverified; release enablement is unchanged.

The diagnostic now supports a durable final `observation.json` for a future
explicitly approved fresh session. It writes only a closed, fixed metadata
schema in its own newly created diagnostic directory, with exclusive creation,
flush, at most 64 observation records and a 65,535-byte limit. Counts and fixed
blocked-reason enums distinguish local guards/caps from HTTP/security rejection;
the first stop reason survives the record cap. An API response without GET query
evidence is labelled `api-read`, not guessed to be a catalogue read. No URLs,
cookies, header values, website strings or exception paths are retained. Both
protected-API and native-playback verification flags remain false.

Offline self-tests cover redaction, numeric/record bounds, request and access
guards, file-collision refusal and descriptor cleanup using an injected file
system. Syntax/import checks also passed. This reporting change cannot recover
the already-running old session's output and did not restart that session.
For a future approved Windows run, use the local Node Electron launcher to keep
terminal output attached as well; do not automatically repeat a denied attempt.

The offline diagnostic checks are included in the ordinary Node regression
suite. The final complete run passed **200 Node tests**, with zero failed,
cancelled or skipped tests. No live website request, observation file or profile
was created by the injected-filesystem self-test.

The old isolated diagnostic was subsequently revalidated as still running well
beyond its six-minute session limit. Only its exact process was stopped after
checking the PID, executable path, script arguments and age; termination was
confirmed. No app data or files were removed. Its missing response output and
unclassified visible error remain missing evidence, not a protected-source pass.
A new captured live run was not launched. The user was asked whether they are
ready for one fresh manual check, or can supply the earlier error/screenshot.

### Resumed desktop and tablet checks — 7 October

The user's continuation authorized one fresh scoped check on each platform.
The desktop ordinary-site diagnostic was launched through the local Node
Electron launcher, retaining its terminal output. It ended at its six-minute
watchdog and saved the fixed-schema report. Homepage/bootstrap HTTP 200 was
observed, but `protected=0`, `denied=0` and `frozen=false`: no protected episode
request reached the API and no new upstream access rejection was observed.
Six requests were blocked locally (`api-query=2`, `api-route=1`, `origin=3`).
No new manual title/episode result was received before the window closed.

Offline checks of all seven current desktop/Android connector query texts
passed the actual GET and POST diagnostic guards. The coarse `api-query`
counter cannot identify the blocked website operation or envelope. Broadening
the allowed grammar, operations, routes or origins would therefore be
speculative. Neither homepage nor bootstrap success proves protected access,
and the website window was not automatically reopened.

The tablet's separate-debug catalogue-only check progressed to server choices
and stopped with `MkissaRateLimitedException`, without starting playback.
That class covers both CAPTCHA and rate-limit policy; the installed diagnostic
did not report its enum subtype, so this result must not be labelled as a
specific HTTP 429 or CAPTCHA response. No automatic retry or subsequent native
media attempt followed. Protected access, a functioning ordinary Connect
workflow and live MKissa playback remain unresolved on both platforms.

The refreshed tablet diagnostics passed **201 JVM tests** and both debug APK
builds. Installation preserved debug data inode 539632 and signed-release
data inode 186674; the signed release remains 8.0.0. No data was cleared,
provider enabled remotely or release published.

The local website diagnostic now counts fixed rejection subtypes such as missing
POST bytes, batched envelopes, missing/non-string queries, root aliases and
unreviewed roots. Only bounded enum counters leave the guard, not request text,
variables, hashes, names, paths or headers. Existing allow rules, caps and stop
conditions remain intact. Offline guard/report checks and all **218 Node tests**
passed. These counters do not identify the two earlier blocks retroactively;
another ordinary-site observation still needs a fresh user-operated attempt.

The tablet debug reporter additionally distinguishes reviewed CAPTCHA/rate-limit
exception enums, using a bounded cycle-safe cause walk without examining error
text. Four new regressions passed in the **205-test JVM suite**; both debug APKs
built and installed successfully without clearing data. This is improved
diagnosis, not a protected-source access fix or a retry of the prior denial.

### Captured ordinary-site request-format failure

The user completed another approved desktop observation and reported
`NETWORK_ERROR: Failed to fetch`. Closing the separate window saved its report
after 265 seconds: bootstrap HTTP 200, `protected=0`, `denied=0`, `frozen=false`.
Of 46 local blocks, 42 were `api-query` with the fixed subtype `query-missing`;
the remaining blocks were one API route and three origins. Thus the ordinary
website's blocked operations lacked the plain `query` field expected by the
guard. Their method, envelope or exact operations were not exported, so this
does not yet prove hash-only persisted queries, encrypted requests, a provider
outage or an upstream HTTP 403.

The guard additionally recognizes the bounded standard persisted-query envelope
as a fixed diagnostic subtype without storing its hash. Such requests remain
blocked unless their operations can be reviewed separately; no hash-only or
unknown-operation allowance was introduced. This recognition cannot classify
the already completed run retroactively. The normal protected request/native
player path remains unresolved, and no rejected request was repeated.

A bounded public-static inspection subsequently read the homepage and four
same-origin/explicit-CDN JavaScript assets (1,283,329 bytes total). TypeScript's
parser, without executing website code, identified both a `persistedQuery`
property and an actual `delete ...query` expression in the request-building
module. This corroborates the query-free website format behind the local
restriction, but does not identify each blocked operation or its hash-to-query
mapping. No protected/API request, cookie capture or browser identity change
was made by that inspection. The exact catalogue operation mapping must be
reviewed before hash-only requests can be permitted; live protected sources and
native playback remain unverified.

### Exact persisted-query review — 8 October

The isolated desktop diagnostic can now recognise hash-only requests only when
the SHA-256 matches an exact, locally parsed and reviewed single-root read
document. Public JavaScript is parsed as data: bounded literal strings,
concatenations and static template substitutions only; no calls, imported code,
getters or site JavaScript execute in Node. Ambiguous bindings, cycles, oversized
documents and unsupported expressions are rejected. Extracted documents are
candidate contents, not a claim about the website's eventual runtime values.
The exact hash match establishes the accepted document identity.

The bounded public review located two candidates (one `shows`, one `show`) in
the homepage/entry assets, totalling 1,161,063 bytes over the homepage and two
JavaScript reads. These documents and hashes stay in memory for the separate
session; only fixed counts leave it. Unknown hashes, account operations,
mutations, batches and conflicting query/hash or URL/body envelopes remain
blocked. Existing network/session limits and first-denial stop behavior remain.
There is no newly recognised protected `episode` hash, so this is a catalogue
diagnostic repair, not native MKissa playback or Connect implementation.

The ordinary site check was opened again after offline validation: two reviewed
operations, homepage loaded, bootstrap HTTP 200. A manual Cowboy Bebop search
was requested; its live outcome is pending. This diagnostic change does not
alter either production connector or remotely enable the provider.
