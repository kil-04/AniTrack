# Manga reading sources (native Android)

AniTrack's manga mode (Home → **Manga**) browses AniList's manga catalogue and
reads chapters in the native reader (`ui/MangaReaderScreen.kt`). Chapters come
from reading sources registered in `MangaSources.all`
(`apps/android/.../data/manga/MangaSource.kt`), tried in order.

**Current registry (user choice, 2026-10-03): MangaDot only.** It has the largest
catalogue, behind a one-time user-completed Cloudflare check.

These are implemented and tested but unregistered:

- **MangaPill** (`data/manga/mangapill/`): most licensed series, no check.
- **MangaDex** (`data/manga/mangadex/`, official API).
- **Comix** (`data/manga/comix/`).

Add one to the list to offer it again.

With more than one source registered, the detail page's **Try another source**
button steps past a wrong or empty match. The choice is remembered per title
(`manga_source_<anilistId>` in the `anitrack_next` preferences).

## Manga mode across the app

The Home **Anime | Manga** toggle sets an app-wide mode (`home_mode` in the
`anitrack_next` preferences, owned by `AppShell`). In Manga mode the shell
switches to manga counterparts of the anime features:

| Anime | Manga mode |
|---|---|
| Top-bar search / quick search (anime) | AniList manga search (live dropdown, "View all" opens Search with the query) |
| Search tab (anime filters) | `MangaSearchScreen`: genre, type (Manga/Manhwa/Manhua/One-shot/Light novel), year, status, sort, "Top rated manga" |
| My List (watch statuses, MAL sync) | `MangaListScreen`: Reading / Completed / On hold / Dropped / Plan to read, stored locally in `manga_list` (no MAL sync yet); "+ Add to list" on each manga page |
| Schedule (airing) | `MangaUpdatesScreen`: newest MangaDot chapter for manga in your list or reading history, marked NEW past your last read chapter |
| Downloads (HLS episodes, Range) | `MangaDownloadsScreen` + `MangaDownloads`: per-chapter ↓ on chapter rows, or **Download range** (below); pages saved under `filesDir/manga-downloads/<anilistId>/<chapter>/` with `meta.json`; read offline (the reader opens local pages first; strips slice from the local file) |
| Time Machine | hidden (anime-specific) |

MangaDot matches are remembered (`mangadot_match_<anilistId>`), so titles reopen
and Updates check them with one small request each (`/api/manga/{id}`:
`latest_chapter_number`, `last_chapter_date`).

## Chapter list and scanlation groups

Sources return every upload, often several groups per chapter number (Tales of
Demons and Gods on MangaDot: 5254 uploads from 14 groups for 1384 chapters). The
detail page lists them like MangaDot's own chapter list:

- **Row layout**: read state (○ unread, ◐ in progress, ● read), `Ch. N`, title,
  🇬🇧, group, page count (`20p`) and upload age (`6d`, `Sep 19`, or `Dec 2, 2024`
  in another year).
- **Group filter**: "All Groups" shows every group's upload as its own row;
  choosing a group shows only its uploads. The list shows each group's chapter
  count, and the choice is remembered per title as `manga_group_<anilistId>`.
- **Search and order**: "Search chapters" matches the chapter number ("34",
  "Ch. 341") or the title. Newest/Oldest sorts by number, then upload time.
- **Paging**: 60 rows show at first, and "Show N more chapters" adds 100.
- **Continue / Start reading** uses the chosen group (or the group with the most
  chapters). Opening a row reads that exact upload. Next/previous chapter then
  follow that upload's group, and other groups fill gaps.
- Reading progress is per chapter number, so switching groups keeps it.
- Some groups put a notice on their aggregator uploads (e.g. a "read on our
  website" page). Opening another group's row for that chapter avoids it.

## Range downloads

**Download range**, next to Continue, queues many chapters at once, like the
anime Range:

- **Presets** start at the next chapter to read: Next 10, Next 25, All unread
  ("All" when nothing is read yet), and All.
- **From/To** take chapter numbers in either order. Half chapters inside the
  range (4.1, 140.5) are included (`MangaChapters.inRange` / `rangePresets`).
- **Group**: the dialog's Group menu (with each group's chapter count) picks
  whose uploads to download (`MangaChapters.rangeChoice`). It starts with the
  group this title's downloads already use, so batches don't mix groups. Without
  downloads it starts with the chapter list's group, or else the group with the
  most chapters.
- **Fill gaps from other groups** is on by default and shown only when needed.
  For chapter numbers the chosen group never uploaded, it takes another group's
  upload (the group with the most chapters first). Turned off, those numbers are
  left out. The dialog lists them either way.
- **One copy per chapter**: each number downloads once. Numbers already
  downloaded or queued from any group are skipped ("Skipping 3 you already have
  (from Vortex Scans)"). A failed try at a number is replaced.
- **Summary**: how many chapters, and roughly how many pages (from the source's
  page counts).
- **Offline reading** (Downloads → Read) also moves through one upload per
  number, preferring the opened chapter's group.
- **Order**: chapters download one at a time, in reading order.
- **Cancel N** on the Downloads tab removes a series' queued and in-progress
  chapters. Finished ones stay.
- **Stopping**: a cancelled or deleted download stops at its next page and
  removes its partial folder. Each queued request carries a generation, so a
  stopped download never re-adds its row.

## Long-strip pages

Many manhua/manhwa uploads are a single tall image, for example 800×12271 or
1200×16848 (109 of Tales of Demons and Gods' uploads are 1–2 pages). One bitmap
that tall exceeds the GPU texture limit and renders blank ("Failed to allocate a
hardware bitmap").

`PageStrips` handles any page taller than 4096 px or 3:1:

- It downloads the image once to a bounded cache (`cacheDir/manga-strips`, 40 MB
  per image, 300 MB total, LRU).
- The reader shows it as 2048-row slices decoded with `BitmapRegionDecoder` only
  while on screen, so pages stay sharp and memory stays bounded.
- A strip counts as read once its last slice is shown.
- Pages of unknown size are capped by Coil to 8192 px tall. The Comix connector (`data/manga/comix/`, see
`comix.md`) is implemented but not registered until it is verified on a device.

MangaPill and MangaDex follow the default rule in `connector-contract.md`:
bounded data is parsed, no site script runs, and no WebView is involved.
MangaDot follows the AnimePahe pattern: the user passes Cloudflare in a WebView,
then native requests reuse that session (details below).

## Shared rules (`data/manga/MangaHttp.kt`)

- Catalogue requests go only to each source's fixed hosts, serialized with a
  minimum spacing, through DNS that refuses local-network answers. Redirects
  must stay on those hosts. Bodies are capped (4 MB).
- 429, 403/503 and challenge pages stop the attempt with a message. There is no
  retry loop, cooldown bypass or CAPTCHA handling.
- Page-image URLs must be HTTPS public names: no credentials, IP literals,
  local names or (except MangaDex@Home) non-443 ports.
- Headers on a `MangaPage` apply to that exact image request only.
- User agent: `AniTrack/<version> (Android)`. MangaDex forbids spoofed browser
  user agents, and MangaPill serves it normally.

## MangaDot

mangadot.net (inspected 2026-10-02 on the tablet) is a React Router app with a
plain JSON API. It mirrors comix.to's catalogue (`source_url`), which is why it
is large: Solo Leveling, Omniscient Reader to chapter 311, and Tales of Demons
and Gods with 1384 chapters, where MangaPill and MangaDex have few or none.

- **Cloudflare**: every page and API request without a session gets a managed
  challenge (`403`, `cf-mitigated: challenge`). Images are not challenged.
- **Connection**: `MangaDotConnectActivity` shows mangadot.net in a normal
  WebView with its genuine user agent. Cloudflare's check usually passes by
  itself there. If it shows "Verify you are human", the user ticks it;
  AniTrack never does. The screen then calls the API with the session and closes
  with `RESULT_OK`. It allows only mangadot.net and challenges.cloudflare.com:
  analytics and ads are blocked, and popups, permissions and file access are
  denied. The `cf_clearance` cookie lasted about a year (8760 h) on 2026-10-02.
- **API requests** (`MangaDotSource`) carry the default WebView user agent and
  only mangadot.net's own cookies from `CookieManager` (Cloudflare binds the
  session to that user agent). A challenge response raises
  `MangaVerificationRequired`. The detail page then falls back to the next
  source, shows **Connect MangaDot** with a one-line explanation, and reloads
  after a successful connection. There is no automatic retry and no hidden or
  automatic solving.
- Endpoints:
  - `GET /api/search/suggestions?q=…&limit=8` returns `{suggestions:[{id,title,…}]}`.
  - `GET /api/manga/{id}` returns `{manga:{anilist_id, mal_id, year, country_of_origin, alt_titles,…}}`.
  - `GET /api/manga/{id}/chapters/list` returns every upload: `[{id, chapter_number,
    chapter_title, language, group_name, page_count, source: user|scraper}]`.
    This can exceed 2.5 MB; it is capped at 16 MB.
  - Page lists: `GET /api/uploads/{id}/images` (source `user`) or
    `/api/chapters/{id}/images` (source `scraper`). Both return `{images:[{url:"/chapters/…webp", w, h}]}`.
    The reader page also calls `/api/token/generate`, but the page lists do not
    need it, and AniTrack never calls it.
- Matching: up to 5 suggestions per query (English, then romaji) are checked
  against `/api/manga/{id}`. Accepted when `anilist_id` equals the AniList id
  (or `mal_id` when there is no AniList link). A conflicting link rejects the
  title. Unlinked titles need an exact normalized name (title or alt title) plus
  the same year (±1) and country.
- Chapter ids keep their source (`user:25424`) because ids are per source.
  Only English uploads with pages are listed. Each upload keeps its group and
  page count, for the group pickers.

## MangaPill

Public HTML, inspected 2026-10-02:

- Search `https://mangapill.com/search?q=<title>`: result links
  `/manga/{id}/{slug}` with `class="mb-2"`. The link holds the title
  (`font-black`) and comma-separated alternative names (`text-secondary`).
  Type/year tags follow (`bg-purple-500` = manga/manhwa/manhua/novel,
  `bg-orange-500` = year).
- Title page `/manga/{id}/{slug}`: chapter links
  `/chapters/{id}-{code}/{slug}` with text `Chapter N`. Code is
  `10_000_000 + N * 1000` (140.5 → `10140500`).
- Chapter page: `<img class="js-page" data-src=… width=… height=…>` per page.
  The image host (currently `cdn.readdetectiveconan.com`) answers 403 without
  `Referer: https://mangapill.com/`, which is the only page header sent.

Matching (`MangaPillParser.score`) requires an exact normalized name match (case,
spacing, punctuation and accents ignored) between AniList's English/romaji
titles or synonyms and MangaPill's title (3 points) or an alternative name
(2 points). Year adjusts the score: +2 same, +1 off by one, −4 otherwise. Type
adjusts it: +1 matching, −10 comic versus novel, −1 other mismatch. At least 3
points and a unique best score are required; ties match nothing. English is
searched first, then romaji. Checked against 24 popular titles: correct for all
MangaPill carries; light novels never match their comic adaptations.

## MangaDex

Official API (<https://api.mangadex.org/docs/>):

- Search `/manga?title=…`. A title is accepted **only** when MangaDex links it to
  the AniList id (`links.al`) or MAL id (`links.mal`). Never by name alone.
- Chapters `/manga/{id}/feed` with English, no external, empty or future
  chapters, paged 500 at a time (up to 5000). `isUnavailable` chapters are
  skipped. Unnumbered chapters are kept only when a title has no numbered ones.
- Pages `/at-home/server/{chapterId}` → `{baseUrl}/data/{hash}/{file}`
  (original quality). A base URL is guaranteed for 15 minutes; the reader
  swaps in a fresh node after 13 minutes or after a node failure. At most 35
  page-server lookups per minute (MangaDex's limit is 40).
- MangaDex@Home reporting: every image load from a `*.mangadex.network` node is
  reported to `https://api.mangadex.network/report` (url, success, bytes,
  duration, `X-Cache` hit) by `MangaDexHomeReporter`. It is an OkHttp interceptor
  on Coil's client (`WebsiteSessionApplication.newImageLoader`). Loads cancelled
  by scrolling are not reported as failures. `mangadex.org` hosts are never
  reported.
- Coverage: many licensed series have few or no readable English chapters
  (2026-10-02: Steel Ball Run 95 chapters, Omniscient Reader 4, Solo Leveling 0).
  A feed chapter can still return 404 from at-home; the reader then says the
  chapter is no longer available.

## Validation

```text
apps\android\gradlew.bat -p apps/android :app:testDebugUnitTest :app:assembleDebug --console=plain
```

Unit tests: `MangaDotParserTest`, `PageStripsTest`, `MangaPillParserTest`, `MangaDexParserTest`,
`MangaDexHomeReporterTest`, `MangaUrlPolicyTest`, `MangaSourcesTest`,
`MangaChaptersTest`, `MangaTest` (synthetic fixtures only).

Device check on the SM-T735 debug build (2026-10-02), all passing:

- Manga search.
- Spy x Family via MangaPill: chapter 1 → 2 → 3, resume at the saved page,
  Continue Reading row.
- Steel Ball Run via MangaDex.
- Frieren source switch and switch back.

The debug-only `ComixMangaActivity` opens any title:

```text
adb shell am start -n com.sanjay.anitrack.next.debug/com.sanjay.anitrack.next.diagnostics.ComixMangaActivity --ei manga_id <anilistId>
```

MangaDot on the tablet (2026-10-03):

- Spy x Family, Solo Leveling and Omniscient Reader matched; reading works.
- First use without a session falls back to MangaPill and shows Connect.
- Connect passed Cloudflare by itself and closed; the list reloaded "via MangaDot".

The debug-only `MangaDotProbeActivity` (exported in debug builds only) helps re-inspect the site:

```text
adb shell am start -n com.sanjay.anitrack.next.debug/com.sanjay.anitrack.next.diagnostics.MangaDotProbeActivity [--es path /manga/99]
adb shell am start -n …/com.sanjay.anitrack.next.diagnostics.MangaDotProbeActivity --ez native true   # API status with the session (logs no cookies)
adb shell am start -n …/com.sanjay.anitrack.next.diagnostics.MangaDotProbeActivity --ez forget true   # drop the debug app's clearance
```

It enables WebView remote debugging (debug builds only), so pages can be
inspected over `adb forward tcp:9444 localabstract:webview_devtools_remote_<pid>`.

If a source breaks, re-inspect its markup/API shape against this runbook before
changing parsers. Do not add retries, rotate identities or bypass a challenge.
