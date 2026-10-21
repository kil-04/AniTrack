import { app, net } from "electron";
import {
  NOVELARCHIVE,
  novelArchiveChapters,
  novelArchiveChapterText,
  novelArchiveChapterUrl,
  novelArchiveDetail,
  novelArchiveHome,
  novelArchiveSearch,
  novelArchiveSearchUrl,
  novelArchiveTitleUrl,
  NOVEL_HOME_NOTICES,
  NOVELARCHIVE_HOME_LISTS,
  NOVELBUDDY,
  novelBuddyChapters,
  novelBuddyChapterText,
  novelBuddyChaptersUrl,
  novelBuddyChapterUrl,
  novelBuddyDetail,
  novelBuddyHome,
  novelBuddyHomeUrl,
  novelBuddySearch,
  novelBuddySearchUrl,
  novelBuddyTitleUrl,
  type NovelCard,
  type NovelChapter,
  type NovelChapterText,
  type NovelDetail,
  type NovelHome,
  type NovelSearchFilters,
  type NovelSearchPage,
  type NovelSourceId,
} from "../../../../../packages/shared/novel";
import { readCached, writeCached } from "../manga/disk-cache";
import { MangaSourceError, SourceHttp } from "../manga/sources";

export { MangaSourceError as NovelSourceError };

const honestAgent = () => `AniTrack/${app.getVersion()} (Desktop)`;

/**
 * Two request lanes per source, each with fixed hosts, serialized and spaced
 * requests and bounded bodies (see SourceHttp): "front" for what's on screen and
 * a slower "back" lane for update checks and downloads, so a long download never
 * queues ahead of the chapter being read.
 */
export type Lane = "front" | "back";
const http = {
  novelbuddy: {
    front: new SourceHttp("NovelBuddy", new Set(NOVELBUDDY.HOSTS), 300, () => net.fetch, honestAgent()),
    back: new SourceHttp("NovelBuddy", new Set(NOVELBUDDY.HOSTS), 900, () => net.fetch, honestAgent()),
  },
  novelarchive: {
    front: new SourceHttp("NovelArchive", new Set(NOVELARCHIVE.HOSTS), 400, () => net.fetch, honestAgent()),
    back: new SourceHttp("NovelArchive", new Set(NOVELARCHIVE.HOSTS), 1000, () => net.fetch, honestAgent()),
  },
} satisfies Record<NovelSourceId, Record<Lane, SourceHttp>>;

const LIST_BYTES = 4 * 1024 * 1024;
const CHAPTERS_BYTES = 16 * 1024 * 1024;
const TEXT_BYTES = 4 * 1024 * 1024;

/** Parses a body, turning any shape or JSON problem into a message safe to show. */
function parse<T>(label: string, text: string, read: (json: unknown) => T): T {
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new MangaSourceError(`${label} sent a response AniTrack couldn't read.`); }
  try { return read(json); } catch (error) {
    throw new MangaSourceError(error instanceof Error && error.message.length < 200 ? error.message : `${label} sent a response AniTrack couldn't read.`);
  }
}

// ── Small in-memory caches ────────────────────────────────────────────────────

class Ttl<T> {
  private readonly map = new Map<string, { at: number; value: T }>();
  constructor(private readonly ttlMs: number, private readonly max: number) {}
  get(key: string): T | null {
    const hit = this.map.get(key);
    if (!hit || Date.now() - hit.at > this.ttlMs) return null;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }
  /** [ttlMs] shortens this entry's life (a stand-in answer). */
  set(key: string, value: T, ttlMs = this.ttlMs) {
    this.map.delete(key);
    this.map.set(key, { at: Date.now() - (this.ttlMs - ttlMs), value });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

const homeCache = new Ttl<NovelHome>(30 * 60 * 1000, 1);
const searchCache = new Ttl<NovelSearchPage>(10 * 60 * 1000, 40);
const detailCache = new Ttl<NovelDetail>(30 * 60 * 1000, 60);
const chapterListCache = new Ttl<NovelChapter[]>(10 * 60 * 1000, 20);
const textCache = new Ttl<NovelChapterText>(60 * 60 * 1000, 12);

/** Disk-cache names are lower-case only; NovelBuddy ids are case-sensitive, so hex-encode them. */
const diskName = (kind: "chapters" | "title", sourceId: NovelSourceId, id: string) =>
  `${kind}-novel-${sourceId === "novelbuddy" ? "nb" : "na"}-${Buffer.from(id, "utf-8").toString("hex")}`;

// ── Operations ────────────────────────────────────────────────────────────────

const HOME_DISK = "home-novel";

/**
 * Home: NovelBuddy's feed; while NovelBuddy is down, NovelArchive's lists; while both
 * are, the last Home saved on disk. Each stand-in carries a notice saying so.
 */
export async function novelHome(): Promise<NovelHome> {
  const hit = homeCache.get("home");
  if (hit) return hit;
  try {
    const value = await buddyHome();
    homeCache.set("home", value);
    void writeCached(HOME_DISK, value);
    return value;
  } catch (buddyError) {
    const archive = await archiveHome().catch(() => null);
    if (archive) {
      // Short-lived, so NovelBuddy's feed comes back soon after NovelBuddy does.
      homeCache.set("home", archive, 5 * 60 * 1000);
      return archive;
    }
    const saved = await readCached<NovelHome>(HOME_DISK);
    if (saved && Array.isArray(saved.value.trending)) return { ...saved.value, notice: NOVEL_HOME_NOTICES.saved };
    throw buddyError;
  }
}

async function archiveHome(): Promise<NovelHome | null> {
  const archive = http.novelarchive.front;
  const list = async ({ filters, limit }: { filters: Omit<NovelSearchFilters, "sourceId">; limit: number }) =>
    parse("NovelArchive", await archive.get(novelArchiveSearchUrl(filters, limit), LIST_BYTES), novelArchiveSearch).items;
  // The first list proves NovelArchive answers; the rest may come back empty.
  const popular = await list(NOVELARCHIVE_HOME_LISTS.popular);
  const [latest, completed, favourites] = await Promise.all(
    [NOVELARCHIVE_HOME_LISTS.latest, NOVELARCHIVE_HOME_LISTS.completed, NOVELARCHIVE_HOME_LISTS.favourites].map((l) => list(l).catch(() => [] as NovelCard[])),
  );
  return novelArchiveHome({ popular, latest, completed, favourites });
}

async function buddyHome(): Promise<NovelHome> {
  const buddy = http.novelbuddy.front;
  const home = parse("NovelBuddy", await buddy.get(novelBuddyHomeUrl(), LIST_BYTES), novelBuddyHome);
  // The home feed's "latest" is mostly machine translations, so ask for recent updates,
  // finished series and the most bookmarked directly, keeping the human translations.
  const human = (filters: Parameters<typeof novelBuddySearchUrl>[0], limit: number) =>
    buddy.get(novelBuddySearchUrl(filters, limit), LIST_BYTES)
      .then((t) => parse("NovelBuddy", t, novelBuddySearch).items.filter((c) => !c.mtl))
      .catch(() => [] as NovelCard[]);
  const [latest, completed, favourites] = await Promise.all([
    human({ sort: "latest" }, 60),
    human({ sort: "popular", status: "completed" }, 30),
    human({ sort: "favourites" }, 30),
  ]);
  return { ...home, latest: latest.length ? latest : home.latest, completed, favourites };
}

export async function novelSearch(filters: NovelSearchFilters): Promise<NovelSearchPage> {
  const { sourceId, ...rest } = filters;
  const url = sourceId === "novelbuddy" ? novelBuddySearchUrl(rest) : novelArchiveSearchUrl(rest);
  const hit = searchCache.get(url);
  if (hit) return hit;
  const page = sourceId === "novelbuddy"
    ? parse("NovelBuddy", await http.novelbuddy.front.get(url, LIST_BYTES), novelBuddySearch)
    : parse("NovelArchive", await http.novelarchive.front.get(url, LIST_BYTES), novelArchiveSearch);
  searchCache.set(url, page);
  return page;
}

// NovelArchive sends its whole contents list with the title, so one request serves both.
const archiveTitle = async (id: string, lane: Lane) => {
  const text = await http.novelarchive[lane].get(novelArchiveTitleUrl(id), CHAPTERS_BYTES);
  const detail = parse("NovelArchive", text, novelArchiveDetail);
  const chapters = parse("NovelArchive", text, novelArchiveChapters);
  chapterListCache.set(`novelarchive:${id}`, chapters);
  void writeCached(diskName("chapters", "novelarchive", id), chapters);
  return detail;
};

export async function novelTitle(sourceId: NovelSourceId, id: string, lane: Lane = "front"): Promise<NovelDetail> {
  const key = `${sourceId}:${id}`;
  const hit = detailCache.get(key);
  if (hit) return hit;
  const detail = sourceId === "novelbuddy"
    ? parse("NovelBuddy", await http.novelbuddy[lane].get(novelBuddyTitleUrl(id), LIST_BYTES), novelBuddyDetail)
    : await archiveTitle(id, lane);
  detailCache.set(key, detail);
  void writeCached(diskName("title", sourceId, id), detail);
  return detail;
}

/** The title page saved last time (opens at once, and offline). */
export async function savedNovelTitle(sourceId: NovelSourceId, id: string): Promise<{ detail: NovelDetail; chapters: NovelChapter[] } | null> {
  const [detail, chapters] = await Promise.all([
    readCached<NovelDetail>(diskName("title", sourceId, id)),
    readCached<NovelChapter[]>(diskName("chapters", sourceId, id)),
  ]);
  return detail ? { detail: detail.value, chapters: Array.isArray(chapters?.value) ? chapters!.value : [] } : null;
}

export async function novelChapters(sourceId: NovelSourceId, id: string, lane: Lane = "front"): Promise<NovelChapter[]> {
  const key = `${sourceId}:${id}`;
  const hit = chapterListCache.get(key);
  if (hit) return hit;
  let list: NovelChapter[];
  if (sourceId === "novelbuddy") {
    list = parse("NovelBuddy", await http.novelbuddy[lane].get(novelBuddyChaptersUrl(id), CHAPTERS_BYTES), novelBuddyChapters);
    chapterListCache.set(key, list);
    void writeCached(diskName("chapters", sourceId, id), list);
  } else {
    detailCache.set(key, await archiveTitle(id, lane));
    list = chapterListCache.get(key) ?? [];
  }
  return list;
}

export async function novelChapter(sourceId: NovelSourceId, titleId: string, chapterId: string, lane: Lane = "front"): Promise<NovelChapterText> {
  const key = `${sourceId}:${titleId}:${chapterId}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const text = sourceId === "novelbuddy"
    ? parse("NovelBuddy", await http.novelbuddy[lane].get(novelBuddyChapterUrl(titleId, chapterId), TEXT_BYTES), novelBuddyChapterText)
    : parse("NovelArchive", await http.novelarchive[lane].get(novelArchiveChapterUrl(titleId, chapterId), TEXT_BYTES), (json) => novelArchiveChapterText(json, chapterId));
  if (!text.paragraphs.length) throw new MangaSourceError("This chapter came back empty on the source. Try another source.");
  // Downloads don't fill the reading cache (they'd push out the chapters around the reader).
  if (lane === "front") textCache.set(key, text);
  return text;
}
