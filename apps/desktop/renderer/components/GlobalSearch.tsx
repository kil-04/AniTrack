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
    <div ref={containerRef} className="titlebar-no-drag relative flex w-72 items-center">
      <div className="relative w-full flex items-center">
        <Search size={16} className="pointer-events-none absolute left-3 text-muted" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search anime... (Ctrl+K)"
          className="w-full rounded-full border border-white/10 bg-bg-card/80 py-1.5 pl-9 pr-16 text-sm text-white placeholder:text-muted focus:border-accent focus:outline-none transition-colors"
        />
        {q && (
          <button 
            type="button"
            onClick={() => setQ('')}
            className="absolute right-9 text-muted hover:text-white transition-colors p-1"
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate('/filter' + (q ? '?q=' + encodeURIComponent(q) : ''))}
          className="absolute right-2 text-muted hover:text-white transition-colors p-1 flex items-center gap-1"
          title="Advanced Filter"
        >
          <Filter size={14} />
        </button>
      </div>

      {focused && q.trim().length > 0 && (
        <div className="absolute top-full mt-2 w-full left-0 bg-[#1b1b1b] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[9999] animate-in fade-in zoom-in-95 duration-150">
          {loading && results.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted">Searching...</div>
          ) : results.length > 0 ? (
            <div className="flex flex-col py-2">
              {results.map((anime, idx) => (
                <Link
                  key={anime.id}
                  to={'/anime/' + anime.id}
                  state={{ anime }}
                  onClick={() => setFocused(false)}
                  className={`flex items-center gap-3 px-4 py-2 hover:bg-white/5 transition-colors ${selectedIndex === idx ? 'bg-white/10' : ''}`}
                >
                  {anime.coverImage ? (
                    <img src={anime.coverImage} className="w-10 h-14 object-cover rounded shadow-sm" alt="" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-10 h-14 bg-white/5 rounded flex items-center justify-center text-xs text-muted">N/A</div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                    <div className="text-sm font-semibold truncate text-white">{anime.title}</div>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-muted uppercase tracking-wider">
                      {anime.year && <span className="bg-white/10 px-1.5 py-0.5 rounded">{anime.year}</span>}
                      {anime.averageScore && <span className="text-green-400">★ {(anime.averageScore / 10).toFixed(1)}</span>}
                      {anime.status && <span>{anime.status.replace('_', ' ')}</span>}
                    </div>
                  </div>
                </Link>
              ))}
              <div className="mt-1 border-t border-white/5 pt-1 px-2">
                <button
                  onClick={() => { navigate('/filter?q=' + encodeURIComponent(q)); setFocused(false); }}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-white hover:bg-white/5 rounded transition-colors flex justify-between items-center"
                >
                  <span>View all results for "{q}"</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-sm text-muted">No results found for "{q}"</div>
          )}
          
          <div className="bg-black/40 border-t border-white/10 px-4 py-2 flex items-center justify-between text-[10px] text-muted">
            <div className="flex gap-3">
              <span className="flex items-center gap-1"><kbd className="bg-white/10 px-1 rounded font-sans">↑</kbd><kbd className="bg-white/10 px-1 rounded font-sans">↓</kbd> to navigate</span>
              <span className="flex items-center gap-1"><kbd className="bg-white/10 px-1 rounded font-sans">↵</kbd> to select</span>
            </div>
            <span className="flex items-center gap-1"><kbd className="bg-white/10 px-1 rounded font-sans">esc</kbd> to exit</span>
          </div>
        </div>
      )}
    </div>
  );
}
