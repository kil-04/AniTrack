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
  NOVELPHOENIX,
  novelPhoenixChapterPage,
  novelPhoenixChapters,
  novelPhoenixChaptersUrl,
  novelPhoenixChapterText,
  novelPhoenixChapterUrl,
  novelPhoenixDetail,
  novelPhoenixProvisional,
  novelPhoenixSearch,
  novelPhoenixSearchUrl,
  novelPhoenixTitleUrl,
  type NovelCard,
  type NovelChapter,
  type NovelChapterText,
  type NovelDetail,
  type NovelHome,
  type NovelPhoenixChapterPage,
  type NovelSearchFilters,
  type NovelSearchPage,
  type NovelSourceId,
} from "../../../../../packages/shared/novel";
import { readCached, writeCached } from "../manga/disk-cache";
import { MangaSourceError, SourceHttp } from "../manga/sources";
import { hex, slugStem } from "./names";
import { RequestPace } from "./pace";

export { MangaSourceError as NovelSourceError };

const honestAgent = () => `AniTrack/${app.getVersion()} (Desktop)`;

/**
 * Two request lanes per source, each with fixed hosts, serialized and spaced
 * requests and bounded bodies (see SourceHttp): "front" for what's on screen and
 * a slower "back" lane for update checks and downloads, so a long download never
 * queues ahead of the chapter being read.
 */
export type Lane = "front" | "back";
const HTML = "text/html,application/xhtml+xml";
/**
 * Novel Phoenix refuses bursts (HTTP 429), so everything sent to it draws on one
 * budget: three requests at once, then one every two seconds, which ran clean in
 * testing. What's on screen (priority 0) goes before the chapter-list fill (1),
 * and that before downloads and update checks (2).
 */
const phoenixPace = new RequestPace(3, 2000);
const phoenix = (priority: number) =>
  new SourceHttp(
    "Novel Phoenix", new Set(NOVELPHOENIX.HOSTS), 150,
    () => (url, init) => phoenixPace.take(priority).then(() => net.fetch(url, init)),
    honestAgent(), false, HTML,
  );
const http = {
  novelbuddy: {
    front: new SourceHttp("NovelBuddy", new Set(NOVELBUDDY.HOSTS), 300, () => net.fetch, honestAgent()),
    back: new SourceHttp("NovelBuddy", new Set(NOVELBUDDY.HOSTS), 900, () => net.fetch, honestAgent()),
  },
  novelarchive: {
    front: new SourceHttp("NovelArchive", new Set(NOVELARCHIVE.HOSTS), 400, () => net.fetch, honestAgent()),
    back: new SourceHttp("NovelArchive", new Set(NOVELARCHIVE.HOSTS), 1000, () => net.fetch, honestAgent()),
  },
  novelphoenix: { front: phoenix(0), back: phoenix(2) },
} satisfies Record<NovelSourceId, Record<Lane, SourceHttp>>;

/**
 * Novel Phoenix lists chapters 100 to a page, so a long novel's first list is dozens
 * of requests. They go one at a time on a queue of their own, behind whatever is on
 * screen, so the chapter being read never waits for them.
 */
const phoenixFillLane = phoenix(1);
/** A fill that is refused for going too fast waits this long (or the site's Retry-After) and carries on, a few times. */
const PHOENIX_FILL_WAIT_MS = 30_000;
const PHOENIX_FILL_RETRIES = 4;

const LIST_BYTES = 4 * 1024 * 1024;
const CHAPTERS_BYTES = 16 * 1024 * 1024;
const TEXT_BYTES = 4 * 1024 * 1024;

/** Reads a source's HTML page, turning any shape problem into a message safe to show. */
function page<T>(label: string, html: string, read: (html: string) => T): T {
  try { return read(html); } catch (error) {
    throw new MangaSourceError(error instanceof Error && error.message.length < 200 ? error.message : `${label} sent a page AniTrack couldn't read.`);
  }
}

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
  delete(key: string) {
    this.map.delete(key);
  }
}

const homeCache = new Ttl<NovelHome>(30 * 60 * 1000, 1);
const searchCache = new Ttl<NovelSearchPage>(10 * 60 * 1000, 40);
const detailCache = new Ttl<NovelDetail>(30 * 60 * 1000, 60);
const chapterListCache = new Ttl<NovelChapter[]>(10 * 60 * 1000, 20);
const textCache = new Ttl<NovelChapterText>(60 * 60 * 1000, 12);

/**
 * Disk-cache names are lower-case only; NovelBuddy ids are case-sensitive, so hex-encode
 * them. Novel Phoenix ids are lower-case slugs already (and too long to hex-encode).
 */
const diskName = (kind: "chapters" | "title", sourceId: NovelSourceId, id: string) =>
  sourceId === "novelphoenix" ? `${kind}-novel-np-${slugStem(id)}` : `${kind}-novel-${sourceId === "novelbuddy" ? "nb" : "na"}-${hex(id)}`;

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
  const url = sourceId === "novelbuddy" ? novelBuddySearchUrl(rest) : sourceId === "novelarchive" ? novelArchiveSearchUrl(rest) : novelPhoenixSearchUrl(rest);
  const hit = searchCache.get(url);
  if (hit) return hit;
  const found = sourceId === "novelbuddy"
    ? parse("NovelBuddy", await http.novelbuddy.front.get(url, LIST_BYTES), novelBuddySearch)
    : sourceId === "novelarchive"
      ? parse("NovelArchive", await http.novelarchive.front.get(url, LIST_BYTES), novelArchiveSearch)
      : page("Novel Phoenix", await http.novelphoenix.front.get(url, LIST_BYTES), (html) => novelPhoenixSearch(html, rest.page ?? 1));
  searchCache.set(url, found);
  return found;
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
    : sourceId === "novelarchive"
      ? await archiveTitle(id, lane)
      : page("Novel Phoenix", await http.novelphoenix[lane].get(novelPhoenixTitleUrl(id), LIST_BYTES), (html) => novelPhoenixDetail(html, id, Date.now()));
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

/** Chapter lists being fetched now: a second request for the same title waits for the first. */
const chapterListRuns = new Map<string, Promise<NovelChapter[]>>();

/**
 * A title's chapters in reading order. A long Novel Phoenix list read for the first
 * time comes back at once, with "Chapter N" standing in for the names on pages not
 * read yet ([novelChaptersPartial] says so); [novelChaptersComplete] waits for them.
 */
export function novelChapters(sourceId: NovelSourceId, id: string, lane: Lane = "front"): Promise<NovelChapter[]> {
  const key = `${sourceId}:${id}`;
  const hit = chapterListCache.get(key);
  if (hit) return Promise.resolve(hit);
  const filling = phoenixFills.get(key);
  if (filling) return Promise.resolve(filling.provisional());
  let run = chapterListRuns.get(key);
  if (!run) {
    run = fetchChapters(sourceId, id, lane).finally(() => chapterListRuns.delete(key));
    chapterListRuns.set(key, run);
  }
  return run;
}

/** Whether the list [novelChapters] gives right now still has stand-in names. */
export const novelChaptersPartial = (sourceId: NovelSourceId, id: string) => phoenixFills.has(`${sourceId}:${id}`);

/** The list with every chapter's real name: waits for a long list's remaining pages. */
export async function novelChaptersComplete(sourceId: NovelSourceId, id: string): Promise<NovelChapter[]> {
  const list = await novelChapters(sourceId, id);
  return phoenixFills.get(`${sourceId}:${id}`)?.done ?? list;
}

async function fetchChapters(sourceId: NovelSourceId, id: string, lane: Lane): Promise<NovelChapter[]> {
  const key = `${sourceId}:${id}`;
  let list: NovelChapter[];
  if (sourceId === "novelarchive") {
    detailCache.set(key, await archiveTitle(id, lane));
    return chapterListCache.get(key) ?? [];
  }
  if (sourceId === "novelbuddy") {
    list = parse("NovelBuddy", await http.novelbuddy[lane].get(novelBuddyChaptersUrl(id), CHAPTERS_BYTES), novelBuddyChapters);
  } else {
    const read = await phoenixChapters(id, lane);
    // A list still being filled in is neither cached nor saved: the fill does both when it's whole.
    if (!read.complete) return read.list;
    list = read.list;
  }
  chapterListCache.set(key, list);
  void writeCached(diskName("chapters", sourceId, id), list);
  return list;
}

type PhoenixRows = NovelPhoenixChapterPage["chapters"];

/** A saved Novel Phoenix list older than this is read again in full (a chapter's title can be corrected). */
const PHOENIX_FULL_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** Up to this many pages are simply waited for; more than that and the list is shown first, filled in behind. */
const PHOENIX_QUICK_PAGES = 3;
/** Long lists being filled in: what there is so far, and the whole list once every page is read. */
const phoenixFills = new Map<string, { provisional: () => NovelChapter[]; done: Promise<NovelChapter[]> }>();
/** Pages read for a list that isn't whole yet, so a fill that was cut short carries on instead of starting over. */
const phoenixPages = new Ttl<Map<number, PhoenixRows>>(30 * 60 * 1000, 8);

/**
 * Novel Phoenix's chapter list, page by page. Chapters are requested by position and
 * earlier pages don't change, so with a list saved from last time only its last page
 * and the pages after it are read again (new chapters); a list that shrank, or
 * doesn't line up, is read from the start. A list with many pages still to read is
 * returned at once with stand-in names and finished in the background.
 */
async function phoenixChapters(id: string, lane: Lane): Promise<{ list: NovelChapter[]; complete: boolean }> {
  const key = `novelphoenix:${id}`;
  const per = NOVELPHOENIX.CHAPTERS_PER_PAGE;
  const read = async (n: number, on: SourceHttp) =>
    page("Novel Phoenix", await on.get(novelPhoenixChaptersUrl(id, n), LIST_BYTES), (html) => novelPhoenixChapterPage(html, Date.now()));

  const saved = await readCached<NovelChapter[]>(diskName("chapters", "novelphoenix", id));
  const old = saved && Array.isArray(saved.value) && Date.now() - saved.at < PHOENIX_FULL_REFRESH_MS ? saved.value : [];
  // Whole pages before the last saved one are kept, when they are the positions 1, 2, 3…
  let keep = Math.max(0, Math.ceil(old.length / per) - 1) * per;
  if (!old.slice(0, keep).every((c, i) => c?.id === String(i + 1) && typeof c.label === "string")) keep = 0;
  let from = keep / per + 1;
  let first = await read(from, http.novelphoenix[lane]);
  if (keep && (!first.chapters.length || first.chapters[0].id !== String(keep + 1))) {
    keep = 0;
    from = 1;
    first = await read(1, http.novelphoenix[lane]);
  }
  const kept: PhoenixRows = old.slice(0, keep).map((c) => ({ id: c.id, label: c.label, updatedAt: c.updatedAt ?? null }));
  const last = first.pages;
  const pages = phoenixPages.get(key) ?? new Map<number, PhoenixRows>();
  phoenixPages.set(key, pages);
  pages.set(from, first.chapters);
  // The last page is always read now (it is the one that grows); the others once.
  const missing = Array.from({ length: Math.max(0, last - from) }, (_, i) => from + 1 + i).filter((n) => n === last || !pages.has(n));
  const fetchRest = async (on: SourceHttp, patient = false) => {
    for (const n of missing) {
      for (let attempt = 0; ; attempt++) {
        try {
          pages.set(n, (await read(n, on)).chapters);
          break;
        } catch (error) {
          // The background fill waits out a "too many requests" instead of giving the list up.
          if (!patient || !(error instanceof MangaSourceError) || error.status !== 429 || attempt >= PHOENIX_FILL_RETRIES) throw error;
          const asked = Number(error.retryAfter) * 1000;
          await new Promise((resolve) => setTimeout(resolve, asked > 0 && asked <= 300_000 ? asked : PHOENIX_FILL_WAIT_MS));
        }
      }
    }
  };
  // A page that failed fails the list: a list with a hole would misnumber every later chapter.
  const whole = () => {
    phoenixPages.delete(key);
    return novelPhoenixChapters([kept, ...Array.from({ length: last - from + 1 }, (_, i) => pages.get(from + i) ?? [])]);
  };
  const total = first.total;
  if (lane === "back" || total == null || missing.length <= PHOENIX_QUICK_PAGES) {
    await fetchRest(http.novelphoenix[lane]);
    return { list: whole(), complete: true };
  }
  const provisional = () => novelPhoenixProvisional(total, [kept, ...pages.values()]);
  const done = fetchRest(phoenixFillLane, true)
    .then(() => {
      const list = whole();
      chapterListCache.set(key, list);
      void writeCached(diskName("chapters", "novelphoenix", id), list);
      return list;
    })
    .finally(() => phoenixFills.delete(key));
  done.catch(() => { /* reported to whoever waits for the whole list; the next request carries on */ });
  phoenixFills.set(key, { provisional, done });
  return { list: provisional(), complete: false };
}

export async function novelChapter(sourceId: NovelSourceId, titleId: string, chapterId: string, lane: Lane = "front"): Promise<NovelChapterText> {
  const key = `${sourceId}:${titleId}:${chapterId}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const text = sourceId === "novelbuddy"
    ? parse("NovelBuddy", await http.novelbuddy[lane].get(novelBuddyChapterUrl(titleId, chapterId), TEXT_BYTES), novelBuddyChapterText)
    : sourceId === "novelarchive"
      ? parse("NovelArchive", await http.novelarchive[lane].get(novelArchiveChapterUrl(titleId, chapterId), TEXT_BYTES), (json) => novelArchiveChapterText(json, chapterId))
      : page("Novel Phoenix", await http.novelphoenix[lane].get(novelPhoenixChapterUrl(titleId, chapterId), TEXT_BYTES), (html) => novelPhoenixChapterText(html, chapterId));
  if (!text.paragraphs.length) throw new MangaSourceError("This chapter came back empty on the source. Try another source.");
  // Downloads don't fill the reading cache (they'd push out the chapters around the reader).
  if (lane === "front") textCache.set(key, text);
  return text;
}
