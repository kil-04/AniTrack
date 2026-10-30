# Standalone AniTrack source service

This service runs the maintained native connectors in its own isolated Electron
profile on a server. Website visitors do not install or pair a desktop app.
The composition explicitly includes AnimePahe, Anikoto, Shonen, AniChan,
MangaDot, MangaBall, XComic and Toonkotsu. It does not import the development
anime registry or offer development-only sources.

## Status

The service is deployed as a Render Free trial. AniChan is individually enabled
on the public website after a real complete-episode file download (498 files,
306,682,536 bytes), local VLC playback and midpoint seeking. Its media playlists
contain local references only; removing website history preserves those files.
Other protected sources remain disabled pending their own website checks and
complete playback/reading and download validation. A passing unit test or health
endpoint does not establish that a source accepts the hosting network.
AnimePahe currently displays "Sorry, you have been blocked" in the hosted
browser on `animepahe.pw`, confirmed by the operator after the manual check.
Its streaming and download connection remains disabled; this is a source-side
access restriction, and no automatic repeated attempts are made.

## Deployment

Use the repository root as the build context and the service's Dockerfile.
Configure the host's HTTPS domain to forward to `PORT` (default 8080). The profile
directory must be isolated and writable by the image's `node` user. For sessions
that survive restarts, attach a persistent volume at `/data`. A host without a
persistent disk can instead use a dedicated ephemeral directory such as
`/tmp/anitrack-source-profile`; its source verification sessions are lost whenever
the host restarts or replaces the container. Source checks must then be completed
again. A persistent volume is useful but is not required for service startup.

Configure these secrets in the hosting service, never in source control:

- `SOURCE_SERVICE_KEY`: a random base64url key of at least 32 characters. The
  website server uses it for `/v1/rpc` and `/v1/assets/…`.
- `SOURCE_OPERATOR_KEY`: a different random base64url key of at least 32 characters.
- `SOURCE_OPERATOR_ORIGIN`: the exact public HTTPS origin, without a trailing slash.
  When omitted on Render, its assigned `RENDER_EXTERNAL_URL` is validated and used.
- `SOURCE_PROFILE_DIR`: a dedicated absolute directory; the Docker image defaults
  to `/data/profile`. An ephemeral host can use `/tmp/anitrack-source-profile`.
  Never reuse a personal profile.
- `SOURCE_BIND_ADDRESS`: `0.0.0.0` by default for the container; use `127.0.0.1`
  for isolated local checks. Other addresses and hostnames are rejected.
- `PORT`: a decimal port from 1 to 65535; it defaults to 8080.

All startup settings are validated before a profile is created. Service and
operator keys must be different base64url strings of 32–256 characters. A profile
cannot be the home/application-data directory or an existing AniTrack profile.
Local checks need fresh test keys and a separate profile; never load a personal
browser profile or change the process-wide browser protections. Run the service
from its own application directory so the maintained source scripts remain under
`apps/android/app/src/main/assets/` relative to `app.getAppPath()`.

### Optional free-tier trial

`render-free.yaml` is a trial blueprint, not an active deployment. It selects one
Free Docker web service, no persistent disk, and manual deployments. The profile
is isolated at `/tmp/anitrack-source-profile`; enter fresh service/operator keys
through the host's secret settings. Confirm the generated HTTPS origin and
account settings before connecting the website.

The Free instance has 512 MB of RAM, so Electron source checks may exceed its
memory budget. A trial with several retained source windows caused an OOM
restart. Hardware acceleration is disabled because this service does not play
video; test one source at a time and do not infer multi-user capacity from the
single-source checks. Idle services spin down after 15 minutes, and a cold start takes
about one minute. Restarts and spin-downs discard profile sessions. Bandwidth and
build minutes have quotas: exceeding them may suspend services or builds, or
incur charges when the account has a payment method. Account usage and spending
controls must be verified before deployment; this blueprint does not promise
unlimited usage or guaranteed zero overage. Do not add paid compute, storage, or
other paid resources for this trial. See [Render's free-service limits](https://render.com/docs/free)
and [compute-plan specifications](https://render.com/docs/compute-plans).

The website relay is implemented and wraps catalogue media, HLS resources,
captions and page images in signed same-origin URLs. Configure its server-only
environment variables after validating the deployed service:

- `ANITRACK_SOURCE_SERVICE_URL`: the exact public HTTPS origin.
- `ANITRACK_SOURCE_SERVICE_KEY`: the value of `SOURCE_SERVICE_KEY`.
- `ANITRACK_SOURCE_ENABLED_SOURCES`: comma-separated validated source IDs.

Leave the enabled-source list empty until a source passes live playback/reading,
seeking/subtitles where applicable, a complete download, and reopening with the
network disabled. Enable each source separately after those checks. Merely
setting a key, passing unit tests, or receiving HTTP200 is insufficient.
Unenabled sources retain their existing supported public transport or explicit
unavailable state. The website exposes source identifiers only; there is no
visitor setting or browser storage entry for the service origin/key.

The deployed container runs as a nonroot user with Electron's sandbox enabled.
If another hosting environment does not support that sandbox, deployment must
fail; do not add `--no-sandbox`.

## Source checks

The operator opens `/operator` over HTTPS and enters `SOURCE_OPERATOR_KEY` in
the sign-in form. The key is never placed in a link or browser storage. A random
memory-only session cookie expires after 15 minutes and is Secure, HttpOnly and
SameSite=Strict. Existing Basic-authenticated API clients remain compatible.
Choose the named source and press Connect, then complete its normal
check in the displayed source window and press Finish. The native connector owns
this connection lifecycle, including clearing Toonkotsu's verification state and
keeping AniChan's exact verified reader session. AnimePahe Connect also waits
for human Finish and hides its verified homepage rather than destroying it:
its same-origin API requests need that live page context. An unfinished check
does not grant readiness. Return to AniTrack and retry the
failed source operation manually.

Only approved, sandboxed source windows can appear. The page supports direct
human clicks/typing; it cannot navigate to an arbitrary URL or evaluate code.
No challenge solver, stealth driver, automatic retry or cookie import/export is
provided. A source may still reject the hosting network; do not enable its
website download capability until its full live checks pass.

MangaBall image verification is separate from its catalogue. After the native
connector returns a chapter's image list, the service registers only its exact
reviewed CDN image URLs. A 403/429 stops that image host. The operator's named
MangaBall Connect opens an observed image for its normal check; a subsequent
manual retry reads image bytes in that same verified session. Idle-closed
windows require Connect again. Unknown CDN hosts fail for review. This path has
focused tests, but still needs a real hosted chapter and download check.

The separately named **MangaBall catalogue** connection handles its public API.
It opens only after the operator selects Connect. Finish must observe a normal
HTTP 200 JSON response on a reviewed catalogue route before reads are enabled.
Only the existing public title/chapter GET routes are accepted; source cookies
stay in that dedicated browser session. A 403 stops reads until a new explicit
connection; a 429 also preserves its waiting period. The native desktop app
continues using its existing transport unless this service explicitly composes
the browser transport before its first MangaBall request. This connection is
not advertised as ready until a real hosted catalogue, chapter and local-file
download have passed.

## Boundaries and validation

`SourceService` accepts a fixed operation allowlist and bounded JSON. Native
connectors own catalogue parsing, download capabilities, page order, browser
sessions and stream authorization. Media receipts expire and live only in
memory. HLS manifests preserve keys, subtitles, audio renditions and relative
resource order. Anime media uses a separate in-memory Chromium network session
through a loopback-only CONNECT tunnel. The tunnel pins checked public DNS
answers; Chromium retains its normal TLS and certificate checks. Only active
receipt URLs and their HTTPS authorities are leased, and redirects are rejected;
cookies/headers are applied only when the native authorization registry grants
them for that resource. A service restart requires fresh media resolution.
Some source servers mislabel MPEG-TS segments as images or JavaScript. Full
media responses are relabelled only after a bounded prefix proves four valid
188-byte transport packets. Keys, subtitles, images and byte ranges are excluded
from that probe; other active-content responses remain rejected.

Run these checks from the repository root:

```text
node node_modules/typescript/bin/tsc -p apps/source-service/tsconfig.json --noEmit
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/source-service.test.mjs tests/source-service-client.test.mjs tests/source-service-config.test.mjs tests/source-service-mangaball.test.mjs tests/source-service-mangaball-adapter.test.mjs tests/source-service-mangaball-catalogue.test.mjs tests/source-service-native-media.test.mjs tests/source-service-media-types.test.mjs tests/source-service-operator-login.test.mjs tests/source-service-pahe-connect.test.mjs
```

The portable `worker-client.ts` is copied unchanged to the website's
`lib/source-service-client.ts`; keep both copies identical when changing it.
The website suite includes a full Worker relay check with HMAC receipts and
the existing player's security-stop guard. Its source checks must also pass
against the real deployed service before a source is advertised as ready.
