# AniTrack

A desktop anime tracker with a Netflix-style UI, two-way MyAnimeList sync, a built-in local file player, and a "Watch on" launcher for licensed streaming services.

Built because mainstream tracker/player apps are clunky and most aggregator sites have broken Continue Watching / list features.

## Features

- **Netflix-style UI** — hero banner, horizontal rows, hover-to-scale cards, dark theme.
- **Continue watching that actually works** — every 5 seconds the player persists position to SQLite. Reopen any time and resume.
- **Two-way MAL sync** — pulls your full list on connect; pushes episode counts, statuses, and scores back to MAL every 30 seconds.
- **Local file player** — plays your `.mkv` / `.mp4` / `.avi` / etc. files. Auto-marks an episode "watched" at 85% completion.
- **Library scanner** — point it at folders, it parses anime filenames (`[Group] Title - 03 [1080p].mkv` / `Title.S01E03.mkv`) and matches them to AniList for metadata.
- **AniList metadata** — rich data for browsing/search (no MAL needed for read-only).
- **Watch on a licensed service** — every show has a side panel with search links to Crunchyroll, Netflix, HiDive, Hulu, Disney+, Amazon, and YouTube.

## Stack

- Electron 32 (main process + custom protocols)
- React 18 + Vite + TypeScript
- Tailwind CSS for styling
- Zustand for renderer state
- better-sqlite3 for local persistence
- AniList GraphQL API (no auth) for metadata
- MyAnimeList REST API + OAuth 2.0 PKCE for sync

## Setup

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on `:5173` and Electron pointing at it. Hot reload works for renderer changes; restart for main-process changes.

### Connecting MyAnimeList

1. Go to https://myanimelist.net/apiconfig and create a new app.
   - **App Type:** Other
   - **App Redirect URL:** `anitrack://mal-callback`
2. Copy the **Client ID** that MAL issues.
3. Open the app → **Settings** → paste the Client ID → **Connect MyAnimeList**.
4. Approve in browser. AniTrack will receive the callback via the `anitrack://` protocol handler, store tokens locally, and you're done.

### Adding your library

1. **Settings → Library folders → Add folder**.
2. Pick the directory containing your anime files. Subdirectories are scanned.
3. Click **Scan library**. AniTrack will parse filenames, match titles against AniList, and populate the home screen.

Filename matching works best with the common fansub format: `[Group] Show Name - 03 [1080p].mkv`. `S01E03` format also works.

## How sync works

- **On connect:** `mal:pull` walks your full MAL list, resolves each entry to its AniList equivalent (so we have nice metadata), and writes `list_entry` rows to local SQLite.
- **As you watch:** every 5s the player writes `playback` rows. When `position / duration >= 0.85`, the matching `list_entry` row is marked `mal_dirty = 1`.
- **Background flush:** a 30-second timer in the main process calls `MAL_PUSH_PROGRESS`, which drains all dirty rows via `PATCH /anime/{id}/my_list_status`.
- **Status auto-promote:** if `episodes_watched` reaches `episodes`, status flips from `watching` → `completed`.

## Build

```bash
npm run build       # build renderer + transpile electron
npm run pack        # build + run electron-builder for current OS
```

`electron-builder` outputs are written to `./release/`.

## File map

```
electron/
  main.ts                    main process, IPC, custom protocols
  preload.ts                 contextBridge (window.api)
  services/
    db.ts                    SQLite schema + helpers
    anilist.ts               AniList GraphQL client
    mal.ts                   MAL OAuth + sync (pull + dirty-flush)
    library.ts               filename parser + recursive scanner
    legal-sites.ts           streaming service link builder

src/
  App.tsx                    router + bootstrap
  store/useAppStore.ts       zustand store
  lib/format.ts              time formatting helpers
  components/
    Sidebar.tsx              left nav with MAL status chip
    TopBar.tsx               search box + global status
    HeroBanner.tsx           home-page splash
    Row.tsx                  horizontal scroller w/ hover arrows
    Card.tsx                 cover card with progress bar
    WatchOnMenu.tsx          "Watch on licensed service" panel
  pages/
    Home.tsx                 hero + continue watching + rows
    Library.tsx              filtered list view
    Search.tsx               AniList search
    ShowDetail.tsx           cover/banner + episodes + watch-on
    Player.tsx               HTML5 video w/ custom controls
    Settings.tsx             MAL connect + library folders + scan

shared/
  types.ts                   shared types + IPC channel names
```

## Notes on legality

This app is a tracker and a player for **files you already have on disk**. It does not stream from any third-party source. The "Watch on" section opens the official search page of legitimate streaming services. Use a subscription you actually pay for.

## Roadmap ideas

- AniList sync alongside MAL (mostly a matter of adding a second OAuth path).
- Better subtitle support (currently relies on the video's built-in tracks; external `.ass`/`.srt` would need additional work).
- mpv-based playback for better codec support (some `.mkv` containers don't play in Chromium's HTML5 video).
- Per-episode thumbnails via ffmpeg snapshot.
- Discord rich presence.
