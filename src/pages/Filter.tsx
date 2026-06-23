import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import Card from '../components/Card';
import type { AnimeMeta, AdvancedSearchFilters } from '../../shared/types';
import { Search, Filter as FilterIcon, ChevronDown, Square, CheckSquare, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

const ANILIST_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];

const COMBINED_GENRES = [
  "Action", "Adventure", "Cars", "Comedy", "Dementia", "Demons", "Drama", "Ecchi", 
  "Fantasy", "Game", "Harem", "Historical", "Horror", "Isekai", "Josei", "Kids", 
  "Magic", "Mahou Shoujo", "Martial Arts", "Mecha", "Military", "Music", "Mystery", 
  "Parody", "Police", "Psychological", "Romance", "Samurai", "School", "Sci-Fi", 
  "Seinen", "Shoujo", "Shoujo Ai", "Shounen", "Shounen Ai", "Slice of Life", "Space", 
  "Sports", "Super Power", "Supernatural", "Thriller", "Vampire"
];

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const YEARS = Array.from({length: 90}, (_, i) => new Date().getFullYear() + 1 - i);
const TYPES = ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'];
const STATUSES = ['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'];

// Anikoto exposes a "Source" filter; AniList's MediaSource enum covers most of it.
const SOURCES = [
  { id: 'ORIGINAL', label: 'Original' },
  { id: 'MANGA', label: 'Manga' },
  { id: 'LIGHT_NOVEL', label: 'Light Novel' },
  { id: 'VISUAL_NOVEL', label: 'Visual Novel' },
  { id: 'NOVEL', label: 'Novel' },
  { id: 'WEB_NOVEL', label: 'Web Novel' },
  { id: 'VIDEO_GAME', label: 'Video Game' },
  { id: 'GAME', label: 'Game' },
  { id: 'COMIC', label: 'Comic' },
  { id: 'DOUJINSHI', label: 'Doujinshi' },
  { id: 'PICTURE_BOOK', label: 'Picture Book' },
  { id: 'LIVE_ACTION', label: 'Live Action' },
  { id: 'MULTIMEDIA_PROJECT', label: 'Multimedia Project' },
  { id: 'OTHER', label: 'Other' },
];

// Episode-count buckets, encoded "min-max" ("100-" = 100+).
const EPISODE_RANGES = [
  { id: '1-1', label: '1 episode' },
  { id: '2-12', label: '2 - 12' },
  { id: '13-24', label: '13 - 24' },
  { id: '25-50', label: '25 - 50' },
  { id: '51-100', label: '51 - 100' },
  { id: '100-', label: '100+' },
];

const SORTS = [
  { id: 'TRENDING_DESC', label: 'Trending' },
  { id: 'POPULARITY_DESC', label: 'Most Viewed' },
  { id: 'SCORE_DESC', label: 'Score' },
  { id: 'UPDATED_AT_DESC', label: 'Latest Updated' },
  { id: 'ID_DESC', label: 'Latest Added' },
  { id: 'START_DATE_DESC', label: 'Release Date' },
  { id: 'TITLE_ROMAJI', label: 'Name A-Z' },
  { id: 'EPISODES_DESC', label: 'Number of Episodes' },
];

function MultiSelectDropdown({ label, options, selected, onChange }: { label: string, options: string[], selected: string[], onChange: (s: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter(x => x !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button 
        type="button" 
        onClick={() => setOpen(!open)} 
        className="bg-[#1f1f1f] border border-white/10 rounded-md py-2 px-3 text-sm focus:border-accent focus:outline-none flex items-center justify-between gap-2 min-w-[140px] hover:bg-white/5 transition-colors"
      >
        <span className="truncate max-w-[120px]">
          {selected.length === 0 ? `Select ${label}` : `${selected.length} ${label}s`}
        </span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      
      {open && (
        <div className="absolute top-full mt-2 left-0 w-[600px] bg-[#222222] border border-white/10 shadow-2xl rounded-lg z-50 py-3 px-2">
          <div className="grid grid-cols-4 gap-y-1 gap-x-2 max-h-[400px] overflow-y-auto custom-scrollbar">
            {options.map(opt => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer hover:text-white text-white/80 transition-colors text-sm py-1.5 px-3 rounded hover:bg-white/5">
                <input 
                  type="checkbox" 
                  className="hidden" 
                  checked={selected.includes(opt)} 
                  onChange={() => toggle(opt)} 
                />
                {selected.includes(opt) ? <CheckSquare size={16} className="text-white flex-shrink-0" /> : <Square size={16} className="text-white/30 flex-shrink-0" />}
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Filter() {
  const [params, setParams] = useSearchParams();
  
  const [query, setQuery] = useState(params.get('q') || '');
  const [genre, setGenre] = useState<string[]>(params.get('genre') ? params.get('genre')!.split(',') : []);
  const [season, setSeason] = useState(params.get('season') || '');
  const [year, setYear] = useState(params.get('year') || '');
  const [type, setType] = useState(params.get('type') || '');
  const [status, setStatus] = useState(params.get('status') || '');
  const [source, setSource] = useState(params.get('source') || '');
  const [episodeRange, setEpisodeRange] = useState(params.get('episodes') || '');
  const [sort, setSort] = useState(params.get('sort') || '');

  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [lastPage, setLastPage] = useState(1);

  const [results, setResults] = useState<AnimeMeta[]>([]);
  const [topRated, setTopRated] = useState<AnimeMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingTop, setLoadingTop] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingTop(true);
    window.api.anilist.advancedSearch({ sort: 'SCORE_DESC' })
      .then(res => setTopRated(res.results.slice(0, 10)))
      .catch(() => {})
      .finally(() => setLoadingTop(false));
  }, []);

  const fetchResults = (pageNum: number, currentParams: URLSearchParams = params) => {
    setLoading(true);
    setError(null);
    
    const filters: AdvancedSearchFilters = { page: pageNum };
    
    const q = currentParams.get('q') || '';
    if (q.trim()) filters.query = q.trim();
    
    // Anikoto merges tags and genres into a single UI list.
    // We partition them before sending to AniList backend.
    const genreStr = currentParams.get('genre') || '';
    const selectedGenresTags = genreStr ? genreStr.split(',') : [];
    const selectedGenres = selectedGenresTags.filter(g => ANILIST_GENRES.includes(g));
    const selectedTags = selectedGenresTags.filter(g => !ANILIST_GENRES.includes(g));
    
    if (selectedGenres.length > 0) filters.genre = selectedGenres;
    if (selectedTags.length > 0) filters.tag = selectedTags;
    
    const s = currentParams.get('season');
    if (s) filters.season = s;
    
    const y = currentParams.get('year');
    if (y) filters.year = parseInt(y);
    
    const t = currentParams.get('type');
    if (t) filters.format = t;
    
    const st = currentParams.get('status');
    if (st) filters.status = st;

    const src = currentParams.get('source');
    if (src) filters.source = src;

    const eps = currentParams.get('episodes');
    if (eps) {
      const [min, max] = eps.split('-');
      if (min) filters.episodesGreater = parseInt(min, 10);
      if (max) filters.episodesLesser = parseInt(max, 10);
    }

    const so = currentParams.get('sort');
    if (so) filters.sort = so;

    let isRedirecting = false;
    window.api.anilist.advancedSearch(filters)
      .then(async (res) => {
        // Self-healing pagination:
        // If we requested an estimated high page number but got 0 results, calculate the true last page
        // using an optimized binary search with a smart check at page 10.
        // This ensures the user never gets stuck on a blank screen (like page 138).
        if (res.results.length === 0 && pageNum > 1) {
          isRedirecting = true;
          const findTrueLastPage = async (low: number, high: number): Promise<number> => {
            if (low >= high) return low;
            const mid = Math.floor((low + high + 1) / 2);
            try {
              const testRes = await window.api.anilist.advancedSearch({ ...filters, page: mid });
              if (testRes.results.length > 0) {
                return findTrueLastPage(mid, high);
              } else {
                return findTrueLastPage(low, mid - 1);
              }
            } catch (err) {
              console.error('Self-healing search attempt failed:', err);
              return low;
            }
          };

          let trueLast = 1;
          const upperLimit = pageNum - 1;
          if (upperLimit >= 10) {
            try {
              // Heuristic: check page 10 first to shrink the search space if the result set is small
              const checkTen = await window.api.anilist.advancedSearch({ ...filters, page: 10 });
              if (checkTen.results.length > 0) {
                trueLast = await findTrueLastPage(10, upperLimit);
              } else {
                trueLast = await findTrueLastPage(1, 9);
              }
            } catch (err) {
              trueLast = await findTrueLastPage(1, upperLimit);
            }
          } else {
            trueLast = await findTrueLastPage(1, upperLimit);
          }

          setPage(trueLast);
          fetchResults(trueLast, currentParams);
          return;
        }

        setResults(res.results);
        setHasNextPage(res.hasNextPage);
        setLastPage(res.lastPage ?? 1);
      })
      .catch(err => {
        console.error('Filter fetch failed:', err);
        const msg = String(err?.message || err || '');
        if (msg.includes('429')) {
          setError('AniList rate limit reached. Please wait a few seconds and try again.');
        } else {
          setError('Failed to load results. Please try again.');
        }
        setResults([]);
        setHasNextPage(false);
        setLastPage(1);
      })
      .finally(() => {
        if (!isRedirecting) {
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    setQuery(params.get('q') || '');
    setGenre(params.get('genre') ? params.get('genre')!.split(',') : []);
    setSeason(params.get('season') || '');
    setYear(params.get('year') || '');
    setType(params.get('type') || '');
    setStatus(params.get('status') || '');
    setSource(params.get('source') || '');
    setEpisodeRange(params.get('episodes') || '');
    setSort(params.get('sort') || '');

    setPage(1);
    fetchResults(1, params);
  }, [params]);

  const handleFilter = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (genre.length > 0) p.set('genre', genre.join(','));
    if (season) p.set('season', season);
    if (year) p.set('year', year);
    if (type) p.set('type', type);
    if (status) p.set('status', status);
    if (source) p.set('source', source);
    if (episodeRange) p.set('episodes', episodeRange);
    if (sort) p.set('sort', sort);
    setParams(p);
  };

  const effectiveLastPage = Math.max(lastPage, page + (hasNextPage ? 1 : 0));

  return (
    <div className="p-8 flex gap-8">
      <div className="flex-1">
        <h1 className="text-3xl font-bold mb-6">Filter</h1>
        
        <form onSubmit={handleFilter} className="flex flex-wrap gap-4 mb-8 bg-[#1b1b1b] p-4 rounded-xl border border-white/5">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input 
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search..." 
              className="w-full bg-[#1f1f1f] border border-white/10 rounded-md py-2 pl-9 pr-4 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          
          <MultiSelectDropdown label="genre" options={COMBINED_GENRES} selected={genre} onChange={setGenre} />

          <select value={season} onChange={e => setSeason(e.target.value)} className="bg-[#1f1f1f] border border-white/10 rounded-md py-2 px-3 text-sm focus:border-accent focus:outline-none">
            <option value="">Select season</option>
            {SEASONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={year} onChange={e => setYear(e.target.value)} className="bg-[#1f1f1f] border border-white/10 rounded-md py-2 px-3 text-sm focus:border-accent focus:outline-none">
            <option value="">Select year</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <select value={type} onChange={e => setType(e.target.value)} className="bg-[#1f1f1f] border border-white/10 rounded-md py-2 px-3 text-sm focus:border-accent focus:outline-none">
            <option value="">Select type</option>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <select value={status} onChange={e => setStatus(e.target.value)} className="bg-[#1f1f1f] border border-white/10 rounded-md py-2 px-3 text-sm focus:border-accent focus:outline-none">
            <option value="">Select status</option>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>

          <select value={source} onChange={e => setSource(e.target.value)} className="bg-[#1f1f1f] border border-white/10 rounded-md py-2 px-3 text-sm focus:border-accent focus:outline-none">
            <option value="">Select source</option>
            {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          <select value={episodeRange} onChange={e => setEpisodeRange(e.target.value)} className="bg-[#1f1f1f] border border-white/10 rounded-md py-2 px-3 text-sm focus:border-accent focus:outline-none">
            <option value="">Episode range</option>
            {EPISODE_RANGES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>

          <select value={sort} onChange={e => setSort(e.target.value)} className="bg-[#1f1f1f] border border-white/10 rounded-md py-2 px-3 text-sm focus:border-accent focus:outline-none">
            <option value="">Default sort</option>
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          <button type="submit" className="bg-accent hover:bg-accent/80 text-white py-2 px-6 rounded-md text-sm font-semibold transition-colors flex items-center gap-2">
            <FilterIcon size={16} /> Filter
          </button>
        </form>

        {loading ? (
          <div className="text-center py-20 text-muted">Loading...</div>
        ) : error ? (
          <div className="text-center py-20">
            <div className="text-red-400 mb-4">{error}</div>
            <button
              onClick={() => fetchResults(page)}
              className="bg-accent hover:bg-accent/80 text-white py-2 px-6 rounded-md text-sm font-semibold transition-colors"
            >
              Retry
            </button>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-20 text-muted">No results found matching your criteria.</div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
            {results.map(anime => (
              <Card key={anime.id} anime={anime} />
            ))}
          </div>
        )}
        
          <div className="mt-10 mb-6 flex items-center justify-center gap-1.5">
            {/* First Page */}
            <button
              onClick={() => {
                setPage(1);
                fetchResults(1);
                const gridEl = document.querySelector('.grid');
                if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              disabled={page === 1 || loading}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1f1f1f] text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition"
              title="First Page"
            >
              <ChevronsLeft size={15} />
            </button>

            {/* Previous Page */}
            <button
              onClick={() => {
                const prev = page - 1;
                setPage(prev);
                fetchResults(prev);
                const gridEl = document.querySelector('.grid');
                if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              disabled={page === 1 || loading}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1f1f1f] text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition"
              title="Previous Page"
            >
              <ChevronLeft size={15} />
            </button>

            {/* Current Page */}
            <span className="flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg px-3 text-sm font-semibold bg-white text-black border border-white/20">
              {page}
            </span>

            {/* Next Page */}
            <button
              onClick={() => {
                const next = page + 1;
                setPage(next);
                fetchResults(next);
                const gridEl = document.querySelector('.grid');
                if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              disabled={!hasNextPage || loading}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1f1f1f] text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition"
              title="Next Page"
            >
              <ChevronRight size={15} />
            </button>

            {/* Last Page */}
            {lastPage < 138 && (
              <button
                onClick={() => {
                  setPage(effectiveLastPage);
                  fetchResults(effectiveLastPage);
                  const gridEl = document.querySelector('.grid');
                  if (gridEl) gridEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                disabled={page === effectiveLastPage || !hasNextPage || loading}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1f1f1f] text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:pointer-events-none transition"
                title="Last Page"
              >
                <ChevronsRight size={15} />
              </button>
            )}
          </div>

      </div>

      <div className="w-[300px] shrink-0">
        <h2 className="text-xl font-bold mb-4">Top rated anime</h2>
        {loadingTop ? (
          <div className="text-muted text-sm">Loading...</div>
        ) : (
          <div className="flex flex-col gap-3">
            {topRated.map(anime => (
              <Link to={`/anime/${anime.id}`} state={{ anime }} key={anime.id} className="flex gap-3 bg-[#1b1b1b] border border-white/5 p-2 rounded-lg hover:bg-white/5 transition-colors">
                {anime.coverImage ? (
                  <img src={anime.coverImage} className="w-14 h-20 object-cover rounded shadow-sm" alt="" />
                ) : (
                  <div className="w-14 h-20 bg-white/5 rounded" />
                )}
                <div className="flex-1 flex flex-col justify-center">
                  <div className="text-sm font-bold line-clamp-2 leading-tight mb-1">{anime.title}</div>
                  <div className="flex gap-2 items-center text-xs">
                    {anime.averageScore && <span className="text-green-400 font-bold">★ {(anime.averageScore / 10).toFixed(1)}</span>}
                    {anime.duration && <span className="text-muted">{anime.duration} min</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
