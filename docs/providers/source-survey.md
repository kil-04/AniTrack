# Source survey: EverythingMoe candidates (12 Oct 2026)

For the latest large-library research, see
[Large anime catalogs: deeper comparison](large-anime-catalogs-2026-10-20.md).
The earlier dated verdicts below are historical; the later findings supersede
them where access, matching or research constraints changed.

The user asked for anime and manga sources with large libraries from
<https://everythingmoe.com/>, inspected with REA. This records what each
candidate exposes as of 12 Oct 2026, from the user's network (India). Nothing
here is implemented yet.

## Method and limits

- EverythingMoe's index is server-rendered. Each entry's pros and cons, including
  its library-size label, come from `/data/expand/<slug>.json`.
- Each candidate got: one homepage request (reachability, Cloudflare);
  REA 6.4.0 `analyze-web-bundle` over CDP (a throwaway headless Chrome);
  a CDP network log of title, chapter and watch pages; then a plain-HTTP replay
  of the calls with AniTrack's honest user agent (`AniTrack/8.0.0 (Android)`).
- REA's MCP connection timed out this session, so the REA CLI was used.
  Sites that put Cloudflare's interstitial in front of headless Chrome only
  yield the interstitial to `analyze-web-bundle`. For those, the public bundle
  was downloaded and read statically (`analyze-javascript-application`).
- Boundaries, as for every connector: no Cloudflare/Turnstile solving, no
  reversing of request signers, response or image decoders, or obfuscated
  stream tokens, and no third-party player or ad embeds
  (`connector-contract.md`). A site that needs any of these is marked
  "not usable", without investigating the protection itself.

Already in AniTrack: Anikoto, AnimePahe, MangaDot, MangaBall. Dropped earlier:
Miruro (encrypted API), MKissa (ISP blocks, captcha), Comix (signed requests,
encrypted responses, scrambled images; MangaDot mirrors its catalogue).

## Anime

| Site | EverythingMoe | Catalogue | Video | Verdict |
| --- | --- | --- | --- | --- |
| **anv** (anv.to) | Large library, very new | Open JSON | Own HLS, session cookie | **Usable** |
| Re:Anime (reanime.to) | Medium-large, #1 | Open, AniList-keyed | flixcloud embed, obfuscated one-time token | Not usable |
| ani.pm | Large | Open, AniList-keyed | Third-party `embed.settlar.io` (403 to headless) | Not usable |
| AnimeX (animex.one) | Large, scraper | Open REST | Stream host blocks non-browsers; player builds encoded proxy paths | Not usable |
| aniwaves.ru | Very large | Runs on `wss://anikoto.to/wsanime` | Anikoto clone | Redundant |
| AniSnatch | Large | Cloudflare challenge to non-browsers | Reuploads AnimePahe | Low value |

AniZone, Senshi, KickAssAnime, Anime Nexus, AnimeOnsen and Anify are rated
small or medium by EverythingMoe and were not inspected.

### anv: the recommended anime source

- `POST /api/catalog` `{"operation":"AnimeDetail","variables":{"slug":"<slug>"}}`
  returns title details. Watch pages are `/anime/<slug>-<5hex>-episode-N`.
- `POST /api/episode` `{"anilistId":N,"malId":N|null,"episode":N,"first":true,"prefer":"sub"|"dub"}`
  takes **real AniList ids** (titles missing from AniList get ids above 1e9).
  It returns `{status:"ready", variants:[{id:"sub"|"dub", sources:[{url, type, tracks}]}]}`.
  Sources are `/stream/<token>/index.m3u8?k=…`; tracks are VTT subtitles
  (Crunchyroll subs in about ten languages).
- It needs the `shiro_watch` cookie, which a watch page sets with an ordinary
  `Set-Cookie` (HttpOnly, 24 h). Without it the endpoint answers 403
  `{"status":"unavailable","reason":"forbidden"}`.
- The HLS master offers 1080p/720p/480p from anv.to, with the session cookie
  and Referer. There is no `EXT-X-KEY`. Segments are TS behind a PNG header:
  the "disguised segment" layout the desktop player already handles.
- Coverage check: AniList 1, 21, 30, 457, 1535, 11061 and 170942 were all ready
  with 3 sub and 3 dub sources each, in 1–8 s (the first request for a title is slower).
- Risk: EverythingMoe calls it "very new"; it was formerly Shiro.

## Manga

| Site | EverythingMoe | Access (honest UA) | Images | Tracker ids | Verdict |
| --- | --- | --- | --- | --- | --- |
| **XComic** (xcomic.me) | Very large, new | HTML + GraphQL `POST /query/` | `iNN.imgNN.org`, no Referer | AniList, MAL, MangaUpdates | **Usable** |
| **Weeb Central** | Medium, official TLs | HTML/htmx | `scans.lastation.us`, no Referer | AniList, MangaUpdates | **Usable** (quality) |
| **MangaK** (mangak.io) | Large (aka MangaBuddy) | Next.js page props | `rx.qvzr*.org`, needs Referer | none | Usable (name match) |
| **Toonz** (toonz.to) | Large, new | `/api/comics/<id>/chapters` JSON, RSC page data | `toonz.to/uploads/…`, no Referer | none | Usable (name match) |
| Manganato.gg | Large, low quality, ads | HTML | `img-r1.2xstorage.com`, needs Referer | none | Usable, low quality |
| Toonkotsu | Very large | Chapter data via the site's own scripts | See detailed 19 Oct survey below | AniList, MAL, … | Usable with a page session; earlier rejection superseded |
| MangaFire | Large | API needs a client-computed `vrf` token | — | — | Not usable |
| MangaHub, Mangago, OniSaga, Kagane, VyManga | Large to very large | Cloudflare challenge to non-browsers | — | — | Only with a user-verified session (MangaDot pattern); not inspected further |
| Atsumaru | Medium | Open JSON (`/api/home2/…`) | — | — | Not pursued (size) |

### XComic

- Search `GET /search?word=<q>` is server-rendered HTML and fuzzy; fan works are
  mixed in, so match on the title page's tracker links. One Piece is
  `/title/kolxr` → `anilist.co/manga/30013`, `myanimelist.net/manga/13`.
- A chapter `GET /chapter/<id>` is HTML that contains the page URLs
  (`https://iNN.imgNN.org/_f/…/*.webp`). These load without a Referer, for the
  honest user agent.
- GraphQL `POST /query/` accepts plain JSON with no extra headers:
  `get_comic_chapterList_jumpList(select: {comic_id})` and
  `get_comic_chapterDuplications(chapter_id)`. Introspection is disabled.
- **Open item:** One Piece's title page links 317 chapters but only 76 distinct
  numbers, and the jump list returned nothing for `kolxr`. Find the full
  chapter-list route before building the connector.

### Weeb Central

- The series page `/series/<ULID>/<slug>` links AniList and MangaUpdates.
- `GET /series/<ULID>/full-chapter-list` returns HTML with every
  `/chapters/<ULID>` link (184 for the test series).
- `GET /chapters/<ULID>/images?is_prev=False&current_page=1&reading_style=long_strip`
  returns the page images on `scans.lastation.us`.

### MangaK, Toonz, Manganato

- MangaK: `/<slug>` and `/<slug>/chapter-N` carry `__NEXT_DATA__` props
  (`initialManga`, `initialChapter`). Images need `Referer: https://mangak.io/`
  (403 without it).
- Toonz: `/manga/<slug>`, `/manga/<slug>/chapter/<n>`. Page data lists
  `images[].filename`; `UPLOADS_BASE` is empty, so images are at
  `https://toonz.to/uploads/<filename>`. The chapter list is
  `/api/comics/<comicId>/chapters`. Toonz blocks headless browsers (403 plus a
  third-party check page) but serves plain HTTP.
- Manganato.gg: HTML. Images on `img-r1.2xstorage.com` need
  `Referer: https://www.manganato.gg/`; the `imgs-2` mirror returned 404.

## REA evidence (this session's ledger)

`analyze-web-bundle`: Re:Anime `ev_8a6325ab…`, anv `ev_9444dcf2…`,
AnimeX `ev_1e225b01…`, ani.pm `ev_37ac7d37…`, aniwaves `ev_09945b40…`,
XComic `ev_0177cdb3…`, MangaK `ev_60b92721…`, Manganato `ev_ae6e51cc…`,
MangaFire `ev_0977a321…`, Weeb Central `ev_9965ce19…`.
For Toonkotsu, Toonz, MangaHub and Mangago, headless Chrome only got the
interstitial. `analyze-javascript-application` on Toonkotsu's downloaded
bundle: `ev_858879e8…` (its `/api/v1/…` routes).

## Recommendation

1. **Anime:** add anv to both apps. It's AniList-keyed (no fuzzy matching),
   has sub and dub, and multi-language subtitles. It needs the
   watch-page cookie, `/api/episode`, and HLS with disguised segments.
2. **Manga:** add XComic first, once its full chapter-list route is found. Then
   Weeb Central for official-translation quality. MangaK and Toonz are
   name-matched fallbacks.

# Update: 19 Oct 2026 (large libraries, re-checked)

The user asked for more sources with large libraries, anime first, and ruled that a
Cloudflare/Turnstile check or request signing done inside the site's own page does not
make a site unusable: AnimePahe and MangaDot already work through user-verified page
sessions. Sites marked "not usable" above for those reasons were re-checked in a real
browser page. Plain-HTTP checks used AniTrack's honest user agent, one request at a
time; library sizes are EverythingMoe's labels.

Kinds of access:

- **Plain HTTP**: works from the app's own requests.
- **Page session**: works inside the site's page (hidden window or WebView), the way
  AnimePahe/MangaDot do; the app reads the stream or pages the page loads. "Check"
  means a visible human check the user passes once in a connect window.

## Anime

| Site | Library | Ids | Access | Stream | Notes |
| --- | --- | --- | --- | --- | --- |
| **shonen.to** | Large (scraper) | AniList (`/watch/<anilistId>/<ep>`) | Plain HTTP | `GET /sources/shonen?id=&episode=&language=sub\|dub` -> HLS up to 1080p via `vidcloud.sbs` proxy, VTT subs; no Referer, no key | Strongest fit: no title matching. Depends on the sites it scrapes |
| **anv** | Large | AniList | Plain HTTP + watch-page cookie | As on 12 Oct: `/api/episode` ready, HLS with disguised segments | Re-confirmed working |
| **AniChan** | Large | AniList (`/api/watch/*?anilistId=`) | Page session (Turnstile passed invisibly) | 1080p HLS via `c.toroplay.cymru` proxy, several VTT subs | Played Overgeared ep 1 in a page |
| **Xanime** | Large | MAL id on title pages | Plain HTTP | Signed HLS on its own hosts (`xanivsrc*.org`), 720p seen, TS behind .png/.jpg, English VTT | Episode list on the watch page; search `?word=` |
| **ANIMEGG** | Very large | Slugs (name match) | Plain HTTP + `Referer: animegg.org` | MP4 480/720/1080p via `vidcache.net` | Simplest format |
| **Re:Anime** | Medium-large, #1 | AniList | Page session | flixcloud player, 1080p Erai-raws CR WEB-DL, multi-sub | Played in a page |
| **AnimeX** | Large | AniList ids in URLs | Page session | Own player `plyr.animex.one` -> `/rest/api/sources`, 1080p | Played in a page |
| **Zanix** | Large | MAL/AniList in its scripts | Page session | Own ReCloud player: `getSources` JSON -> HLS, CR subs in several languages, intro/outro times | Episode API 403s outside its page |
| **2Dhive** | Large | MAL (`?anime=<malId>`) | Page session | babastream player (in-page encryption + invisible proof-of-work) | Played in a page |
| AniHQ | Medium-large | ? | Check | Cloudflare "Just a moment" stays up | Needs the user to pass the check once; not tested further |
| ani.pm | Large | Opaque hashed ids | Page session (untested) | third-party embed | Hard to match titles |
| hianimes.se | Large | ? | Connection reset | | Looks like an ISP block (India) |

Medium/small (skipped per the user's "large libraries"): AniZone, Senshi, KickAssAnime,
Anime Nexus, Gotaku, AnimeOnsen, Anify, Otaku-Streamers.

## Manga

| Site | Library | Access | Notes |
| --- | --- | --- | --- |
| **Kagane** | Very large | Page session | Reader loaded all 46 pages (blob images decoded in-page) |
| **MangaKatana** | Medium-large | Plain HTTP | Search, 1,223 One Piece chapters, 40 pages per chapter, images load without Referer |
| Toonkotsu | Very large | Check | Its own "Quick Check" before chapters; user passes it once |
| XComic, Weeb Central, MangaK, Toonz | see 12 Oct | Plain HTTP | Not re-checked |
| MangaFire | Large | Page session (not re-tested) | `vrf` token is computed in-page |

## Novels

| Site | Library | Access | Notes |
| --- | --- | --- | --- |
| **NovelCool** | Large | Plain HTTP | All chapter links on the title page (2,497 for Shadow Slave, behind other sites); clean text. Mixes manga |
| **NovelFire** | Large | Plain HTTP | 100 chapters per list page (Shadow Slave 3,218); clean text; removing Korean novels (includes Overgeared) |
| **WuxiaClick** | Large | Plain HTTP | Next.js; chapter text in page; some low-quality translations |
| **Wuxia Box** | Large | Plain HTTP | Search is a POST form; chapter text in page |
| Novelito | Large, very new | Plain HTTP API (`/api/novels/...`, offers EPUB) | Not probed further |
| Xnovel | Large, new | ? | App-style site; API not found from its scripts |

## Recommendation (for the user to decide)

1. **Anime:** shonen.to first (AniList-keyed, plain HTTP, 1080p, subs), then AniChan or
   Re:Anime as page-session sources, and anv. Xanime and ANIMEGG need title matching.
2. **Manga:** Kagane (very large, page session) and MangaKatana (plain HTTP).
3. **Novels:** NovelCool or NovelFire as a third source.

# Toonkotsu integration survey: 19 Oct 2026

Research only, requested before implementation in desktop and native Android.
The detailed observations below supersede the earlier Toonkotsu rejection.
**Result: the current Chrome session can search, show tracker-linked titles,
list chapters and render chapter pages. A website-session connector is a viable
implementation direction; AniTrack integration has not yet been built or tested.**

## Method and evidence limits

- Used a real Chrome tab at <https://toonkotsu.com/>, its normal search UI,
  rendered DOM/accessibility tree and the browser's observed-page asset inventory.
  Navigated the site's reader normally; did not replay its protected requests.
- Browser profile/session state was pre-existing. No cookies were inspected,
  exported or copied, and no user agent or fingerprint was changed. This does
  not establish how a fresh Electron partition or Android WebView will behave.
- No human-check control was clicked or solved. A Quick Check screen was not
  captured in this run; the reader eventually opened without agent interaction
  with a check. Its observed resources included Cloudflare Turnstile and the
  site's unlock endpoint. Whether this used existing clearance or an automatic
  website check is unknown. Fresh sessions still need a visible, user-operated
  Connect flow.
- Resource inventory establishes that URLs were observed, not their methods,
  status codes, request headers, response shapes or token lifetime. Routes below
  are evidence of the site's normal operation, not a verified plain-HTTP API.
- Signing/decoding internals were not investigated. The user subsequently
  overrode the skill restriction on investigating them; that override does not
  change the requested research-first stop or constitute evidence about their
  implementation.

## Search and title metadata (confirmed)

- Homepage **Search titles** opens a search dialog. Entering `One Piece`
  produced **VIEW 55 RESULTS** and ten displayed suggestions, with the main
  series first. Suggestions included spin-offs and alternative-title matches,
  so a matching name alone is insufficient.
- The first result opened
  <https://toonkotsu.com/title/ktm04-one-piece>.
  Observed title references have an opaque lower-case alphanumeric id followed
  by a slug: `/title/<id>-<slug>`. Preserve the source id rather than deriving
  identity from the translated title or slug.
- That page explicitly links [AniList manga 30013](https://anilist.co/manga/30013)
  and [MyAnimeList manga 13](https://myanimelist.net/manga/13).
  Match the requested AniList id against this title-page link, following
  `xcomicDetail`/XComic matching. The MAL link is secondary metadata.
- Rendered metadata includes `One Piece`, alternative titles, `MANGA`,
  `ONGOING`, year `1997`, author `ODA Eiichiro`, description, genres and cover.
  The observed cover URL is `https://toonkotsu.com/cdn/c/ktm04/muxe4yu7/460.webp`.
- Observed catalogue resources include `/cdn/v1/series/ktm04` and
  `/api/v1/series/ktm04/mangabaka`. Their response schemas were not inspected.
- Browse is `/manga/browse`. The quick-search request URL, query parameters and
  a stable URL for submitting a search remain unconfirmed; do not invent an API
  from this observation. A bounded fixture for search still needs to be captured
  when implementing the connector.

## Chapter lists (confirmed, completeness limits)

- The hydrated title page says **Chapters (3,862)**. This is an upload count:
  chapter `1196` appears separately for **TCB Scans** and **Official**.
  The TCB row reports **17 pages**, **1100px**, **7.7 MB**; Official reports
  **16 pages**, **1100px**, **7.2 MB**. Other visible groups include
  WeebCentral and Rolia Scans.
- Chapter links for those two uploads are:
  - <https://toonkotsu.com/title/ktm04-one-piece/4675553-chapter-1196>
  - <https://toonkotsu.com/title/ktm04-one-piece/4706277-chapter-1196>
- The title DOM contained 100 chapter links and pagination controls `1`, `2`,
  `3`, `39`. The pagination request/cursor or resulting page URL was not
  established: an attempted second-page interaction timed out at the browser
  control layer. The complete 3,862-upload list has **not** been enumerated.
- Direct chapter navigation briefly exposed a server-rendered fallback with
  **Chapters (1,209)**, 100 chapter links, volume entries and 13 list pages,
  before the interactive reader replaced it. This differs from the hydrated
  upload list and must not be treated as proof that every upload is available
  from the fallback. A parser must distinguish chapter numbers, volume-only
  entries and individual upload ids.
- Keep each upload id, chapter number, optional title, group, page count and
  upload timestamp where available. Reuse AniTrack's existing group selection
  and chapter normalization; do not collapse upload choices during parsing.

## Reader and page-image delivery (confirmed)

- Opened TCB Scans chapter `4675553`. The page became an interactive reader
  titled `Page 1: Chapter 1196 - One Piece - Toonkotsu`, with **1 / 17**.
  The URL acquired a page-position suffix `/1`.
- DOM images `Page 1` through `Page 6` loaded successfully, with `blob:` URLs
  belonging to `https://toonkotsu.com`. Page 1 had natural size **1100 x 1606**.
- Used the reader's **Last Page** control. It moved to
  `/title/ktm04-one-piece/4675553-chapter-1196/17`, showed **17 / 17**, then
  loaded `Page 17` successfully at **1100 x 1606**. The DOM also contained
  successfully loaded pages 12–16. Pages 7–11 were not individually checked;
  do not claim every page was verified. Loading is lazy/windowed.
- The observed reader resource inventory included:
  - `/cdn/v1/series/ktm04`
  - `/api/manga/chapter/4675553`
  - `/api/manga/unlock`
  - `/api/manga/key`
  - multiple `/cdn/e/<opaque>.bin` resources
  - Cloudflare's `https://challenges.cloudflare.com/turnstile/v0/api.js`
- The normal page converts delivered data into readable image blobs. Observed
  `.bin` resources plus rendered blobs support that conclusion; the precise
  signing, encoding and image transformation are unknown. No decoder, keys or
  signed request material were extracted or reproduced.
- All observed chapter-delivery resource URLs were on **toonkotsu.com**.
  No external chapter-image CDN was established. A `blob:` URL is scoped to its
  owning browser context and is not a reusable HTTPS page URL for AniTrack's
  renderer, Android image loader or downloads.

## Implementation implications (proposed, not yet implemented)

1. Register `toonkotsu` immediately after XComic in desktop `SOURCES` and Android
   `MangaSources.all`, with desktop `needsConnect: true` and an Android
   connection activity. Keep existing source preferences intact.
2. Implement a pure `packages/shared/toonkotsu.ts` parser and Kotlin twin under
   `data/manga/toonkotsu/`. Save sanitized fixtures for search, exact tracker-id
   matches, metadata, paged upload lists and reader page metadata. Test the same
   cases on both sides, including mismatched tracker ids, duplicate uploads,
   fractional numbers, volume-only entries and invalid URLs/ids.
3. Desktop should reuse the isolation/lifecycle safeguards of
   `VerifiedPageSession` and provide **Connect Toonkotsu** through
   `connectMangaSource`. Important gap: the helper currently performs fixed
   same-origin GETs from an isolated world; it does not navigate chapter pages,
   wait for reader hydration or export decoded blob bytes. Its title-based
   challenge detector does not specifically detect an in-page **Quick Check**.
   Merely wrapping a chapter GET in this helper will not produce image URLs.
4. Android should follow `data/manga/mangadot/` for the visible connection UX
   and restrictive WebView settings. Its current cookie-backed HTTP pattern is
   insufficient by itself for decoded blob images. A source-owned website
   session needs a bounded way to supply already-rendered image bytes to the
   native reader/cache, with no app/account bridge exposed to the page.
5. The page-session approach must preserve the actual reader session through
   decoding and byte transfer. Keep requests sequential and bounded; surface
   Quick Check to the user and stop on rejection/rate limiting. Establish that
   the selected title/chapter matches before accepting page bytes. Keep ad
   resources and popups out of the app's connector window.
6. For `fetchPageImage`, allow only observed, validated public HTTPS hosts and
   paths needed by the finished transport. Current evidence supports the exact
   host `toonkotsu.com`, not a wildcard or any new external CDN. Do not serve
   raw `.bin` responses as images or pass website blob URLs across processes;
   a validated decoded-byte/cache hand-off is also needed. Referer, cookie
   requirements, MIME types and download compatibility remain to be verified.

Before claiming implementation complete, resolve the quick-search transport,
full chapter pagination, fresh-profile Quick Check behaviour, and decoded-byte
transfer in both Electron and Android. Then run `npm run typecheck`, `npm test`,
`npm run build`, `npm run android:next:test`, plus isolated desktop and debug
tablet reading checks. None of those app checks were run for this documentation
only survey. **Stopped here as requested; no connector code, commit or push.**

## Implementation follow-up: 19 Oct 2026

The user requested implementation after the research stop. Further inspection of
the site's current public modules and a separate Electron website session resolved
the catalogue questions:

- Search is `GET /cdn/v1/search?q=<encoded query>&limit=5`, returning `items`
  with `hid` and `slug`. The isolated Electron page received HTTP 200.
- `GET /cdn/v1/series/<hid>` returns `{series, chapters, recs}`. For `ktm04`,
  the isolated Electron page received HTTP 200 and a 2,523,073-character JSON
  response. `series.trackers.anilist` is `30013`;
  `series.externalIds.myanimelist` is `"13"`.
- The complete raw chapter catalogue is delivered in that response. Each row
  carries `id`, `n`, `label`, `at`, `pages`, `group` and optional `alts`.
  Alternate uploads inherit the canonical number/volume and can override their
  own group, page count and timestamp. The website paginates this data locally;
  the connector does not need to traverse the UI's 39 chapter-list pages.
- A fresh isolated reader page returned **Quick Check**, even though catalogue
  requests worked. Thus homepage/catalogue access is insufficient to declare
  the reader connected. The connector probes page 1 before returning reader
  handles and remembers that chapter for the visible Connect window.

Implementation uses `packages/shared/toonkotsu.ts` with a Kotlin twin, and a
locally bundled `toonkotsu_page.js` reader shared by both apps. The website itself
performs its normal image decoding. The bundled reader exports only a bounded
decoded image blob for the requested chapter/page; it exposes no native bridge.
HTTPS reader URLs are source-specific page handles, intercepted locally rather
than downloaded as image responses. Resource requests are restricted to
`toonkotsu.com` and `challenges.cloudflare.com`; no external image CDN is added.
Decoded images are cached and copied into the existing offline-download system.

Toonkotsu is registered immediately after XComic on both platforms. Existing
source preferences are retained. Parser fixtures are trimmed from the observed
catalogue and mirrored in the Kotlin tests. Live reader verification and the
four required build/test checks are tracked by the implementation task; this
section does not claim that a check or human-verification flow has passed.

### Validation during implementation

- `npm run typecheck`, `npm test` (428 passing tests), `npm run build` and
  `npm run android:next:test` passed. The Android debug APK also built.
- The isolated desktop app matched One Piece to AniList `30013`, returned
  10,201 individual uploads from the full catalogue, and correctly offered
  Connect when its fresh reader encountered Quick Check. After the user-operated
  verification, AniTrack's image protocol returned HTTP 200 JPEGs for pages 1
  and 17 of chapter `4675553`, both decoded at 1100 x 1606. This verifies actual
  desktop image-byte delivery, including the final page of that upload.
  The native desktop reader at `#/manga/read` also displayed page 1 successfully.
- On the tablet debug app, the user completed Quick Check. The website session
  rendered chapter `4678742` (1196, TCB Scans), and the native AniTrack reader
  displayed its first decoded page with a 17-page count. This verifies the
  WebView-to-cache-to-native-reader hand-off; a complete offline chapter has
  not yet been checked.
- Live testing exposed an Android timeout that propagated as coroutine
  cancellation, leaving a loading placeholder behind. Local session deadlines
  now become a Connect prompt or a retryable source error, while cancellation
  of the caller still cancels the operation. Android unit tests and the debug
  build passed after that fix. The updated debug APK was installed in place and
  also opened the Official upload of chapter 1196 with its 16-page count.
- No commit, push or release was made.
- Follow-up review found that Android's backup preference allowlist omitted
  `toonkotsu_match_`. It now includes saved Toonkotsu matches on export and
  restore, with regression coverage in `BackupTest`.

# Additional anime candidates: 19 Oct 2026

Requested alongside shonen.to download support. These are research findings;
none of these candidates was added to AniTrack. Earlier size-based exclusions
are not evidence that a site cannot work. Catalogue access and video delivery
are tracked separately.

| Source | Observed access and identity | Coverage / remaining work |
| --- | --- | --- |
| [Gotaku](https://gotaku.to/) | Its real Chrome homepage rendered current titles with separate sub/dub episode counts. Death Parade was listed with 12 sub and 12 dub episodes at `/title/3xxgz7`. A plain request to that title returned HTTP 200 but only a 2,135-character app shell; its public main module is obfuscated. | [EverythingMoe](https://everythingmoe.com/s/gotaku) describes own encodes/servers and a medium-small library rebuilding after a reset. Tracker IDs, search results, episode delivery and stream resolution remain unverified. |
| [AniZone](https://anizone.to/) | Homepage returned HTTP 200 (69,553 characters), with `/anime`, `/episode`, `/tag`, a Livewire search form and `/livewire/update`. Catalogue cards are populated by the app; static HTML alone did not expose the resolved title/episode links. | [EverythingMoe](https://everythingmoe.com/s/anizone) describes a medium-small self-hosted library, release information and rich subtitles, chiefly useful for recent anime. Tracker IDs and playable media remain unverified. |
| [KickAssAnime](https://kaa.lt/) | Its current domain listed by [EverythingMoe](https://everythingmoe.com/s/KickAssAnime) is `kaa.lt`, which returned HTTP 200 and a 148,317-character Nuxt application page. The listed `kaa.to` alternate failed during TLS establishment on this network; that does not establish that the current domain is blocked. | The directory describes a medium-small self-hosted library, high-bitrate recent releases and multilingual soft subtitles, with incomplete older coverage and dub-server issues. Search, IDs, episode APIs and playable media require a separate live investigation. |

Browser control became unavailable after the Gotaku homepage inspection. The
remaining observations above are plain-HTTP or static public-module evidence,
not successful playback tests. No signing or decoding restriction was used to
reject a candidate, and no downloaded website code was executed in a native
runtime.

For larger-library options, the earlier survey also contains anv, AniChan,
Xanime, AnimeGG, Re:Anime and AnimeX. Their earlier findings were not re-tested
in this pass. The user can choose which source to investigate for integration.

# Large-library follow-up: 19–20 Oct 2026

The user requested continued research specifically on large anime libraries.
The [detailed comparison](large-anime-catalogs-2026-10-20.md) records current
endpoints, identity checks, older-OVA coverage and transport results.

| Source | Size evidence | New evidence |
| --- | --- | --- |
| Xanime | Browse reports 10,430 titles | MAL-linked Bebop and Yokohama Shopping Log; 1080p HLS and real TS bytes; valid sub VTT, one broken dub VTT |
| ani.pm | Catalog reports 9,052 sourced entries | Direct AniList lookup works, superseding the earlier opaque-ID matching concern; session API works but supplied embed returns Cloudflare 403 |
| AniChan | Claims 17,000+ titles | Older OVAs and full Bebop episode-count API; stream servers require a verified session (401 outside one) |
| ANIMEGG | Directory labels it very large | 26 Bebop episodes, 2 Yokohama OVA episodes, direct MP4 byte-range response; sampled older sub upload is 360p |

Counts are site-reported catalog entries, not independently verified playable
shows. New browser/native playback was not tested because the selected research
browser was unavailable; direct HTTP media evidence is identified separately.
No new connector was implemented, committed or published.

REA follow-up on 20 Oct: analyzed the shipped modules for all four shortlisted
sites and retained Evidence with explicit coverage limits. An isolated REA
browser captured Xanime's complete 26-episode sample list, successful HLS/segment
and caption responses, and the player's 24:43 duration. Advancing playback was
not measured; the browser tool results were partial due to its cleanup deadline.
ani.pm's native HLS branch needs master URL fields absent from both sampled
inventories. AniChan's session flow includes optional AES-GCM server responses
and supports HLS, MP4 and embeds. Full details and Evidence IDs are in the
[REA follow-up](large-anime-catalogs-2026-10-20.md#rea-follow-up-20-oct-2026).

## AniChan implementation follow-up: 20 Oct 2026

The user selected AniChan for implementation in both apps. A subsequent isolated
Electron session verified advancing Overgeared episode 1 video at 1920 pixels,
plus decoded HLS/subtitle metadata. Bebop fast-tier sub and dub responses also
contained direct HLS servers. The initial empty response was caused by omitting
the required `tier=fast`, rather than missing title coverage.

The [connector notes](anichan.md) record the exact catalogue/session boundaries,
shared page reader, native playback contract and validation. This supersedes the
earlier unverified-session finding for those sampled titles; it does not prove
the site's entire reported catalog is playable.

Final app checks also passed: AniChan played in the production desktop player
and the tablet's native debug player, including a delayed server switch on
Android. The [validation notes](anichan.md#app-validation) include the source-ID
collision and retained-WebView fixes found by those checks. The current work
remains uncommitted and unpublished.

AniChan now also exposes HLS downloads in both apps. Full-episode downloads and
local playback with English subtitles were verified on the desktop and tablet;
conservative transfer pacing was added after a simultaneous test hit a CDN
limit. See [download validation](anichan.md#download-validation) for completed
checks, tested qualities and the sampled mirrors that returned HTTP 502.
