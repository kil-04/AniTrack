// ── AniList GraphQL (direct fetch — public API) ────────────────────────────────

export const ANILIST_GQL = "https://graphql.anilist.co";

// Two-lane serial scheduler + TTL cache + 429 retry — mirrors apps/desktop/main/services/anilist.ts.
// All requests stay serialized (AniList 429s otherwise), but interactive calls
// (search / filter / detail get) go through the HIGH lane and always run before
// queued background work (watch-order relations crawl, trending, airing). Without
// the lanes, a Search or Filter request can sit behind dozens of queued background
// calls at 350ms spacing and appear to load forever.
const _alHigh: Array<() => Promise<void>> = [];
const _alLow: Array<() => Promise<void>> = [];
const _alPending = new Map<string, Promise<unknown>>();
let _alPumping = false;
let _alStartup = true;
setTimeout(() => { _alStartup = false; }, 6000);
const _alCache = new Map<string, { value: unknown; expires: number }>();
const AL_CACHE_TTL = 5 * 60 * 1000;

async function _alPump() {
  if (_alPumping) return;
  _alPumping = true;
  try {
    while (_alHigh.length || _alLow.length) {
      const job = (_alHigh.shift() ?? _alLow.shift())!;
      await job();
      // Space requests so we stay under AniList's ~90/min limit.
      await new Promise((r) => setTimeout(r, _alStartup ? 700 : 350));
    }
  } finally {
    _alPumping = false;
  }
}

export async function alGql<T>(
  query: string,
  variables: Record<string, unknown>,
  priority: "high" | "low" = "high",
): Promise<T> {
  const key = JSON.stringify({ query, variables });
  const hit = _alCache.get(key);
  if (hit && Date.now() < hit.expires) return hit.value as T;
  const pending = _alPending.get(key);
  if (pending) return pending as Promise<T>;

  const request = new Promise<T>((resolve, reject) => {
    const job = async () => {
      try {
        const result = await _alDoGql<T>(query, variables);
        _alCache.set(key, { value: result, expires: Date.now() + AL_CACHE_TTL });
        if (_alCache.size > 300) {
          const oldest = _alCache.keys().next().value;
          if (oldest !== undefined) _alCache.delete(oldest);
        }
        resolve(result);
      } catch (err) {
        reject(err);
      }
    };
    (priority === "high" ? _alHigh : _alLow).push(job);
    void _alPump();
  });
  _alPending.set(key, request);
  request.finally(() => _alPending.delete(key)).catch(() => {});
  return request;
}

async function _alDoGql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // Time-box the request — the scheduler is a single serial pump, so one
    // hung fetch would otherwise stall EVERY AniList call in the app.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(ANILIST_GQL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt < 3) continue;
      throw err;
    }
    clearTimeout(timer);
    if (res.status === 429) {
      if (attempt < 3) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Math.min(5000, isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * attempt);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error("AniList 429");
    }
    if (!res.ok) throw new Error(`AniList ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data as T;
  }
  throw new Error("AniList: exhausted retries");
}

export const MEDIA_FIELDS = `
  id idMal title { romaji english native } synonyms coverImage { large } bannerImage
  episodes status format popularity season seasonYear averageScore genres description(asHtml: false)
  startDate { year month day } nextAiringEpisode { airingAt episode }
  studios(isMain: true) { nodes { name } }
`;

export function mapMedia(m: any) {
  return {
    id: m.id,
    malId: m.idMal ?? null,
    title: m.title?.english || m.title?.romaji || "Unknown",
    titleEnglish: m.title?.english ?? null,
    titleRomaji: m.title?.romaji ?? null,
    coverImage: m.coverImage?.large ?? null,
    bannerImage: m.bannerImage ?? null,
    episodes: m.episodes ?? null,
    status: m.status ?? null,
    format: m.format ?? null,
    popularity: m.popularity ?? null,
    // Strip HTML tags — the synopsis is rendered via dangerouslySetInnerHTML, and
    // AniList descriptions can contain markup. (Desktop strips this in anilist.ts.)
    synopsis: (m.description ?? "").replace(/<[^>]+>/g, "") || null,
    genres: m.genres ?? [],
    averageScore: m.averageScore ?? null,
    year: m.seasonYear ?? null,
    studios: m.studios?.nodes?.map((n: any) => n.name) ?? [],
  };
}

// Mirrors apps/desktop/main/services/anilist.ts: AniList's SEARCH_MATCH ranks obscure
// synonym-matches above the obvious popular series, so re-rank each result page
// by relevance tier (exact/prefix > substring > word overlap) then popularity.
const _normTitle = (s: string | undefined | null) =>
  (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function _relevanceTier(query: string, m: any): number {
  const nq = _normTitle(query);
  if (!nq) return 0;
  const cands = [m.title?.english, m.title?.romaji, m.title?.native, ...(m.synonyms ?? [])]
    .map(_normTitle)
    .filter(Boolean);
  let tier = 0;
  for (const c of cands) {
    if (c === nq || c.startsWith(nq)) tier = Math.max(tier, 3);
    else if (c.includes(nq)) tier = Math.max(tier, 2);
    else {
      const qw = nq.split(" ");
      const cw = new Set(c.split(" "));
      if (qw.filter((w) => cw.has(w)).length / qw.length >= 0.5) tier = Math.max(tier, 1);
    }
  }
  return tier;
}

export function rankByRelevance(query: string, media: any[]): any[] {
  return media
    .map((m, i) => ({ m, score: _relevanceTier(query, m) * 1000 + Math.log10((m.popularity ?? 0) + 1) * 10 - i * 0.001 }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
}
