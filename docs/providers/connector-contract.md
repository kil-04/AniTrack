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

## Security rule

Never download and execute connector code remotely. Signed automation may update
data only: domains, routes, selectors, host rules, ordering and enablement.
Executable scraping or playback logic must be reviewed, tested and released as
part of the desktop installer or APK.

## Definition of done

A connector is ready when:

- registry contract tests pass;
- saved search/episode/player fixtures parse successfully;
- stream authorization is scoped to resolved hosts;
- seeking, server switching and progress preserve the same episode number;
- download resolution happens immediately before download because URLs expire;
- both production builds pass.
