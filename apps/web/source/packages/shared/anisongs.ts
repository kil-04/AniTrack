/**
 * Anime openings and endings from AnisongDB (anisongdb.com), the index of Anime Music
 * Quiz's song library: every song has its show's AniList/MAL ids, the season it aired,
 * a video clip (720p "HQ" or 480p "MQ") and an mp3. `songDifficulty` is the share of
 * quiz players who recognise the song, so it ranks how well-known a song is.
 * Checked 20 Oct 2026. Kotlin twin: apps/android/.../data/AniSongs.kt.
 */
import type { ThemeSong } from "./anime-themes";

export const ANISONGS = {
  API: "https://anisongdb.com/api",
  /** Anime Music Quiz's own media hosts; all serve the same files with range requests. */
  MEDIA: "https://naedist.animemusicquiz.com",
  HOSTS: ["naedist.animemusicquiz.com", "eudist.animemusicquiz.com", "files.catbox.moe"],
  /** Decades with charts, by their first year. */
  DECADES: [1960, 1970, 1980, 1990, 2000, 2010, 2020],
  FIRST_YEAR: 1960,
  CHART_SIZE: 100,
  /** Songs in each yearly chart, per kind. */
  YEAR_SIZE: 30,
};

/** Opening, ending, or insert song (one sung inside an episode or film). */
export type SongKind = "OP" | "ED" | "IN";
export type SeasonName = "Winter" | "Spring" | "Summer" | "Fall";
export const SEASONS: SeasonName[] = ["Winter", "Spring", "Summer", "Fall"];

export interface AniSong {
  /** AnisongDB's id for this song in this show. */
  id: number;
  anilistId: number | null;
  malId: number | null;
  anime: string;
  animeJp: string | null;
  /** "Spring 1998". */
  season: string | null;
  year: number | null;
  /** "TV", "Movie", "OVA", "ONA", "Special"… as AnisongDB lists the show. */
  format: string | null;
  kind: SongKind;
  /** 1 for "Opening 1"; null when unnumbered. */
  number: number | null;
  title: string;
  artist: string;
  /** Percentage of quiz players who recognise it (0–100), when known. */
  recognition: number | null;
  /** Clip file name on the media hosts, best quality first. */
  video: string | null;
  quality: "720p" | "480p" | null;
  audio: string | null;
  /** Filled in from AniList for chart files; absent from live answers. */
  cover?: string | null;
  /** Last.fm listeners (people who play it as music), for chart files; null when Last.fm doesn't know it. */
  listeners?: number | null;
  /** YouTube views across everyone's uploads of it, for chart files; null when not looked up or none found. */
  views?: number | null;
  /** The show is tagged Kids on AniList (chart files only). */
  kids?: boolean;
  /**
   * Its Last.fm listeners aren't anime fans: the artist has no Japanese or anime tag there.
   * A licensed western song (Gilbert O'Sullivan's "Alone Again" in Maison Ikkoku), or a
   * Japanese group whose name Last.fm gives to a western act (VIP, Circus).
   */
  licensed?: boolean;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);
const FILE = /^[a-z0-9]{4,16}\.(?:webm|mp4|mp3)$/i;
const SEASON = /^(Winter|Spring|Summer|Fall) (\d{4})$/;

/** A media file name AniTrack may load ("ffr7rh.webm"); nothing with a path or host. */
export function isSongFile(value: unknown): value is string {
  return typeof value === "string" && FILE.test(value);
}

/**
 * One AnisongDB row as an AniSong; null for dubs, rebroadcasts or rows without media. Insert
 * songs count only when "Standard": AnisongDB's character songs, chants and instrumentals
 * aren't songs people play as music.
 */
export function parseAniSong(raw: unknown): AniSong | null {
  const row = obj(raw);
  if (!row || row.isDub === true || row.isRebroadcast === true) return null;
  const type = /^(Opening|Ending|Insert Song)\s*(\d+)?$/i.exec(str(row.songType, 40) ?? "");
  if (!type) return null;
  const insert = /^insert/i.test(type[1]);
  if (insert && row.songCategory !== "Standard") return null;
  const id = int(row.annSongId);
  const title = str(row.songName);
  const artist = str(row.songArtist) ?? "Unknown artist";
  const anime = str(row.animeENName) ?? str(row.animeJPName);
  if (!id || !title || !anime) return null;
  const hq = isSongFile(row.HQ) ? row.HQ : null;
  const mq = isSongFile(row.MQ) ? row.MQ : null;
  const audio = isSongFile(row.audio) ? row.audio : null;
  if (!hq && !mq && !audio) return null;
  const season = str(row.animeVintage, 20);
  const seasonMatch = season ? SEASON.exec(season) : null;
  const ids = obj(row.linked_ids);
  const difficulty = typeof row.songDifficulty === "number" && Number.isFinite(row.songDifficulty)
    ? Math.min(100, Math.max(0, row.songDifficulty)) : null;
  return {
    id,
    anilistId: int(ids?.anilist),
    malId: int(ids?.myanimelist),
    anime,
    animeJp: str(row.animeJPName),
    season: seasonMatch ? season : null,
    year: seasonMatch ? Number(seasonMatch[2]) : null,
    format: str(row.animeType, 20),
    kind: insert ? "IN" : type[1].toLowerCase() === "opening" ? "OP" : "ED",
    number: !insert && type[2] ? Number(type[2]) : null,
    title,
    artist,
    recognition: difficulty,
    video: hq ?? mq,
    quality: hq ? "720p" : mq ? "480p" : null,
    audio,
  };
}

/** An AnisongDB answer (a JSON array of rows) as songs, each song once. */
export function parseAniSongs(json: unknown): AniSong[] {
  if (!Array.isArray(json)) throw new Error("AnisongDB sent an unreadable answer.");
  const out = new Map<number, AniSong>();
  for (const raw of json.slice(0, 5000)) {
    const song = parseAniSong(raw);
    if (song && !out.has(song.id)) out.set(song.id, song);
  }
  return [...out.values()];
}

export const songVideoUrl = (song: AniSong): string | null => (song.video ? `${ANISONGS.MEDIA}/${song.video}` : null);
export const songAudioUrl = (song: AniSong): string | null => (song.audio ? `${ANISONGS.MEDIA}/${song.audio}` : null);

/** Only AnisongDB's media hosts, over HTTPS. */
export function isSongMedia(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ANISONGS.HOSTS.includes(parsed.hostname) && FILE.test(parsed.pathname.slice(1));
  } catch {
    return false;
  }
}

/** "OP1", "ED", as the theme player shows it. */
export const songSlug = (song: AniSong) => (song.kind === "IN" ? "Insert" : `${song.kind}${song.number ?? ""}`);

/** The song in the shape both apps' theme players and video viewers take. */
/**
 * A title page's theme songs with AnisongDB's clips filling the gaps: an AnimeThemes song
 * without a video (or audio) takes the clip of the same kind and number ("OP1", "ED2-TV" →
 * ED2), songs AnimeThemes doesn't list come after its own, and a show AnimeThemes doesn't
 * know is AnisongDB's songs alone. AnimeThemes' own creditless videos still come first.
 */
export function withSongClips(themes: ThemeSong[], clips: AniSong[]): ThemeSong[] {
  // Title pages list openings and endings; insert songs stay in the Songs section.
  const playable = clips.filter((clip) => clip.kind !== "IN" && (clip.video || clip.audio));
  const covered = new Set(themes.map((theme) => /^(OP|ED)(\d*)/.exec(theme.slug)).filter(Boolean).map((m) => `${m![1]}${m![2] || 1}`));
  // Songs AnimeThemes doesn't list at all (God Mars' endings), after its own.
  const extra = playable.filter((clip) => !covered.has(`${clip.kind}${clip.number ?? 1}`)).map(toThemeSong);
  return [...themes.map((theme) => {
    if ((theme.videoUrl || theme.nsfw) && theme.audioUrl) return theme;
    const slug = /^(OP|ED)(\d*)/.exec(theme.slug);
    const number = slug?.[2] ? Number(slug[2]) : 1;
    const clip = slug ? clips.find((c) => c.kind === slug[1] && (c.number ?? 1) === number) : undefined;
    if (!clip) return theme;
    return {
      ...theme,
      videoUrl: theme.videoUrl ?? (theme.nsfw ? null : songVideoUrl(clip)),
      audioUrl: theme.audioUrl ?? songAudioUrl(clip),
    };
  }), ...extra];
}

export function toThemeSong(song: AniSong): ThemeSong {
  return {
    animeId: song.anilistId ?? 0,
    animeTitle: song.anime,
    cover: song.cover ?? null,
    slug: songSlug(song),
    // The theme players know openings and endings; an insert plays as one.
    type: song.kind === "ED" ? "ED" : "OP",
    title: song.title,
    artists: [song.artist],
    episodes: null,
    spoiler: false,
    nsfw: false,
    audioUrl: songAudioUrl(song),
    videoUrl: songVideoUrl(song),
  };
}

/**
 * A title without its version tags, so a song's versions count as one:
 * "FLY ME TO THE MOON <Rei (#5) Remix Version>", "Ora wa Ninkimono 25thMIX" and
 * "Ora wa Ninkimono 2019MIX" all become their plain title.
 */
export function baseTitle(title: string): string {
  const base = title.toLowerCase()
    .replace(/<[^>]*>|\[[^\]]*\]|[(~][^)~]*(?:ver|version|mix|remix|edit|size|cover|arrange)[^)~]*[)~]|\s-[^-]*(?:ver|version|mix|remix|edit|size)[^-]*-?\s*$/g, " ")
    .replace(/[\s~-]*(?:\d+(?:st|nd|rd|th)?\s*)?(?:re)?mix\s*$/, " ")
    .replace(/[\s~-]*(?:tv|full|short|long)?\s*(?:ver\.?|version)\s*$/, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return base || title.toLowerCase().trim();
}
// Openings and endings merge with each other, insert songs only with insert songs: a song first
// heard inside a 1990 OVA is still the ending it became in 1993.
const group = (song: AniSong) => (song.kind === "IN" ? "in" : "theme");
const songKey = (song: AniSong) => `${group(song)}\u0000${baseTitle(song.title)}\u0000${song.artist.toLowerCase()}`;
const showKey = (song: AniSong) => `${group(song)}\u0000${song.anilistId ?? song.anime.toLowerCase()}\u0000${baseTitle(song.title)}`;
/** Earlier first; in the same year a TV series before its films and specials. */
const isEarlier = (a: AniSong, b: AniSong) =>
  (a.year ?? 9999) - (b.year ?? 9999) || (a.format === "TV" ? 0 : 1) - (b.format === "TV" ? 0 : 1)
  // The same year, an opening or ending over an insert of the same recording.
  || (a.kind === "IN" ? 1 : 0) - (b.kind === "IN" ? 1 : 0) || a.id - b.id;

/**
 * Each song once, under its original show: the earliest (a TV series before its films)
 * of the shows that use the same recording, scored by its best-known use. A remake by
 * another artist is another song.
 */
export function originalSongs(songs: AniSong[]): AniSong[] {
  const merge = (list: AniSong[], keyOf: (song: AniSong) => string) => {
    const best = new Map<string, AniSong>();
    for (const song of list) {
      const key = keyOf(song);
      const held = best.get(key);
      if (!held) { best.set(key, song); continue; }
      const original = isEarlier(song, held) < 0 ? song : held;
      const scores = [song.recognition, held.recognition].filter((v): v is number => v != null);
      const heard = [song.listeners, held.listeners].filter((v): v is number => v != null);
      const watched = [song.views, held.views].filter((v): v is number => v != null);
      best.set(key, {
        ...original,
        recognition: scores.length ? Math.max(...scores) : null,
        ...(heard.length ? { listeners: Math.max(...heard) } : {}),
        ...(watched.length ? { views: Math.max(...watched) } : {}),
      });
    }
    return [...best.values()];
  };
  // An "insert" that's the same recording as an opening or ending somewhere is that theme
  // played again (Get Wild inside City Hunter 2), not an insert song of its own.
  const recording = (song: AniSong) => `${baseTitle(song.title)}\u0000${song.artist.toLowerCase()}`;
  const themes = new Set(songs.filter((song) => song.kind !== "IN").map(recording));
  const own = songs.filter((song) => song.kind !== "IN" || !themes.has(recording(song)));
  // The same recording across shows, then one song's versions within a show
  // (a show's re-recordings by other singers are still its one theme).
  return merge(merge(own, songKey), showKey);
}

/** "best": what people listen to as music; "known": what most fans recognise. */
export type ChartOrder = "best" | "known";

/** Charted songs with both counts have a median of 384 YouTube views per Last.fm listener. */
const VIEWS_PER_LISTENER = 384;

/**
 * The plays a song is ranked on: its YouTube views, across everyone's uploads. Only a song
 * YouTube found nothing for falls back on Last.fm, at the median rate. A licensed song's
 * plays aren't anime fans', and neither count is used for it.
 */
function plays(song: AniSong): { count: number; source: "views" | "listeners" } | null {
  if (song.licensed) return null;
  if (song.views) return { count: song.views, source: "views" };
  return song.listeners ? { count: song.listeners * VIEWS_PER_LISTENER, source: "listeners" } : null;
}

/**
 * A song's "best" score (0–100), from how much people play it (plays): a log scale where
 * 1M views ≈ 43, 10M ≈ 60, 100M ≈ 78 and 2B = 100; the charts show it with a bar. A song
 * neither YouTube nor Last.fm knows gets half its quiz recognition, and a Kids show's song
 * counts 60%: those are known by everyone but rarely played as music.
 */
export function bestScore(song: AniSong): number | null {
  const played = plays(song);
  const base = played ? Math.min(100, Math.log10(played.count / 3000 + 1) * 17.17) : song.recognition != null ? song.recognition * 0.5 : null;
  return base == null ? null : song.kids ? base * 0.6 : base;
}

// ── YouTube views (chart builder) ───────────────────────────────────────────

/** One video on a YouTube search page. */
export interface YouTubeVideo { id: string; title: string; channel: string; views: number; seconds: number | null }

const runs = (v: unknown): string => {
  const o = obj(v);
  if (!o) return "";
  if (typeof o.simpleText === "string") return o.simpleText;
  return Array.isArray(o.runs) ? o.runs.map((r) => (typeof obj(r)?.text === "string" ? obj(r)!.text : "")).join("") : "";
};

/** The videos in a search page's ytInitialData, in page order. */
export function parseYouTubeSearch(data: unknown): YouTubeVideo[] {
  const out: YouTubeVideo[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 40 || out.length >= 60) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
    const o = obj(node);
    if (!o) return;
    const v = obj(o.videoRenderer);
    if (v) {
      const id = typeof v.videoId === "string" ? v.videoId : "";
      const views = runs(v.viewCountText);
      const length = runs(v.lengthText).split(":").map(Number);
      if (/^[\w-]{11}$/.test(id) && /\d|no views/i.test(views)) {
        out.push({
          id, title: runs(v.title), channel: runs(v.ownerText),
          views: Number(views.replace(/[^\d]/g, "")) || 0,
          seconds: length.length >= 2 && length.every(Number.isFinite) ? length.reduce((sum, n) => sum * 60 + n, 0) : null,
        });
      }
      return;
    }
    Object.values(o).forEach((n) => walk(n, depth + 1));
  };
  walk(data, 0);
  return out;
}

const fold = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const KANA: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o", か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so", た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no", は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo", や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro", わ: "wa", を: "wo", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do", ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po", ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o", ゔ: "vu",
};
const SMALL_Y: Record<string, string> = { ゃ: "a", ゅ: "u", ょ: "o" };

/** Kana spelled in romaji (おどるポンポコリン → odoruponpokorin); everything else as it is. */
export function kanaToRomaji(text: string): string {
  // Katakana as hiragana: the same table serves both.
  const chars = [...text.normalize("NFKC")].map((c) => {
    const code = c.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : c;
  });
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "っ") { const next = KANA[chars[i + 1]]; if (next) out += next[0]; continue; }
    if (c === "ー") continue;
    const kana = KANA[c];
    if (!kana) { out += c; continue; }
    const y = SMALL_Y[chars[i + 1]];
    if (y && kana.endsWith("i") && kana.length > 1) {
      // きゃ → kya, しゃ → sha, ちゅ → chu, じょ → jo
      const stem = kana.slice(0, -1);
      out += /(?:sh|ch|j)$/.test(stem) ? stem + y : `${stem}y${y}`;
      i++;
      continue;
    }
    out += kana;
  }
  return out;
}

/** Words a song title is matched on: particles and version words don't need to be there. */
const MINOR = new Set(["no", "wo", "wa", "ga", "to", "ni", "de", "e", "mo", "the", "a", "an", "of"]);
const titleWords = (title: string) => baseTitle(title).split(" ").map(fold).filter((w) => w && !MINOR.has(w));
/** "Lupin III: Part II" → also "Lupin III"; "Gegege no Kitarou (1985)" → also "Gegege no Kitarou"; "Love Live! School Idol Project" → also "Love Live!". */
const showNames = (names: (string | null)[]) => [...new Set(names.flatMap((n) => (n
  ? [n, n.replace(/\s*[:(\[].*$/, ""), n.replace(/\s+(?:part|season|series)\s+\S+$/i, ""), n.replace(/([!?])\s.*$/, "$1"),
    // "City Hunter 2", "Lupin III Part II", "Bleach 2nd Season" → also the first show's name.
    n.replace(/\s*[:(\[].*$/, "").replace(/\s+(?:\d{1,2}|[IVX]{1,4}|\d+(?:st|nd|rd|th)(?:\s+season)?)$/i, "")]
  : [])).map(fold).filter((v) => v.length >= 4))];

/** The names a song's show goes by, sequels' first-season name among them: its franchise. */
export const franchiseNames = (song: AniSong): string[] => showNames([song.anime, song.animeJp]);

/** A romaji word: syllables like "ko", "shi", "tsu", "kyou", with "n" and doubled consonants. */
const ROMAJI = /^(?:(?:[kgsztdnhbpmyrwfjv]|ch|sh|ts)?y?[aiueo]|n|[kstpc](?=[kstpc]))+$/;
const PARTICLES = new Set(["no", "wo", "wa", "ga", "ni", "de", "to", "yo", "na", "mo", "e"]);

/**
 * "Zankoku na Tenshi no Thesis" or "Odoru Ponpokorin": a particle beside a real romaji word,
 * or mostly romaji words and 8+ letters. Not "Get Wild", "Ai no Story" or "SARA".
 */
export function readsAsJapanese(title: string): boolean {
  const all = baseTitle(title).split(" ").filter(Boolean);
  const words = all.filter((w) => !MINOR.has(w));
  const romaji = words.filter((w) => ROMAJI.test(w));
  if (all.some((w) => PARTICLES.has(w)) && romaji.some((w) => w.length >= 4)) return true;
  return words.join("").length >= 8 && romaji.length * 2 >= words.length + 1;
}

/** Videos about many songs, or about something else. */
const NOT_THE_SONG = /\btop\s*\d+|ranking|\ball\s+(?:the\s+)?(?:openings|endings|op|ed)s?\b|\bevery\s+(?:opening|ending)|compilation|medley|メドレー|\breact(?:ion|s|ing)?\b|but it'?s/i;
const THEME: Record<"OP" | "ED", RegExp> = {
  // "Opening 2", "Opening #2", "OP No.2".
  OP: /(?:\bopening|\bintro|オープニング|\bop(?![a-z]))\s*(?:#|no\.?\s*)?(\d+)?/i,
  ED: /(?:\bending|\boutro|エンディング|\bed(?![a-z]))\s*(?:#|no\.?\s*)?(\d+)?/i,
};

/**
 * Views of everyone's uploads of `song` among a search's results: re-uploads, full and TV
 * versions, lyric and live videos, covers and fan edits. A video counts when its title has
 * every word of the song's name, in romaji or kana ("Lupin III Theme" for "Lupin III no
 * Theme", おどるポンポコリン for "Odoru Ponpokorin"; a short name like "SARA" also needs the
 * show or artist), when it's the show's opening/ending with this song's number (not another
 * season's, and not naming another of `rivals`, the franchise's other songs, or their singers),
 * or when it's the artist's official "- Topic" upload titled in Japanese. Compilations,
 * rankings, reactions and anything over 15 minutes don't.
 */
export function songYouTubeViews(
  videos: YouTubeVideo[], song: AniSong, otherNames: (string | null | undefined)[] = [], rivals: SongRival[] = [],
): number {
  const words = titleWords(song.title);
  // "THE HERO !! ~Ikareru Kobushi ni Hi o Tsukero~" is mostly uploaded as "THE HERO!!".
  // Not when that main title is the show's name ("CITY HUNTER ~Ai yo Kienaide~") or another of
  // the franchise's songs ("memories ~17years after~" beside One Piece's ending "memories").
  const showWords = showNames([song.anime, song.animeJp]);
  // A trailing "(…)" is one too ("STILL LOVE HER(Ushinawareta Fuukei)"), a middle one isn't ("Sogeking (Hero) no Uta").
  const mainOf = (title: string) => title.replace(/\s*[~～].*$/, "").replace(/\s*[(（][^)）]*[)）]\s*$/, "");
  const main = mainOf(song.title);
  // An insert also yields to a theme of that name ("Departures~Blessing~" to Guilty Crown's ending).
  const rivalNames = new Set(rivals.flatMap((r) => [fold(baseTitle(r.title)), ...(song.kind === "IN" && r.kind !== "IN" ? [fold(mainOf(r.title))] : [])]));
  const mainWords = main !== song.title && !showWords.some((n) => n.includes(fold(main))) && !rivalNames.has(fold(main))
    ? titleWords(main) : [];
  // …and not on an upload naming a longer title with the same start ("Departures ~Blessing~").
  const longerRivals = mainWords.length ? rivals.map((r) => titleWords(r.title))
    .filter((w) => w.length > mainWords.length && mainWords.every((m) => w.includes(m)) && w.join("") !== words.join("")) : [];
  const longWords = words.filter((w) => w.length >= 3);
  // …when what's left isn't only the show's name ("THEME FROM LUPIN Ⅲ" isn't "Lupin III no Ai no Theme"),
  // unless the show is named after the song (the film "Macross: Ai Oboete Imasu ka").
  const kanjiWords = words.some((w) => w.length < 3 && /^[a-z]+$/.test(w)) && words.every((w) => w.length >= 3 || /^[a-z]+$/.test(w))
    && (longWords.filter((w) => !showWords.some((n) => n.includes(w))).join("").length >= 8
      || showWords.some((n) => n.includes(fold(song.title))));
  // The track's own name elsewhere (Spotify's ラムのラブソング for "Lum no Love Song").
  const aliases = otherNames.filter((n): n is string => !!n).map(fold).filter((n) => n.length >= 2 && n !== words.join(""));
  // Only a long name that reads as Japanese counts without the show or artist beside it. An
  // English one ("Cheap Thrills", "She's so lovely") would count Sia's or Scouting for Girls'
  // song, and a short Japanese one can be another show's ("Jiyuu no Tsubasa": Captain Tylor's
  // 1994 ending, and Attack on Titan's).
  const short = !(readsAsJapanese(song.title) && words.length >= 2 && words.join("").length >= 14);
  // A band like "You & Explosion Band" is its whole name; a duet's first singer is theirs.
  // Long vowels spelled either way: AnisongDB's "Yuuko Matsutani" is YouTube's "Yuko Matsutani - Topic".
  const vowels = (text: string) => text.replace(/ou/g, "o").replace(/uu/g, "u").replace(/oo/g, "o");
  // Two letters are a name only outside the Latin alphabet: Love Live!'s "μ's".
  const artists = [...new Set([song.artist, song.artist.split(/,| feat\.| & | x /i)[0] ?? ""].map((a) => vowels(fold(a))))]
    .filter((a) => a.length >= 3 || (a.length === 2 && /[^a-z0-9]/.test(a)));
  const shows = showNames([song.anime, song.animeJp]);
  // "Opening 2" alone names a theme beside the show's whole name, or its short name when it's the
  // franchise's first show: "Demon Slayer Opening 1" is Gurenge, not the Entertainment District
  // Arc's, and "Fairy Tail ED 6" is the 2009 show's.
  const ownShows = [song.anime, song.animeJp].filter((n): n is string => !!n).map(fold).filter((v) => v.length >= 4);
  // The song's own show: its other songs share its AniList id (or, without one, its name).
  const sameShow = (r: SongRival) => (song.anilistId != null && r.anilistId != null ? r.anilistId === song.anilistId : r.anime === song.anime);
  const showYear = Math.min(song.year ?? Infinity, ...rivals.filter((r) => sameShow(r) && r.year != null).map((r) => r.year!));
  const first = !rivals.some((r) => !sameShow(r) && r.year != null && r.year < showYear);
  const themeNames = first ? shows : ownShows;
  // The franchise's other songs, by their words: not a 2-letter "ai" (in every title), nor one
  // named after the show itself (1969 Dororo's "Dororo" is in every Dororo upload).
  const own = words.join("");
  const rivalWords = rivals.flatMap((r) => [titleWords(r.title), titleWords(mainOf(r.title))])
    .filter((w) => w.join("").length >= 4 && w.join("") !== own && w.join("") !== fold(main)
      && !w.every((x) => ownShows.some((n) => n.includes(x))));
  // …their shows' names ("Lupin III: The First Opening", "No Game No Life: Zero OP" aren't the first show's)…
  // (long vowels either way: "Naruto Shippuden" is AnisongDB's "Naruto: Shippuuden")
  const rivalShows = [...new Set(rivals.flatMap((r) => [r.anime, r.animeJp ?? ""]).map((n) => vowels(fold(n))))]
    .filter((n) => n.length >= 6 && !ownShows.some((o) => vowels(o).includes(n)) && themeNames.some((t) => n.includes(vowels(t))));
  // …and their singers ("DAN DA DAN Season 2 OP | On The Way by AiNA THE END" isn't Otonoke).
  const rivalArtists = [...new Set(rivals.map((r) => vowels(fold(r.artist))))]
    .filter((a) => a.length >= 4 && !artists.some((own) => own.includes(a) || a.includes(own)) && !shows.some((n) => n.includes(a)));
  const sequel = sequelOf(`${song.anime} ${song.animeJp ?? ""}`);
  // A "Season 2" upload is another season's only when the franchise has that season under its
  // own name: AnisongDB files Dandadan's second season as plain "Dandadan".
  const seasons = new Set(rivals.map((r) => sequelOf(r.anime)));
  // Then same-named shows are seasons in the order they aired, a year each (One Punch Man's 2015
  // series, OVA and specials, then 2019's season 2).
  const sameName = rivals.filter((r) => !sameShow(r) && ownShows.includes(fold(r.anime)) && r.year != null);
  const earlier = new Set(sameName.filter((r) => r.year! < showYear).map((r) => r.year)).size;
  const sameSeason = (title: string) => {
    const n = sequelOf(title);
    return n === sequel || (sequel === 1 && !seasons.has(n) && n === earlier + 1);
  };
  // A bare "Opening 1" is ambiguous when a same-named show of another year has an opening 1 too
  // (One Punch Man's three seasons, My Hero Academia's first two).
  const twin = sameName.some((r) => r.kind === song.kind && (r.number ?? 1) === (song.number ?? 1));
  const isTopic = (channel: string) => artists.some((a) => channel === `${a}topic`);
  // An untitled Topic upload could be any of the artist's songs for the franchise (Galla's
  // two Initial D endings, Mikio Sakai's opening and insert): then it counts only when its kana
  // sound out the song's name (ラムのラブソング: r-m-n-r-b-s-n-g, as "Lum no Love Song").
  const sounds = soundsOf(fold(baseTitle(song.title)));
  // Kanji can't be sounded out, but the kana beside them can: 魂のルフラン's "no rufuran" is
  // n-r-f-r-n, the end of "Tamashii no Refrain".
  const soundsLike = (title: string) => {
    const heard = fold(kanaToRomaji(title)).split(/[^a-z0-9]+/).map(soundsOf).join("");
    return heard.length >= 4 && sounds.length >= 4 && sounds.includes(heard);
  };
  const sharedArtist = rivals.some((r) => artists.includes(vowels(fold(r.artist)))
    || artists.includes(vowels(fold(r.artist.split(/,| feat\.| & | x /i)[0] ?? ""))));
  // A Japanese upload names its song in 「」: kana that sound like another of the franchise's
  // songs are that one's (ONE PIECE オープニングテーマ「あーーっす！」 is "Uuuuus!", not "We Are!").
  const rivalSounds = new Set(rivals.map((r) => soundsOf(fold(baseTitle(r.title)))).filter((v) => v && v !== sounds));
  const namesOtherSong = (title: string) => [...title.matchAll(/[「『]([^」』]+)[」』]/g)].some(([, quoted]) => {
    const name = fold(kanaToRomaji(quoted));
    return name.length >= 3 && rivalSounds.has(soundsOf(name)) && !words.every((w) => name.includes(w));
  });
  const seen = new Set<string>();
  let total = 0;
  let topic = false;
  const counted: { video: YouTubeVideo; official: boolean }[] = [];
  for (const video of videos) {
    if (seen.has(video.id) || NOT_THE_SONG.test(video.title) || (video.seconds != null && video.seconds > 15 * 60)) continue;
    const titles = [fold(video.title), fold(kanaToRomaji(video.title))];
    const channel = vowels(fold(video.channel));
    const has = (text: string) => titles.some((t) => t.includes(text));
    const ofShow = shows.some(has);
    const byArtist = artists.some((a) => titles.some((t) => vowels(t).includes(a)) || channel.includes(a));
    const named = (words.length > 0 && words.every(has) && (!short || ofShow || byArtist))
      || (mainWords.length > 0 && mainWords.every(has) && (ofShow || byArtist) && !longerRivals.some((w) => w.every(has)))
      // A one- or two-letter word is often a kanji in Japanese titles: 愛・おぼえていますか is
      // "Ai Oboete Imasu ka", on the artist's or show's upload.
      || (kanjiWords && /[㐀-鿿]/.test(video.title) && longWords.every(has) && (ofShow || byArtist))
      || aliases.some((name) => has(name) && (name.length >= 4 || ofShow || byArtist));
    let themed = false;
    // An insert song has no "Opening 2" of its own to look for, and a video naming another of
    // the show's songs is that one's ("Atashi ga Tonari ni Iru Uchi ni (Shield Hero Ending Theme)").
    if (!named && song.kind !== "IN" && themeNames.some(has) && sameSeason(video.title) && !rivalShows.some((n) => titles.some((t) => vowels(t).includes(n)))
      && !rivalWords.some((w) => w.every(has)) && !rivalArtists.some((a) => titles.some((t) => vowels(t).includes(a)) || channel.includes(a))
      && !namesOtherSong(video.title)) {
      // The first "Opening" with a number decides ("OP / Opening 2" is opening 2).
      const matches = [...video.title.matchAll(new RegExp(THEME[song.kind].source, "gi"))];
      const numbered = matches.find((m) => m[1]);
      // With a same-named later season, an upload naming no season is the first one's.
      const thisSeason = !twin || earlier === 0 || namesSeason(video.title);
      if (numbered) themed = Number(numbered[1]) === (song.number ?? 1) && thisSeason;
      else if (matches.length) themed = (song.number ?? 1) === 1 && thisSeason;
    }
    const official = !named && !themed && !topic && isTopic(channel)
      && (!sharedArtist || soundsLike(video.title))
      // Titled in Japanese: the artist's "4:00 A.M." on the same channel is another song.
      && /[぀-ヿ㐀-鿿]/.test(video.title) && !/[a-z]{3}/i.test(video.title);
    if (!named && !themed && !official) continue;
    if (official) topic = true;
    seen.add(video.id);
    counted.push({ video, official });
  }
  // The artist's Topic channel already uploaded it under a name we know: its other untitled
  // uploads are other songs (Nakano-ke no Itsutsugo's はつこい beside 五等分のカタチ).
  const topicNamed = counted.some(({ video, official }) => !official && isTopic(vowels(fold(video.channel))));
  for (const { video, official } of counted) if (!official || !topicNamed) total += video.views;
  return total;
}

/** A name's consonants as Japanese hears them: "lumnolovesong" and "ramunorabusongu" are both "rmnrbsng". */
function soundsOf(text: string): string {
  if (/[^a-z0-9]/.test(text)) return ""; // kanji left over: nothing to compare
  return text.replace(/l/g, "r").replace(/v/g, "b").replace(/c(?!h)/g, "k").replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");
}

/** Another song of the same franchise, which a "Show Opening" upload may be about instead. */
export interface SongRival {
  title: string; artist: string; anime: string; animeJp?: string | null; year: number | null;
  anilistId?: number | null; kind?: SongKind; number?: number | null;
}

/** A title that names its season or part, even the first ("Lupin III Part 1 Opening"). */
const namesSeason = (title: string) => /\bseason\s*\d|\b\d+(?:st|nd|rd|th)\s+season|\bpart\s*\d|第\s*\d+\s*期|\bs\d\b/i.test(title);

/** The season or part a title names ("Season 2", "2nd Season", "Part 2", "第2期"); 1 when it names none. */
function sequelOf(title: string): number {
  const match = /\bseason\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s+season|\bpart\s*(\d+)|第\s*(\d+)\s*期|\bs(\d)\b/i.exec(title);
  return match ? Number(match.slice(1).find(Boolean)) : 1;
}

/** Which number decided a song's "best" score: its YouTube views, its Last.fm listeners, or (neither) its quiz score. */
export function bestSource(song: AniSong): "views" | "listeners" | "quiz" {
  return plays(song)?.source ?? "quiz";
}

const scoreOf = (song: AniSong, order: ChartOrder) => (order === "best" ? bestScore(song) : song.recognition);

/**
 * A chart: by the order's score, then the older show. Each song once, under its original
 * show (originalSongs); songs without a video are left out; at most `perShow` songs a show.
 */
export function rankSongs(songs: AniSong[], kind: SongKind | null = null, limit = ANISONGS.CHART_SIZE, perShow = Infinity, order: ChartOrder = "known"): AniSong[] {
  const ranked = originalSongs(songs.filter((song) => song.video && (!kind || song.kind === kind)))
    .map((song) => ({ song, score: scoreOf(song, order) }))
    .filter((entry): entry is { song: AniSong; score: number } => entry.score != null)
    .sort((a, b) => b.score - a.score || (a.song.year ?? 9999) - (b.song.year ?? 9999) || a.song.id - b.song.id)
    .map((entry) => entry.song);
  const counts = new Map<string, number>();
  const out: AniSong[] = [];
  for (const song of ranked) {
    const show = String(song.anilistId ?? song.anime.toLowerCase());
    const seen = counts.get(show) ?? 0;
    if (seen >= perShow) continue;
    counts.set(show, seen + 1);
    out.push(song);
    if (out.length >= limit) break;
  }
  return out;
}

/** Decade and all-time charts keep at most this many songs a show. */
export const CHART_PER_SHOW = 4;

export const decadeOf = (year: number) => Math.floor(year / 10) * 10;
export const decadeLabel = (decade: number) => `${decade}s`;

/** The season a date falls in, as anime seasons run (Winter = Jan–Mar). */
export function seasonOf(date: Date): { season: SeasonName; year: number } {
  return { season: SEASONS[Math.floor(date.getUTCMonth() / 3)], year: date.getUTCFullYear() };
}

/** The season before this one ("Winter 2026" → "Fall 2025"). */
export function previousSeason(season: SeasonName, year: number): { season: SeasonName; year: number } {
  const index = SEASONS.indexOf(season);
  return index === 0 ? { season: "Fall", year: year - 1 } : { season: SEASONS[index - 1], year };
}

export function isSeasonQuery(season: unknown, year: unknown, now = new Date()): boolean {
  return SEASONS.includes(season as SeasonName) && Number.isInteger(year)
    && (year as number) >= ANISONGS.FIRST_YEAR && (year as number) <= now.getUTCFullYear() + 1;
}

export type SongSearchBy = "song" | "artist" | "anime";

/** The JSON body of an AnisongDB search_request. */
/**
 * AnisongDB's refusal in place of songs, said plainly: it turns text search off while Anime
 * Music Quiz runs ranked games ({"detail":"… disabled during ranked time"}), a few times a day.
 */
export function anisongdbRefusal(json: unknown): string | null {
  const detail = obj(json)?.detail;
  if (typeof detail !== "string") return null;
  return /ranked/i.test(detail)
    ? "AnisongDB pauses song search while Anime Music Quiz runs its ranked games. Try again in a little while."
    : `AnisongDB couldn't search right now (${detail.slice(0, 120)}).`;
}

export function searchBody(query: string, by: SongSearchBy): Json {
  const search = { search: query.trim().slice(0, 100), partial_match: true };
  return {
    ...(by === "anime" ? { anime_search_filter: search } : {}),
    ...(by === "song" ? { song_name_search_filter: search } : {}),
    ...(by === "artist" ? { artist_search_filter: { ...search, group_granularity: 0, max_other_artist: 99 } } : {}),
    and_logic: false,
    ignore_duplicate: false,
    opening_filter: true,
    ending_filter: true,
    insert_filter: false,
  };
}

/** One chart scope's lists: each order, each kind. */
export interface ChartSet { best: Record<SongKind, AniSong[]>; known: Record<SongKind, AniSong[]> }

/** Charts shipped with both apps (built by scripts/build-song-charts.mjs). */
export interface SongCharts {
  generatedAt: string;
  /** Keyed by decade start ("1990"). */
  decades: Record<string, ChartSet>;
  /** Keyed by year ("1998"), from 1960 to the year the charts were built. */
  years: Record<string, ChartSet>;
  allTime: ChartSet;
}

function parseSong(raw: unknown): AniSong | null {
  const s = obj(raw);
  if (!s || !int(s.id) || (s.kind !== "OP" && s.kind !== "ED" && s.kind !== "IN") || !str(s.title) || !str(s.anime)) return null;
  if (s.video != null && !isSongFile(s.video)) return null;
  if (s.audio != null && !isSongFile(s.audio)) return null;
  const cover = str(s.cover, 500);
  return {
    id: s.id as number,
    anilistId: int(s.anilistId), malId: int(s.malId),
    anime: str(s.anime)!, animeJp: str(s.animeJp),
    season: str(s.season, 20), year: int(s.year), format: str(s.format, 20),
    kind: s.kind, number: int(s.number),
    title: str(s.title)!, artist: str(s.artist) ?? "Unknown artist",
    recognition: typeof s.recognition === "number" ? s.recognition : null,
    video: (s.video as string | null) ?? null,
    quality: s.quality === "720p" || s.quality === "480p" ? s.quality : null,
    audio: (s.audio as string | null) ?? null,
    cover: cover && cover.startsWith("https://") ? cover : null,
    listeners: typeof s.listeners === "number" && s.listeners >= 0 ? s.listeners : null,
    views: typeof s.views === "number" && s.views >= 0 ? s.views : null,
    kids: s.kids === true,
    licensed: s.licensed === true,
  };
}

/**
 * Reads a chart file: `songs` once each, and every chart as a list of their ids
 * (`{decades: {"1990": {best: {OP: [ids], ED: [ids]}, known: {…}}}, years, allTime}`).
 */
export function parseCharts(json: unknown): SongCharts {
  const root = obj(json);
  if (!root || typeof root.generatedAt !== "string") throw new Error("Unreadable song charts.");
  const byId = new Map<number, AniSong>();
  for (const raw of Array.isArray(root.songs) ? root.songs.slice(0, 50_000) : []) {
    const song = parseSong(raw);
    if (song) byId.set(song.id, song);
  }
  const list = (value: unknown): AniSong[] =>
    (Array.isArray(value) ? value.slice(0, ANISONGS.CHART_SIZE) : []).map((id) => byId.get(id as number)).filter((s): s is AniSong => !!s);
  const pair = (value: unknown) => ({ OP: list(obj(value)?.OP), ED: list(obj(value)?.ED), IN: list(obj(value)?.IN) });
  const set = (value: unknown): ChartSet => ({ best: pair(obj(value)?.best), known: pair(obj(value)?.known) });
  const decades: SongCharts["decades"] = {};
  for (const decade of ANISONGS.DECADES) decades[String(decade)] = set(obj(root.decades)?.[String(decade)]);
  const years: SongCharts["years"] = {};
  const rawYears = obj(root.years);
  for (const key of Object.keys(rawYears ?? {})) {
    const year = Number(key);
    if (/^\d{4}$/.test(key) && year >= ANISONGS.FIRST_YEAR && year <= 2100) years[key] = set(rawYears![key]);
  }
  return { generatedAt: root.generatedAt, decades, years, allTime: set(root.allTime) };
}
