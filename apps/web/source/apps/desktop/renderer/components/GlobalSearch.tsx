import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Search, Filter, X } from 'lucide-react';
import type { AnimeMeta } from '../../../../packages/shared/types';

export default function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AnimeMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const delay = setTimeout(() => {
      setLoading(true);
      window.api.anilist.advancedSearch({ query: q.trim() }).then((res: any) => {
        const resultsArray = Array.isArray(res) ? res : res.results || [];
        setResults(resultsArray.slice(0, 8)); // limit to 8 for dropdown
        setSelectedIndex(-1);
      }).catch(() => {}).finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(delay);
  }, [q]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!focused || !q.trim()) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        navigate('/anime/' + results[selectedIndex].id, { state: { anime: results[selectedIndex] } });
        setFocused(false);
      } else {
        navigate('/filter?q=' + encodeURIComponent(q.trim()));
        setFocused(false);
      }
    } else if (e.key === 'Escape') {
      setFocused(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="titlebar-no-drag relative flex w-full items-center">
      <div className="relative w-full flex items-center">
        <Search size={16} className="pointer-events-none absolute left-3.5 text-ink-3" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search anime"
          className="h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.05] pl-10 pr-24 text-sm text-white outline-none transition placeholder:text-ink-3 hover:bg-white/[0.07] focus:border-accent/50 focus:bg-surface-2 focus:ring-4 focus:ring-accent/15"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="absolute right-[4.25rem] rounded-md p-1 text-ink-3 transition-colors hover:text-white"
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate('/filter' + (q ? '?q=' + encodeURIComponent(q) : ''))}
          className="absolute right-2 flex items-center gap-1.5 rounded-lg p-1 text-ink-3 transition-colors hover:text-white"
          title="Advanced Filter"
        >
          {!q && <span className="kbd">Ctrl K</span>}
          <Filter size={14} />
        </button>
      </div>

      {focused && q.trim().length > 0 && (
        <div className="absolute top-full left-0 z-[9999] mt-2 w-full overflow-hidden rounded-2xl border border-white/10 bg-surface-1/95 shadow-pop backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
          {loading && results.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted">Searching...</div>
          ) : results.length > 0 ? (
            <div className="flex flex-col p-1.5">
              {results.map((anime, idx) => (
                <Link
                  key={anime.id}
                  to={'/anime/' + anime.id}
                  state={{ anime }}
                  onClick={() => setFocused(false)}
                  className={`flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.06] ${selectedIndex === idx ? 'bg-accent/[0.12] ring-1 ring-inset ring-accent/25' : ''}`}
                >
                  {anime.coverImage ? (
                    <img src={anime.coverImage} className="h-14 w-10 rounded-lg object-cover shadow-md ring-1 ring-white/10" alt="" loading="lazy" decoding="async" />
                  ) : (
                    <div className="flex h-14 w-10 items-center justify-center rounded-lg bg-white/5 text-xs text-muted">N/A</div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                    <div className="text-sm font-semibold truncate text-white">{anime.title}</div>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted uppercase tracking-wider">
                      {anime.year && <span className="rounded-md bg-white/[0.08] px-1.5 py-0.5">{anime.year}</span>}
                      {anime.averageScore && <span className="text-amber-300">★ {(anime.averageScore / 10).toFixed(1)}</span>}
                      {anime.status && <span>{anime.status.replace('_', ' ')}</span>}
                    </div>
                  </div>
                </Link>
              ))}
              <div className="mt-1 border-t border-white/[0.06] pt-1.5">
                <button
                  onClick={() => { navigate('/filter?q=' + encodeURIComponent(q)); setFocused(false); }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold text-accent transition-colors hover:bg-accent/10"
                >
                  <span>View all results for "{q}"</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-muted">No results found for "{q}"</div>
          )}

          <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/30 px-4 py-2 text-[10px] text-ink-3">
            <div className="flex gap-3">
              <span className="flex items-center gap-1"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> to navigate</span>
              <span className="flex items-center gap-1"><kbd className="kbd">↵</kbd> to select</span>
            </div>
            <span className="flex items-center gap-1"><kbd className="kbd">esc</kbd> to exit</span>
          </div>
        </div>
      )}
    </div>
  );
}
