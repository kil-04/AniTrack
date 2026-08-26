import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Card from "../components/Card";
import type { AnimeMeta } from "../../../../packages/shared/types";

export default function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const [results, setResults] = useState<AnimeMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.api.anilist.search(q)
      .then((r) => { if (!cancelled) setResults(r); })
      .catch((e: Error) => { if (!cancelled) { setError(e.message); setResults([]); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [q]);

  return (
    <div className="px-8 py-8">
      <h1 className="mb-6 text-3xl font-bold">
        {q ? `Results for "${q}"` : "Search"}
      </h1>
      {loading && <div className="text-muted">Searching…</div>}
      {!loading && error && (
        <div className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}
      {!loading && !error && results.length === 0 && q && (
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
