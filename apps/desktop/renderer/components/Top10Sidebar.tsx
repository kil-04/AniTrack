import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Captions, Mic } from "lucide-react";
import { providerClient } from "../lib/provider-api";
import type { ProviderFeedGroup, ProviderFeedItem } from "../../../../packages/shared/provider-types";

export default function Top10Sidebar() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("day");
  const [groups, setGroups] = useState<ProviderFeedGroup[] | null>(null);
  const [loading, setLoading] = useState(true);

  // The registry selects the first enabled connector with a normalized top feed.
  useEffect(() => {
    let cancelled = false;
    providerClient.feed("top", 1, 10)
      .then((result) => {
        if (cancelled) return;
        setGroups(result.groups);
        if (result.groups.length > 0) setTab(result.groups[0].id);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Resolve the provider result to its AniList entry so it opens the normal detail page.
  async function open(item: ProviderFeedItem) {
    for (const q of [item.title, ...(item.titleAlternatives ?? [])]) {
      try {
        const results = await window.api.anilist.search(q);
        if (results && results.length > 0) {
          navigate(`/anime/${results[0].id}`, { state: { anime: results[0] } });
          return;
        }
      } catch { /* try next */ }
    }
  }

  const tabs = groups ?? [];
  const items = tabs.find((group) => group.id === tab)?.items ?? [];

  return (
    <div className="rounded-xl border border-white/5 bg-[#1b1b1b] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">Top 10</h2>
        <div className="flex overflow-hidden rounded-md border border-white/10 text-[11px] font-semibold">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1 transition-colors ${
                tab === t.id ? "bg-white text-black" : "text-white/60 hover:bg-white/5"
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>
      </div>

      {loading && !groups ? (
        <div className="py-8 text-center text-sm text-white/30">Loading…</div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-sm text-white/30">Couldn't load rankings.</div>
      ) : (
        <div className="flex flex-col">
          {items.map((a, i) => (
            <button
              key={`${a.providerId}:${a.id || i}`}
              onClick={() => open(a)}
              className="flex items-center gap-3 border-b border-white/5 py-2.5 text-left last:border-0 hover:bg-white/[0.03] transition-colors"
            >
              <span
                className={`w-6 shrink-0 text-center text-lg font-black tabular-nums ${
                  i < 3 ? "text-white" : "text-white/25"
                }`}
              >
                {i + 1}
              </span>
              {a.poster ? (
                <img src={a.poster} alt="" className="h-14 w-10 shrink-0 rounded object-cover" loading="lazy" decoding="async" />
              ) : (
                <div className="h-14 w-10 shrink-0 rounded bg-white/5" />
              )}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm font-semibold leading-tight text-white/90">{a.title}</div>
                <div className="mt-1 flex items-center gap-2 text-[10px] font-bold text-white/40">
                  {a.subCount != null && (
                    <span className="flex items-center gap-0.5 text-emerald-300">
                      <Captions size={11} /> {a.subCount}
                    </span>
                  )}
                  {a.dubCount != null && (
                    <span className="flex items-center gap-0.5 text-sky-300">
                      <Mic size={10} /> {a.dubCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
