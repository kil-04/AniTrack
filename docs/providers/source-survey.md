# Source survey: EverythingMoe candidates (12 Oct 2026)

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
| Toonkotsu | Very large | Chapter data via obfuscated `prepare()`/`open()` signer and decoder | — | AniList, MAL, … | Not usable |
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
