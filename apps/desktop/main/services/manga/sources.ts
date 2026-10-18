import { app, BrowserWindow, net } from "electron";
import {
  isMangaBallId,
  isMangaDotPage,
  MANGABALL,
  mangaBallAllChapters,
  mangaBallChapters,
  mangaBallDetail,
  mangaBallLatest,
  mangaBallPages,
  mangaBallSearch,
  MANGADOT,
  mangaDotChapters,
  mangaDotDetail,
  mangaDotImagesPath,
  mangaDotPages,
  mangaDotSuggestions,
  MAX_CHAPTERS,
  normalizeTitle,
  publicHttps,
  sourceMatches,
  type LatestResult,
  type MangaChapter,
  type MangaMeta,
  type MangaPageImage,
  type MangaSourceInfo,
  type SourceDetail,
  type SourceLatest,
  type SourceTitle,
} from "../../../../../packages/shared/manga";
import { mangaById } from "./anilist-manga";
import { readCached, writeCached } from "./disk-cache";
import { saveMatch, savedMatch } from "./store";
import { comixSession, ComixSessionError } from "./comix-session";
import { COMIX_CHAPTER_LIST_DEADLINE_MS, comixChapters, comixDetail, comixHasNext, comixPages, comixSearchIds, comixValidRequest, type ComixParams } from "./comix-protocol";
import { fetchComixImage } from "./comix-images";
import { ComixHtmlPageParser } from "./comix-html-pages";
import { PageVerificationError, VerifiedPageSession } from "../providers/verified-page-session";

/** A reading-source failure whose message is safe to show; [verify] asks for the source's one-time check. */
export class MangaSourceError extends Error {
  constructor(message: string, readonly status?: number, readonly verify = false) {
    super(message);
  }
}

const CHALLENGE = /<title[^>]*>\s*(?:just a moment|attention required)|_cf_chl_opt|verify you are human/i;
const honestAgent = () => `AniTrack/${app.getVersion()} (Desktop)`;

/**
 * Catalogue HTTP for one source: fixed hosts, serialized requests with a minimum
 * spacing, bounded bodies and no retry loop. A challenge page stops the attempt
 * and asks for the source's connection instead of retrying.
 */
export class SourceHttp {
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(
    private readonly label: string,
    private readonly hosts: Set<string>,
    private readonly spacingMs: number,
    private readonly fetcher: () => (url: string, init: RequestInit) => Promise<Response>,
    private readonly userAgent: string | null,
    private readonly verifiable = false,
  ) {}

  get(url: string, maxBytes: number): Promise<string> {
    return this.enqueue(url, maxBytes);
  }

  /** POSTs a JSON body under the same host, spacing, size and challenge rules as [get]. */
  post(url: string, json: unknown, maxBytes: number): Promise<string> {
    return this.enqueue(url, maxBytes, json);
  }

  private enqueue(url: string, maxBytes: number, json?: unknown): Promise<string> {
    const run = this.queue.then(() => this.fetchText(url, maxBytes, json));
    this.queue = run.catch(() => {});
    return run;
  }

  private async fetchText(url: string, maxBytes: number, json?: unknown): Promise<string> {
    const target = publicHttps(url);
    if (!target || !this.hosts.has(target.hostname)) throw new MangaSourceError("Refused an unexpected address.");
    const wait = this.spacingMs - (Date.now() - this.last);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25_000);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.userAgent) headers["User-Agent"] = this.userAgent;
      const init: RequestInit = { headers, signal: ac.signal };
      if (json !== undefined) {
        headers["Content-Type"] = "application/json"; // Exactly: with "; charset=utf-8" MangaBall ignores the body.
        init.method = "POST";
        init.body = JSON.stringify(json);
      }
      let res: Response;
      try {
        res = await this.fetcher()(target.toString(), init);
      } catch {
        throw new MangaSourceError(`${this.label} couldn't be reached. Check your connection and retry.`);
      }
      const final = publicHttps(res.url || target.toString());
      if (!final || !this.hosts.has(final.hostname)) throw new MangaSourceError(`${this.label} redirected somewhere unexpected.`);
      if (this.verifiable && res.headers.get("cf-mitigated")?.toLowerCase() === "challenge") {
        throw new MangaSourceError(`${this.label} needs a quick check. Use Connect ${this.label}, complete it, then retry.`, 403, true);
      }
      const text = await readCapped(res, maxBytes, this.label);
      if (res.status === 404) throw new MangaSourceError(`${this.label} doesn't have this anymore.`, 404);
      if (res.status === 429) throw new MangaSourceError(`${this.label} is limiting requests. Wait a minute, then retry.`, 429);
      if (res.status === 403 || res.status === 503) {
        if (this.verifiable && CHALLENGE.test(text.slice(0, 16_384))) {
          throw new MangaSourceError(`${this.label} needs a quick check. Use Connect ${this.label}, complete it, then retry.`, 403, true);
        }
        throw new MangaSourceError(`${this.label} refused the request. Try again later.`, res.status);
      }
      if (!res.ok) throw new MangaSourceError(`${this.label} returned an error (HTTP ${res.status}).`, res.status);
      if (CHALLENGE.test(text.slice(0, 4096))) {
        throw new MangaSourceError(
          this.verifiable ? `${this.label} needs a quick check. Use Connect ${this.label}, complete it, then retry.` : `${this.label} is showing a browser check. Try again later.`,
          403,
          this.verifiable,
        );
      }
      return text;
    } finally {
      clearTimeout(timer);
      this.last = Date.now();
    }
  }
}

async function readCapped(res: Response, maxBytes: number, label: string): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new MangaSourceError(`${label} sent an unexpectedly large response.`);
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new MangaSourceError(`${label} sent an unexpectedly large response.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const parseJson = (text: string): unknown => {
  try { return JSON.parse(text); } catch { throw new MangaSourceError("The source sent a response AniTrack couldn't read."); }
};

// ── Common source behaviour ───────────────────────────────────────────────────

interface Source {
  info: MangaSourceInfo;
  find(manga: MangaMeta): Promise<SourceTitle | null>;
  chapters(title: SourceTitle): Promise<MangaChapter[]>;
  /** Page images for the renderer, through the app's image protocol. */
  pages(title: SourceTitle, chapterId: string): Promise<MangaPageImage[]>;
  /** Page images at the source itself (for downloads, fetched with [fetchPageImage]). */
  pageImages(title: SourceTitle, chapterId: string): Promise<MangaPageImage[]>;
  /** The newest chapter of a matched title (one small request). */
  latest(title: SourceTitle): Promise<SourceLatest | null>;
}

const MATCH_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const CHAPTERS_TTL_MS = 5 * 60 * 1000;

/** A title lookup shared by both sources: cached answers, saved matches, then a confirmed search. */
function matcher(
  sourceId: string,
  search: (query: string) => Promise<string[]>,
  detail: (id: string) => Promise<SourceDetail | null>,
): (manga: MangaMeta) => Promise<SourceTitle | null> {
  const memory = new Map<number, { at: number; title: SourceTitle | null }>();
  return async (manga) => {
    const hit = memory.get(manga.id);
    if (hit && Date.now() - hit.at < (hit.title ? MATCH_TTL_MS : MISS_TTL_MS)) return hit.title;
    const saved = savedMatch(manga.id, sourceId);
    if (saved) {
      memory.set(manga.id, { at: Date.now(), title: saved });
      return saved;
    }
    const queries = [...new Map(
      [manga.title, manga.titleRomaji]
        .filter((q): q is string => !!q && q.trim().length >= 2)
        .map((q) => [normalizeTitle(q), q.trim().slice(0, 120)] as const),
    ).values()];
    const checked = new Set<string>();
    let found: SourceDetail | null = null;
    outer: for (const query of queries) {
      const ids = await search(query);
      for (const id of ids) {
        if (checked.has(id)) continue;
        checked.add(id);
        const d = await detail(id);
        if (d && sourceMatches(d, manga)) { found = d; break outer; }
      }
    }
    const title = found ? { sourceId, id: found.id, title: found.title } : null;
    memory.set(manga.id, { at: Date.now(), title });
    if (title) saveMatch(manga.id, title);
    return title;
  };
}

// ── Saved chapter lists ───────────────────────────────────────────────────────

const savedListName = (title: SourceTitle) => `chapters-${title.sourceId}-${title.id}`;
const listableTitle = (title: SourceTitle) =>
  (title.sourceId === "mangaball" && isMangaBallId(title.id)) || (title.sourceId === "mangadot" && /^\d{1,12}$/.test(title.id)) ||
  (title.sourceId === "comix" && /^[a-zA-Z0-9]{1,32}$/.test(title.id));

/** Keeps a fresh chapter list on disk, so the title page can show it at once next time (or offline). */
function keepList(title: SourceTitle, list: MangaChapter[]) {
  if (list.length && listableTitle(title)) void writeCached(savedListName(title), list);
}

/** The chapter list saved by the last successful fetch, with when it was saved. */
export async function savedChapters(title: SourceTitle): Promise<{ at: number; list: MangaChapter[] } | null> {
  if (!listableTitle(title)) return null;
  const saved = await readCached<unknown[]>(savedListName(title));
  if (!saved || !Array.isArray(saved.value)) return null;
  const list = saved.value.filter((c): c is MangaChapter => {
    const o = c as Partial<MangaChapter> | null;
    return !!o && typeof o.id === "string" && o.id.length <= 64 && typeof o.number === "number" && Number.isFinite(o.number);
  });
  return list.length ? { at: saved.at, list } : null;
}

/** The app's image protocol URL for a source page (the main process adds the headers each source needs). */
const imageUrl = (sourceId: string, url: string) => `anitrack-manga://img/?s=${sourceId}&u=${encodeURIComponent(url)}`;

/** A source's [pageImages], as the renderer loads them. */
const viaProtocol = (sourceId: string, pageImages: Source["pageImages"]): Source["pages"] =>
  async (title, chapterId) => (await pageImages(title, chapterId)).map((page) => ({ ...page, url: imageUrl(sourceId, page.url) }));

const LATEST_TTL_MS = 5 * 60 * 1000;

/** A [latest] lookup remembered for a few minutes, so reopening Updates doesn't ask every title again. */
function cachedLatest(load: (id: string) => Promise<SourceLatest | null>): (title: SourceTitle) => Promise<SourceLatest | null> {
  const memory = new Map<string, { at: number; value: SourceLatest | null }>();
  return async (title) => {
    const hit = memory.get(title.id);
    if (hit && Date.now() - hit.at < LATEST_TTL_MS) return hit.value;
    const value = await load(title.id);
    if (memory.size > 300) memory.delete(memory.keys().next().value!);
    memory.set(title.id, { at: Date.now(), value });
    return value;
  };
}

const latestOf = (detail: SourceDetail | null): SourceLatest | null =>
  detail && (detail.latestChapter != null || detail.latestAt != null) ? { chapter: detail.latestChapter, at: detail.latestAt } : null;

// ── MangaBall: public JSON API ───────────────────────────────────────────────

const ballHttp = new SourceHttp("MangaBall", new Set(["api.mangaball.com"]), 250, () => net.fetch, honestAgent());
const ballChapters = new Map<string, { at: number; list: MangaChapter[] }>();
const ballDetail = async (id: string) => mangaBallDetail(parseJson(await ballHttp.get(`${MANGABALL.API}/title/detail/${id}`, 2 * 1024 * 1024)));

/**
 * Image hosts MangaBall's own API named in this run (it rotates its CDN). The image
 * protocol fetches MangaBall pages from these hosts only, so it never becomes a
 * fetcher for arbitrary addresses.
 */
const ballImageHosts = new Set<string>();

async function ballPageImages(_title: SourceTitle, chapterId: string): Promise<MangaPageImage[]> {
  if (!isMangaBallId(chapterId)) throw new MangaSourceError("Unrecognised MangaBall chapter.");
  const body = await ballHttp.get(`${MANGABALL.API}/chapter-detail?chapter_id=${chapterId}&user_id=demo_user`, 2 * 1024 * 1024);
  const pages = mangaBallPages(parseJson(body)).map((url) => ({ url, width: null, height: null }));
  if (!pages.length) throw new MangaSourceError("MangaBall has no pages for this chapter.");
  const host = new URL(pages[0].url).hostname.toLowerCase();
  ballImageHosts.delete(host);
  ballImageHosts.add(host);
  while (ballImageHosts.size > 16) ballImageHosts.delete(ballImageHosts.values().next().value!);
  return pages;
}

const mangaBall: Source = {
  info: { id: "mangaball", label: "MangaBall", needsConnect: false },
  find: matcher(
    "mangaball",
    async (query) => {
      const body = await ballHttp.get(`${MANGABALL.API}/title/search-advanced?keyword=${encodeURIComponent(query)}&page=1&limit=10&adult_mode=no_18`, 4 * 1024 * 1024);
      const names = new Set([normalizeTitle(query)]);
      return mangaBallSearch(parseJson(body))
        .filter((hit) => !hit.adult)
        .sort((a, b) => Number(!names.has(normalizeTitle(a.name))) - Number(!names.has(normalizeTitle(b.name))))
        .slice(0, 5)
        .map((hit) => hit.id);
    },
    ballDetail,
  ),
  async chapters(title) {
    if (!isMangaBallId(title.id)) throw new MangaSourceError("Unrecognised MangaBall title.");
    const hit = ballChapters.get(title.id);
    if (hit && Date.now() - hit.at < CHAPTERS_TTL_MS) return hit.list;
    // Every English upload in one request: the listing MangaBall's own site code calls
    // (found with REA in its bundle). One Piece's 4,720 uploads took 3.5 s, where the
    // paged listing took ~2.2 s for each of its 10 pages. The paged listing stays as
    // the fallback should this endpoint change.
    let all: MangaChapter[] = [];
    try {
      const body = await ballHttp.post(
        `${MANGABALL.API}/chapter/chapter-listing-by-title-id`,
        { title_id: title.id, user_id: "demo_user", lang: "en" },
        32 * 1024 * 1024,
      );
      all = mangaBallAllChapters(parseJson(body));
    } catch (error) {
      if (error instanceof MangaSourceError && error.status === 429) throw error; // Don't double the load when limited.
      console.warn("[MangaBall] single-call chapter listing failed, using the paged listing", error);
    }
    const paged = !all.length;
    for (let page = 1; paged && page <= 20; page++) {
      const body = await ballHttp.get(
        `${MANGABALL.API}/title/chapter-listing?title_id=${title.id}&page=${page}&limit=500&group_by=flat&sort_order=asc&language=en&search=`,
        16 * 1024 * 1024,
      );
      const result = mangaBallChapters(parseJson(body));
      all.push(...result.chapters);
      if (page >= result.totalPages || all.length >= MAX_CHAPTERS) break;
    }
    const list = [...new Map(all.map((c) => [c.id, c])).values()];
    if (list.length) ballChapters.set(title.id, { at: Date.now(), list });
    keepList(title, list);
    return list;
  },
  pages: viaProtocol("mangaball", ballPageImages),
  pageImages: ballPageImages,
  // The newest English upload: the title detail's `updated_at` lags behind its chapters.
  latest: cachedLatest(async (id) => {
    if (!isMangaBallId(id)) return null;
    const body = await ballHttp.get(
      `${MANGABALL.API}/title/chapter-listing?title_id=${id}&page=1&limit=10&group_by=flat&sort_order=desc&language=en&search=`,
      1024 * 1024,
    );
    return mangaBallLatest(parseJson(body));
  }),
};

// ── MangaDot: JSON API behind Cloudflare, with a user-verified session ────────

const MANGADOT_PARTITION = "persist:mangadot";
/**
 * Cloudflare issues MangaDot's clearance as a partitioned (CHIPS) cookie, which the
 * browser sends only from a page on mangadot.net. Main-process requests never carry
 * it and were always challenged, even right after the user's check (observed
 * 2026-10-15). So API reads and page images are made by the user-verified page
 * itself, from an isolated world. The cookie is never copied or re-scoped.
 */
const dotPage = new VerifiedPageSession({
  origin: MANGADOT.ORIGIN, partition: MANGADOT_PARTITION, label: "MangaDot", world: 1210,
  maxBodyBytes: 16 * 1024 * 1024, requestTimeoutMs: 25_000,
});

/** One same-origin GET from the verified page, as a fetch Response. */
async function dotFetch(url: string, accept: string, binary = false): Promise<Response> {
  let answer;
  try {
    answer = await dotPage.get(url, accept, ["cf-mitigated", "content-type", "retry-after"], binary ? "base64" : "utf8");
  } catch (error) {
    // An unfinished or closed check is still a check: the caller offers Connect MangaDot.
    if (error instanceof PageVerificationError) return new Response("", { status: 403, headers: { "cf-mitigated": "challenge" } });
    throw error;
  }
  if (answer.body === null) throw new MangaSourceError("MangaDot sent an unexpectedly large response.");
  const body = answer.status === 204 || answer.status === 304 ? null
    : binary ? Buffer.from(answer.body, "base64") : answer.body;
  return new Response(body, { status: answer.status, headers: answer.headers });
}

const dotHttp = new SourceHttp(
  "MangaDot",
  new Set(["mangadot.net"]),
  300,
  () => (url) => dotFetch(url, "application/json"),
  null,
  true,
);
const dotChapters = new Map<string, { at: number; list: MangaChapter[] }>();
const dotDetail = async (id: string) => mangaDotDetail(parseJson(await dotHttp.get(`${MANGADOT.ORIGIN}/api/manga/${Number(id)}`, 1024 * 1024)));

async function dotPageImages(_title: SourceTitle, chapterId: string): Promise<MangaPageImage[]> {
  const path = mangaDotImagesPath(chapterId);
  if (!path) throw new MangaSourceError("Unrecognised MangaDot chapter.");
  const pages = mangaDotPages(parseJson(await dotHttp.get(`${MANGADOT.ORIGIN}${path}`, 1024 * 1024)));
  if (!pages.length) throw new MangaSourceError("MangaDot has no pages for this chapter.");
  return pages;
}

const mangaDot: Source = {
  info: { id: "mangadot", label: "MangaDot", needsConnect: true },
  find: matcher(
    "mangadot",
    async (query) => mangaDotSuggestions(parseJson(await dotHttp.get(`${MANGADOT.ORIGIN}/api/search/suggestions?q=${encodeURIComponent(query)}&limit=8`, 256 * 1024))).map(String),
    dotDetail,
  ),
  async chapters(title) {
    const id = Number(title.id);
    if (!Number.isInteger(id) || id <= 0) throw new MangaSourceError("Unrecognised MangaDot title.");
    const hit = dotChapters.get(title.id);
    if (hit && Date.now() - hit.at < CHAPTERS_TTL_MS) return hit.list;
    const list = mangaDotChapters(parseJson(await dotHttp.get(`${MANGADOT.ORIGIN}/api/manga/${id}/chapters/list`, 16 * 1024 * 1024)));
    if (list.length) dotChapters.set(title.id, { at: Date.now(), list });
    keepList(title, list);
    return list;
  },
  pages: viaProtocol("mangadot", dotPageImages),
  pageImages: dotPageImages,
  latest: cachedLatest(async (id) => (/^\d{1,12}$/.test(id) && Number(id) > 0 ? latestOf(await dotDetail(id)) : null)),
};

// ── Comix: website-owned signing/decoding in its isolated catalogue session ──

async function comixRead(path: string, params: ComixParams = {}) {
  try { return await comixSession.read(path, params); }
  catch (error) {
    if (error instanceof ComixSessionError) throw new MangaSourceError(error.message, undefined, error.verify);
    throw new MangaSourceError("Comix catalogue did not complete. Retry manually.");
  }
}

function comixTitleId(title: SourceTitle): string {
  if (title.sourceId !== "comix" || !comixValidRequest(`/manga/${title.id}`, {})) throw new MangaSourceError("Unrecognised Comix title.");
  return title.id;
}

const comixLists = new Map<string, { at: number; list: MangaChapter[] }>();
const comixTitleDetail = async (id: string) => comixDetail(await comixRead(`/manga/${id}`), id);
/** Supplies a chapter's pre-fetched reader outerHTML, or null to use the catalogue API. Fetching stays with the host. */
export type ComixReaderHtmlSource = (title: SourceTitle, chapterId: string) => Promise<string | null>;
let comixReaderHtml: ComixReaderHtmlSource | null = null;
const comixHtmlParser = new ComixHtmlPageParser();

/** Installs (or with null, removes) the host's reader-HTML supplier. */
export function setComixReaderHtmlSource(source: ComixReaderHtmlSource | null): void {
  comixReaderHtml = source;
}

/** Page images at the source from a static reader snapshot; data only, never fetched or executed. */
export function comixPagesFromHtml(rawHtmlPayload: string): MangaPageImage[] {
  let urls: string[];
  try { urls = comixHtmlParser.extractMangaPages(rawHtmlPayload); } catch (error) {
    throw new MangaSourceError(error instanceof Error ? error.message : "Comix reader HTML was not readable.");
  }
  if (!urls.length) throw new MangaSourceError("Comix reader HTML has no pages for this chapter.");
  return urls.map((url) => ({ url, width: null, height: null }));
}

const comixPageImages: Source["pageImages"] = async (title, chapterId) => {
  comixTitleId(title);
  if (!/^\d{1,15}$/.test(chapterId)) throw new MangaSourceError("Unrecognised Comix chapter.");
  const html = comixReaderHtml ? await comixReaderHtml(title, chapterId) : null;
  if (html != null) return comixPagesFromHtml(html);
  return comixPages(await comixRead(`/chapters/${chapterId}`));
};

const comix: Source = {
  info: { id: "comix", label: "Comix", needsConnect: true },
  find: matcher("comix", async query => comixSearchIds(await comixRead("/manga", {
    keyword: query, page: 1, limit: 20, "order[relevance]": "desc",
  })), comixTitleDetail),
  async chapters(title) {
    const hid = comixTitleId(title);
    const hit = comixLists.get(hid);
    if (hit && Date.now() - hit.at < CHAPTERS_TTL_MS) return hit.list;
    const started = Date.now();
    const assertDeadline = () => {
      if (Date.now() - started >= COMIX_CHAPTER_LIST_DEADLINE_MS) throw new MangaSourceError("Comix chapter list timed out; no partial list was saved.");
    };
    const all = new Map<string, MangaChapter>();
    let expectedTotal: number | null = null;
    for (let page = 1; page <= 200; page++) {
      assertDeadline();
      const value = await comixRead(`/manga/${hid}/chapters`, { page, limit: 100, "order[number]": "asc" });
      assertDeadline();
      const rows = comixChapters(value);
      const pagination = value.pagination ?? value.meta;
      const total = pagination && typeof pagination === "object" && !Array.isArray(pagination)
        ? (pagination as Record<string, unknown>).total : undefined;
      if (typeof total !== "number" || !Number.isSafeInteger(total) || total < 0 || total > 20_000) {
        throw new MangaSourceError("Comix omitted its chapter total; no partial list was saved.");
      }
      if (expectedTotal === null) expectedTotal = total;
      else if (expectedTotal !== total) throw new MangaSourceError("Comix chapter total changed; retry manually. No partial list was saved.");
      for (const row of rows) {
        if (all.has(row.id)) throw new MangaSourceError("Comix repeated a chapter; no partial list was saved.");
        all.set(row.id, row);
      }
      if (all.size > expectedTotal) throw new MangaSourceError("Comix returned an inconsistent chapter total; no partial list was saved.");
      const more = comixHasNext(value, page);
      if (!more) {
        if (all.size !== expectedTotal) throw new MangaSourceError("Comix returned an incomplete chapter list; no partial list was saved.");
        const list = [...all.values()];
        assertDeadline();
        if (comixLists.size >= 20) comixLists.delete(comixLists.keys().next().value!);
        if (list.length) comixLists.set(hid, { at: Date.now(), list });
        keepList(title, list);
        return list;
      }
      if (!rows.length || all.size === expectedTotal) throw new MangaSourceError("Comix returned inconsistent chapter pagination; no partial list was saved.");
    }
    throw new MangaSourceError("Comix chapter list exceeds the supported limit; no partial list was saved.");
  },
  pages: viaProtocol("comix", comixPageImages),
  pageImages: comixPageImages,
  latest: cachedLatest(async id => latestOf(await comixTitleDetail(id))),
};

/** Preserve existing source preference; Comix is an additional explicit choice. */
const SOURCES: Source[] = [mangaDot, mangaBall, comix];

export const sourceInfos = (): MangaSourceInfo[] => SOURCES.map((source) => source.info);

export function sourceById(id: unknown): Source {
  const source = SOURCES.find((s) => s.info.id === id);
  if (!source) throw new MangaSourceError("Unknown reading source.");
  return source;
}

/**
 * The newest chapter of one title for the Updates page. A saved match answers with
 * one small request; otherwise each source (the one picked on the title's page
 * first) looks the title up in turn. Sources in [skip], or that ask for their check
 * now ([LatestResult.blocked]), are left out. One title failing never throws.
 */
export async function latestFor(mangaId: number, preferred: string | null, skip: ReadonlySet<string>): Promise<LatestResult> {
  const order = [...SOURCES].sort((a, b) => Number(b.info.id === preferred) - Number(a.info.id === preferred));
  const blocked: string[] = [];
  const usable = (source: Source) => !skip.has(source.info.id) && !blocked.includes(source.info.id);
  const attempt = async <T>(source: Source, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof MangaSourceError && error.verify) blocked.push(source.info.id);
      return null;
    }
  };
  const answer = (source: Source, latest: SourceLatest): LatestResult => ({
    found: { ...latest, sourceId: source.info.id, label: source.info.label },
    blocked,
  });
  for (const source of order) {
    const title = usable(source) ? savedMatch(mangaId, source.info.id) : null;
    const latest = title ? await attempt(source, () => source.latest(title)) : null;
    if (latest) return answer(source, latest);
  }
  if (!order.some((source) => usable(source) && !savedMatch(mangaId, source.info.id))) return { found: null, blocked };
  const manga = await mangaById(mangaId).catch(() => null);
  if (!manga) return { found: null, blocked };
  for (const source of order) {
    if (!usable(source) || savedMatch(mangaId, source.info.id)) continue;
    const title = await attempt(source, () => source.find(manga));
    const latest = title ? await attempt(source, () => source.latest(title)) : null;
    if (latest) return answer(source, latest);
  }
  return { found: null, blocked };
}

/**
 * Opens MangaDot in its own window so the user can pass the site's check themselves
 * (AniTrack never solves it). Resolves once the window closes, with whether the
 * session now reaches the API.
 */
export function connectMangaDot(parent: BrowserWindow | null): Promise<boolean> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 1000,
      height: 760,
      parent: parent ?? undefined,
      title: "Connect MangaDot",
      autoHideMenuBar: true,
      webPreferences: { partition: MANGADOT_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.on("closed", () => {
      dotHttp.get(`${MANGADOT.ORIGIN}/api/search/suggestions?q=one&limit=1`, 256 * 1024)
        .then(body => {
          try {
            const value = parseJson(body) as { suggestions?: unknown } | null;
            resolve(!!value && Array.isArray(value.suggestions));
          } catch { resolve(false); }
        }, () => resolve(false));
    });
    void win.loadURL(`${MANGADOT.ORIGIN}/`);
  });
}

export function connectMangaSource(sourceId: unknown, parent: BrowserWindow | null): Promise<boolean> {
  if (sourceId === "mangadot") return connectMangaDot(parent);
  if (sourceId === "comix") return comixSession.connect(parent);
  return Promise.resolve(false);
}

/**
 * Fetches a page image from its source with the headers (and session) that source
 * needs, or null for an address the source doesn't serve pages from.
 */
export function fetchPageImage(sourceId: string, target: URL, signal?: AbortSignal): Promise<Response> | null {
  if (sourceId === "comix") return fetchComixImage(target.toString(), signal);
  if (sourceId === "mangaball" && ballImageHosts.has(target.hostname.toLowerCase())) {
    return net.fetch(target.toString(), { headers: { Referer: `${MANGABALL.SITE}/`, "User-Agent": honestAgent() }, signal });
  }
  if (sourceId === "mangadot" && isMangaDotPage(target)) {
    // From the verified page, which sends its own Referer and partitioned clearance.
    return dotFetch(target.toString(), "image/avif,image/webp,image/apng,image/*;q=0.8", true);
  }
  return null;
}

/** Serves a page image to the renderer with the headers (and session) its source needs. */
export async function servePageImage(requestUrl: string): Promise<Response> {
  let target: URL | null = null;
  let source = "";
  try {
    const u = new URL(requestUrl);
    source = u.searchParams.get("s") ?? "";
    target = publicHttps(u.searchParams.get("u") ?? "");
  } catch { /* handled below */ }
  if (!target) return new Response("", { status: 400 });
  const pending = fetchPageImage(source, target);
  if (!pending) return new Response("", { status: 403 });
  let response: Response;
  try {
    response = await pending;
  } catch {
    return new Response("", { status: 502 });
  }
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.startsWith("image/")) return new Response("", { status: response.ok ? 415 : response.status });
  return new Response(response.body, {
    status: 200,
    headers: { "Content-Type": type, "Cache-Control": "max-age=86400" },
  });
}
