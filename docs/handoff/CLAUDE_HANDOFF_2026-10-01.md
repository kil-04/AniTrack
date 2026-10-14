# AniTrack — Claude continuation handoff

Snapshot: **1 October 2026**, Asia/Calcutta. Prepared at the user's request when switching from Codex to Claude. This document contains no credentials, cookies, signing keys, or expiring media URLs.

## 1. Start here

- Workspace: the repository root.
- Current branch: `codex/provider-architecture`.
- HEAD observed: `de7753940e1d975c564de6767e70a6826e559c00` — `perf: accelerate app startup and home loading`.
- Current source version: **7.0.5** in root `package.json` and native Android Gradle configuration. Android `versionCode` is **9**.
- There is a substantial **uncommitted working tree**, including provider implementations, Android debug diagnostics, desktop repairs, runtime configuration/signature changes, and staged legacy IDE-file deletions. **Preserve all of it.** `git diff` alone does not show the new untracked connector/test files; also inspect `git status --short`.
- Do not reset, clean, revert, blindly stage everything, recreate signing keys, uninstall an app, or overwrite the user's installed profile.
- No release, push, version bump, or installation over the existing desktop app was performed during the latest desktop-repair work. A local unpacked test build was produced, but it predates the final source edits.
- Read `AGENTS.md`, `docs/architecture/project-structure.md`, and `docs/providers/connector-contract.md` before modifying architecture/provider boundaries.
- Provider runbooks are `docs/providers/mkissa.md` and `docs/providers/miruro.md`. They contain dated investigation history; read the **later sections** as well as the introductory status. Earlier blockers/statuses are sometimes superseded later in the same document.

## 2. What the user wants, and the actual project

The latest implementation request was: **fix desktop streaming and bugs because both Anikoto and AnimePahe stopped working after several days**. Earlier work focused heavily on the new Android app, adding MKissa and Miruro, improving seeking/server switching, and making the app faster.

The project was originally described as Electron + Capacitor + Flutter, but the actual repository now contains:

| Area | Actual status |
| --- | --- |
| `apps/desktop/` | Maintained Windows Electron app: TypeScript main process, React/Vite renderer |
| `apps/android/` | Maintained native Android app: Kotlin, Jetpack Compose, Media3/ExoPlayer |
| `legacy/capacitor/` | Retired Capacitor app and plugin sources; retained for compatibility/reference |
| Flutter/Dart | **No Flutter app exists in this repository** |
| `packages/shared/` | TypeScript contracts, recommendation/taste/archive helpers, runtime config/trust data |
| `automation/` | Signed data-only provider configuration and Android update metadata |
| `scripts/`, `.github/workflows/`, `tests/` | Builds, signing/releases, monitoring, CI, regression tests |

Do new Android product work in `apps/android/`, not the retired Capacitor app. The user wanted actual folder cleanup and modular code, not merely renamed abstractions. The layout is already restructured; build/cache output is ignored. Do not claim every file was fully audited or that restructuring alone guarantees speed.

Important user preferences:

- Old anime, especially **1980s**, with 1970s and 1990s also encouraged.
- Keep the classics boost global for all users, while recommendations still use each user's own list as seeds.
- New providers should behave like Anikoto in the app's normal player, not as website-player wrappers.
- Seek forward/backward and switch servers without losing episode identity or timestamp.
- Maximize safe automation; avoid unnecessary manual releases, but do not pretend compiled code can change through configuration alone.
- Native Android is installed by APK. Android's final installation confirmation cannot be silently removed by ordinary app code.

## 3. Architecture and contracts to preserve

Desktop compilation contexts:

- Renderer: `apps/desktop/tsconfig.renderer.json`, ESNext/Chromium.
- Main: `apps/desktop/tsconfig.main.json`, CommonJS emitted into `dist-electron/`.
- Shared contracts imported into both contexts from `packages/shared/`.

Renderer must not call Node APIs directly. IPC changes go through `packages/shared/types.ts`, main IPC registration, `apps/desktop/main/preload.ts`, and renderer bridge declarations in `types.d.ts`.

Provider boundaries:

- Desktop contract: `apps/desktop/main/services/providers/types.ts`.
- Desktop registry/composition: `providers/registry.ts`, `providers/index.ts`.
- Provider-neutral desktop IPC: `apps/desktop/main/ipc/providers.ts`.
- Native contracts/models/registry: `apps/android/app/src/main/java/com/sanjay/anitrack/next/data/providers/`.
- Android adapters: `data/providers/connectors/`.
- Player consumes normalized media, subtitle, header, backend, and seek-policy metadata. It must not infer transport behavior solely from a provider name.

AniList IDs are the primary identity; MAL IDs are secondary. Unknown streams may use negative synthetic IDs and a stub-then-resolve migration. MAL dirty entries flush in the background. Continue-watching/progress synchronization also uses a private GitHub Gist.

Desktop Gist implementation has a historical misleading filename: `apps/desktop/renderer/lib/supabase-sync.ts`; it implements GitHub Gist synchronization, not evidence of a current Supabase backend. Native equivalent: `data/GistSync.kt`.

One connector is **not necessarily one file**. Adding a custom provider normally needs one TypeScript implementation, one Kotlin implementation, explicit platform registry entries, configuration, and fixtures/tests. A provider's five servers are variants of one provider, not five separate providers.

Security rules:

- Signed remote configuration is **data only**. Never download and execute connector code.
- Treat public site scripts as bounded static input; never use `eval`, `Function`, VM execution, or injected downloaded scripts to extract media.
- Do not load advertising/player embeds merely to discover media URLs.
- Do not solve/bypass CAPTCHA, rotate identities, copy Chrome sessions, or repeatedly retry a security challenge.
- Manual ordinary-homepage verification can be user-operated; failed requests stop promptly.
- Media headers/cookies must be scoped to the exact URL or verified HLS directory, not a whole arbitrary CDN.
- Validate HTTPS URLs and reject credentials/local targets/unsafe redirects. Logs must omit signed URLs, cookies, headers, and decoder keys.

## 4. Latest desktop repair: Anikoto

### Root causes found

1. Current Anikoto sources can arrive as an AES-CBC **`enc` payload**, instead of only the old `sources.file` shape.
2. Videojs embeds use a different current source/client path than the legacy player route.
3. Some master playlists advertise a **missing quality** (HTTP 404); blindly selecting it breaks otherwise available playback/downloads.
4. Passing a custom session to Electron `net.fetch` did not produce the intended partition behavior. The transport now calls the actual **`Session.fetch`**.
5. A live CDN check showed `Session.fetch` with ambient `credentials: include` failing with `net::ERR_FAILED`, while `credentials: omit` plus explicit scoped headers succeeded. A separate local fixture verified explicit Cookie headers can still be sent while ambient cookies are omitted.
6. Long-lived source caches and broad/last-player-origin header guesses were unsafe or unreliable.

### Implemented changes

Under `apps/desktop/main/services/providers/`:

- `anikoto-source.ts`: bounded static extraction of the current public client metadata; AES-256-CBC decoding as data; legacy source compatibility; validated public HTTPS outputs. No remote code execution or key logging.
- `anikoto-transport.ts`: per-origin serialization, 20-second request/body/queue deadline, 8 MiB response cap, cancellation, explicit HTTP failures. Security/429/challenge bodies stop queued work with a bounded desktop cooldown, not retry/domain rotation.
- `anikoto-browser.ts`: ordinary requests use `persist:anikoto` Session.fetch. Prewarming initializes the session rather than requiring a hidden homepage scrape.
- `anikoto-hls.ts`: bounded playlist-only traversal, scoped authorization of observed playlist/segment/key/map/subtitle directories, missing-rendition handling, whole-traversal deadline. It does not fetch video during resolution.
- `anikoto.ts`: accepts new/legacy source formats; fixes videojs paths; preserves hard-sub hash metadata; enforces requested soft/hard/dub type rather than silently substituting; validates link coordinates before requests; reduces resolved-source cache to **15 seconds**; propagates security/rate errors rather than automatic fallback loops.

HLS behavior: retain the original master if its supported branches work. If an optional quality is missing, choose the highest-bandwidth verified video leaf. Do not mistake subtitle/audio renditions for video or discard externally separate audio. The currently unsupported encrypted `/segment/{...}` form fails explicitly instead of pretending it works.

`apps/desktop/main/main.ts` now injects media headers/CORS from the generic resolved-stream authorization registry or Pahe's own URL-specific authorization. Removed broad CDN guesses, last-player-origin routing, and fabricated Chrome client hints. Known thumbnail handling is separate.

### Live evidence from this repair session

These were real Electron transport/media smoke checks, not full rendered-episode tests:

| Test | Observed result |
| --- | --- |
| Cowboy Bebop, Anikoto, episode 1 | 26 episodes; source resolved; manifest, first and last media returned 200; byte-range 206; download wrote real media units, then test cancelled/removed its own download |
| Naruto, Anikoto, episode 5 | 220 episodes; manifest/first/last media 200; range 206 |
| Frieren, Anikoto, episode 1 | 28 episodes; manifest/first/last media 200; CDN returned 200 rather than 206 for the range request |
| Cowboy Bebop, Anikoto, episode 26 | Manifest and first media 200, but **last segment returned HTTP 200 `text/html`**, not video |

The episode-26 source problem is not repaired by claiming HTTP 200 equals healthy media. The downloader now rejects that kind of fake-success body. All titles/qualities/full episodes have **not** been validated.

A controlled Chromium/HLS sustained playback diagnostic was prepared at `artifacts/desktop-repair/video-playback-smoke.cjs`: compiled provider resolution, local controlled video page, >65-second playback target, decoded-frame/time checks, forward/back seek, 150-second watchdog. **No completed result is available in this handoff; inspect/rerun it before claiming the historical ~30-second buffering problem is eliminated.** It is an ignored diagnostic, not a replacement for the production React player test.

## 5. Latest desktop repair: AnimePahe / Kwik

### Root causes and changes

- Verification/session readiness could be incorrectly accepted while a challenge was still displayed.
- Cached stream A could be paired with the newest cookies from stream B.
- Session-aware requests were not consistently using the actual Electron Session.fetch transport.

Files:

- `providers/animepahe.ts`: user-operated provider homepage verification; persist:animepahe Session.fetch; generation/readiness checks; challenge and 429 handling; no alternate-browser request/origin retry loop; restricted popup/navigation/permission/download behavior; normalized exact/directory media scope.
- `providers/animepahe-session.ts`: typed access errors, state/generation gate, per-stream URL+cookie snapshot cache, independent cookie age.
- `providers/animepahe-kwik.ts`: **latest rewrite fetches Kwik HTML once as bounded data** using the app-owned persist:kwik session. It does not open/execute the remote embed to intercept video. Validates trusted Kwik `/e/{id}` links and media hosts, captures its own exact-session cookie snapshot, deduplicates pending resolution, checks config generation.
- `providers/animepahe-kwik-parser.ts`: bounded quoted-literal packer decoding without executing script; bounds HTML/candidate counts/radix; independent request/body/cookie stage deadline, including transports whose abort/cancel never resolves.

Important unresolved risk: if ordinary fetched Kwik HTML does not supply supported direct media or that session supplies no required cookies, the new resolver **fails clearly and asks for a connector update/another provider**. Synthetic tests do not prove current Kwik works live. Do not reintroduce embed execution to make the test look successful.

### User verification and exact pending question

The isolated desktop test app opened an AnimePahe homepage verification window. The user replied **“done”** after manually completing it. That is user confirmation of the homepage step, **not confirmation of episode video/audio/downloads**.

The user was also asked to try Cowboy Bebop on both providers for over one minute and seek forward in **“AniTrack — repair test”**. No completed playback result was received. They were told to Ctrl+R after the renderer rebuild.

However, **Ctrl+R refreshes renderer code only**. The running test app's main process predates later Kwik/downloader/Anikoto changes. Quit/restart the test app with freshly compiled main code, preserving its app-owned test profile, before validating the final provider implementation.

## 6. Player and downloader repairs

### Desktop player

`apps/desktop/renderer/pages/StreamPlayer.tsx` and new `components/player/playbackRequests.ts`:

- Revision/context gates discard old episode/server/provider resolutions and their late failures/finally callbacks.
- Old requests cannot replace the newest video, subtitle selection, error, or loading state.
- Capture exact fractional live position and pending seek through repeated server switches while still loading.
- Current provider/quality callback reference for HLS/native asynchronous callbacks.
- Closing/changing context invalidates pending work and timers.
- Codec recovery retains timestamp and shares a bounded recovery budget.
- Bounded media/network recovery instead of endless retries/stall refreshes; terminal errors stop stale timers.
- Security/rate/cooldown markers survive IPC wrapping and require manual retry rather than trying every server automatically.
- Episode-load failure is shown as a retryable error, not automatically treated as an expired show/session.
- Manual retry clears stale link metadata; old-show skip metadata is cleared.

These have fixture regressions. Real UI long-run/server-switch/position testing remains necessary.

### Desktop downloads

`apps/desktop/main/services/downloads.ts`:

- Reacquire scoped authorization for every manifest, media, key, and redirect destination.
- Omit ambient cookies while allowing explicitly scoped required headers.
- Validate every redirect and use its final URL for relative media.
- Per-job cancellation aborts all workers/readers; removed jobs cannot recreate folders/write files/emit late updates.
- Drain peers before reporting terminal worker failure.
- 30-second request/body deadline; 2 MiB playlist, 32 MiB asset, 64 KiB key, 10 GiB job, 20,000-asset limits.
- HTTP 403/429 stop immediately. Only bounded transient 408/5xx retries, clamped/cancellable backoff.
- Resume fingerprint prevents mixing numbered files from another server/quality or changed source plan.
- **HTTP 200 HTML/JSON/error documents and empty bodies are rejected**, including segment/init/key responses. Real binary media is not rejected merely because a CDN labels it image/jpeg or octet-stream.
- Errors redact signed media URLs.

No full completed real episode download has been signed off in this latest repair session; the live episode-1 test proved actual media files began transferring, then intentionally cancelled and cleaned its own test data.

## 7. New provider: MKissa

Full runbook: `docs/providers/mkissa.md`.

- One provider with server variants; staged site `https://mkissa.to`, API origin `https://api.mkissa.net`, GraphQL route `/api`.
- Desktop connector/helpers: `mkissa.ts`, `mkissa-client.ts`, `mkissa-bundle.ts`, `mkissa-crypto.ts`, `mkissa-key-manager.ts`, `mkissa-utils.ts`.
- Native adapter: `connectors/MkissaProvider.kt`; helpers under `connectors/mkissa/`.
- Uses bounded static bootstrap/crypto parsing and persisted GraphQL read operations; no downloaded JS execution.
- Explicit desktop and Android registry entries exist.
- **Signed config revision 6 keeps MKissa disabled for release. Android debug exposes it for testing.** Do not enable release until its verification gate is satisfied.

Historical server labels changed upstream:

- 31 August observation: Default, Yt, Luf-Mp4, Mp4, Ok.
- 5 September observation: **Yt-mp4, Fm-Hls, Uni, Mp4, Ok**.

These are dated per-title observations, not a guaranteed fixed count of five working servers today.

Verified on Samsung SM-T735 on 5 September:

- Public build-162 bootstrap/handshake and current static parser succeeded.
- Android visible playback via **Yt-mp4**.
- Forward seek to ~6:34 and backward seek to ~3:06 worked.
- **Fm-Hls returns a Byse frontend shell**, not the previously recognized packed direct-media response. Clean failure currently; new data/API flow still needs investigation and fixtures.
- Switching back to Yt-mp4 hit a provider security challenge, so timestamp-preserving server switching was not signed off.
- Other servers, desktop rendered playback, complete downloads, and full stability remain unverified.

At the user's request, Android's old timed cooldown was removed: failed challenge/rate attempts stop, but a new **manual** attempt is allowed immediately. No automatic retry/mirror challenge bypass. Desktop cooldown behavior remains unchanged.

## 8. New provider: Miruro

Full investigation history: `docs/providers/miruro.md`.

- User selected **https://www.miruro.ru/** after `.to`/direct API checks were blocked.
- Reads use the observed current `/api/secure/pipe?e=...` protocol with bounded encoded GET envelopes: config, info/{AniList ID}, episodes, selected sources.
- Plain JSON, gzip-base64url, and observed XOR-gzip responses are decoded as data. `/env2.js` JSON literal is parsed, never executed. Synthetic fixtures contain no live key/credentials.
- Desktop has `miruro-client.ts` and `miruro-protocol.ts`, **but no registered working desktop Miruro connector**.
- Android has `MiruroProvider.kt`, `MiruroAndroidProvider.kt`, `connectors/miruro/` protocol/catalogue/media/session components, provider-neutral `ProviderAccess`, and Connect/Reconnect/Disconnect UI.
- **Miruro is available in Android debug only and hard-disabled for release. No Miruro remote release enablement has occurred. Downloads remain disabled.**

Why direct API checks failed but Android later worked:

- Initial direct requests on PC and real tablet returned SECURITY_CHECK/403.
- Passing a verified WebView's UA/cookie snapshot into a different native transport still failed.
- A user-operated normal-homepage WebView session could perform the reviewed same-origin catalogue/source GETs in that same session, then hand normalized **direct media** to the normal native player.
- This is not playback in a website wrapper. The video surface is Media3, not the WebView; no Chrome session copying or embed interception.
- Session survives ordinary route changes but closes on disconnect/activity destruction/security failure; background requests are refused; 30 minutes of inactivity expires it.

Verified evidence, 6 September:

- Same-session config/info/episodes succeeded for AniList ID 1 (Cowboy Bebop).
- BEE / soft-sub / episode 1 returned five source entries and two subtitles. Only supported validated direct HLS/MP4 entries are eligible; embed entries are ignored.
- Diagnostic native playback rendered 1448x1080 and advanced frames/time.
- Seek to 120 seconds resumed at ~122 seconds; back to 30 resumed at ~32 seconds, with new frames after each.
- User confirmed the **ordinary app episode list loaded**, then confirmed **video and sound on BEE** in the normal player.
- User reported **no subtitles**. Native subtitle format/language/default/CC handoff was improved; sanitized logs later showed VTT tracks offered/accepted 2/2 and 1/1, UTF-8. **Visible captions remain unresolved**; parser acceptance does not prove subtitle fetch/render success.
- Normal-player Cowboy Bebop episode 12 later reproduced HTTP 403 on **BEE and HOP**, apparently on cross-origin HLS media after some resources loaded.
- Latest Android change uses existing **PUBLIC_HLS** scope to carry only provider-supplied public Referer to recognized cross-host playlist/segment/key/subtitle resources, not cookies/arbitrary HTML. MP4 stays exact-URL scoped. **Needs rebuild/device retest.**

User explicitly requested cooldown removal. Android no longer imposes the previous five-minute reconnect block. API errors stop and close the session, requiring a fresh user-approved connection. Media-server 403/429 stop playback but preserve catalogue access for manual server changes. No automatic retries/security bypass. The separate idle expiry remains.

Do not treat the website's displayed Cowboy Bebop episode titles as authoritative episode order: a browser observation put titles in suspicious positions. Preserve numeric source identity and verify mapping.

## 9. Features already present / earlier work to retain

This is an inventory of implemented modules and recorded work, not a fresh end-to-end verification of every feature.

- MAL OAuth, two-way list/watch status synchronization; AniList metadata/search/auth-related integration; local list/library and continue watching.
- Streaming with provider/server/quality/sub-dub controls; skip-time metadata, playback speed/seek controls, fullscreen and mini-player surfaces; download queue/local playback.
- Private Gist cross-device progress synchronization. The user's personal Gist token is distinct from release authentication and the automation signing key.
- Desktop latest episodes now come from **AniList's recent airing schedule**, aligned with Android's feed, rather than waiting for an old provider-page refresh flow. Metadata latest-feed availability does not imply a streaming provider has that episode.
- Recommendations: choose up to eight completed/watching positive-ID seeds from the user's list, favor strong ratings, reserve a strong seed from each classic decade where available; use AniList recommendation relationships, aggregate/rank, exclude already-listed titles.
- **Global era boost:** 1980s +3; 1970s and 1990s +2.5, applied once per candidate after graph aggregation. User requested this policy remain global, not only their account.
- Recommendations recompute through startup/list refresh paths and use bounded caching, not an unconditional random daily shuffle. New list ratings/seeds and upstream recommendations affect later results. Do not claim a scheduled refresh exists without checking.
- **Time Machine:** year/era browsing from 1960 onward, era atmosphere/theme, classic shortcuts, default 1988; clickable Genre Signal filters the currently loaded year's titles on desktop and Android.
- **Taste Genome:** list-derived era/genre/format affinity, confidence, classic share, rating summary, archetype. Era preference weights rating/evidence so high-rated 1980s taste is not drowned out by modern consumption volume. This is deterministic list analysis, not a trained model or new MAL account report.
- **Living Anime Museum:** factual catalogue/exhibit labels, era rooms, studio/run/format/score facts, accession codes and genre tags. Do not invent missing historical facts.
- Profile/About/Settings and tablet control/layout refinements were earlier user requests; retain the current implementation and recheck visually if touching related UI.

Performance work already committed:

- Desktop local home snapshot (up to 24h) paints cached trending/recommendations/latest content immediately.
- Independent local/network results update as they arrive; Gist reconcile no longer blocks initial home rendering.
- Route lazy-loading and idle prewarming of player/detail chunks.
- Native AniList TTL/cache/dedup and cached combined home-feed support; reduced startup/network bursts.
- Native release minification/resource shrinking enabled.

Do not reintroduce startup waits on every provider/Gist/network task. Speed up verified bottlenecks rather than merging modular files into a giant file.

## 10. Automation / continuous deployment — what exists and its limit

Read `automation/README.md` and the actual workflow files; **current GitHub execution/secrets/permissions status was not rechecked during this handoff**.

- Signed ECDSA P-256 remote configuration: verified schema/signature, increasing revision, HTTPS endpoints, cached last-valid fallback; handles domains, bounded routes/selectors, stream-host rules, provider order/enablement, notices/kill switches.
- Desktop config refresh occurs at startup, every six hours, and manual Settings refresh; bounded failure backoff.
- `publish-automation-config.yml` validates/publishes signed config changes.
- `provider-health.yml` is configured for regular checks; treats normal Pahe challenges separately; disabled MKissa is not falsely probed/reported healthy.
- `ci.yml` verifies signatures, Node tests, Android unit tests, TypeScript, desktop build, native debug build.
- `continuous-deploy.yml` runs after successful pushed-main CI, ignores superseded runs, auto-increments patch version/Android versionCode, creates release commit/tag, dispatches release workflow.
- `release.yml` requires an exact matching version tag and the protected production environment; builds/signs/verifies/uploads/publishes a combined desktop+native Android release.
- Desktop updater exists. Android verifies signed update manifest, APK SHA-256, package and permanent signing certificate before asking the user to install.

**Editing files here does not instantly change an installed app.** Compatible data-only rules can deploy through the signed config channel after publication/refresh. New parsers, UI, database, playback engine, and other executable changes require rebuilt installer/APK delivery. Continuous deployment automates those releases; it does not eliminate binaries or Android's final Install tap.

Credentials:

- `.env` and `.release-secrets/` are ignored local secret locations. Their current presence/contents/auth validity were **not inspected** for this handoff.
- Do not paste GitHub/Gist tokens, OAuth tokens, cookies, private signing keys, or keystore passwords into chat/docs/code.
- Release workflows use short-lived GitHub `GITHUB_TOKEN`; a publisher PAT should not be compiled into the application.
- Preserve/back up the permanent Android keystore and automation signing key; replacing them breaks existing client trust/in-place updates.
- The local desktop package generated in this repair session was unsigned. Production Windows signing certificate configuration must be checked before claiming signed publisher identity/SmartScreen reputation.

## 11. Tests and builds: exact confidence level

Freshly rechecked while preparing this handoff:

- **130/130 Node tests pass**, zero failures/skips, using exactly the files declared in `package.json`'s test script.
- Desktop main TypeScript `--noEmit`: **pass**.
- Desktop renderer TypeScript `--noEmit`: **pass**.

New/relevant test files:

- `tests/anikoto-source.test.mjs`, `anikoto-transport.test.mjs`, `anikoto-hls.test.mjs`, `anikoto-provider.test.mjs`.
- `tests/animepahe-session.test.mjs` (includes static Kwik parser and stalled fetch/body/cookie deadline coverage).
- `tests/desktop-player.test.mjs`, `downloads.test.mjs`, `electron-provider-smoke.test.cjs`.
- Existing MKissa/Miruro protocol/web-session/registry/authorization tests and recommendations/taste/time-machine/museum tests.

Earlier in the desktop repair: Vite production build passed; Electron main compiled; unpacked local package succeeded. **Final package has not been regenerated after all later source edits.**

Earlier Android checkpoint recorded in the provider docs: **66 JVM tests passed**, debug app/test APK built and installed with data preserved. That is historical evidence, **not a fresh final Android verification** of all current files, including the later cross-origin HLS change.

Mock/parser tests do not prove live providers, every server, complete downloads, sustained video, captions, or production updates work. See the live test sections above.

Normal commands from root:

```text
npm test
npm run typecheck
npm run build
npm run android:next:test
npm run android:next:debug
npm run providers:smoke:electron -- Bebop 1 anikoto --slug=VERIFIED_PROVIDER_SLUG
```

The smoke script takes positional title, episode number, and provider ID, plus optional `--slug=...` and `--download`. Replace `VERIFIED_PROVIDER_SLUG` with an actual Anikoto show identifier; prefer explicit verified slugs when title search is flaky. `--download` performs a bounded begin/cancel/remove diagnostic, not a full download verification.

Node 24 is configured in CI. Tests rely on modern Node facilities (`registerHooks`/TypeScript loading); use a compatible runtime. On this Windows session some npm/PowerShell launches stalled; direct `node node_modules/typescript/bin/tsc ...` / direct test-file invocation with `cmd.exe`, non-login shell, worked.

## 12. Local test app / diagnostics / build artifacts

All following paths are ignored diagnostics, not committed production code:

- `artifacts/desktop-repair/launch-repair-app.cjs`: launches full compiled app with title **AniTrack — repair test**, isolated `%TEMP%\anitrack-desktop-repair-test` userData, appPath pointed at this repo, default-protocol registration suppressed. It may still be open. Do not mistake its isolated MAL/Gist state for the installed app's profile.
- Its user-approved Pahe verification session belongs to that test process/profile. Preserve it on restart; do not copy cookies from installed/private/Chrome profiles.
- `artifacts/desktop-repair/anikoto-probe.mjs`: bounded static provider probe.
- `artifacts/desktop-repair/inspect-public-player.mjs`: static inspection with literal redaction, not JS execution.
- `artifacts/desktop-repair/electron-media-compare.js`: own-app transport comparison diagnostic.
- `artifacts/desktop-repair/video-playback-smoke.cjs`: controlled sustained video diagnostic, result not signed off here.
- `artifacts/desktop-repair/local-build/win-unpacked/AniTrack.exe`: **local unpacked build, stale relative to final source**. Do not publish/distribute it as the final repair without rebuilding.

Production-worthy smoke helpers are `scripts/electron-provider-smoke.js` and `scripts/electron-provider-smoke-common.js`: actual Session.fetch, bounded manifests/redirects/media probes, sanitized stage reporting, global deadline, manual verification only, no background challenge loops.

Windows screen capture via the computer-use integration timed out twice, including one recovery attempt. No screenshot-based final desktop QA was obtained. Do not invent what the UI displayed. User confirmation is still needed.

Previously tested tablet: **Samsung SM-T735 / Tab S7 FE, Android 14**. USB and wireless debugging were used earlier. Debug app package is `com.sanjay.anitrack.next.debug`; signed release is `com.sanjay.anitrack.next`; test instrumentation package is separate. **Current device connection is not established by old chat messages.** Check authorization/connection afresh; do not reuse old pairing codes/ports or uninstall the release app.

## 13. Highest-priority continuation checklist

1. Snapshot/review the current dirty and untracked files; preserve unrelated earlier Android/MKissa/Miruro work and staged cleanup.
2. Build fresh Electron main + renderer. Restart the isolated repair test app so it really uses final main code; retain its app-owned verification profile.
3. Validate **AnimePahe** end-to-end after manual homepage completion: episode list, static Kwik resolution, video/audio, >1-minute playback, seek, server/quality switch, subtitles if offered, and bounded real media download. If direct HTML/cookies are insufficient, report that precise blocker instead of calling Pahe repaired.
4. Complete Anikoto actual rendered >65-second/seek diagnostic, then production-player QA across episode/provider/quality switching. Check stale-request races and timestamp retention with rapid changes.
5. Check download cancellation, safe resume, and non-media failures in the actual app. Investigate upstream broken episode-26 media without retries that hammer challenges.
6. Re-run regression/type checks and rebuild the **final** local package. Release only when the user requests/authorizes the deployment and blockers are clearly disclosed.
7. Android next: rebuild/retest Miruro cross-origin HLS authorization, diagnose BEE captions at fetch/load/track/render stages, verify expiry/reconnect/server switching; keep release disabled until complete.
8. MKissa next: investigate Fm-Hls/Byse's supported data flow without executing/loading its ad embed; fixture it, validate other returned aliases, then test normal-player switching/progress/downloads on both platforms. Keep release config disabled meanwhile.
9. Only after provider stability, extend features/performance. Retain global classics preference and current architecture.

Do not claim “everything fixed,” all five servers supported, Miruro working on desktop, or automatic instant code updates based on the currently available evidence.
