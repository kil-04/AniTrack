import { useEffect, useState } from "react";
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

  useEffect(() => {
    let cancelled = false;
    const cached = readCache(key);
    setItems(cached?.items.slice(0, limit) ?? []);
    if (cached && Date.now() - cached.savedAt < FRESH_MS) return;
    // Below the fold: let Home's hero and Latest Episodes go first, since AniList
    // answers one request at a time.
    const wait = new Promise<void>((resolve) => setTimeout(resolve, MAX_WAIT_MS));
    void Promise.race([homeFeedSettled, wait])
      .then(() => (cancelled ? null : window.api.anilist.advancedSearch({ ...filters, page: 1 })))
      .then((res) => {
        if (cancelled || !res) return;
        const next = res.results.slice(0, limit);
        setItems(next);
        if (next.length > 0) writeCache(key, next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, limit]);

  if (items.length === 0) return null;

  return (
    <Row title={title}>
      {items.map((a) => (
        <Card key={a.id} anime={a} size="sm" />
      ))}
    </Row>
  );
}
