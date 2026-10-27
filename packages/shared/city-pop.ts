/** Curated artist/label YouTube releases. The player streams through YouTube itself. */
import catalog from "../catalogs/city-pop.json";

export type CityPopMood = "night-drive" | "sunset" | "after-hours";

export interface CityPopTrack {
  id: string;
  title: string;
  artist: string;
  /** Original release year when verified; never the upload or reissue year. */
  year: number | null;
  videoId: string;
  channel: string;
  moods: CityPopMood[];
  note: string;
  sourceUrl: string;
}

export const CITY_POP_STATIONS: readonly { id: CityPopMood; title: string; subtitle: string }[] = Object.freeze([
  Object.freeze({ id: "night-drive" as const, title: "Night Drive", subtitle: "Neon lights and a road with no hurry." }),
  Object.freeze({ id: "sunset" as const, title: "Sunset Coast", subtitle: "Warm grooves for the last light of the day." }),
  Object.freeze({ id: "after-hours" as const, title: "After Hours", subtitle: "Slow down when the city goes quiet." }),
]);

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const trackIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const moods = new Set<string>(CITY_POP_STATIONS.map((station) => station.id));

/** Fail closed on a malformed bundled catalog instead of silently changing stations. */
export function validateCityPopCatalog(value: unknown): CityPopTrack[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error("City Pop catalog must contain between 1 and 100 tracks.");
  }
  const ids = new Set<string>();
  const videos = new Set<string>();
  return value.map((entry, index) => {
    const fail = (): never => { throw new Error(`Invalid City Pop catalog track at index ${index}.`); };
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return fail();
    const row = entry as Record<string, unknown>;
    const string = (key: string): string => {
      const field = row[key];
      if (typeof field !== "string" || !field.trim()) return fail();
      return field.trim();
    };
    const id = string("id");
    const videoId = string("videoId");
    if (!trackIdPattern.test(id) || id.length > 80 || !videoIdPattern.test(videoId) || ids.has(id) || videos.has(videoId)) return fail();
    if (row.year !== null && (typeof row.year !== "number" || !Number.isInteger(row.year) || row.year < 1900 || row.year > 2100)) return fail();
    if (!Array.isArray(row.moods) || row.moods.length === 0 || row.moods.some((mood) => typeof mood !== "string" || !moods.has(mood)) || new Set(row.moods).size !== row.moods.length) return fail();
    const sourceUrl = string("sourceUrl");
    if (sourceUrl !== `https://www.youtube.com/watch?v=${videoId}`) return fail();
    ids.add(id);
    videos.add(videoId);
    return {
      id, title: string("title"), artist: string("artist"), year: row.year as number | null,
      videoId, channel: string("channel"), moods: [...row.moods] as CityPopMood[], note: string("note"), sourceUrl,
    };
  });
}

export const CITY_POP_TRACKS: readonly CityPopTrack[] = Object.freeze(validateCityPopCatalog(catalog).map((track) => {
  Object.freeze(track.moods);
  return Object.freeze(track);
}));

const byId = new Map(CITY_POP_TRACKS.map((track) => [track.id, track]));
const byVideo = new Map(CITY_POP_TRACKS.map((track) => [track.videoId, track]));
const youtubeId = /^youtube-([A-Za-z0-9_-]{11})$/;
const normalize = (text: string): string => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** A search result for a curated video is that curated track: one favorite per song, under its catalog id. */
export function cityPopCanonical(track: CityPopTrack): CityPopTrack {
  return byVideo.get(track.videoId) ?? track;
}

/**
 * Stored favorite ids that still exist (curated, or a saved search result), each song once: a
 * `youtube-<id>` favorite of a curated video becomes its catalog id.
 */
export function cityPopFavorites(ids: unknown, saved: readonly CityPopTrack[]): string[] {
  if (!Array.isArray(ids)) return [];
  const savedIds = new Set(saved.map((track) => track.id));
  const result = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const video = youtubeId.exec(id)?.[1];
    const curated = byId.get(id) ?? (video ? byVideo.get(video) : undefined);
    if (curated) result.add(curated.id);
    else if (savedIds.has(id)) result.add(id);
  }
  return [...result];
}

/**
 * The order a queue plays in: from the chosen track to the end, then round to the ones before
 * it. Each video plays once, at most 100 of them.
 */
export function cityPopPlayOrder(tracks: readonly CityPopTrack[], startId?: string): CityPopTrack[] {
  const start = Math.max(0, tracks.findIndex((track) => track.id === startId));
  const seen = new Set<string>();
  return [...tracks.slice(start), ...tracks.slice(0, start)]
    .filter((track) => !seen.has(track.videoId) && !!seen.add(track.videoId)).slice(0, 100);
}

/** Favorites are an optional additional filter; an empty favorites list yields no tracks. */
export function filterCityPop(
  tracks: readonly CityPopTrack[],
  query: string,
  mood: CityPopMood | "all",
  favorites?: readonly string[] | null,
): CityPopTrack[] {
  const words = normalize(query).split(" ").filter(Boolean);
  const saved = favorites == null ? null : new Set(favorites);
  return tracks.filter((track) => {
    if (mood !== "all" && !track.moods.includes(mood)) return false;
    if (saved && !saved.has(track.id)) return false;
    const searchable = normalize([track.title, track.artist, track.channel, track.note].join(" "));
    return words.every((word) => searchable.includes(word));
  });
}

/** A search result the main process has no metadata for: still playable by its video id. */
const placeholderTrack = (videoId: string): CityPopTrack => ({
  id: `youtube-${videoId}`, title: "YouTube video", artist: "YouTube", year: null, videoId, channel: "YouTube",
  moods: [], note: "YouTube search result", sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
});

/**
 * The player's queue from IPC: curated ids, or strict `youtube-<videoId>` ids, never URLs.
 * `known` holds metadata for search results (this session's results and the renderer's saved
 * favorites, both validated); a curated video always plays as its curated track. Each video
 * plays once (the first wins), at most 100.
 */
export function cityPopQueue(ids: unknown, known: readonly CityPopTrack[] = []): CityPopTrack[] {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) throw new Error("Choose a City Pop track or station.");
  const found = new Map(known.map((track) => [track.id, track]));
  const seenIds = new Set<string>();
  const seenVideos = new Set<string>();
  const queue: CityPopTrack[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || seenIds.has(id)) throw new Error("Unknown City Pop track.");
    seenIds.add(id);
    const video = youtubeId.exec(id)?.[1];
    const track = byId.get(id) ?? (video ? byVideo.get(video) ?? found.get(id) ?? placeholderTrack(video) : undefined);
    if (!track) throw new Error("Unknown City Pop track.");
    if (seenVideos.has(track.videoId)) continue;
    seenVideos.add(track.videoId);
    queue.push(track);
  }
  return queue;
}

function curatedTrack(track: CityPopTrack): CityPopTrack {
  const known = byId.get(track.id);
  if (known && track.videoId === known.videoId) return known;
  const saved = parseCityPopSavedTracks([track])[0];
  if (saved) return saved;
  throw new Error("Unknown City Pop track.");
}

export function cityPopWatchUrl(track: CityPopTrack): string {
  return curatedTrack(track).sourceUrl;
}

export function cityPopThumbnail(track: CityPopTrack): string {
  return `https://i.ytimg.com/vi/${curatedTrack(track).videoId}/hqdefault.jpg`;
}

/** Search favorites contain metadata only. Playback remains inside YouTube's own player. */
export function parseCityPopSavedTracks(value: unknown): CityPopTrack[] {
  if (!Array.isArray(value)) return [];
  const result: CityPopTrack[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, 100)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const text = (key: string, max = 200): string | null => {
      const field = row[key];
      return typeof field === "string" && field.trim().length > 0 && field.length <= max ? field.trim() : null;
    };
    const videoId = text("videoId", 11);
    if (!videoId || !videoIdPattern.test(videoId) || row.id !== `youtube-${videoId}` || seen.has(videoId)) continue;
    const title = text("title"), artist = text("artist"), channel = text("channel"), note = text("note", 500);
    if (!title || !artist || !channel || !note || row.year !== null || !Array.isArray(row.moods) || row.moods.length !== 0) continue;
    const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
    if (row.sourceUrl !== sourceUrl) continue;
    seen.add(videoId);
    result.push({ id: `youtube-${videoId}`, title, artist, year: null, videoId, channel, moods: [], note, sourceUrl });
  }
  return result;
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;

function youtubeText(value: unknown): string {
  const row = object(value);
  if (!row) return "";
  if (typeof row.simpleText === "string") return row.simpleText.trim();
  return Array.isArray(row.runs) ? row.runs.map((run) => {
    const part = object(run);
    return typeof part?.text === "string" ? part.text : "";
  }).join("").trim() : "";
}

function youtubeInitialData(html: string): unknown {
  // Parse only a literal JSON object, never script code, a decoder, or player configuration.
  const assignment = /(?:\b(?:var\s+)?ytInitialData|window\s*\[\s*["']ytInitialData["']\s*\])\s*=\s*/g;
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(html))) {
    const start = assignment.lastIndex;
    if (html[start] !== "{") continue;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < html.length; i++) {
      const char = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}

export const CITY_POP_SEARCH_UNAVAILABLE = "YouTube search is unavailable right now. Try again later.";

/**
 * Public search-page metadata only; no media URLs, signing, or stream extraction. Anything but a
 * readable results page (a consent or check page, broken data, a layout this parser doesn't
 * know) throws, so it never reads as a search with no matches.
 */
export function parseCityPopSearch(html: string): CityPopTrack[] {
  if (typeof html !== "string" || html.length > 4 * 1024 * 1024) throw new Error(CITY_POP_SEARCH_UNAVAILABLE);
  const data = object(youtubeInitialData(html));
  const contents = object(data?.contents);
  if (!data || (data.estimatedResults === undefined && !contents?.twoColumnSearchResultsRenderer && !contents?.sectionListRenderer)) {
    throw new Error(CITY_POP_SEARCH_UNAVAILABLE);
  }
  const stack: unknown[] = [data];
  const candidates: CityPopTrack[] = [];
  const seen = new Set<string>();
  let visited = 0, videos = 0, lockups = 0;
  while (stack.length > 0 && candidates.length < 20 && visited++ < 100_000) {
    const next = stack.pop();
    if (Array.isArray(next)) {
      for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]);
      continue;
    }
    const node = object(next);
    if (!node) continue;
    const row = object(node.videoRenderer);
    if (row) {
      videos++;
      const videoId = row.videoId;
      const title = youtubeText(row.title);
      const channel = youtubeText(row.ownerText) || youtubeText(row.longBylineText) || youtubeText(row.shortBylineText);
      const endpoint = object(row.navigationEndpoint);
      const navigation = object(object(endpoint?.commandMetadata)?.webCommandMetadata)?.url;
      const badges = Array.isArray(row.badges) ? row.badges : [];
      const liveBadge = badges.some((badge) => {
        const style = object(object(badge)?.metadataBadgeRenderer)?.style;
        return typeof style === "string" && style.includes("LIVE");
      });
      const overlays = Array.isArray(row.thumbnailOverlays) ? row.thumbnailOverlays : [];
      const liveOverlay = overlays.some((overlay) => {
        const style = object(object(overlay)?.thumbnailOverlayTimeStatusRenderer)?.style;
        return style === "LIVE" || style === "UPCOMING";
      });
      if (typeof videoId === "string" && videoIdPattern.test(videoId) && !seen.has(videoId)
        && title && title.length <= 200 && channel && channel.length <= 200
        && !row.isLiveNow && !row.upcomingEventData && !liveBadge && !liveOverlay
        && !(typeof navigation === "string" && navigation.startsWith("/shorts/"))) {
        seen.add(videoId);
        candidates.push({ id: `youtube-${videoId}`, title, artist: channel, year: null, videoId, channel, moods: [], note: "YouTube search result", sourceUrl: `https://www.youtube.com/watch?v=${videoId}` });
      }
      continue;
    }
    const entries = Object.entries(node);
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, child] = entries[i];
      if (key === "reelShelfRenderer" || key === "reelItemRenderer" || key === "shortsLockupViewModel") continue;
      if (key === "lockupViewModel") lockups++;
      if (child && typeof child === "object") stack.push(child);
    }
  }
  // Results in a newer layout than videoRenderer: the search worked but couldn't be read.
  if (!videos && lockups) throw new Error(CITY_POP_SEARCH_UNAVAILABLE);
  return candidates;
}
