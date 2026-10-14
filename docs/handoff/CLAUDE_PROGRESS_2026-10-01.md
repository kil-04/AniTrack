# AniTrack — Claude session progress, 1 October 2026

Continuation of `CLAUDE_HANDOFF_2026-10-01.md`. The pre-session working tree is
saved at the local ref `refs/backup/claude-handoff-2026-10-01`.

**Released as v7.1.0** at the user's request: commits e289a9b, dec1624,
78338e3, 630bd72, f48dae9 (version 7.1.0, Android versionCode 10) and 471a018
on `main`; continuous deployment tagged v7.1.0 on 471a018 and dispatched the
release workflow. CD now releases an untagged declared version as-is (see
automation/README.md "Release versions"). These handoff notes stay local.

## Root causes found and fixed

| Area | Finding | Fix | Evidence |
| --- | --- | --- | --- |
| Anikoto downloads | CDN serves MPEG-TS behind random `.png/.ico/.jpg/.webp/.html` names with a matching `Content-Type`; the "ep 26 last segment is HTML" was valid TS. The downloader rejected it by header. | `downloads.ts` and the smoke probe classify bytes (TS sync every 188 B, fMP4 box, ID3) before trusting the header. | Byte sniff of live segments; ep 26 smoke now passes. |
| Anikoto downloads | Cloudflare 429 (`Retry-After: 10`) after ~106 requests in ~4 s with 6 workers; 429 is terminal by design. | `DOWNLOAD_WORKERS = 2`. | Full ep 26 (314 segs, 195 MiB) and ep 1 (353 segs, 305 MiB) downloaded, every segment verified, 0 errors. |
| AnimePahe verification | Window showed a *cached* homepage, so readiness was falsely marked and the user could never complete the check. | Homepage loads with `Cache-Control: no-cache`; one `reloadIgnoringCache()` when an API call is challenged. | Live: challenge now appears; after user completion homepage passes. |
| AnimePahe requests | Cloudflare rejects browser-process `Session.fetch` even with valid clearance; same-origin page requests pass. | Fixed same-origin GETs from an **isolated world** of the verified page (`paheSessionRequest`): data-only argument, same-origin path check, 2 MiB cap, deadlines, no retry. | Search → 26 episodes → 6 links → Kwik HLS resolved live. |
| AnimePahe play page | Cloudflare's injected `/cdn-cgi/challenge-platform/` loader in normal 200 pages was treated as a challenge. | `paheResponseError` needs 403, a challenge title, or `_cf_chl_opt`/`cf-chl-` (loader alone only on 5xx). | Play page now parsed; Kwik static resolver works live. |
| AnimePahe UX/memory | Startup prewarm would pop the check unprompted; hidden site window ran all session. | Silent prewarm (shown only on a user request); idle window closed after 10 min. | Closing it freed ~116 MB working set. |
| Desktop player | Rapid source switches lost position: a freshly attached source at ~0 s beat the unapplied pending seek. | `capturePlaybackPosition` prefers a pending seek; provider-switch retained position is a last resort. | Live Pahe QA 8/8 incl. rapid switches (5:06 kept). |
| Offline playback | `anitrack-dl://` read whole segments with `readFileSync` on the main thread. | Streamed response with `Content-Length`. | 3 MiB probe byte-identical; traversal/missing → 404. |
| Desktop rendering | 312 `backdrop-filter` surfaces on Home (per-card badges/play overlays); one AniList banner is 136800×28800. | Removed per-card blurs; `lib/image-guard.ts` swaps oversized banners for cover art and remembers them. | Home: 312 → 3 blur surfaces; decoded image total 3,979 MP → 31 MP. |
| Desktop package | 112 of 114 MB in `app.asar` were renderer-bundled or Capacitor-only `node_modules`. | Excluded 30 unused packages in `build.files` (main needs only electron-updater + node-sqlite3-wasm trees). | `app.asar` 115 MB → 3.2 MB; unpacked 381 → 270 MB; packed app boots, IPC/DB/providers work. |
| **Android Anikoto** | Android never got the `enc` source decoding, and tried only the first server. Release and debug Anikoto failed: "stream URL missing in getSources". | `connectors/anikoto/AnikotoSource.kt` (port of `anikoto-source.ts`), up to 5 servers, videojs path, cached cipher. | Tablet debug: plays, soft subs render, seeks forward/back. |

Later in the session: two of the three Anikoto soft-sub servers (HD-1 and
Vidstream-2, `megaplay…/stream/` players) failed on every episode on both
platforms. Their own client script contains only a telemetry cipher; the real
decoder is in an obfuscated bundle, which is deliberately **not** read. Their
`enc` sources decode with the same origin's readable `/videojs/` client
constants, so both platforms now fall back to those (data only; unreadable
clients cached as such; a security/rate error while reading stops at once).
Desktop live: first server succeeds, 0 dead servers per episode (was 2).

Android downloads saved video only, so soft-sub episodes played offline with
no captions. Downloads now carry the preferred VTT track (default → English →
first) and save it as `subs.vtt` (best-effort, HTTPS, ≤ 2 MiB, must start with
`WEBVTT`); offline playback attaches it. Tablet: ep 18 and ep 19 downloaded
(344/345 segments, all local, ENDLIST, real TS), ep 19 saved 281 cues and
showed English captions offline; both test downloads were then deleted in-app.

Tablet soak/seek evidence: 81 min of unattended auto-next playback (eps
12 → 16): 1,103 segments, 0 hung requests, 0 retries, 0 watchdog stalls,
0 player errors. Seek stress: first segment 30–310 ms after each seek.

Also: the desktop Anikoto provider caches the player-client cipher for 15 min
per client URL (it re-downloaded the client script on every resolve), and
`scripts/electron-provider-smoke.js` now normalizes the User-Agent like
`main.ts` (Cloudflare binds clearance to the UA, so the smoke was re-challenged).

## Build outputs (local, ignored, not distributed)

- `artifacts/desktop-repair/local-build-2/win-unpacked/` — unsigned unpacked desktop build from final sources (asar 3.2 MB); boot-checked with an isolated profile.
- `apps/android/app/build/outputs/apk/release/app-release.apk` — 3.3 MB, signed with the same certificate as the installed release app (SHA-256 `df2e4f6c…ec6b`), so it would update in place. **Not installed.**

## Verification

- Desktop: 136/136 Node tests, renderer + main typecheck pass.
- Android: 72/72 JVM tests (6 new `AnikotoSourceTest`).
- Desktop live: Anikoto sustained 75 s + seeks (isolated harness) and production-player CDP QA 7/7; AnimePahe production-player QA 8/8.
- Tablet (SM-T735, debug build installed in place): Anikoto playback, captions, seek. Cold start 929 ms (debug), Home 139 MB PSS, playback 235 MB PSS.

## Open items

- **Release Android app still has the old Anikoto resolver** until a release APK is installed (needs the user's go-ahead).
- Android Anikoto backward seek once hit two hung segment requests (~8.5 s each); the 8 s buffering watchdog recovered automatically. Not reproduced in a later 6-seek stress run or the 81-minute soak.
- MKissa (debug-only) servers changed again (Ss-Hls, Mp4, Ok, Sl-mp4, Uv-mp4); Mp4/Ok fail with `ERR_SSL_PROTOCOL_ERROR`, Ss-Hls times out. Keep release-disabled.
- AnimePahe **downloads** unverified: the Cloudflare clearance expired before the bounded download smoke ran; no retry was attempted.
- Miruro and Android AnimePahe need user-operated connection/verification; not retested.
- Desktop CDP QA harness: `--remote-debugging-port` on the repair launcher (see memory note); hidden/occluded windows stop video decode, so frame counts need a visible window.
