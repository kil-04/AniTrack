# Provider connector contract

Provider connectors isolate third-party streaming sites from the rest of
AniTrack. A connector translates its site into normalized operations:

1. Search for a show.
2. Return a normalized episode list.
3. Return stream variants for an episode.
4. Resolve one variant into playable media plus its headers and capabilities.
5. Optionally expose feeds, external-ID verification, prefetching or a
   configurable base URL.

## Desktop

- Contract: `apps/desktop/main/services/providers/types.ts`
- Registry: `apps/desktop/main/services/providers/registry.ts`
- Composition root: `apps/desktop/main/services/providers/index.ts`
- IPC boundary: `apps/desktop/main/ipc/providers.ts` (`registerProviderIpc`)
- Implementations: `apps/desktop/main/services/providers/animepahe.ts` and
  `apps/desktop/main/services/providers/anikoto.ts`

The registry is the application boundary. IPC must call it instead of importing
a concrete connector. The legacy `PAHE_*` channel names are retained temporarily
so existing renderer and Capacitor code keep working.

## Native Android

- Contract and models: `apps/android/app/src/main/java/com/sanjay/anitrack/next/data/providers/`
- Connector adapters: `.../data/providers/connectors/`
- Existing scraper engines: `.../data/Anikoto.kt` and `.../data/Pahe.kt`

`ResolvedMedia` tells the player which backend and seek mode to use and carries
the Referer, user agent, subtitles and skip ranges. The player should never need
to infer these from a provider name.

## Adding a provider

Because desktop uses TypeScript and Android uses Kotlin, one executable file
cannot safely serve both applications. The target contribution is:

1. One shared declarative provider entry in the signed runtime configuration.
2. One desktop connector implementation.
3. One native Android connector adapter.
4. One explicit registry entry per platform.
5. Saved parser fixtures and contract tests.

The explicit Android registry line is intentional. Runtime classpath scanning is
fragile under Android shrinking and makes failures harder to diagnose. A future
build-time generator may remove that line while retaining static registration.

Simple providers may fit in one adapter file. Anti-bot providers such as
AnimePahe will still need private helpers for browser sessions, cookies and CDN
authorization.

## Stream variants and server switching

`ProviderCapabilities.streamVariants` tells the UI what a stream choice means:

- `quality` is a resolution or bitrate choice;
- `subtitle-type` is a soft-sub, hard-sub or dub choice;
- `server` is a provider mirror/player choice.

For a multi-server provider, return one `StreamLink` per server. Keep
`StreamLink.variant` stable (for example, a normalized server alias) and use
`quality` as its user-facing label. Do not model five servers as five providers.
Resolve only the selected server and try the remaining links sequentially after
a real resolution or playback failure. Switching links must preserve the
episode, audio preference and current playback position.

Server links and media URLs are often short-lived. Cache only bounded metadata;
resolve a link immediately before playback or download. A background prefetch
must never resolve every server in parallel.

## Stream authorization

`StreamData` is the complete playback hand-off. In addition to `url`, it may
carry `referer`, `cookies`, `requestHeaders`, `authorizationScope` and `cors`.
The connector must supply these values instead of making the player infer rules
from the provider name.

- `requestHeaders` contains only headers actually required by the resolved
  manifest/media requests. Never include `Host`, `Content-Length`, connection
  headers, proxy headers or client cookies unrelated to the stream.
- `authorizationScope: "exact"` authorizes only the resolved URL. This is the
  default and should be preferred for a direct MP4 or a single signed URL.
- `authorizationScope: "directory"` authorizes the resolved URL and sibling
  resources under the same HTTPS origin and path directory. Use it only when an
  HLS playlist loads relative manifests, segments, keys or subtitles there.
- `cors` asks the Electron main process to add renderer-facing CORS headers for
  that narrowly scoped media authorization. It does not broaden the allowed
  destination.

Authorization must be registered only after a connector returns a validated
HTTPS URL. Reject credential-bearing URLs, local/private hosts and non-network
schemes. Never apply provider headers to an entire third-party origin when an
exact URL or stream directory is sufficient, and never log cookies,
authorization values or source-decoding keys.

### What can be one file

The signed `automation/remote-config.json` is the one shared data file for
provider domains, routes, selectors, stream-host rules, ordering and enablement.
Both maintained apps can consume those data-only changes after signature
verification, without shipping remotely downloaded executable code.

A provider that differs only in those declared values can therefore be added or
repaired through that one configuration entry once a compatible generic engine
exists in both apps. A provider with custom JavaScript challenges, cookie
sessions, encrypted links or unusual playback authorization still needs reviewed
TypeScript and Kotlin connector code. Keep those implementation files thin by
delegating reusable parsing, matching and player behavior to shared platform
helpers.

## Security rule

Never download and execute connector code remotely. Signed automation may update
data only: domains, routes, selectors, host rules, ordering and enablement.
Executable scraping or playback logic must be reviewed, tested and released as
part of the desktop installer or APK.

Downloaded site JavaScript is untrusted input: parse only the bounded data
needed by a reviewed connector and never evaluate it with `eval`, `Function`, a
script tag or a WebView. Do not display advertising/player embed pages merely
to discover their media URL.

AniTrack does not bypass CAPTCHA or human-verification challenges. A connector
must recognize challenge responses, stop retrying, enter a bounded cooldown and
let the registry offer another provider. Repeated parallel retries amplify a
challenge and can make every server unavailable.

Android MKissa and Miruro are an explicit user-requested exception to the timed
cooldown: stop the failed attempt without automatic retries, but allow an
immediate manual retry or server change. Miruro API security errors require a
fresh user-approved connection; a media-server rejection must not invalidate
the catalogue session. No CAPTCHA bypass or automatic server rotation is added.
Desktop cooldown policies are unchanged.

## Definition of done

A connector is ready when:

- registry contract tests pass;
- saved search/episode/player fixtures parse successfully;
- stream authorization is scoped to resolved hosts;
- seeking, server switching and progress preserve the same episode number;
- download resolution happens immediately before download because URLs expire;
- both production builds pass.
