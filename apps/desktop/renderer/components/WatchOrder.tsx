import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
import type { AnimeMeta } from "../../../../packages/shared/types";

/**
 * Franchise watch order — an ordered season timeline built by walking AniList
 * relation edges: PREQUEL hops back to the franchise root, then SEQUEL hops
 * forward to the latest entry. Movies/side stories stay in the Related strip;
 * this is the main-series spine ("what do I watch next?").
 */

const MAX_HOPS = 15;

// Prefer main-series formats when a show has several sequels/prequels
// (e.g. a TV sequel and an OVA both tagged SEQUEL).
const FORMAT_RANK: Record<string, number> = { TV: 0, ONA: 1, TV_SHORT: 2 };
function formatRank(f?: string | null) {
  return f != null && f in FORMAT_RANK ? FORMAT_RANK[f] : 3;
}

function pickHop(edges: { relationType: string; anime: AnimeMeta }[], type: "PREQUEL" | "SEQUEL"): AnimeMeta | null {
  const candidates = edges.filter((e) => e.relationType === type && e.anime?.id > 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const fr = formatRank(a.anime.format) - formatRank(b.anime.format);
    if (fr !== 0) return fr;
    return (a.anime.year ?? 9999) - (b.anime.year ?? 9999);
  });
  return candidates[0].anime;
}

// Franchise chains rarely change mid-session — cache per anime id so hopping
// between seasons of the same show doesn't re-crawl AniList every time.
const chainCache = new Map<number, AnimeMeta[]>();

async function buildChain(animeId: number, isCancelled: () => boolean): Promise<AnimeMeta[]> {
  const cached = chainCache.get(animeId);
  if (cached) return cached;

  const relationsOf = (id: number) => window.api.anilist.relations(id).catch(() => []);

  const self = await window.api.anilist.get(animeId).catch(() => null);
  if (!self || isCancelled()) return [];

  // Walk back to the root…
  const before: AnimeMeta[] = [];
  let cur: AnimeMeta = self;
  const seen = new Set<number>([animeId]);
  for (let i = 0; i < MAX_HOPS; i++) {
    const prev = pickHop(await relationsOf(cur.id), "PREQUEL");
    if (!prev || seen.has(prev.id) || isCancelled()) break;
    seen.add(prev.id);
    before.unshift(prev);
    cur = prev;
  }

  // …then forward to the newest entry.
  const after: AnimeMeta[] = [];
  cur = self;
  for (let i = 0; i < MAX_HOPS; i++) {
    const next = pickHop(await relationsOf(cur.id), "SEQUEL");
    if (!next || seen.has(next.id) || isCancelled()) break;
    seen.add(next.id);
    after.push(next);
    cur = next;
  }

  const chain = [...before, self, ...after];
  if (chain.length > 1) {
    // Bounded — a long browse session shouldn't grow this forever.
    if (chainCache.size > 300) chainCache.clear();
    for (const m of chain) chainCache.set(m.id, chain);
  }
  return chain;
}

export default function WatchOrder({
  animeId,
  onChain,
}: {
  animeId: number;
  onChain?: (ids: number[]) => void;
}) {
  const navigate = useNavigate();
  const [chain, setChain] = useState<AnimeMeta[]>([]);

  useEffect(() => {
    let cancelled = false;
    setChain([]);
    if (!(animeId > 0 && animeId < 1_000_000_000)) return;
    buildChain(animeId, () => cancelled).then((c) => {
      if (cancelled) return;
      setChain(c.length > 1 ? c : []);
      onChain?.(c.length > 1 ? c.map((m) => m.id) : []);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeId]);

  if (chain.length < 2) return null;

  const curIdx = chain.findIndex((m) => m.id === animeId);
  const next = curIdx >= 0 && curIdx < chain.length - 1 ? chain[curIdx + 1] : null;

  return (
    <div className="mt-8 px-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Watch Order</h2>
        {next && (
          <button
            onClick={() => navigate(`/anime/${next.id}`, { state: { anime: next } })}
            className="flex items-center gap-1.5 rounded-full bg-[#e50914] px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-[#f6121d]"
          >
            <Play size={12} fill="currentColor" />
            Continue with {next.title.length > 32 ? next.title.slice(0, 32) + "…" : next.title}
          </button>
        )}
      </div>

      <div className="thin-scrollbar flex gap-3 overflow-x-auto pb-2">
        {chain.map((m, i) => {
          const isCurrent = m.id === animeId;
          return (
            <button
              key={m.id}
              onClick={() => !isCurrent && navigate(`/anime/${m.id}`, { state: { anime: m } })}
              className={`group relative w-32 flex-shrink-0 text-left ${isCurrent ? "cursor-default" : ""}`}
            >
              <div
                className={`relative overflow-hidden rounded-lg ${
                  isCurrent ? "ring-2 ring-[#e50914]" : "ring-1 ring-white/10"
                }`}
              >
                {m.coverImage ? (
                  <img
                    src={m.coverImage}
                    alt={m.title}
                    loading="lazy"
                    className={`h-44 w-32 object-cover transition ${isCurrent ? "" : "group-hover:scale-105"}`}
                  />
                ) : (
                  <div className="h-44 w-32 bg-white/5" />
                )}
                {/* Order badge */}
                <div
                  className={`absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-extrabold ${
                    isCurrent ? "bg-[#e50914] text-white" : "bg-black/70 text-white/90"
                  }`}
                >
                  {i + 1}
                </div>
                {isCurrent && (
                  <div className="absolute inset-x-0 bottom-0 bg-[#e50914]/90 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-white">
                    You are here
                  </div>
                )}
              </div>
              <p className={`mt-1.5 line-clamp-2 text-xs leading-tight transition ${isCurrent ? "text-white" : "text-white/70 group-hover:text-white"}`}>
                {m.title}
              </p>
              <p className="text-[10px] text-white/40">
                {[m.year, m.format === "TV" ? null : m.format].filter(Boolean).join(" · ")}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
