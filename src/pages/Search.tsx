import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Card from "../components/Card";
import type { AnimeMeta } from "../../shared/types";

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const [results, setResults] = useState<AnimeMeta[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    window.api.anilist.search(q).then((r) => {
      if (!cancelled) {
        setResults(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [q]);

  return (
    <div className="px-8 py-8">
      <h1 className="mb-6 text-3xl font-bold">
        {q ? `Results for "${q}"` : "Search"}
      </h1>
      {loading && <div className="text-muted">Searching…</div>}
      {!loading && results.length === 0 && q && (
        <div className="text-muted">No results.</div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
        {results.map((a) => (
          <Card key={a.id} anime={a} />
        ))}
      </div>
    </div>
  );
}
