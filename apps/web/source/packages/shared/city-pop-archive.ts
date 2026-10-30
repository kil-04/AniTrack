/** Internet Archive's public search/metadata APIs; all URLs are built locally. */
export interface ArchiveItem {
  id: string;
  title: string;
  creator: string;
  mediaType: "audio" | "video";
  year: number | null;
  coverUrl: string;
}

export interface ArchiveSearchResult { items: ArchiveItem[]; total: number; page: number }
export type ArchiveMediaFilter = "all" | "audio" | "video";
export const CITY_POP_ARCHIVE_PAGE_SIZE = 24;

export interface ArchiveTrack {
  itemId: string;
  fileName: string;
  title: string;
  artist: string;
  mediaType: "audio" | "video";
  url: string;
  size: number | null;
}

export interface CityPopDownload {
  key: string;
  itemId: string;
  fileName: string;
  title: string;
  artist: string;
  mediaType: "audio" | "video";
  status: "queued" | "downloading" | "completed" | "error";
  bytes: number;
  totalBytes: number | null;
  error: string | null;
}

/** Archive answered, but not with a usable search or item: shown as an error, never as "nothing found". */
export class ArchiveUnavailableError extends Error {}
export const ARCHIVE_SEARCH_UNAVAILABLE = "Internet Archive search is unavailable right now. Try again later.";
export const ARCHIVE_ITEM_UNAVAILABLE = "This Internet Archive item is unavailable right now. Try again later.";

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const pageNumber = (page: number): number => Number.isFinite(page) ? Math.max(1, Math.min(1000, Math.floor(page))) : 1;
const mediaType = (value: unknown): "audio" | "video" | null => value === "audio" ? "audio" : value === "movies" ? "video" : null;

export function validArchiveId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 100 && !/[\x00-\x1f\x7f]/.test(value) && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function text(value: unknown, fallback = "", max = 300): string {
  const parts = Array.isArray(value) ? value.slice(0, 10) : [value];
  const result = parts.filter((part): part is string => typeof part === "string").map((part) => part.trim()).filter(Boolean).join("; ");
  return result ? result.slice(0, max) : fallback;
}

function restricted(value: Row): boolean {
  const keys = ["is_dark", "dark", "is_restricted", "restricted", "access_restricted", "access-restricted-item", "is_private", "private", "hidden"];
  return keys.some((key) => {
    const flag = value[key];
    return flag === true || flag === 1 || (typeof flag === "string" && /^(?:true|1|yes|y)$/i.test(flag.trim()));
  });
}

export function archiveSearchUrl(query: string, page = 1, media: ArchiveMediaFilter = "all"): string {
  if (media !== "all" && media !== "audio" && media !== "video") throw new Error("Invalid Archive media filter.");
  const clean = query.trim().replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200).trim();
  const literal = clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const words = literal.split(/\s+/).map((term) => `"${term}"`).join(" AND ");
  // Keep words in one field so unrelated titles and uploader names cannot combine into a song match.
  const scope = clean ? `title:(${words}) OR creator:(${words}) OR subject:"${literal}"` : '(title:"city pop" OR subject:"city pop" OR title:citypop OR subject:citypop)';
  const kind = media === "video" ? "movies" : media === "audio" ? "audio" : "(audio OR movies)";
  const params = new URLSearchParams({ q: `mediatype:${kind} AND (${scope})`, output: "json", rows: String(CITY_POP_ARCHIVE_PAGE_SIZE), page: String(pageNumber(page)) });
  for (const field of ["identifier", "title", "creator", "mediatype", "year", "date", "is_dark", "access-restricted-item"]) params.append("fl[]", field);
  params.append("sort[]", "downloads desc");
  return `https://archive.org/advancedsearch.php?${params.toString()}`;
}

export function parseArchiveSearch(value: unknown, page = 1, media: ArchiveMediaFilter = "all"): ArchiveSearchResult {
  if (media !== "all" && media !== "audio" && media !== "video") throw new Error("Invalid Archive media filter.");
  const root = row(value);
  const response = row(root?.response);
  const status = row(root?.responseHeader)?.status;
  // An error envelope or a missing result set is Archive failing, not zero matches.
  if (!root || !response || "error" in root || (status !== undefined && status !== 0)) throw new ArchiveUnavailableError(ARCHIVE_SEARCH_UNAVAILABLE);
  const docs = Array.isArray(response.docs) ? response.docs : [];
  const items: ArchiveItem[] = [];
  const seen = new Set<string>();
  for (const entry of docs.slice(0, 100)) {
    const item = row(entry);
    if (!item || restricted(item) || !validArchiveId(item.identifier) || seen.has(item.identifier)) continue;
    const type = mediaType(item.mediatype);
    if (!type || (media !== "all" && type !== media)) continue;
    const yearText = typeof item.year === "number" ? String(item.year) : text(item.year, text(item.date));
    const match = /^(\d{4})(?:\b|-)/.exec(yearText);
    const year = match && Number(match[1]) >= 1900 && Number(match[1]) <= 2100 ? Number(match[1]) : null;
    seen.add(item.identifier);
    items.push({ id: item.identifier, title: text(item.title, item.identifier), creator: text(item.creator, "Unknown artist"), mediaType: type, year, coverUrl: `https://archive.org/services/img/${encodeURIComponent(item.identifier)}` });
    if (items.length === CITY_POP_ARCHIVE_PAGE_SIZE) break;
  }
  const total = typeof response.numFound === "number" && Number.isFinite(response.numFound) ? Math.max(0, Math.floor(response.numFound)) : 0;
  return { items, total, page: pageNumber(page) };
}

function validFileName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000
    && !/[\\\x00-\x1f\x7f]/.test(value)
    && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function archiveFileUrl(id: string, file: string): string {
  if (!validArchiveId(id) || !validFileName(file)) throw new Error("Invalid Internet Archive file.");
  return `https://archive.org/download/${encodeURIComponent(id)}/${file.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function positiveInteger(value: unknown): number | null {
  const candidate = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null;
}

function position(value: unknown): number | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /^(\d{1,4})(?:\s*\/\s*\d{1,4})?$/.exec(raw);
  return match ? Number(match[1]) : null;
}

/**
 * Public playable files only. Derivatives replace their originals without duplicating songs. An
 * error answer, or an item listed without its files, is Archive failing (it throws); an empty
 * object is an item that no longer exists, so nothing plays.
 */
export function parseArchiveTracks(itemId: string, value: unknown): ArchiveTrack[] {
  if (!validArchiveId(itemId)) return [];
  const root = row(value);
  if (!root || "error" in root) throw new ArchiveUnavailableError(ARCHIVE_ITEM_UNAVAILABLE);
  const metadata = row(root.metadata);
  if (!metadata || restricted(root) || restricted(metadata) || !mediaType(metadata.mediatype)
    || (metadata.identifier !== undefined && metadata.identifier !== itemId)) return [];
  if (!Array.isArray(root.files)) throw new ArchiveUnavailableError(ARCHIVE_ITEM_UNAVAILABLE);
  const files = root.files.slice(0, 5000).map((entry) => row(entry)).filter((entry): entry is Row => entry !== null);
  const byName = new Map<string, Row>();
  for (const file of files) if (validFileName(file.name)) byName.set(file.name, file);
  const originalName = (file: Row): string | null => {
    let name = file.name as string, current = file;
    const visited = new Set<string>([name]);
    for (let count = 0; count < 10; count++) {
      const original = current.original;
      if (!validFileName(original) || visited.has(original)) break;
      visited.add(original);
      name = original;
      const parent = byName.get(original);
      if (!parent) break;
      if (restricted(parent)) return null;
      current = parent;
    }
    return name;
  };
  type Candidate = { track: ArchiveTrack; priority: number; index: number; number: number | null; disc: number };
  const groups = new Map<string, Candidate>();
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (!validFileName(file.name) || restricted(file)) continue;
    const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
    const audioPriority: Record<string, number> = { mp3: 0, m4a: 1, ogg: 2, flac: 3, wav: 4 };
    const type = ext && Object.hasOwn(audioPriority, ext) ? "audio" : ext === "mp4" || ext === "webm" ? "video" : null;
    if (!type || !ext) continue;
    const sourceName = originalName(file);
    if (!sourceName) continue;
    // A public derivative must not revive an explicitly restricted original.
    const source = byName.get(sourceName);
    if (source && restricted(source)) continue;
    const size = positiveInteger(file.size);
    if (size === 0) continue;
    const priority = type === "audio" ? audioPriority[ext] : /\.ia\.mp4$/i.test(file.name) ? 0 : ext === "mp4" ? 1 : 2;
    const key = `${type}:${sourceName}`;
    const existing = groups.get(key);
    const track: ArchiveTrack = {
      itemId, fileName: file.name,
      title: text(file.title, text(source?.title, file.name.split("/").pop()!.replace(/\.[^.]+$/, ""))),
      artist: text(file.artist, text(file.creator, text(source?.artist, text(source?.creator, text(metadata.creator, "Unknown artist"))))),
      mediaType: type, url: archiveFileUrl(itemId, file.name), size,
    };
    const candidate: Candidate = { track, priority, index: existing?.index ?? index, number: position(file.track ?? source?.track), disc: position(file.disc ?? file.discnumber ?? source?.disc ?? source?.discnumber) ?? 0 };
    if (!existing || priority < existing.priority) groups.set(key, candidate);
  }
  const result = [...groups.values()];
  if (result.every((candidate) => candidate.number !== null)) result.sort((a, b) => a.disc - b.disc || a.number! - b.number! || a.index - b.index);
  else result.sort((a, b) => a.index - b.index);
  return result.slice(0, 500).map((candidate) => candidate.track);
}
