import { useEffect, useRef, useState } from "react";
import Row from "./Row";
import Card from "./Card";
import { homeFeedSettled } from "../store/useAppStore";
import type { AnimeMeta, AdvancedSearchFilters } from "../../../../packages/shared/types";

interface Props {
  title: string;
  filters: AdvancedSearchFilters;
  limit?: number;
}

// These catalogue slices change slowly but are among AniList's slowest queries
// (Top Airing can take 8 s), so each row is kept for half a day and painted from
// that copy straight away.
const CACHE_PREFIX = "anitrack-discover-v1:";
const FRESH_MS = 12 * 60 * 60 * 1000;
const MAX_WAIT_MS = 8000;

function readCache(key: string): { savedAt: number; items: AnimeMeta[] } | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return value && Array.isArray(value.items) && typeof value.savedAt === "number" ? value : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, items: AnimeMeta[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), items }));
  } catch {
    // Storage full or unavailable: the row still shows the live result.
  }
}

// A horizontally-scrolling row with its own catalogue slice from AniList. Used
// for the Anikoto-style discovery sections on Home (Top Airing, Most Popular, …).
export default function DiscoverRow({ title, filters, limit = 18 }: Props) {
  const key = CACHE_PREFIX + JSON.stringify(filters);
  const [items, setItems] = useState<AnimeMeta[]>(() => readCache(key)?.items.slice(0, limit) ?? []);
  const anchor = useRef<HTMLDivElement>(null);
  const [homeReady, setHomeReady] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const [settledKey, setSettledKey] = useState<string | null>(null);

  useEffect(() => {
    // Measure after the hero/latest rows have painted: before then, a lower
    // row can briefly sit at the top and would defeat deferred loading.
    let cancelled = false;
    const timer = setTimeout(() => { if (!cancelled) setHomeReady(true); }, MAX_WAIT_MS);
    void homeFeedSettled.then(() => {
      clearTimeout(timer);
      if (!cancelled) setHomeReady(true);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!homeReady) return;
    if (!anchor.current) return;
    if (typeof IntersectionObserver === "undefined") { setNearViewport(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { root: anchor.current.closest("main"), rootMargin: "240px 0px" });
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [homeReady]);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache(key);
    setItems(cached?.items.slice(0, limit) ?? []);
    if (cached && Date.now() - cached.savedAt < FRESH_MS) return;
    // Reserve the row's space, but don't queue slow catalogue queries until
    // scrolling brings this row close. Cached rows still paint immediately.
    if (!nearViewport) return;
    void window.api.anilist.advancedSearch({ ...filters, page: 1 })
      .then((res) => {
        if (cancelled || !res) return;
        const next = res.results.slice(0, limit);
        setItems(next);
        if (next.length > 0) writeCache(key, next);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSettledKey(key); });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, limit, nearViewport]);

  if (items.length === 0) {
    return (
      <div ref={anchor} data-discover-row={title}>
        {settledKey !== key && (
          <Row title={title}>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} aria-hidden="true" className="h-[232px] w-[144px] shrink-0 rounded-xl bg-white/[0.03]" />
            ))}
          </Row>
        )}
      </div>
    );
  }

  return (
    <div ref={anchor} data-discover-row={title}>
      <Row title={title}>
        {items.map((a) => (
          <Card key={a.id} anime={a} size="sm" />
        ))}
      </Row>
    </div>
  );
}
