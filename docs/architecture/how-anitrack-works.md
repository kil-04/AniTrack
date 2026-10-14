# How AniTrack works

A plain-language tour of both apps, written on 14 October 2026 from the current
working tree (including the uncommitted redesign and Comix work). Where this
disagrees with `AGENTS.md`, this file is the newer description: `AGENTS.md`
still describes the older AnimePahe-first, local-video-file version of the app.

---

## The big picture

AniTrack is a personal anime and manga hub. It ships as **two separate apps**:

| | **Desktop** | **Android (tablet/phone)** |
|---|---|---|
| Built with | Electron: a Chromium window plus a Node.js "main process", UI in React + Tailwind | Native Kotlin + Jetpack Compose, video through ExoPlayer (Media3) |
| Lives in | `apps/desktop/` | `apps/android/` |
| Version | 8.0.0 | 8.0.0 (`com.sanjay.anitrack.next`; debug build `….debug`) |

There is **no AniTrack server**. Both apps talk directly to outside services,
and the only thing they share at runtime is your accounts and one private
GitHub gist:

- **AniList:** all anime and manga information (titles, covers, episodes,
  relations, trending, airing times).
- **MyAnimeList (MAL):** your watch list, pushed and pulled both ways.
- **Streaming sites ("providers"):** Anikoto and AnimePahe for video. Miruro
  is implemented but switched off; MKissa was removed on request (its code is
  kept but unregistered).
- **Manga sites ("sources"):** MangaDot, MangaBall and Comix.
- **Small helpers:** AnimeThemes (opening and ending songs) and AniSkip
  (intro and outro timestamps).
- **GitHub:** a private gist for cross-device sync, signed config files, and
  release downloads.

### Repository map

| Path | What it is |
|---|---|
| `apps/desktop/main/` | Electron main process: database, providers, downloads, sync, network rules |
| `apps/desktop/renderer/` | Desktop UI (React + Vite + Tailwind) |
| `apps/android/` | Native Android app (Kotlin + Compose) |
| `packages/shared/` | TypeScript types and logic used by both halves of the desktop app (`types.ts`, `provider-types.ts`, `manga.ts`, `runtime-config.ts`, `story-bridge.ts`, `time-machine.ts`, `taste-genome.ts`, …) |
| `automation/` | Signed remote settings (`remote-config.json` + `.sig`) and Android update metadata (`android-update.json` + `.sig`) |
| `scripts/` | Release, signing, health-check and live smoke-test tools |
| `tests/` | About 320 Node regression tests |
| `docs/` | Provider runbooks, architecture notes, handoffs |
| `legacy/capacitor/` | The old Capacitor Android app, kept only for reference |

---

## 1. The desktop app

### Three layers, kept apart for security

```
┌──────────────── Renderer (Chromium window) ────────────────┐
│  React UI: pages, player, manga reader                      │
│  calls window.api.*  (the only door to the system)          │
└───────────────┬─────────────────────────────────────────────┘
                │ IPC (messages between processes)
┌───────────────▼──── preload.ts (the bridge) ────────────────┐
│  exposes a fixed list of functions as window.api            │
└───────────────┬─────────────────────────────────────────────┘
┌───────────────▼──── Main process (Node.js) ─────────────────┐
│  database, providers, downloads, MAL/AniList, manga sources, │
│  network header rules, custom protocols, updater             │
└──────────────────────────────────────────────────────────────┘
```

The UI cannot touch files or make privileged network calls itself. Every
action is a named message:

1. the message names live in `packages/shared/types.ts` (the `IPC` map);
2. the handlers live in `main/main.ts` and `main/ipc/*.ts` (`auth`, `db`,
   `downloads`, `manga`, `providers`);
3. `main/preload.ts` exposes them as `window.api`;
4. `renderer/types.d.ts` declares that API for TypeScript.

A bug or a hostile page in the UI therefore can't reach your disk.

### The UI (renderer)

- **Shell:** `App.tsx` lays out the collapsible left sidebar (Anime/Manga
  switch, Browse, Library, Settings), the top bar (back/forward and global
  search) and the page area. Pages fade in briefly. Routes use a hash router
  (`#/anime/123`).
- **Mode colour:** the mode sets `data-mode="anime|manga"` on the page, which
  swaps the accent colour: azure for anime, deep royal blue for manga (tokens
  in `index.css`).
- **Anime pages:** Home (hero carousel, Continue Watching, latest episodes,
  Top 10, discovery rows), Search/Filter, title pages, Schedule, My List,
  Continue Watching, Downloads, and the extras Time Machine, Taste Genome and
  Museum.
- **Manga pages:** Home, Search, My List, Updates, Downloads, title page,
  reader.
- **State (Zustand stores):** `useAppStore` (account state, lists, Continue
  Watching), `usePlayerStore` (the persistent player), `useMangaReader` and
  `useMangaDownloads`, `useThemePlayer` (theme songs).
- **Look:** shared components such as `PageHeader`, `SectionHeader`,
  `EmptyState`, `SelectField`, `BrandMark`, plus the `.btn / .panel / .chip /
  .badge / .icon-tile / .input / .skeleton` classes.

### The main process: what each part does

| File/folder | Job |
|---|---|
| `services/db.ts` | The local SQLite database (via `node-sqlite3-wasm`) in your Windows app-data folder. Tables: `anime`, `list_entry`, `playback`, `manga_reading`, `manga_list`, `manga_match`, older local-file tables (`local_episode`, `library_folder`), and versioned migrations. |
| `services/anilist.ts` | AniList GraphQL: search, details, trending, airing, relations. |
| `services/mal.ts` | MAL login (OAuth with PKCE in an in-app window), importing your list, pushing changes. |
| `services/anilist-sync.ts` | Optional AniList account sync, using your own AniList client ID. |
| `services/providers/` | Streaming connectors and the provider registry (section 3). |
| `services/downloads.ts` | Offline episode downloads (section 4). |
| `services/manga/` | Manga sources, the isolated Comix session, disk caches, manga downloads. |
| `services/animethemes.ts` | Theme songs from AnimeThemes, cached for 6 hours. |
| `services/remote-config.ts` | Downloads and verifies the signed settings file (section 8). |
| `services/updater.ts` | App updates via `electron-updater`, loaded only when needed so startup stays fast. |
| `main.ts` | Startup, single-instance lock, custom protocols (`anitrack-dl://` for downloaded video, `anitrack-manga://` for manga images), network header rules, background timers. |

---

## 2. The Android app

- **One activity:** `MainActivity.kt` hosts everything with Compose
  navigation. Routes include `home`, `search`, `quicksearch`, `anime/{id}`,
  `player`, `mylist`, `schedule`, `downloads`, `continue`, `latest`,
  `time-machine`, `taste-genome`, `museum/{id}`, `settings`, plus the manga
  routes (`manga/{id}`, `reader`, `manga-search`, `manga-list`,
  `manga-updates`, `manga-downloads`).
- **Layout:** on a tablet you get a top navigation bar; in portrait a compact
  top bar plus a bottom bar. The Anime/Manga switch on Home changes the tabs
  and the accent colour, and is remembered (`home_mode` preference).
- **Data layer (`data/`):** mostly app-wide singletons:
  - `AniList` (GraphQL with a 30-minute disk cache and popularity floors,
    because unfiltered AniList sorts time out);
  - `Db` (SQLite tables `playback`, `list_entry`, `manga_list`, `reading`,
    `mal_outbox`);
  - `Mal`, `GistSync`, `Providers` (the provider registry);
  - `PlayerHolder` (the persistent player), `DownloadManager` and
    `DownloadTransport`;
  - `ReleaseAlerts`, `SmartDownloads`, `AnimeThemes`, `ThemePlayer`,
    `ThemeRadio`, `StoryBridge`, `Backup`, `RemoteConfig`;
  - `update/AppUpdater`.
- **UI (`ui/`):** one file per screen, built from shared design pieces:
  `AniTheme.kt` (colours) and `DesignSystem.kt` (`ScreenHeader`, `EmptyState`,
  `IconTile`, `AniCard`, `PillButton`, `PillTabs`, `Tag`, …).
- **Website sessions:** sites that need a real browser get their own web view.
  Comix even runs in a separate process (`:comix`) with its own cookie store,
  isolated from the rest of the app.

The two apps share **no code** at runtime; Android re-implements the same ideas
in Kotlin. The one exception is `comix_transport.js` (in Android's `assets/`),
which both apps load into the Comix web page.

---

## 3. Watching an episode, step by step

This is the core flow; both apps do the same thing.

1. **Pick a show.** Everything is keyed by its **AniList ID**, AniTrack's
   primary key everywhere. A show known only to a streaming site gets a
   negative stand-in ID, which is replaced once the real AniList entry is
   found ("stub-then-resolve"), so Continue Watching works immediately.
2. **Find it on a streaming site.** The provider registry asks each enabled
   provider, in order, to search for the title. Order and on/off switches come
   from the signed remote config. Results are scored against the AniList title,
   year and episode count, and verified by AniList/MAL ID where the site
   exposes one. The match is remembered.
3. **List episodes.** The provider returns a normalised episode list (numbers,
   titles, thumbnails, filler flags). The UI only ever sees this neutral format
   (`packages/shared/provider-types.ts` on desktop, `ProviderModels.kt` on
   Android), never site-specific data.
4. **Resolve the stream.** The provider turns an episode into video links,
   usually HLS (a playlist of short video chunks), plus subtitles and
   sub/dub options.
   - **AnimePahe** sits behind a Cloudflare check that you complete once
     yourself (a desktop window or an Android overlay). Its videos go through
     its Kwik player pages.
   - **Anikoto** serves video from rotating CDN hosts that require the right
     Referer header.
5. **Authorise the request** (the clever part). Video CDNs often demand
   specific headers (Referer, cookies, Origin) that a normal web page can't set.
   - **Desktop:** `stream-authorization.ts` registers each resolved stream URL
     (or its folder) together with the headers it needs. Network hooks in
     `main.ts` add those headers **only** to requests matching those
     registrations, add the CORS headers the player needs, and record 403/429
     refusals.
   - **Android:** `ScopedRequestAuthorization` does the same for ExoPlayer,
     which uses Chromium's network stack (Cronet).
6. **Play.**
   - **Desktop:** `StreamPlayer.tsx` uses hls.js (or the native player for MP4)
     with a YouTube-style control bar, keyboard shortcuts and an episode side
     panel. Leaving the page shrinks it into a **floating mini-player**, so
     playback continues while you browse.
   - **Android:** `PlayerHolder` owns one app-wide ExoPlayer, so the same
     mini-player works. Touch gestures (seek, brightness, volume) live in
     `PlayerGestureLayer`.
   - **Skip intro/outro:** timestamps come from AniSkip, looked up by the
     show's MAL ID and episode.
7. **Save progress.** The position is saved to the `playback` table as you
   watch; that's what Continue Watching shows. Near the end, "Up next" offers
   the next episode, and the episode count is updated on your list.
8. **Sync.** Watch-list changes go to MAL (section 5); Continue Watching goes
   to the other device through the gist (section 6).

---

## 4. Anime downloads

- **Desktop (`services/downloads.ts`):**
  - **Saving:** stores the whole HLS stream (playlist, every chunk, encryption
    keys and subtitles) under `anitrack_downloads/` in app data, then rewrites
    the playlist to point at the local files.
  - **Playback:** the player reads it back through `anitrack-dl://`, so offline
    playback uses the same player.
  - **Pacing:** two download workers, because the CDNs answer faster bursts
    with HTTP 429.
  - **Disguised chunks:** some sites wrap video chunks in fake image files; the
    downloader strips that wrapper.
- **Android (`DownloadManager` + `DownloadTransport`):** the same idea, saved
  straight to app storage with a queue, progress notifications and retry.
- **Smart downloads (Android, currently switched off):** keeps the next 1–3
  episodes of recent shows downloaded (Anikoto only, since it needs no browser
  check) and optionally the next 5/10/20 manga chapters.

---

## 5. Your list and MyAnimeList

- **What's stored:** each `list_entry` row holds a status (watching,
  completed, plan to watch, on hold, dropped), episodes watched and your score.
- **Desktop to MAL:** changing anything marks the row dirty (`mal_dirty`), and
  a timer pushes dirty rows to MAL every 30 seconds. Changes made offline are
  not lost; they go out when you're back online.
- **Android to MAL:** the same idea using an outbox table (`mal_outbox`).
- **Importing:** connecting MAL pulls your whole MAL list into the local
  database.
- **AniList account sync:** optional on desktop, using your own AniList client
  ID.

## 6. Cross-device sync (the GitHub gist)

- **Setup:** you paste a GitHub token with "gist" permission on each device.
  The apps find or create one private gist, `anitrack-sync.json`.
- **What's in it:** Continue Watching rows (show, episode, position, length,
  title, cover and the AnimePahe session), plus "deleted" markers.
- **How conflicts resolve:** the newest change wins per episode. A deletion
  beats older rows but is cleared if you rewatch. The format stays
  byte-compatible between desktop, Android and the old Capacitor app.
- **When it syncs:**
  - **Desktop:** at launch, and whenever the window regains focus (at most
    once a minute).
  - **Android:** when the Home screen opens, and from Settings → Sync now.

---

## 7. Manga mode

| Source | How it works |
|---|---|
| **MangaDot** | Biggest catalogue. Needs a one-time Cloudflare check that you complete (desktop connect window, Android `MangaDotConnectActivity`). Requests then reuse that verified session's cookies. |
| **MangaBall** | Public JSON API, no check needed. |
| **Comix** | Runs Comix's own page code inside an isolated, sandboxed browser session. A bundled script (`comix_transport.js`) borrows the site's own request function to fetch catalogue data, and the app unscrambles its shuffled page images locally. **Currently refused by Comix's server for the app's built-in browser (HTTP 502).** |
| MangaPill, MangaDex | Code still exists but not registered. |

How a manga is read:

1. **Match:** the AniList manga is found on a source, by tracker links first
   and title + year + country as a fallback. The match is saved.
2. **Chapter list:** fetched in full (one chapter number can have several
   uploads from different scanlation groups) and cached; you can choose a
   preferred group.
3. **Reader:** vertical scroll or paged left-to-right/right-to-left, two-page
   spreads, width and background settings. Very tall webtoon pages are cut
   into slices (`PageStrips`) so they don't render blank. Progress is saved
   per page; failed pages are not counted as read.
4. **Downloads:** chapters are saved for offline reading, including "Download
   range" for many at once.
5. **Updates:** checks your reading list for new chapters (Comix is skipped,
   since every check would open its loading window). Android **release alerts**
   (WorkManager, every 2 hours) notify you of new chapters and episodes.

---

## 8. Remote config: changing behaviour without an app update

`automation/remote-config.json` is a small, **data-only** settings file. It can
change provider domains, which hosts count as video CDNs, provider order,
feature kill-switches and notices.

Both apps download it from GitHub every 6 hours and accept it only if all of
these hold:

- the **ECDSA P-256 signature** checks out against the public key built into
  the app (`packages/shared/automation-trust.json`);
- the format is valid;
- the revision is newer than the cached one;
- every address in it is HTTPS.

If GitHub is unavailable, the last good copy keeps working. So when a streaming
site changes its domain, publishing a new signed file fixes every installed
copy, and nobody can push code into the apps that way. The
`publish-automation-config` GitHub workflow signs it.

## 9. Updates, releases and monitoring

- **Desktop:** `electron-updater` checks GitHub Releases and installs new
  versions (NSIS installer).
- **Android:** `AppUpdater` downloads a **signed** update manifest
  (`android-update.json` + `.sig`), checks the APK's SHA-256, then asks Android
  to install it (`REQUEST_INSTALL_PACKAGES` permission).
- **Pipeline:** pushing to `main` runs CI (`ci.yml`). Continuous deployment
  (`continuous-deploy.yml`) then tags the version and triggers `release.yml`,
  which builds desktop and Android and publishes one combined GitHub release
  (`npm run release:all`). Versions follow the MAJOR.MINOR scheme.
- **Provider health:** `provider-health.yml` runs every 15 minutes on GitHub
  Actions to check that the streaming providers still answer.

## 10. The extras (companion features)

- **Continue the story:** anime pages show the source manga or novel ("You're
  on chapter N"); manga pages show "Watch the anime".
- **Theme songs and Theme radio:** openings and endings from AnimeThemes, a
  now-playing bar that follows you, and a shuffled radio of your shows' songs.
  Theme songs and episodes never play at the same time.
- **Time Machine:** jump to any year since 1960, browse what aired, and collect
  a "passport" of the years you've visited.
- **Taste Genome:** a profile of your taste built from what you've actually
  watched and rated.
- **Living Museum:** an exhibit-style page for one title.
- **Schedule and notifications:** upcoming episodes of shows you track
  (desktop checks hourly; Android every 2 hours).
- **Android extras:** backup and restore to JSON, recent searches,
  next-episode countdown, auto-skip, manual mark-as-read for manga.

---

## 11. Safety rules built into the design

- **Desktop windows:** the UI runs with context isolation and no Node access.
  Website windows (providers, Comix, MangaDot) get no preload and no app bridge.
- **Narrow network rules:** each website session has an allow-list of the exact
  paths it may load. Everything else, including ads, account pages and
  pop-ups, is blocked.
- **Scoped headers:** stream headers apply only to the exact authorised URLs,
  never globally.
- **Signed inputs:** config and Android updates are signature-checked, and no
  remote code is ever downloaded.
- **Human checks stay human:** website checks (Cloudflare, Comix's picture
  check) are completed by you, never automated.

## 12. Testing and tools

- `npm test`: about 320 Node tests (providers, playback, sync, manga, Comix,
  config).
- `npm run android:next:test`: about 290 Kotlin unit tests.
- `npm run typecheck`: both TypeScript halves.
- `npm run dev`: start the desktop app for development.
- `npm run android:next:debug`: build the debug APK.
- Smoke scripts in `scripts/` run the real Electron app against live sites,
  and only when explicitly asked (`--run`).

---

## Where things stand (14 October 2026)

- The midnight-blue redesign, Codex's Comix work and the 14 October fixes are
  all **uncommitted**. The `out/` folder of captures isn't git-ignored, so keep
  it out of commits.
- **Comix** is refused by Comix's own server for the app's built-in browser
  (HTTP 502 with `retry-after: 60`) since its 13–14 October site update, while
  Chrome Incognito works. MangaDot and MangaBall work normally.
- Handoff notes with full details: `docs/handoff/CLAUDE_HANDOFF_2026-10-13.md`
  and `docs/handoff/CLAUDE_HANDOFF_2026-10-14.md`.
