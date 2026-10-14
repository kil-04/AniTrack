# Manga mode (desktop)

The Electron app has the Android app's manga mode (11 Oct 2026). The top bar's
**Anime | Manga** switch moves between the two; the mode follows the route
(`/manga…` is manga) and the app reopens in the last one used
(`anitrack.mode` in localStorage).

| Page | Route | What it does |
|---|---|---|
| Home | `/manga` | Hero (top trending), **Continue Reading**, Trending / Publishing / Popular / Top rated / Trending manhwa rows from one AniList request |
| Search | `/manga/search` | Title search plus All / Manga / Manhwa / Manhua, genre, format, status, year and sort; filters live in the URL |
| My List | `/manga/list` | Reading / Completed / On hold / Dropped / Plan to read (local `manga_list` table, same statuses as Android) |
| Updates | `/manga/updates` | Newest chapter of each title in your reading history and list, newest first, with "N NEW" past the chapter you last read; **All / New chapters** filter (see below) |
| Downloads | `/manga/downloads` | Chapters saved for offline reading, grouped by title: progress, **Cancel N**, Retry, Delete, **Read** (see below) |
| Title | `/manga/:id` | AniList details, list status, **Watch the anime** (adaptations, series first), chapters per source with group filter, chapter search, newest/oldest, read markers, mark read/unread, "mark everything before Ch N read", a download button per chapter and **Download range** |
| Reader | `/manga/read` | Full window (no shell); see below |

The top-bar search box searches manga in manga mode (Ctrl+K, live results,
Enter opens Search). An anime's **Continue the story** card opens its manga
in-app ("Read the manga"); **More in print** tiles open their manga pages.

## Sources

The same two sources as Android, in the same order: **MangaDot**, then
**MangaBall**. `Auto` tries them in order and the first with English chapters
wins; a picked source is remembered per title (`anitrack.manga.source.<id>`),
as is the reading group (`anitrack.manga.group.<id>`).

- **MangaBall** — public JSON API (`api.mangaball.com/api/v1`), no check. Pages
  come from its CDN, which wants `https://mangaball.com/` as Referer. The CDN
  host rotates (`bulbasaur.poke-black-and-white.net`, then
  `chikorita.red-and-blue.net` for new chapters in October 2026), so a chapter's
  pages are kept on its most common public HTTPS host, and the image protocol
  fetches MangaBall pages only from hosts the API itself named in this run.
  Chapters are listed with one `POST /chapter/chapter-listing-by-title-id` (One
  Piece's 4,720 uploads in 3.5 s), falling back to the paged
  `GET /title/chapter-listing` if it fails; answers are cached for 5 minutes in
  the main process.
- **MangaDot** — JSON API behind Cloudflare, in the session partition
  `persist:mangadot`. Cloudflare issues its clearance as a partitioned (CHIPS)
  `cf_clearance` cookie, which the browser sends only from a page on
  mangadot.net; main-process `session.fetch` never carries it and was always
  challenged (2026-10-15). API reads and page images are therefore made by the
  verified mangadot.net page itself, from an isolated world
  (`VerifiedPageSession`, as for Miruro). The cookie is never copied or
  re-scoped. When the site shows its check, the page offers **Connect
  MangaDot**: a window on mangadot.net in that partition where the user
  completes the check themselves. AniTrack never solves it.

Chapter numbers are rounded to four decimals when parsed: MangaBall lists both
7.199999999999999 and 7.2 for one chapter (Kagurabachi), which Android's Float
numbers already merge.

Confirmed matches are stored in `manga_match` (AniList id + source → source
title id), like Android's `mangadot_match_*` / `mangaball_match_*` preferences.
Matching rules are the Android ones (tracker link decides; otherwise exact
normalized name + year ±1 + country).

## Reader

- **Layout**: Auto (Japanese titles read right-to-left in pages, everything else
  and long strips scroll vertically), Vertical, Pages ← (RTL), Pages → (LTR).
- **Pages shown** (paged layouts): Auto (two when the window is wider than tall),
  One, Two. Spreads put the cover alone, then pairs; wide scans stand alone;
  **Shifted** pairs from the first page.
- **Page width** (vertical): Narrow 720 px, Medium 960 px, Full. **Background**:
  black, dark gray, white. Preferences: `anitrack.reader` in localStorage.
- **Keys**: ← → turn pages (direction follows the layout), Space / PageUp /
  PageDown, N / P next/previous chapter, F full screen, Esc back to the title.
  Clicking the left or right third turns pages; the middle toggles the bars. In
  page layouts the mouse wheel turns pages too.
- **Controls** fade (and the cursor hides) after 3 s without the mouse moving and
  come back when it moves; never while the settings are open. A **page scrubber**
  along the bottom jumps to any page (it runs right to left in Pages ←); a thin
  progress line stays while the controls are hidden. Reading a downloaded copy
  shows **Downloaded** next to the chapter name.
- Near the end of a chapter (last three pages) the next chapter's page list and
  first pages load, so **Next · Ch N** opens at once; page lists are kept 10
  minutes.
- Progress (page index and page count per chapter) is saved 0.8 s after each
  page change and on leaving, into `manga_reading`; Continue Reading and the
  title page's **Continue · Ch N** read from it.
- A downloaded chapter always opens from disk, wherever the reader was opened
  from, so it reads without a connection.

## Downloads

Like Android's `MangaDownloads`, one chapter at a time, in the order asked for.

- **Per chapter**: the ↓ button on a chapter row (queued spinner, progress ring,
  green when saved, red ↻ to retry a failed one).
- **Download range** (next to the list status on the title page): Next 10 /
  Next 25 / All unread / All presets from the next unread chapter, or From/To
  (half chapters too); a **Group** picker that starts with the group this
  title's downloads already use, else the chapter list's group, else the group
  with the most chapters; **Fill gaps from other groups** (on by default). Each
  chapter number downloads once: numbers already downloaded or queued from any
  group are skipped ("Skipping N you already have"), and a failed try at a
  number is replaced (`planRange`).
- **Files**: `userData/manga_downloads/<anilistId>/<chapter>/` (MangaDot's
  `user:25424` becomes `user_25424`) holds `001.webp`, `002.webp`, … and a
  `meta.json` (title, source title, chapter, pages with sizes, `complete`). The
  meta is written first with `complete: false`; a chapter interrupted by quitting
  comes back as failed ("Download was interrupted"). Page sizes come from the
  source (MangaDot) or the image header (PNG, JPEG without Exif, WebP, GIF), so
  long strips and spreads lay out as they do online.
- **Fetching**: page lists go through the source's `SourceHttp` (spacing, size
  caps, challenge detection); page images use the same headers and session as
  the reader (`fetchPageImage`), three at a time (MangaBall's CDN is slow per
  request: one page took 25 s alone, three in parallel 6 s, on 11 Oct 2026), at
  most 40 MB and 60 s each. One failed page stops the chapter (Retry starts it
  over). MangaDot downloads need the Connect check like reading does.
- **Serving**: `anitrack-manga://local/<anilistId>/<chapter>/<file>`; the handler
  accepts only that shape and resolves the path inside the downloads folder (the
  same traversal check as `anitrack-dl`).
- **Downloads page**: grouped by title with chapters, size and "N in queue";
  **Continue · Ch N** opens the downloaded chapter you're on (or the next one)
  offline; **Cancel N** stops a title's queued and running chapters (finished
  ones stay); the bin deletes a title's downloads after a confirmation, and each
  row's Delete removes one. A removed or cancelled download stops at its next page and
  never re-adds its row (per-chapter generations, as on Android). **Read** opens
  the reader on that title's downloaded chapters only (one per number; the
  opened chapter's group wins), and Back returns to Downloads.

## Updates

The Android **Updates** screen. It checks up to 40 titles: the reading history,
most recent first, then list titles that aren't Completed or Dropped.

- Each title is checked on the source it reads from. Sources are tried in
  order, the one picked on the title's page first; a source with a saved match
  answers with one request through its `SourceHttp` spacing: MangaDot
  `/api/manga/{id}` (`latest_chapter_number`, `last_chapter_date`), MangaBall
  `/title/chapter-listing?…&sort_order=desc&limit=10&language=en` (the newest
  English upload and its `created_at`). MangaBall's `/title/detail` `updated_at`
  isn't used: it is the title's own time and lagged a year behind its chapters
  (Kagurabachi on 11 Oct 2026). When no saved match answers, the title is looked
  up on the remaining sources in turn. Answers are kept 5 minutes; the refresh
  button checks again.
- Four titles are checked at a time; one failing doesn't hide the others.
- **N NEW** is the whole chapters past the furthest one read or marked read
  (`newChapterCount`); "You're on Ch. N" shows that chapter.
- A source that wants its check (MangaDot) is skipped for the rest of the pass
  and the page offers **Connect MangaDot**; after the check the pass reruns.

## How it's built

| Layer | File |
|---|---|
| Types, channel names (`MANGA_IPC`), chapter helpers, spreads, both sources' parsers | `packages/shared/manga.ts` (tests: `tests/manga.test.mjs`) |
| AniList manga queries (feed, search, by id, anime adaptations) | `apps/desktop/main/services/manga/anilist-manga.ts` (uses the shared `gql` queue in `services/anilist.ts`) |
| Source HTTP (host allow-lists, spacing, size caps, challenge detection), MangaBall, MangaDot, Connect window, page-image serving | `apps/desktop/main/services/manga/sources.ts` |
| Reading progress, manga list, saved matches, last chapter read per title | `apps/desktop/main/services/manga/store.ts`; tables from migration v6 in `services/db.ts` |
| Downloads (queue, files, local pages, `local` protocol host) | `apps/desktop/main/services/manga/downloads.ts`; range/meta/image-size helpers in `packages/shared/manga.ts` |
| Updates lookup (`latestFor`: saved match → `latest()`, else find on each source) | `apps/desktop/main/services/manga/sources.ts` |
| IPC handlers (validated arguments; source calls return `SourceResult` so the page can offer Connect / Retry) | `apps/desktop/main/ipc/manga.ts` |
| Page images | `anitrack-manga://img/?s=<source>&u=<url>`: the main process checks the host for that source and fetches it with the source's headers/session; downloaded pages are `anitrack-manga://local/…` |
| Renderer | `renderer/pages/manga/*`, `renderer/components/manga/MangaCards.tsx` and `MangaDownloadUi.tsx`, `renderer/lib/manga-api.ts`, `renderer/store/useMangaReader.ts` and `useMangaDownloads.ts` (download progress arrives as `manga:download-event` messages) |

`window.api.manga` exists only in Electron (the legacy Capacitor shell has no
manga sources), so the switch is hidden there.

## Speed

- The app reopens in manga mode before its first render, so the anime Home
  never mounts (its AniList requests used to run ahead of the manga feed).
- Manga Home paints the last feed at once (`anitrack.manga.feed.v1` in
  localStorage, up to a week old) while a fresh one loads, and warms the title
  page and reader code when idle.
- Title pages: AniList details opened before are kept on disk
  (`manga_cache/anilist-meta.json`, 400 titles, refreshed in the background
  after a day), and each title's chapter list
  (`manga_cache/chapters-<source>-<id>.json`, newest 200 kept) shows at once with
  "Refreshing (list from …)" until the fresh list arrives. When no source
  answers (offline), the saved list stays with **Retry**.
- App-wide: the Outfit font is bundled (`renderer/fonts`, SIL OFL), so the
  window no longer waits on fonts.googleapis.com; `electron-updater` loads right
  before its first check instead of with the main process; the hidden AnimePahe
  window starts 2.5 s after the main window first paints; page transitions are
  0.14 s in, 0.07 s out. Measured on 12 Oct 2026 (QA profile): main code 0.23 s →
  0.10 s, window DOM ready 3.8 s → 1.6 s, Manga Home feed 14 s → instant (fresh at
  4.3 s), title page chapters 4–6 s → 0.2 s, route change 0.5 s → 0.28 s.

Not on desktop yet (Android has them): smart chapter downloads and new-chapter
notifications.
