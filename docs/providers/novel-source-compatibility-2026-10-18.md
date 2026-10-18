# Novel source compatibility — 2026-10-18

Status: investigation done; **Novels mode implemented** on desktop and Android with
NovelBuddy and NovelArchive (see "Implementation" below). LNORI deferred.

Scope: evaluate LNORI, NovelArchive and NovelBuddy for Japanese light novels and
web novels such as Overgeared. This is a bounded public-interface check from a
Windows host, not an Electron/Android end-to-end certification.

## Recommendation

Add a **Novels** content type supporting both volume-based light novels and
chapter-based web novels. Use separate source adapters and a prose reader.
NovelBuddy is the primary web-novel source (complete chapter list, JSON chapter
text); NovelArchive is the second, user-selectable source. LNORI is a useful
Japanese LN supplement, conditional on illustration delivery.

## Method and limits

- Anonymous, bounded HTTP GETs of public catalogue metadata, shipped scripts,
  and a small reading sample; selected image HEAD/GET checks.
- Static REA analysis of captured JavaScript; scripts were not executed as a
  substitute for browser testing. No challenge bypass or account operations.
- Earlier sandbox DNS failures were environmental: the scoped public requests
  succeeded with approved network access. They do not establish site downtime.
- No full-library crawl or bulk book download. Sample chapter text was reduced
  to structural observations and a digest; it is not included in this report.
- Website JSON endpoints are observed implementation details, not promised,
  versioned developer APIs. Completeness, translation quality, rate limits,
  regional access and long-term stability remain unverified.
- Actual Electron/native Android loading, rendering and resume remain untested.
  Platform fit below is an architectural inference from the sampled responses.

## NovelArchive

**Verdict: technically viable for a first web-novel adapter; numbering and
content-quality checks are required.**

Observed public interface, all sampled API responses HTTP 200:

| Operation | Observed route / result |
| --- | --- |
| Search | `GET https://novelarchive.cc/api/novels?search=Overgeared&fuzzy=1&limit=5` |
| Details and contents | `GET /api/novels/6a1637414f942c668d69a5a9` |
| Read sample | `GET /api/novels/6a1637414f942c668d69a5a9/chapters/1?prefetch=1` |
| Small catalogue probe | `GET /api/novels?limit=1`; response pagination reports 110,007 records |

The catalogue total includes AI-generated entries by default and is not a
verified count of distinct, complete or professionally translated novels. Search
also returns fanfiction, so match the author, aliases and synopsis, not title
alone. The exact Overgeared result names **Park Saenal / 박새날**, aliases OG,
Temppal and 템빨, and reports completed status with 2,060 contents entries.

Details return `{novel: ...}` with `chapter_names`; search returns `novels`,
`pagination`, `filters` and `search_info`. The shipped `api.js` supports page and
per-page options, along with search/fuzzy filtering. Only the small first search
page was live-tested, not every pagination/filter combination.

The reading response has `novel`, `chapter` and `navigation` objects. The
sample `chapter` contains `number`, `name`, and plain-text `content`: 20,535
characters, 167 newline-delimited lines, no matched HTML tags, and an introductory
note/prologue. Navigation reports previous null, next 2. The site's own client
documents `prefetch=1` as omitting view-count updates and the full names list.
No sign-in, supplied token, browser cookie warm-up or challenge was required for
these reads. This does not guarantee other routes or future requests behave so.

### Numbering finding

The site's `novel-page.js` uses `namesToItems()` to map each name to **index + 1**
as the request number. This is distinct from its display label:

- Request position 770 is labelled `Chapter 769.5`.
- There is a `Chapter 1733 (Teaser)` label.
- The labels jump from `Chapter 2008` at position 2009 to `Chapter 2010` at
  position 2010. No label `Chapter 2009` exists in the returned list.

Thus 2,060 entries do not establish full chapter coverage. The absent label is
observed; actual missing story content is not proven without further review.
Persist source request position, display label and ordering separately. Never
pass a parsed label directly to this reading endpoint or silently transfer
numeric progress between sources.

The `/sources` response returned two source identifiers, but alternate-source
chapter lists/content were not tested. Their presence does not prove equivalent
coverage or a safe fallback. Chapter-stats keys reflect activity, not a complete
contents inventory.

Public title: <https://novelarchive.cc/novel?id=6a1637414f942c668d69a5a9>

## LNORI

**Verdict: viable Japanese LN text source; illustration support is currently
conditional on a delivery failure being resolved/rechecked.**

- `GET https://lnori.com/library`: HTTP 200; 884 series cards in the fetched
  catalogue. No Overgeared title among those cards; this is a bounded absence.
- `GET https://lnori.com/series/4557/classroom-of-the-elite`: HTTP 200; 30 book
  links, numeric series/book IDs, and explicit AniList, MAL and RanobeDB links.
- `GET https://lnori.com/book/44651/classroom-of-the-elite-year-2-vol-12-5`:
  HTTP 200 without supplied authentication; a whole volume in server HTML,
  2,647 paragraphs, 18 image elements and 15 headings. Reading content is under
  `article.content-body`, divided into `section.chapter` elements with IDs and
  table-of-contents anchors.
- The shipped library script searches title/author locally over HTML catalogue
  cards and represents search in the URL hash. The metadata-advertised
  `/library/search?q=...` route returned 404 for both sampled titles; do not use
  it as a search API. Cache and search the catalogue metadata instead.
- A sampled illustration, `https://img.lnori.com/44651-01.jpg`, returned HTTP
  **530**, body error **1016**, on GET; JPG and AVIF HEAD probes also returned
  530. This proves failure for that sample at check time, not every image or
  region. Targeted reader-script inspection found JXL/AVIF/JPG variants on the
  same host and no alternate illustration host.

Classroom of the Elite resets volume numbers across school years and includes
fractional volumes. Preserve numeric book ID, full title/year grouping and
source order. Do not identify or sort all books by a parsed volume number.
Fetch a selected volume once, split by its sections locally, and save a locator
containing book + section + paragraph position. Preserve illustrations and
inline formatting through sanitization. Do not fetch the complete volume again
for each section. Explicit metadata links are useful matching evidence, though
the semantic equivalence of every mapping has not been verified.

## NovelBuddy

**Verdict: best first web-novel source.** All reads are public JSON on
`api.novelbuddy.me`, no cookies, sign-in or challenge (rechecked 2026-10-18 with
AniTrack's honest user agent).

| Operation | Route |
| --- | --- |
| Search / browse | `GET /titles/search?q=&genres=<slug>&status=&sort=&page=&limit=` (`sort` ∈ newest, rating, views, popular, bookmarks, chapters, comments, latest, added_date, views_today, views_7days, views_30days; `type=korean` etc. also filters) |
| Home rows | `GET /titles/home` → `trending`, `popular`, `latest.items` |
| Details | `GET /titles/<id>` → `data.title` (authors, alt names, genres, newest 50 chapters only) |
| Chapter list | `GET /titles/<id>/chapters` → all 2,060 Overgeared entries, newest first |
| Chapter text | `GET /titles/<id>/chapters/<chapterId>` → `data.chapter.content` (HTML `<p>` prose), `next_chapter`, `previous_chapter` |

- Overgeared (`WAY3LXDy`): every integer label 1–2059 plus "Chapter 769.5"; IDs
  unique and case-sensitive. `number` is a position (769.5 is 770), not the label.
- The home `latest` row and many search hits are machine translations
  (`is_mtl`, or a `MTL-` title prefix); there is no server-side filter, so the
  apps hide them by default and offer "Show machine translations".
- Detail `status` can be stale ("OnGoing" for a finished series).

## Implementation (2026-10-18)

Novels live inside Manga mode: the main switch stays **Anime | Manga** and a
small **Manga · Novels** choice sits under it (a three-way switch was too long).
The Manga switch reopens whichever kind of reading was used last.

- Shared parsers: `packages/shared/novel.ts` (tests `tests/novel.test.mjs`);
  Android port `data/novel/Novel.kt` (tests `NovelTest.kt`). Chapter HTML is
  reduced to plain paragraphs; no source markup is ever rendered.
- Identity is source-first: `(source, source title id)`, because many web
  novels (Overgeared included) have no AniList NOVEL entry. Chapter request ids
  are stored apart from labels and positions; NovelArchive ids are list
  positions, never parsed labels.
- Desktop: `main/services/novel/{sources,store,downloads}.ts`, `main/ipc/novel.ts`,
  SQLite v7 tables `novel_reading` / `novel_list` and v8 `novel_title`, pages
  under `renderer/pages/novel/` (`/novels`, `/novels/search`, `/novels/list`,
  `/novels/downloads`, `/novels/t/:source/:id`, full-window `/novels/read`).
- Android: `data/novel/{NovelSources,NovelStore,NovelReading,NovelDownloads}.kt`,
  DB v10/v11 tables of the same names (all three in backup/restore),
  `ui/NovelScreens.kt`, `ui/NovelDownloadUi.kt` and `ui/NovelReaderScreen.kt`.
- Reader: night/dusk/sepia/paper themes, serif/sans, size, line spacing and
  column width; resume by first visible paragraph; next chapter fetched ahead;
  chapter list panel; keyboard ←/→ on desktop.

### Linked sources (one title page per novel)

The two sources number the same novel differently (NovelArchive's Overgeared has
"Chapter 1733 (Teaser)" and no "Chapter 2009"), so positions are never shared.
Instead:

- `novel_title` remembers each source copy a title page fetched, with a
  `novel_key` (the first copy's `source:id`). Copies with the same name **and**
  author (`sameNovel` = "yes") are linked automatically; the title page's source
  chips find the other copy (search by title, then a romanised alt name), link it
  when sure, or show candidates to pick. "Unlink" undoes a wrong match.
- Progress stays stored per source copy, but is read for the whole group and
  matched by `chapterKey(label)`: the number (plus volume, "part N", "teaser"),
  never the position. Continue on another copy resumes the same label at the same
  fraction through the chapter; a label that copy lacks continues after its nearest
  earlier chapter. The list status is one entry per novel; Continue Reading shows
  one card per novel.

### Downloads

- One background worker saves one chapter at a time as small JSON files (desktop
  `userData/novel_downloads/`, Android `filesDir/novel-downloads/`, ids
  hex-encoded because NovelBuddy ids are case-sensitive). The reader opens a saved
  copy first, so saved chapters read offline; the title page falls back to the
  metadata saved with the download.
- Background work (downloads, update checks) uses a second, slower request lane
  per source (900–1000 ms spacing) so it never queues ahead of the reader. Three
  failures in a row, or a 429, stop that title's queue instead of retrying.
- Title page: next 10 / next 50 / everything from here / every chapter / a
  position range, Stop, Remove all; saved marks per chapter; a Downloads page and
  tab list sizes and live progress.

### Home

Hero carousel of the top trending novels with their blurbs (Continue when one is
in progress), Continue Reading with "+N new" when a source added chapters since the
list was last shown (`seen_count`, not the unread backlog), genre shortcuts into
Search, and rows: Trending, Recently updated, Fan favourites (most bookmarked),
Most read, Finished series.

### Cross-device sync

Novel progress, the list and linked sources sync between desktop and Android
through the same private gist as Continue Watching, in their own file
`anitrack-novel-sync.json` (older app versions never touch it). Rules:
`packages/shared/novel-sync.ts` (tests `tests/novel-sync.test.mjs`) and its twin
`data/novel/NovelSyncMerge.kt` (`NovelSyncMergeTest.kt`); each test suite parses
the other app's exact output.

- Rows are per source copy and merge newest-wins; removals (Continue Reading
  "X", marking unread, leaving the list) are tombstones that hide rows not newer
  than them for 90 days. They wait in `novel_sync_removed` (desktop v9, Android
  v12) until an upload carried them. A read mark is never dated under a known
  removal of that chapter, or the next sync would undo it.
- Links merge by `link_at` (the time a copy was linked or unlinked). The novel's
  key is always its smallest copy key, so two devices linking the same copies
  agree. The "N new" baseline (`seen_count`) merges by maximum.
- A file the parser can't read is never overwritten; rows the other device would
  refuse are never uploaded.
- Desktop runs it in the renderer (`renderer/lib/novel-sync.ts`) on Novels Home,
  title pages and the list, after reading, and from Settings' Pull/Push; Android
  in `GistSync.syncNovelReading()` from the same places and "Sync now".
- Verified 18 Oct with an isolated desktop copy whose `fetch` to api.github.com
  was faked in the page (nothing left the machine): another device's progress,
  link and list status arrived; a local removal uploaded tombstones for both
  linked copies. Tablet: DB upgrade to v12 and removal bookkeeping checked on the
  debug app (it has no gist token, so it never uploads).

- Not yet: MAL/AniList sync for novels, update notifications, LNORI.

Verified 18 Oct: desktop in an isolated Electron QA copy (Overgeared auto-linked
across sources; NovelBuddy Chapter 1734 at 50% resumed on NovelArchive's
"Chapter 1734" (entry 1,735) at paragraph 52/104; 5 chapters downloaded and read
with the network blocked; Home carousel and genre rows); Android debug build on the
Tab S7 FE (mode switch, Home, genre shortcut, linking from the NovelArchive chip
with progress carried over, download dialog, live progress, Downloads tab).
Offline reading on the tablet was not tested (it needs airplane mode).

## AniTrack implementation fit

The maintained apps are Electron/TypeScript and native Android/Kotlin. Follow
`docs/architecture/project-structure.md` and `docs/providers/connector-contract.md`:
desktop network/parsing code belongs in the main process behind typed IPC;
Android needs its own native adapter. Share declarative capabilities, fixtures
and contract semantics rather than trying to execute one TypeScript adapter on
both platforms.

Existing manga models return image pages (`packages/shared/manga.ts` and Android
`data/manga/MangaSource.kt`). Android's chapter normalization groups by a float
number. Reusing that normalization would lose distinctions between volumes,
editions, prologues and repeated chapter numbers.

Suggested minimum novel contract:

1. Search and source-title details, including author, aliases, language/content
   kind, optional external metadata IDs and explicit source identity.
2. Ordered contents with opaque source locator, display label, optional volume
   grouping, optional parsed number, and completeness/pagination state.
3. Reading documents with sanitized text/HTML blocks, headings, inline formatting,
   images and stable anchors. Strip scripts, event handlers and unrelated UI;
   resolve allowed relative media URLs without executing source scripts.
4. Source-specific progress: title/edition/book/section identity plus block or
   paragraph position. Confirm mappings when switching sources; never assume
   equal chapter numbers mean equal content.
5. Local library identity independent of any one metadata catalogue, with optional
   AniList/MAL/RanobeDB IDs. Novel/volume progress must not accidentally update a
   manhwa adaptation's reading record.

### Next implementation and acceptance work

1. Implement the novel model and text reader with font size, line spacing,
   themes, chapter navigation and durable local resume.
2. Add one web-novel adapter; verify Overgeared title/author matching, full
   contents pagination, decimal/teaser labels and the observed numbering gap.
3. Add LNORI's volume adapter and recheck illustration delivery; expose a useful
   missing-image state if a host is unavailable.
4. Add the second web-novel source as a user-selectable alternative with explicit
   source mapping, then bounded offline reading and update checks.
5. Test in real Electron and native Android: text and images, CJK/ruby/emphasis,
   restart resume after font changes, failed-network recovery and source switching.
   Use small structural/synthetic fixtures for parsing edge cases, not full books.

## Evidence index

Ignored local probe artefacts are under
`out/tmp/novel-compat-20261018/{novelarchive,lnori,novelbuddy}/`.

- NovelArchive live observations: `overgeared-search.json`,
  `overgeared-details.json`, `chapter-probe-summary.json`, `catalogue-count.json`;
  static scripts `api.js`, `nav-search.js`, `index-home.js`, `novel-page.js`.
- NovelArchive REA initial bounded capture: parent
  `ev_3878851225152594118ff0a292af38b44a81648852a87f45777ccaeba1560e3c`, summary
  `ev_651c70ce34ed6561b752cde3252949e831580c41a4447f0089d7026415686206`.
  Four captured JS files parsed without failure. Later title-page script was
  inspected directly; it was not part of that initial REA capture.
- LNORI independent findings: `lnori/REPORT.md`, `reader-structure.json`,
  `image-probe.json`, `classroom-book-urls.txt` and captured catalogue/scripts.
- LNORI REA library parent
  `ev_071177b145589b47cdafa95d6385cc29eaa37ad8728048124d63c7ec3a586a7b`;
  reader parent
  `ev_92be2f4b4c6411a36a465a67f98ddda417e5927fef2ea8877cf2330bfc375797`.
  All sampled inline scripts parsed; dynamic behavior remains untested.

Investigation coverage: search, identity, contents and sample text examined;
LN illustration sample failed; production runtime compatibility and exhaustive
catalogue/content quality remain unresolved acceptance work. No build or unit
tests were run because this change only records the investigation.
