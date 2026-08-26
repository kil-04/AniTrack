import { useEffect, useState } from "react";
import Row from "./Row";
import Card from "./Card";
import type { AnimeMeta, AdvancedSearchFilters } from "../../../../packages/shared/types";

interface Props {
  title: string;
  filters: AdvancedSearchFilters;
  limit?: number;
}

// A horizontally-scrolling row that lazily fetches its own catalogue slice
// from AniList. Used for the Anikoto-style discovery sections on Home
// (Top Airing, Most Popular, Top Movies, …).
export default function DiscoverRow({ title, filters, limit = 18 }: Props) {
  const [items, setItems] = useState<AnimeMeta[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.api.anilist
      .advancedSearch({ ...filters, page: 1 })
      .then((res) => {
        if (!cancelled) setItems(res.results.slice(0, limit));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), limit]);

  if (items.length === 0) return null;

  return (
    <Row title={title}>
      {items.map((a) => (
        <Card key={a.id} anime={a} size="sm" />
      ))}
    </Row>
  );
}
