# Large anime catalogs: deeper comparison (19–20 Oct 2026)

Follow-up to the Shonen download work. The user requested large libraries;
Gotaku, AniZone and KickAssAnime are not the focus of this pass. This is research
only: no connector was added, and no commit or release was made.

## Results

Counts below are reported by the source, not a count of independently tested
playable shows. A catalog can contain movies, seasons, specials and unavailable
entries. None of these sources received a full-library availability audit.

| Source | Size evidence | Matching and older coverage | Delivery observed in this pass |
| --- | --- | --- | --- |
| [Xanime](https://xanime.me/search) | Browse reports **10,430 titles**, with 435 pages. | Title pages link MAL IDs. Cowboy Bebop links MAL 1; Yokohama Shopping Log links MAL 975. | Episode 26's dub HLS master and 1080p rendition returned 200; a segment returned 206 with MPEG-TS bytes. The separately listed sub caption returned valid WEBVTT. One dub caption returned 404. |
| [ani.pm](https://ani.pm/) | Catalog API reports **9,052 sourced entries**, 30 per page, 302 pages. | Direct AniList lookup works. Cowboy Bebop lists 26 sub/dub episodes; Yokohama Shopping Log lists 2 sub episodes. | Playback bootstrap and session APIs returned 200, then `embed.settlar.io` returned a Cloudflare 403. Media not verified in this pass. |
| [AniChan](https://anichan.to/) | Homepage/search metadata claims **17,000+ titles**; this is a marketing claim, not a verified playable count. | AniList IDs in title routes. Bebop's episode API reports 26 episodes and sub/dub availability. Both Yokohama OVAs appear with 2 sub episodes. | Catalog/watch HTML returned 200. The servers API returned 401 `{"detail":"session"}` without a verified session. |
| [ANIMEGG](https://www.animegg.org/) | [EverythingMoe](https://everythingmoe.com/s/ANIMEGG) labels it **very large**. No numeric catalog total established. | Search returns Bebop and its movie; the series lists 26 episodes with sub/dub links. Yokohama Kaidashi Kikou lists 2 sub episodes. No tracker link established. | Episode 1's sub embed exposes a 360p MP4. The redirect reached `s127.vidcache.net` and returned 206, `video/mp4`, and an `ftypisom` header. |

Xanime has the most complete new direct-media evidence in this pass. ANIMEGG
is another direct-media option, with lower quality on the sampled older show.
ani.pm now has a confirmed AniList lookup route, improving its matching prospects
over the earlier survey's opaque-ID assessment. AniChan also avoids title-name
matching, but its playback session still needs live browser verification.

## Xanime

- Search: `GET /search?word=<query>`. Empty search exposes the catalog total.
- Bebop: `/title/91594-cowboy-bebop`, explicitly linked to MAL anime 1.
  Its Watch link opened `/title/91594-cowboy-bebop/31962046`, **episode 26**.
  Do not assume the title's Watch link means episode 1.
- The episode HTML's Qwik serialized data contains separate signed sub/dub HLS
  URLs on `xanivsrc*.org`, plus caption URLs. These were read statically; no
  site JavaScript was executed outside the browser and no signing algorithm
  was needed to reproduce the observed requests.
- The sampled dub master offers 1448x1080, 966x720 and 482x360. The 1080p media
  playlist ends in `.ico`, and media segments use mixed `.jpeg`, `.css`, `.gif`,
  `.js`, `.png` and `.webp` extensions. A ranged read returned MPEG-TS bytes
  (`47 40 00 10 ...`), not an image. The playlist contains no `EXT-X-KEY`.
- Media checks used `Referer: https://xanime.me/` and the honest AniTrack user
  agent. Whether that Referer is required was not separately tested.
- The listed sub caption on `xanivsrc2.org` returned 200, WEBVTT, 10,258
  characters. The listed dub caption on `xanivsrc7.org` returned 404. A future
  connector must handle missing captions per stream rather than assuming every
  advertised track works.
- Searching `Yokohama Kaidashi Kikou` returned no results. Searching its English
  title `Yokohama Shopping Log` found `/title/88570-yokohama-shopping-log`, which
  links MAL 975. Search title aliases, then verify the tracker ID.
- Remaining: complete episode-list extraction (stable episode IDs), sub/dub
  selection, signed URL renewal, recent-season coverage and native playback on
  both platforms. A successful ranged byte read is not native playback proof.

## ani.pm

Public module `/assets/index-CAXmVmxA.js` supplies the following routes. They were
read statically and replayed directly, with no account or user credentials:

1. `GET /api/anime/catalog?sort=popular&page=1` returns `items`, `page`,
   `lastPage`, `total`, `hasNextPage` and `availability`. The snapshot reported
   9,052 rows, all marked `sourced`; this is the source's own classification.
2. `GET /api/anime/ani/1?routes=e4` returns Bebop with `anilistId`, `malId`,
   26 episode entries, per-episode sub/dub flags and opaque route IDs.
   `/api/anime/ani/975?routes=e4` similarly returns the 1998 Yokohama OVA.
3. `GET /api/anime/playback-bootstrap/anilist/1?ep=1&lang=sub` returns core
   metadata, availability, intro/outro times, package flags and an opaque
   `settlarSelection` value.
4. `GET /api/anime/settlar/session` uses that value with `provider=anipm`,
   `ep=1`, `channel=sub`, `telemetry=0`. It returned an expiring `embedUrl` on
   `https://embed.settlar.io/embed/v1`.
5. Reading that supplied embed URL with the AniTrack UA and ani.pm Referer
   returned 403, `Attention Required! | Cloudflare`.

This supersedes the earlier conclusion that matching must depend on opaque
hashed IDs: the current frontend has a working AniList lookup path. It does
not establish direct native stream access. A normal browser session, episode
identity and media delivery still need verification. Some supplied episode
descriptions appeared inconsistent with their episode labels, so metadata
alone should not be used as proof that the correct video plays.

## AniChan

- Search: `/search?q=<query>`; titles: `/anime/<anilistId>/<slug>`; episode 1:
  `/anime/1/cowboy-bebop/1`.
- Search is broad/fuzzy: the Bebop query also returned unrelated results.
  Exact AniList matching is needed even when a plausible name appears first.
- Current homepage lists One Piece at 1,180 sub / 1,155 dub episodes, Naruto
  at 220/220, and Hunter x Hunter (2011) at 148/148. These are catalog badges,
  not proof that every episode is playable.
- `GET /api/watch/episodes?anilistId=1` returned
  `{"episodes":26,"sources":[{"name":"anichan","host":"anichan","sub":true,"dub":true}],"dubAvailable":true}`.
- `GET /api/watch/servers?anilistId=1&ep=1&category=sub` returned HTTP 401
  `{"detail":"session"}`. The current public module shows `/site-config`,
  Turnstile, `POST /api/watch/session` and browser crypto in the server-request
  flow. No human verification was automated or token manufactured.
- The earlier survey's in-page playback evidence is historical evidence;
  playback was not repeated in this pass. Remaining work is a real verified
  page session and current media capture on desktop and Android.

## ANIMEGG

- Search: `/search/?q=<query>`; series: `/series/<slug>`; episodes:
  `/<slug>-episode-<number>`. The Bebop page exposes all 26 episode links.
- `/cowboy-bebop-episode-1` links separate sub/dub embeds `/embed/6339` and
  `/embed/6340`. The sub embed declares an ordinary `videoSources` array with
  a relative `/play/<id>/video.mp4?...` URL and a 360p label.
- A bounded ranged request followed that URL to `s127.vidcache.net`, returning
  `Content-Range: bytes 0-65535/54642064` and MP4 bytes. Only the first received
  chunk was read; the episode was not downloaded in full. No ad scripts ran.
- No AniList/MAL link was established. A connector would need cautious name,
  season and episode matching. Current/long-series completeness, higher quality
  on other uploads and native playback still need checking.

## Other candidates screened

- [2Dhive](https://2dhive.com/): directory labels it large. Search found Bebop
  and its movie; the title page lists 26 episodes. Episode 1 embeds
  `https://babastream.top/embed/1/1/sub`. Its existing page-session findings
  remain relevant; media was not re-tested here.
- [AniHQ](https://anihq.cc/home/): directory labels it medium-large; the current
  homepage returned Cloudflare 403. A verified browser session remains untested.
- [Zanix](https://zanix.tr/home): the directory still labels it large, but now
  notes on-demand reuploads, mostly from Anikoto. That weakens its value as an
  independent fallback; this note does not establish that every stream is shared.
- AnimeHeaven, AnimeParadise and WCO are currently rated medium or smaller by
  the directory; AnimeStream is medium (CR/ADN/RetroCrush). They were not advanced
  for this large-library request. Anidap/Anistream share dependencies with
  AnimeX, so additional brands would not necessarily add independent coverage.
- anv's homepage and browse page returned 200. Its earlier stream findings were
  not repeated here; it remains a large-library candidate from the earlier survey.

## REA follow-up: 20 Oct 2026

The user requested verification with REA. Shipped frontend modules were analyzed
with REA's `analyze_javascript_application`; retained views and focused traces
were inspected. These are static observations, not execution claims.

| Artifact set | REA parent Evidence | Coverage |
| --- | --- | --- |
| Xanime: 7 Qwik player/UI modules, 14,282 bytes | `ev_fb4a24ff02edd988e68bf25d0291d7809eac57b2463636ad4f65242c4d930fa2` | 7 parsed, no parse failures; complete inventory of this selected set, semantic relationships still contain unknowns |
| Xanime: full player/HLS bundle, 510,493 bytes | `ev_40228a7fb247f28f59130c46dd913b3985cc41a2efaaf83eca7fc3226d7402ac` | Source parsed, no parse failure; semantic expansion timed out at the selected 120-second deadline; partial facts retained |
| ANIMEGG: 2 inline scripts extracted exactly from the embed HTML, 7,842 bytes | `ev_89dae41bf6161255037e5c7c5911be52b9e14a343dabf8de1ee5694def9f7609` | Both parsed, no parse failures; unknown dynamic/cross-script values remain |
| AniChan: 4 current frontend modules, 166,764 bytes | `ev_3d63de1670a9debdf871747d51e5f1b6d92bf1f8e4116d03547365394afc1deb` | All parsed, no parse failures; expanded relationships reached the result budget, search semantic analysis incomplete |
| ani.pm: entry plus 5 player/detail modules, 471,775 bytes | `ev_9b470c7beb5019118881f9ca0114363d9d269f72ebd5e724a4a056b6d4a62500` | All parsed, no parse failures; result/node budgets limited expansion and entry semantic analysis |

### Xanime: browser media loading and full episode list observed

REA's `capture_browser_scenario` launched a separate headless Chrome with empty
storage. An initial 8-second capture of episode 26 ended while source servers
were still loading. Its accessibility snapshot exposed all 26 stable episode
links, including `/title/91594/31962021-episode-1`.

A second capture opened that observed episode-1 link and waited 20 seconds:

- The page identified Cowboy Bebop, MAL 1, episode 1, and listed sub/dub servers.
- The browser requested a caption on `xanivsrc3.org`, an HLS master on
  `xanivsrc5.org`, a rendition ending in `.ico`, and a segment ending in `.png`;
  those responses returned HTTP 200.
- The rendered player showed **00:00 / 24:43**, quality choices
  1080P/720P/360P/Auto, and episode navigation. This establishes media loading
  and player metadata; advancing time, decoded frames and audio were not measured.
- No human check was automated. Desktop/Android connector playback was not tested.

Both browser tools returned `cleanup_incomplete` after their short cleanup
deadline, retaining the steps, accessibility and network observations as partial
results. A subsequent Windows process check found no matching headless/Playwright
Chrome processes. These partial responses are saved separately as
`rea-xanime-browser-partial.json` and `rea-xanime-browser-partial-2.json`; they
are not represented as successful canonical scenario Evidence records.

### AniChan: session and response decoding are real connector work

REA's module observations and direct source inspection identify this flow:
`/site-config` supplies a Turnstile key; the frontend verifies, then creates a
watch session with `POST /api/watch/session`, retaining expiry/nonce state.
Server resolution uses AniList ID, episode and category. The frontend handles
optional AES-GCM responses through Web Crypto and retries session failures.

Player records can represent **HLS, MP4 or an embedded player**, plus subtitles,
ASS/font URLs, audio selection and intro/outro metadata. Do not assume every
decoded server is a native HLS stream. Fresh anonymous requests still returned
200 for metadata/episode counts and 401 `{"detail":"session"}` for servers.
No account-login requirement was established. Session creation, response
decoding and current video delivery were not executed in this pass.

### ani.pm: Direct HLS exists in code but was not offered for the samples

The current `WatchActionRow-Dpb_PcfU.js` requests
`/api/anime/anipm-server/_packages?anilistId=<id>` and chooses a native master
only when episode records supply `master`, `subMaster` or `dubMaster` with a
valid same-origin HLS URL. A package key and availability booleans are insufficient.

Fresh inventories for Bebop (1) and Yokohama Shopping Log (975) returned keys
such as `a1e1`/`a975e1` and sub/dub flags, **without those master URL fields**.
The executed HTTP bootstrap/session path still supplied an external Settlar
iframe, whose fresh HTTP response was Cloudflare 403. This is a bounded result
for two titles, not evidence that the Direct branch never works.

The focused outgoing module trace is
`ev_fd90833dbb62517f3cb61338f1877cea74ef65d4120cbddaf1428cae82d842fe`:
17 nodes and 19 edges, with partial parent coverage. Graph traces preserve
static/unknown distinctions and do not prove runtime reachability. A page
session is one implementation option; reproducing the observed protocol is
another research path. Neither has been implemented or validated here.

### Evidence preservation and conclusion

The canonical MCP bundle is saved in the task scratch directory as
`large-anime-research/rea-large-anime-evidence-2026-10-20.json`
(81,848,764 bytes, 16 records). Independent CLI Evidence and source provenance
for AniChan and ani.pm are retained alongside their findings. Large bundles
are kept outside the repository; no expiring media or session token is copied
into this document.

Xanime remains the strongest next large-library integration candidate from
these checks: exact MAL verification, a complete sampled episode list and
observed browser HLS/caption loading. ANIMEGG remains a simpler MP4 alternative
with name matching and quality tradeoffs. AniChan and ani.pm require additional
session/media work. No new source was added, committed or published.

## Initial method and limits

The selected Chrome research browser was unavailable in the initial pass. Its
evidence came from direct HTTP, public HTML/JSON and static frontend inspection.
The later REA section records the separate isolated browser captures and their
limits. No advancing browser playback or native app playback is claimed.
Site access was paced and media reads bounded; the whole
catalog was not crawled. Source names, library labels and current primary domains
were checked against [EverythingMoe](https://everythingmoe.com/section/anime).

Raw snapshots and a compact `findings-summary.json` are in this task's scratch
directory under `large-anime-research/`. Expiring media and session values are
kept out of this document and must be resolved again before use.

## Subsequent AniChan integration

After the research-only pass above, AniChan was implemented in both maintained
apps. Fresh page-session research established the required fast/rest tier,
watch-route protocol data and direct signed HLS/WebVTT delivery. The production
desktop player then decoded 1080p video, subtitles and a seek beyond two minutes;
the native debug app on the tablet also played video with English subtitles.
See [AniChan connector and validation](anichan.md) for the implementation,
regression fixes and completed checks. This supersedes the earlier statement
that AniChan remained unimplemented; the claimed full-library size is still
not independently verified. These changes have not been committed or published.
