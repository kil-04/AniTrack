# MKissa provider status and runbook

## Status

MKissa is a staged, disabled provider. Signed runtime configuration revision 6
declares its origins and routes with `providers.mkissa.enabled: false`, so no
installed client should expose it or send background health traffic yet.

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
6. If it fails, cool down a challenge response or try the next unresolved alias
   sequentially. After all aliases fail, fall back to another provider.

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
- CAPTCHA/403/429/503 paths stop quickly, set a bounded cooldown and permit
  provider fallback;
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
mp4upload.com and ok.ru resolve to the same address and reset the TLS
handshake within ~50 ms, and streamlare.com fails with a TLS alert: an
ISP-level block, not an upstream fault. AniTrack does not work around network
blocks. Uv-mp4 returned HTTP 500. Earlier labels (Yt-mp4, Fm-Hls, Uni) were not
offered. After three title lookups the protected source API answered with a
security check and stayed challenged an hour later, so live testing stopped.
MKissa remains disabled; no connector change resulted from this check.
