# Novel Phoenix (novel source) — 2026-11-11

Third novel source, on desktop and Android, with downloads. Chosen by the user on
10 Nov 2026 from a re-check of the earlier survey (`source-survey.md`, "Novels").

## Why this one

Checked 10 Nov 2026 with AniTrack's honest user agent, plain GETs only:

| Site | Finding |
| --- | --- |
| **Novel Phoenix** (`novelphoenix.com`) | NovelFire's new home: `novelfire.net` chapter addresses now redirect there (through `readnovel.site`). Large and current (Shadow Slave at chapter 3,242, updated the same day). **Added.** |
| NovelCool | Novels stopped updating around 31 July 2025 (Shadow Slave, Supreme Magus, The Mech Touch all frozen); most of the catalogue is manga; searching Overgeared or Lord of the Mysteries finds only the manga. Not added. |
| WuxiaClick (`wuxia.click`) | Current, structured page data (`__NEXT_DATA__`) with a machine-translation flag; some titles have no author. Offered, not picked this round. |
| Wuxia Box | Behind (Shadow Slave 1,736 chapters). |
| Novelito | Gone (parked page). |

## How the site is read

No JSON API: every page is server-rendered HTML, read with small patterns in
`packages/shared/novel.ts` (Android twin: `NovelPhoenixParser` in
`data/novel/Novel.kt`). Nothing from the site is rendered as markup.

| Operation | Address |
| --- | --- |
| Search | `/search?keyword=<q>&page=<n>` (20 per page) |
| Browse | `/genre-<slug or all>/sort-<popular, new, latest-release>/status-<all, ongoing, completed>/all-novel?page=<n>` (24 per page; any other sort falls back to new) |
| Title | `/novel/<slug>` (author, rating, chapter count, status, genres, summary, latest chapter) |
| Chapter list | `/novel/<slug>/chapters?page=<n>`, 100 per page, with the total and the page count |
| Chapter | `/novel/<slug>/chapter-<position>`; the text is the `#content` block that carries `data-chapter-id` |

- **Ids.** A title's id is its address slug (lower-case letters, digits, hyphens; up
  to 91 characters seen, 120 accepted). A chapter's id is its 1-based position; its
  label is only shown ("Chapter N: Title", or the site's title alone when that already
  names the chapter, e.g. "Chapter 1.5: An Interlude" at position 2).
- **A missing chapter** answers HTTP 200 with a "Page Chapter Not Found" title and a
  layout `#content` block without `data-chapter-id`.
- **No alternative names** and no machine-translation flag on this site. Copies link
  to other sources by title and author as usual.
- **Covers** (`/server-1/<slug>.jpg`) load without a Referer.

## Request rate

The site refuses bursts with HTTP 429: three chapter-list requests side by side were
refused within about ten seconds, and so were roughly a dozen requests in thirteen
seconds from two queues. One request every two seconds ran 33 pages without a
refusal. So every request to the site (reader, chapter-list fill, downloads, update
checks) draws on **one budget**: three at once, then one every two seconds
(`RequestPace` in `main/services/novel/pace.ts`, `NovelPace.kt` on Android). What's
on screen goes first, then the chapter-list fill, then downloads and update checks.

## Long chapter lists

A page answers in about a second, so a 3,242-chapter list is 33 requests (about a
minute at the safe rate). To keep the title page quick:

- The first visit reads page 1 and, when more than three pages remain, shows the
  whole list at once with "Chapter N" standing in for the names not read yet. Every
  chapter can be opened already (ids are positions). The rest is read in the
  background and the names swap in; the title page says so while it runs.
- A fill refused with 429 waits (the site's `Retry-After`, else 30 s) and carries on,
  up to four times; pages already read are kept for 30 minutes, so the next visit
  continues instead of starting over.
- Later visits re-read only the last saved page and anything after it (new chapters).
  A saved list older than a week is read again in full.
- Desktop: `novelChapters` / `novelChaptersComplete` in `main/services/novel/sources.ts`,
  IPC `novel:chapters` (`partial: true`) and `novel:chapters-complete`. Android:
  `NovelSources.chapters` / `chaptersPartial` / `chaptersComplete`.

## Files and sync

- **File names.** Ids were hex-encoded for file and folder names; the hex of a
  120-character slug would overrun Windows' path limit. A long id keeps the first 64
  hex characters and ends in 32 characters of its SHA-256 (`names.ts`, `NovelNames.kt`,
  same result on both). Every NovelBuddy and NovelArchive id is named exactly as before.
- **Sync.** An app from before Novel Phoenix refuses a whole sync file holding a row it
  can't validate. So later sources' rows live under a new `"more"` section of
  `anitrack-novel-sync.json` (same four parts); the first sections stay exactly as
  they were, and older apps ignore `"more"` and keep syncing the sources they know.
  Rows of a source this version doesn't know are kept and written back untouched, so
  the next source needs no format change. Known limit: an older app's upload drops
  `"more"` from the gist; an updated device puts it back on its next sync.

## Verified

- **Checks:** `npm run typecheck`, `npm test` (642 tests), `npm run build`,
  `npm run android:next:test`, `npm run android:next:debug`.
- **Desktop (isolated QA copy, 11 Nov):** search and browse; Lord of the Mysteries'
  title page; its 1,432-chapter list shown in 1.3 s with stand-in names, a chapter
  opened while they loaded, all names in after 24 s with no refusals; four chapters
  downloaded; with every request sent to a dead proxy, the saved title page and a
  saved chapter opened in the reader and an unsaved chapter failed with the
  connection message. Shadow Slave on NovelBuddy linked itself to the Novel Phoenix
  copy (same author); Overgeared, which the site lacks, offered candidates to pick.
- **Android (debug app on the Tab S7 FE, 11 Nov):** title page with the three source
  chips and the "names are still loading" note; two chapters downloaded
  (`novelphoenix-<hex>/c-31.json`, `c-32.json`); a saved chapter opened in the reader;
  no crashes in the log. Earlier NovelBuddy and NovelArchive downloads kept their
  folder names.
- **Not done:** reading a saved chapter on the tablet with its network off (that
  needs airplane mode on the device); a two-device sync run with real accounts; the
  phone layout.
