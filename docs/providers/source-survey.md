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
