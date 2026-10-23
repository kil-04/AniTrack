#!/usr/bin/env node
/**
 * Builds the song charts both apps ship (apps/android/app/src/main/assets/song_charts.json):
 * for each decade, each year and all time, the openings and endings in two orders:
 *   - "best": what people play as music (YouTube views across everyone's uploads, or Last.fm
 *     listeners; kids' shows weighted down),
 *   - "known": what most fans recognise (AnisongDB's quiz recognition).
 *
 * Every season comes from AnisongDB once, one request at a time, cached in out/anisong-seasons/
 * (the last two years are fetched again). For every song, Spotify finds the
 * track's real name and Last.fm counts its listeners; answers are cached in
 * out/song-listening.json, so a re-run only looks up new songs.
 *
 * At the same time YouTube's search page gives each song's views, added up over everyone's
 * uploads of it (songYouTubeViews), one search every few seconds. out/song-youtube.json keeps
 * each search's videos, not the total, so a better matcher re-scores every song without
 * searching again. The most-recognised songs of every year go first, and a run stops
 * the YouTube part (keeping what it has) as soon as YouTube refuses or asks for a check.
 * Both cover every song with a video (~20.7k; YouTube's part takes about 28 h in all).
 * YT=off skips it; YT_MAX=<n> caps a run's searches. LISTEN=off skips the Last.fm/Spotify lookups
 * (a rebuild from what's cached).
 *
 *   node --env-file=.env scripts/build-song-charts.mjs
 *
 * Needs SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and LASTFM_API_KEY in .env for the "best"
 * order; without them the charts fall back to quiz recognition for both orders.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ANISONGS, CHART_PER_SHOW, SEASONS, baseTitle, decadeOf, franchiseNames, originalSongs, parseAniSongs, parseYouTubeSearch, rankSongs,
  songYouTubeViews,
} from "../packages/shared/anisongs.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(ROOT, "out", "anisong-seasons");
const LISTENING = path.join(ROOT, "out", "song-listening.json");
/** Songs whose lookup included Spotify's (often Japanese) track name. */
const SPOTIFIED = path.join(ROOT, "out", "song-listening-spotify.json");
/** Spotify's name for each track (often its Japanese title), which YouTube matching also uses. */
const SPOTIFY_NAMES = path.join(ROOT, "out", "song-spotify-names.json");
const spotifyNames = fs.existsSync(SPOTIFY_NAMES) ? JSON.parse(fs.readFileSync(SPOTIFY_NAMES, "utf8")) : {};
const ARTIST_TAGS = path.join(ROOT, "out", "song-artist-tags.json");
const YOUTUBE = path.join(ROOT, "out", "song-youtube.json");
/** AniList covers and Kids tags by show id. */
const SHOWS = path.join(ROOT, "out", "song-shows.json");
/** The first episode each later OP/ED plays from, by AniList id and slug (AnimeThemes). */
const THEME_EPISODES = path.join(ROOT, "out", "song-theme-episodes.json");
/** Long shows' air dates and episode counts (AniList), to date their later themes. */
const SHOW_RUNS = path.join(ROOT, "out", "song-show-runs.json");
/** Any of these in an artist's Last.fm tags marks an anime or Japanese act (not a licensed import). */
const ANIME_TAG = /anime|anisong|japan|j-?pop|j-?rock|city ?pop|visual kei|seiyuu|idol|enka|kayou?kyoku|shibuya|vocaloid|tokusatsu|\bgame|k-?pop|asian|soundtrack|\bost\b|[぀-ヿ一-鿿]/i;
const firstArtist = (artist) => artist.split(/,| feat\.| & | x /i)[0].trim();
const OUTPUT = path.join(ROOT, "apps", "android", "app", "src", "main", "assets", "song_charts.json");
const UA = "AniTrack song charts (+https://github.com/kil-04/AniTrack)";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Insert songs looked up on YouTube and Last.fm each year (~11k exist; these are the best-known). */
const INSERTS_PER_YEAR = 60;

/** One request at a time per service, at least `spacing` ms apart. */
function pacer(spacing) {
  let last = 0;
  let lane = Promise.resolve();
  return (fn) => {
    const run = lane.then(async () => {
      const delay = last + spacing - Date.now();
      if (delay > 0) await wait(delay);
      try { return await fn(); } finally { last = Date.now(); }
    });
    lane = run.catch(() => {});
    return run;
  };
}
const anisongdb = pacer(1200);
const anilist = pacer(1000);
// Spotify blocked a new dev app for ~23 h after ~600 searches at 150 ms; go slowly.
const spotify = pacer(1500);
// Its own lane: a search waiting in `spotify` asks for the token, so sharing would deadlock.
const spotifyAuth = pacer(0);
const lastfmLane = pacer(220);
// A person-like pace for YouTube's search page, with a little jitter.
const youtubeLane = pacer(3000);
const animethemesLane = pacer(1500);

async function withRetries(pace, label, fn) {
  for (let attempt = 1; ; attempt++) {
    const response = await pace(fn).catch((error) => ({ ok: false, status: 0, error }));
    if (response.ok) return response;
    const retryAfter = Number(response.headers?.get?.("retry-after"));
    // A rate limit longer than a minute (Spotify can ask for a day) fails at once.
    if (response.status === 429 && retryAfter > 60) throw Object.assign(new Error(`${label} is rate-limited for ${retryAfter} s`), { blocked: true });
    if (attempt >= 5 || (response.status && response.status < 500 && response.status !== 429)) {
      throw new Error(`${label} answered ${response.status || response.error?.message}`);
    }
    // A rate limit can ask for hours; wait at most a minute, then give up on this request.
    await wait(Math.min(60_000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 5000));
  }
}

async function season(name, year, fresh) {
  const file = path.join(CACHE, `${year}-${name}.json`);
  if (!fresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const response = await withRetries(anisongdb, "AnisongDB", () => fetch(`${ANISONGS.API}/season_request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
    body: JSON.stringify({ season: `${name} ${year}` }),
    signal: AbortSignal.timeout(60_000),
  }));
  const json = await response.json();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json));
  return json;
}

/** AniList covers and the Kids tag for these shows. */
/**
 * Covers and Kids tags, cached in out/song-shows.json so a re-run only asks about new shows
 * (seeded from the charts file the first time). When AniList is down, the run carries on with
 * what it has; the missing covers come on a later run.
 */
async function showInfo(ids) {
  let cache = fs.existsSync(SHOWS) ? JSON.parse(fs.readFileSync(SHOWS, "utf8")) : null;
  if (!cache) {
    cache = {};
    const shipped = fs.existsSync(OUTPUT) ? JSON.parse(fs.readFileSync(OUTPUT, "utf8")).songs ?? [] : [];
    for (const song of shipped) if (song.anilistId) cache[song.anilistId] = { cover: song.cover ?? null, kids: !!song.kids };
  }
  const missing = ids.filter((id) => !(id in cache));
  try {
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      const response = await withRetries(anilist, "AniList", () => fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: "query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id coverImage{large} tags{name rank}}}}",
          variables: { ids: chunk },
        }),
      }));
      const json = await response.json();
      for (const media of json?.data?.Page?.media ?? []) {
        const cover = media?.coverImage?.large;
        cache[media.id] = {
          cover: typeof cover === "string" && cover.startsWith("https://") ? cover : null,
          kids: (media.tags ?? []).some((tag) => tag?.name === "Kids" && (tag.rank ?? 0) >= 50),
        };
      }
      if (i % 1000 === 0) fs.writeFileSync(SHOWS, JSON.stringify(cache));
    }
  } catch (error) {
    console.log(`  AniList: ${error.message}; carrying on with ${Object.keys(cache).length} cached shows`);
  }
  fs.mkdirSync(path.dirname(SHOWS), { recursive: true });
  fs.writeFileSync(SHOWS, JSON.stringify(cache));
  return new Map(Object.entries(cache).map(([id, show]) => [Number(id), show]));
}

// ── Listening: Spotify for the real track name, Last.fm for its listeners ─────

const keys = { id: process.env.SPOTIFY_CLIENT_ID, secret: process.env.SPOTIFY_CLIENT_SECRET, lastfm: process.env.LASTFM_API_KEY };
// Last.fm is enough; Spotify (when allowed) adds the names tracks are filed under in Japanese.
const listeningOn = !!keys.lastfm;
let spotifyToken = null;

async function token() {
  if (spotifyToken && spotifyToken.until > Date.now() + 60_000) return spotifyToken.value;
  const response = await withRetries(spotifyAuth, "Spotify token", () => fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${keys.id}:${keys.secret}`).toString("base64") },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(20_000),
  }));
  const json = await response.json();
  spotifyToken = { value: json.access_token, until: Date.now() + json.expires_in * 1000 };
  return spotifyToken.value;
}

/** The Spotify track for this song (Spotify matched title and artist), skipping karaoke uploads. */
async function spotifyName(song) {
  const q = `track:${song.title.slice(0, 80)} artist:${song.artist.split(/[,(]/)[0].slice(0, 60)}`;
  const response = await withRetries(spotify, "Spotify search", async () =>
    fetch(`https://api.spotify.com/v1/search?type=track&limit=5&market=JP&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${await token()}` }, signal: AbortSignal.timeout(20_000) }));
  const items = (await response.json())?.tracks?.items ?? [];
  const track = items.find((t) => !/karaoke|instrumental|off vocal|カラオケ/i.test(t.name));
  return track ? { title: track.name, artist: track.artists?.[0]?.name ?? song.artist } : null;
}

async function lastfm(params) {
  const url = `https://ws.audioscrobbler.com/2.0/?format=json&api_key=${keys.lastfm}&${new URLSearchParams(params)}`;
  const response = await withRetries(lastfmLane, "Last.fm", () => fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) })).catch(() => null);
  return response ? response.json().catch(() => null) : null;
}

/** An artist name for comparing romanisations: "Yuki Saitou" = "Saito Yuki". */
const artistKey = (name) => String(name).toLowerCase().normalize("NFKC")
  .replace(/ou/g, "o").replace(/uu/g, "u").replace(/oo/g, "o")
  .split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort().join(" ");
const sameArtist = (a, b) => {
  const x = artistKey(a), y = artistKey(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};
/** "Zankoku na Tenshi no Thesis" matches "残酷な天使のテーゼ - Zankoku na Tenshi no Thesis". */
const sameTitle = (entry, title) => {
  const a = baseTitle(entry), b = baseTitle(title);
  return a === b || (b.length >= 4 && a.includes(b));
};

let spotifyFailures = 0;
const spotifyAllowed = () => !!(keys.id && keys.secret) && spotifyFailures < 20;

/**
 * Listeners across every Last.fm entry for this recording: its romanised name, the name
 * Spotify knows it by (often Japanese), and Last.fm search hits by the same artist under a
 * matching title. Covers by other artists don't count. Null when Last.fm doesn't know it.
 */
async function listenersFor(song) {
  const entries = new Map();
  const add = (track) => {
    if (!track?.name) return;
    const key = `${artistKey(track.artist?.name ?? track.artist)}\u0000${String(track.name).toLowerCase()}`;
    entries.set(key, Math.max(entries.get(key) ?? 0, Number(track.listeners) || 0));
  };
  const names = [[song.artist, song.title]];
  // After 20 failures in a row (a long rate limit), carry on without Spotify.
  if (keys.id && keys.secret && spotifyFailures < 20) {
    const found = await spotifyName(song).then((r) => { spotifyFailures = 0; return r; }, (e) => {
      spotifyFailures = e?.blocked ? 20 : spotifyFailures + 1;
      if (e?.blocked) console.log(`  ${e.message}: carrying on without Spotify`);
      return null;
    });
    if (found) {
      names.push([found.artist, found.title]);
      spotifyNames[listenKey(song)] = found.title;
    }
  }
  for (const [artist, title] of names) add((await lastfm({ method: "track.getInfo", autocorrect: 1, artist, track: title }))?.track);
  const hits = (await lastfm({ method: "track.search", track: `${song.title} ${song.artist}`.slice(0, 120), limit: 10 }))?.results?.trackmatches?.track ?? [];
  for (const hit of hits) if (sameArtist(hit.artist, song.artist) && sameTitle(hit.name, song.title)) add(hit);
  return entries.size ? [...entries.values()].reduce((sum, n) => sum + n, 0) : null;
}

// ── YouTube views ────────────────────────────────────────────────────────────

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** The videos on the song's search page; throws `{blocked}` when YouTube refuses. */
async function youtubeSearch(song) {
  // The singer or the whole band ("You & Explosion Band", not "You"), and the show without
  // its part or year ("Lupin III", not "Lupin III: Part II").
  const singer = song.artist.split(/,| feat\. /i)[0].trim();
  const show = song.anime.replace(/\s*[:(\[].*$/, "").trim() || song.anime;
  const query = [song.title, singer, show].join(" ");
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US`;
  const response = await youtubeLane(async () => {
    await wait(Math.random() * 1500);
    return fetch(url, {
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" },
      signal: AbortSignal.timeout(20_000),
    });
  });
  const blocked = (why) => Object.assign(new Error(`YouTube ${why}`), { blocked: true });
  if (response.status === 429 || /\/sorry\/|consent\./.test(response.url)) throw blocked(`refused (${response.status} ${response.url.slice(0, 60)})`);
  if (!response.ok) throw new Error(`YouTube answered ${response.status}`);
  const html = await response.text();
  if (/unusual traffic|detected unusual/i.test(html)) throw blocked("asked for a check");
  const data = html.match(/var ytInitialData = (\{.+?\});<\/script>/s);
  // An odd page now and then isn't a block: skip the song (it's retried next run); five in a row stop the run.
  if (!data) throw new Error("YouTube sent a page without results");
  return parseYouTubeSearch(JSON.parse(data[1])).slice(0, 30);
}
/** The song's views from its cached search, or null when it hasn't been searched. */
const viewsOf = (song) => (Array.isArray(youtube[listenKey(song)])
  ? songYouTubeViews(youtube[listenKey(song)], song, [spotifyNames[listenKey(song)]], rivalsOf(song)) : null);

// ── Song dates ─────────────────────────────────────────────────────────────────
// AnisongDB files every song under its show's first season, so One Piece's 2017 opening
// "Hope" sat in 1999. AnimeThemes says which episode each theme starts at and AniList how
// long the show ran: a later theme is dated by the show's own pace (breaks included).

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});

/** Per AniList id, each theme's first episode ("OP20" → 807); {} when AnimeThemes doesn't know the show. */
async function themeEpisodes(ids) {
  const cache = readJson(THEME_EPISODES);
  const missing = ids.filter((id) => !(id in cache));
  console.log(`Theme episodes: ${ids.length - missing.length} cached, ${missing.length} to look up`);
  for (let i = 0; i < missing.length; i += 25) {
    const chunk = missing.slice(i, i + 25);
    const url = "https://api.animethemes.moe/anime?" + [
      "filter%5Bhas%5D=resources", "filter%5Bsite%5D=AniList", `filter%5Bexternal_id%5D=${chunk.join(",")}`,
      "include=animethemes.animethemeentries,resources", "page%5Bsize%5D=25",
    ].join("&");
    const json = await withRetries(animethemesLane, "AnimeThemes", () => fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(30_000) }))
      .then((response) => response.json()).catch(() => null);
    if (!json) continue; // retried next run
    for (const id of chunk) cache[id] = {};
    for (const anime of json.anime ?? []) {
      const id = Number(anime.resources?.find((r) => r.site === "AniList")?.external_id);
      if (!cache[id]) continue;
      for (const theme of anime.animethemes ?? []) {
        const first = Number(/\d+/.exec(String(theme.animethemeentries?.[0]?.episodes ?? ""))?.[0]);
        const slug = /^(OP|ED)(\d*)/.exec(String(theme.slug ?? ""));
        if (slug && first > 0) cache[id][`${slug[1]}${slug[2] || 1}`] = first;
      }
    }
    fs.writeFileSync(THEME_EPISODES, JSON.stringify(cache));
  }
  return cache;
}

/** Per AniList id, {start, end, episodes} in ms and counts (an ongoing show's episodes are those aired). */
async function showRuns(ids) {
  const cache = readJson(SHOW_RUNS);
  const missing = ids.filter((id) => !(id in cache));
  console.log(`Show runs: ${ids.length - missing.length} cached, ${missing.length} to look up`);
  const day = (d) => (d?.year ? Date.UTC(d.year, (d.month ?? 1) - 1, d.day ?? 1) : null);
  try {
    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      const response = await withRetries(anilist, "AniList", () => fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: "query($ids:[Int]){Page(perPage:50){media(id_in:$ids,type:ANIME){id episodes status startDate{year month day} endDate{year month day} nextAiringEpisode{episode}}}}",
          variables: { ids: chunk },
        }),
      }));
      const json = await response.json();
      for (const id of chunk) cache[id] = null;
      for (const media of json?.data?.Page?.media ?? []) {
        const airing = media.nextAiringEpisode?.episode;
        cache[media.id] = {
          start: day(media.startDate),
          end: media.status === "FINISHED" ? day(media.endDate) : null,
          episodes: airing ? airing - 1 : media.episodes ?? null,
        };
      }
      fs.writeFileSync(SHOW_RUNS, JSON.stringify(cache));
    }
  } catch (error) {
    console.log(`  AniList: ${error.message}; later themes keep their show's year where it's missing`);
  }
  return cache;
}

/** The song moved to the season its theme started, when it starts after the first cour. */
function datedSong(song, episodes, runs) {
  const known = episodes[song.anilistId] ?? {};
  const number = song.number ?? 1;
  let first = known[`${song.kind}${number}`];
  if (!first) {
    // AnimeThemes lists only some of a long show's themes (Conan: endings 1, 9 and 56–75):
    // place a missing one between the nearest it does list.
    const listed = Object.entries(known).filter(([slug]) => slug.startsWith(song.kind))
      .map(([slug, ep]) => [Number(slug.slice(2)), ep]).sort((a, b) => a[0] - b[0]);
    const below = listed.filter(([n]) => n < number).at(-1);
    const above = listed.find(([n]) => n > number);
    if (below && above) first = Math.round(below[1] + ((number - below[0]) / (above[0] - below[0])) * (above[1] - below[1]));
  }
  const run = runs[song.anilistId];
  // A theme past a finished run's end belongs to the run AniList files apart (AnisongDB keeps
  // Ranma ½ Nettouhen's themes on the 18-episode first series): it's dated at the same pace.
  if (!first || first <= 13 || !run?.start || !run.episodes || (run.episodes < first && !run.end)) return song;
  const until = run.end ?? Date.now();
  const at = Math.min(Date.now(), run.start + ((until - run.start) / run.episodes) * (first - 1));
  const date = new Date(at);
  const year = date.getUTCFullYear();
  if (year === song.year) return song;
  return { ...song, year, season: `${SEASONS[Math.floor(date.getUTCMonth() / 3)]} ${year}` };
}

// ── Build ──────────────────────────────────────────────────────────────────

const now = new Date();
const thisYear = now.getUTCFullYear();
const all = [];
for (let year = ANISONGS.FIRST_YEAR; year <= thisYear; year++) {
  for (const [index, name] of SEASONS.entries()) {
    if (year === thisYear && index > Math.floor(now.getUTCMonth() / 3)) break;
    all.push(...parseAniSongs(await season(name, year, year >= thisYear - 1)));
  }
}
// Later themes of long shows move to the year they started (One Piece's "Hope" → 2017).
const laterShows = [...new Set(all.filter((s) => s.anilistId && (s.number ?? 1) >= 2).map((s) => s.anilistId))];
const episodesByShow = await themeEpisodes(laterShows);
const runsByShow = await showRuns(laterShows.filter((id) => Object.keys(episodesByShow[id] ?? {}).length));
const dated = all.map((song) => datedSong(song, episodesByShow, runsByShow));
// Each franchise's songs: a "Dandadan Opening" upload naming Otonoke (or Creepy Nuts) isn't Kakumei Douchuu.
const franchises = new Map();
for (const song of all) {
  for (const name of franchiseNames(song)) {
    if (!franchises.has(name)) franchises.set(name, new Set());
    franchises.get(name).add(song);
  }
}
// …and the shows named after it: Naruto's include Naruto Shippuuden's (a long enough name only).
const franchiseKeys = [...franchises.keys()];
const related = new Map();
const relatedNames = (name) => {
  if (!related.has(name)) related.set(name, name.length >= 6 ? franchiseKeys.filter((n) => n.startsWith(name)) : [name]);
  return related.get(name);
};
const rivalsOf = (song) => [...new Set(franchiseNames(song).flatMap(relatedNames).flatMap((n) => [...(franchises.get(n) ?? [])]))]
  .filter((s) => baseTitle(s.title) !== baseTitle(song.title))
  .map((s) => ({ title: s.title, artist: s.artist, anime: s.anime, animeJp: s.animeJp, year: s.year, anilistId: s.anilistId, kind: s.kind, number: s.number }));
console.log(`Dated ${dated.filter((song, i) => song !== all[i]).length} later themes by when they aired`);
// Merge reused songs to their original show first, so a 1979 song a 1985 film reuses
// stays in the 1970s chart.
const originals = originalSongs(dated.filter((s) => s.video));
console.log(`${all.length} songs, ${originals.length} originals with video`);

/** Every song, each year's best-known first; Last.fm and YouTube both look them all up. */
const everySong = [];
/** A song's place among its year's best-known songs (0 = most recognised). */
const placeInYear = new Map();
for (let year = ANISONGS.FIRST_YEAR; year <= thisYear; year++) {
  // Every opening and ending; of the many insert songs, each year's best-known (the rest
  // still chart on their quiz score, behind these).
  let inserts = 0;
  const ranked = rankSongs(originals.filter((s) => s.year === year), null, Infinity)
    .filter((s) => s.kind !== "IN" || inserts++ < INSERTS_PER_YEAR);
  ranked.forEach((song, place) => placeInYear.set(song, place));
  everySong.push(...ranked);
}
const candidates = everySong;
// Covers and Kids tags for every song: any of them can chart on its views.
const info = await showInfo([...new Set(everySong.map((s) => s.anilistId).filter(Boolean))]);
console.log(`AniList: ${info.size} shows, ${[...info.values()].filter((v) => v.kids).length} tagged Kids`);

const listening = fs.existsSync(LISTENING) ? JSON.parse(fs.readFileSync(LISTENING, "utf8")) : {};
const listenKey = (s) => `${baseTitle(s.title)}\u0000${s.artist.toLowerCase()}`;
const youtube = fs.existsSync(YOUTUBE) ? JSON.parse(fs.readFileSync(YOUTUBE, "utf8")) : {};

/** Last.fm (with Spotify's names) and YouTube run side by side: different services, different lanes. */
async function lookUpListening() {
if (process.env.LISTEN === "off") return;
if (listeningOn) {
  let done = 0;
  const spotified = new Set(fs.existsSync(SPOTIFIED) ? JSON.parse(fs.readFileSync(SPOTIFIED, "utf8")) : []);
  // New songs, and (while Spotify answers) songs looked up before without its names.
  // Spotify answers ~600 searches a day, so the songs the shipped decade charts show go first,
  // then each year's best-known: their Japanese names fix the counts people actually see.
  const charted = new Set();
  try {
    const shipped = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
    const byId = new Map(shipped.songs.map((s) => [s.id, s]));
    for (const set of Object.values(shipped.decades)) for (const order of Object.values(set)) for (const ids of Object.values(order)) for (const id of ids) {
      const song = byId.get(id);
      if (song) charted.add(listenKey(song));
    }
  } catch { /* no charts yet */ }
  const todo = candidates.filter((s) => !(listenKey(s) in listening) || (spotifyAllowed() && !spotified.has(listenKey(s))))
    .sort((a, b) => Number(charted.has(listenKey(b))) - Number(charted.has(listenKey(a))) || placeInYear.get(a) - placeInYear.get(b));
  console.log(`Listening: ${candidates.length - todo.length} cached, ${todo.length} to look up`);
  fs.mkdirSync(path.dirname(LISTENING), { recursive: true });
  const save = () => {
    fs.writeFileSync(LISTENING, JSON.stringify(listening));
    fs.writeFileSync(SPOTIFIED, JSON.stringify([...spotified]));
    fs.writeFileSync(SPOTIFY_NAMES, JSON.stringify(spotifyNames));
  };
  for (const song of todo) {
    if (song !== todo[0] && listenKey(song) in listening && !spotifyAllowed()) continue; // Spotify stopped answering
    const withSpotify = spotifyAllowed();
    const found = await listenersFor(song).catch(() => null);
    const before = listening[listenKey(song)];
    listening[listenKey(song)] = typeof before === "number" && (found == null || found < before) ? before : found;
    if (withSpotify && spotifyAllowed()) spotified.add(listenKey(song));
    if (++done % 100 === 0) { save(); console.log(`  ${done}/${todo.length}`); }
  }
  save();
} else {
  console.log("No Spotify/Last.fm keys: the best order falls back to quiz recognition.");
}
}

async function lookUpYouTube() {
  if (process.env.YT === "off") return;
  // Year by year, the most recognised first: every year's top songs before anyone's long tail.
  const todo = everySong.filter((s) => !Array.isArray(youtube[listenKey(s)]) && !(youtube[listenKey(s)] >= 2))
    .sort((a, b) => placeInYear.get(a) - placeInYear.get(b) || (a.year ?? 0) - (b.year ?? 0))
    .slice(0, Number(process.env.YT_MAX) || Infinity);
  console.log(`YouTube: ${everySong.length - todo.length} cached, ${todo.length} to look up`);
  fs.mkdirSync(path.dirname(YOUTUBE), { recursive: true });
  const save = () => fs.writeFileSync(YOUTUBE, JSON.stringify(youtube));
  let done = 0;
  let failures = 0;
  for (const song of todo) {
    try {
      const videos = await youtubeSearch(song);
      // An empty page now and then is YouTube's, not the song's: try again next run, but after
      // two empty answers the song has nothing on YouTube (the count is kept instead of videos).
      const before = youtube[listenKey(song)];
      youtube[listenKey(song)] = videos.length ? videos : (typeof before === "number" ? before : 0) + 1;
      failures = 0;
    } catch (error) {
      if (error.blocked || ++failures >= 5) { console.log(`  YouTube stopped after ${done}: ${error.message}. Re-run later to carry on.`); break; }
      continue;
    }
    if (++done % 50 === 0) { save(); console.log(`  YouTube ${done}/${todo.length}`); }
  }
  save();
}

await Promise.all([lookUpListening(), lookUpYouTube()]);

// Artists' Last.fm tags, to spot licensed non-anime songs among the ones with listeners.
const artistTags = fs.existsSync(ARTIST_TAGS) ? JSON.parse(fs.readFileSync(ARTIST_TAGS, "utf8")) : {};
if (keys.lastfm) {
  const played = (s) => typeof listening[listenKey(s)] === "number" || viewsOf(s) > 0;
  const artists = [...new Set(everySong.filter(played).map((s) => firstArtist(s.artist)))]
    .filter((a) => !(a in artistTags));
  console.log(`Artist tags: ${artists.length} to look up`);
  let done = 0;
  for (const artist of artists) {
    const json = await lastfm({ method: "artist.getTopTags", autocorrect: 1, artist });
    artistTags[artist] = (json?.toptags?.tag ?? []).slice(0, 15).map((t) => String(t.name).toLowerCase());
    if (++done % 200 === 0) { fs.writeFileSync(ARTIST_TAGS, JSON.stringify(artistTags)); console.log(`  ${done}/${artists.length}`); }
  }
  fs.writeFileSync(ARTIST_TAGS, JSON.stringify(artistTags));
}
/** Tagged, and none of the tags is Japanese or anime: a licensed import. Untagged artists count as anime. */
const isLicensed = (song) => {
  const tags = artistTags[firstArtist(song.artist)];
  return Array.isArray(tags) && tags.length > 0 && !tags.some((t) => ANIME_TAG.test(t));
};

// Each song with what we know about it.
const enriched = originals.map((song) => {
  const show = info.get(song.anilistId);
  const heard = listening[listenKey(song)];
  const listeners = typeof heard === "number" ? heard : null;
  const views = viewsOf(song) || null;
  return { ...song, cover: show?.cover ?? null, kids: show?.kids ?? false, listeners, views, licensed: (listeners != null || views != null) && isLicensed(song) };
});

const songs = new Map();
const ids = (list) => list.map((song) => { songs.set(song.id, song); return song.id; });
const chartSet = (list, size) => Object.fromEntries(["best", "known"].map((order) => [order, {
  OP: ids(rankSongs(list, "OP", size, CHART_PER_SHOW, order)),
  ED: ids(rankSongs(list, "ED", size, CHART_PER_SHOW, order)),
  IN: ids(rankSongs(list, "IN", size, CHART_PER_SHOW, order)),
}]));
const decades = Object.fromEntries(ANISONGS.DECADES.map((d) => [d, chartSet(enriched.filter((s) => s.year != null && decadeOf(s.year) === d), ANISONGS.CHART_SIZE)]));
const years = {};
for (let year = ANISONGS.FIRST_YEAR; year <= thisYear; year++) {
  const list = enriched.filter((s) => s.year === year);
  if (list.length) years[year] = chartSet(list, ANISONGS.YEAR_SIZE);
}
const allTime = chartSet(enriched, ANISONGS.CHART_SIZE);

const charts = { generatedAt: now.toISOString(), songs: [...songs.values()], decades, years, allTime };
fs.writeFileSync(OUTPUT, JSON.stringify(charts));
const withListeners = [...songs.values()].filter((s) => s.listeners != null).length;
const withViews = [...songs.values()].filter((s) => s.views != null).length;
console.log(`${songs.size} charted songs (${withViews} with YouTube views, ${withListeners} with Last.fm listeners); wrote ${path.relative(ROOT, OUTPUT)} (${Math.round(fs.statSync(OUTPUT).size / 1024)} KB)`);
