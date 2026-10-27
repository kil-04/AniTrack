import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import Card from '../components/Card';
import type { AnimeMeta, AdvancedSearchFilters } from '../../../../packages/shared/types';
import { Search, SlidersHorizontal, ChevronDown, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X, Star, Trophy, LayoutGrid, SearchX, TriangleAlert, RotateCcw } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SectionHeader from '../components/SectionHeader';
import SelectField from '../components/SelectField';
import EmptyState from '../components/EmptyState';
import { animeStatusLabel } from '../lib/format';

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
        className={`input flex min-w-[150px] items-center justify-between gap-2 text-left ${selected.length ? 'border-accent/45 bg-accent/[0.08] text-white' : 'text-ink-2'}`}
      >
        <span className="max-w-[140px] truncate">
          {selected.length === 0 ? `Any ${label}` : selected.length === 1 ? selected[0] : `${selected.length} ${label}s`}
        </span>
        <ChevronDown size={15} className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="glass absolute left-0 top-full z-50 mt-2 w-[620px] rounded-2xl p-3 shadow-pop">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="eyebrow">Genres &amp; tags</span>
            {selected.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="text-xs font-semibold text-ink-3 transition hover:text-white">
                Clear
              </button>
            )}
          </div>
          <div className="thin-scrollbar grid max-h-[380px] grid-cols-4 gap-1 overflow-y-auto">
            {options.map(opt => {
              const on = selected.includes(opt);
              return (
                <button
                  type="button"
                  key={opt}
                  onClick={() => toggle(opt)}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${on ? 'bg-accent/15 text-white' : 'text-ink-2 hover:bg-white/[0.06] hover:text-white'}`}
                >
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition ${on ? 'border-transparent bg-accent-gradient text-white' : 'border-white/20'}`}>
                    {on && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="truncate">{opt}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const FORMAT_LABELS: Record<string, string> = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special', MUSIC: 'Music' };
const capitalize = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

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

  const resultsRef = useRef<HTMLDivElement>(null);
  const goTo = (n: number) => {
    setPage(n);
    fetchResults(n);
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // The filters in the URL, as removable chips.
  const applied: { key: string; value?: string; label: string }[] = [];
  const appliedQuery = params.get('q');
  if (appliedQuery) applied.push({ key: 'q', label: `"${appliedQuery}"` });
  (params.get('genre') ?? '').split(',').filter(Boolean).forEach(g => applied.push({ key: 'genre', value: g, label: g }));
  const appliedSeason = params.get('season');
  if (appliedSeason) applied.push({ key: 'season', label: capitalize(appliedSeason) });
  const appliedYear = params.get('year');
  if (appliedYear) applied.push({ key: 'year', label: appliedYear });
  const appliedType = params.get('type');
  if (appliedType) applied.push({ key: 'type', label: FORMAT_LABELS[appliedType] ?? appliedType });
  const appliedStatus = params.get('status');
  if (appliedStatus) applied.push({ key: 'status', label: animeStatusLabel(appliedStatus) });
  const appliedSource = params.get('source');
  if (appliedSource) applied.push({ key: 'source', label: SOURCES.find(x => x.id === appliedSource)?.label ?? appliedSource });
  const appliedEpisodes = params.get('episodes');
  if (appliedEpisodes) applied.push({ key: 'episodes', label: `${EPISODE_RANGES.find(x => x.id === appliedEpisodes)?.label ?? appliedEpisodes} eps` });
  const appliedSort = SORTS.find(x => x.id === params.get('sort'))?.label;

  const removeApplied = (key: string, value?: string) => {
    const p = new URLSearchParams(params);
    if (key === 'genre' && value) {
      const rest = (p.get('genre') ?? '').split(',').filter(g => g && g !== value);
      if (rest.length) p.set('genre', rest.join(','));
      else p.delete('genre');
    } else {
      p.delete(key);
    }
    setParams(p);
  };

  const pageButton = 'flex h-9 w-9 items-center justify-center rounded-xl text-ink-3 transition hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-30';

  return (
    <div className="mx-auto flex max-w-[1680px] gap-8 px-8 py-8">
      <div className="min-w-0 flex-1">
        <PageHeader scene="observatory" icon={Search} title="Search" subtitle="Find any anime by name, genre, season, format and more" />

        <form onSubmit={handleFilter} className="panel relative z-20 mb-10 p-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search titles…"
                className="input h-12 rounded-2xl pl-11 text-[15px]"
              />
            </div>
            <button type="submit" className="btn btn-primary h-12 rounded-2xl px-6">
              <SlidersHorizontal size={17} /> Apply
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2.5">
            <MultiSelectDropdown label="genre" options={COMBINED_GENRES} selected={genre} onChange={setGenre} />
            <SelectField value={season} onChange={setSeason} className="w-[150px]">
              <option value="">Any season</option>
              {SEASONS.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
            </SelectField>
            <SelectField value={year} onChange={setYear} className="w-[130px]">
              <option value="">Any year</option>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </SelectField>
            <SelectField value={type} onChange={setType} className="w-[150px]">
              <option value="">Any format</option>
              {TYPES.map(t => <option key={t} value={t}>{FORMAT_LABELS[t] ?? t}</option>)}
            </SelectField>
            <SelectField value={status} onChange={setStatus} className="w-[150px]">
              <option value="">Any status</option>
              {STATUSES.map(s => <option key={s} value={s}>{animeStatusLabel(s)}</option>)}
            </SelectField>
            <SelectField value={source} onChange={setSource} className="w-[170px]">
              <option value="">Any source</option>
              {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </SelectField>
            <SelectField value={episodeRange} onChange={setEpisodeRange} className="w-[150px]">
              <option value="">Any length</option>
              {EPISODE_RANGES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </SelectField>
            <SelectField value={sort} onChange={setSort} className="w-[190px]">
              <option value="">Default sort</option>
              {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </SelectField>
          </div>

          {applied.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
              <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.16em] text-ink-3">Active</span>
              {applied.map(a => (
                <button
                  type="button"
                  key={`${a.key}:${a.value ?? ''}`}
                  onClick={() => removeApplied(a.key, a.value)}
                  className="chip chip-active group"
                  title="Remove this filter"
                >
                  {a.label}
                  <X size={12} className="text-white/60 transition group-hover:text-white" />
                </button>
              ))}
              <button type="button" onClick={() => setParams(new URLSearchParams())} className="btn btn-ghost btn-sm ml-1">
                Clear all
              </button>
            </div>
          )}
        </form>

        <div ref={resultsRef} className="scroll-mt-6">
          <SectionHeader
            icon={LayoutGrid}
            title={appliedQuery ? `Results for "${appliedQuery}"` : 'Results'}
            subtitle={`${appliedSort ? `Sorted by ${appliedSort} · ` : ''}Page ${page}`}
          />
        </div>

        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
            {Array.from({ length: 18 }, (_, i) => (
              <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={TriangleAlert}
            tone="danger"
            title="Search failed"
            action={
              <button onClick={() => fetchResults(page)} className="btn btn-primary">
                <RotateCcw size={16} /> Retry
              </button>
            }
          >
            {error}
          </EmptyState>
        ) : results.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Nothing matches"
            action={applied.length > 0 && (
              <button onClick={() => setParams(new URLSearchParams())} className="btn btn-secondary">
                Clear filters
              </button>
            )}
          >
            Try fewer filters or a different spelling.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
            {results.map(anime => (
              <Card key={anime.id} anime={anime} />
            ))}
          </div>
        )}

        {(page > 1 || hasNextPage) && !error && (
          <div className="mb-6 mt-10 flex items-center justify-center gap-1.5">
            <button onClick={() => goTo(1)} disabled={page === 1 || loading} className={pageButton} title="First page">
              <ChevronsLeft size={15} />
            </button>
            <button onClick={() => goTo(page - 1)} disabled={page === 1 || loading} className={pageButton} title="Previous page">
              <ChevronLeft size={15} />
            </button>
            <span className="flex h-9 min-w-[5.5rem] items-center justify-center rounded-xl bg-accent-gradient px-3 text-xs font-semibold text-white shadow-glow">
              Page {page}
            </span>
            <button onClick={() => goTo(page + 1)} disabled={!hasNextPage || loading} className={pageButton} title="Next page">
              <ChevronRight size={15} />
            </button>
            {lastPage < 138 && (
              <button
                onClick={() => goTo(effectiveLastPage)}
                disabled={page === effectiveLastPage || !hasNextPage || loading}
                className={pageButton}
                title="Last page"
              >
                <ChevronsRight size={15} />
              </button>
            )}
          </div>
        )}
      </div>

      <aside className="hidden w-[300px] shrink-0 xl:block">
        <div className="panel sticky top-6 p-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="icon-tile h-8 w-8 rounded-lg">
              <Trophy size={16} strokeWidth={2.2} />
            </span>
            <h2 className="text-lg font-bold tracking-tight">Top rated</h2>
          </div>
          {loadingTop ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="skeleton h-[68px] rounded-xl" />
              ))}
            </div>
          ) : topRated.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-3">Couldn't load rankings.</div>
          ) : (
            <div className="flex flex-col">
              {topRated.map((anime, i) => (
                <Link
                  to={`/anime/${anime.id}`}
                  state={{ anime }}
                  key={anime.id}
                  className="group flex items-center gap-3 rounded-xl px-1.5 py-2 transition-colors hover:bg-white/[0.04]"
                >
                  <span className={`w-6 shrink-0 text-center text-lg font-black tabular-nums ${i < 3 ? 'bg-accent-gradient bg-clip-text text-transparent' : 'text-white/20'}`}>
                    {i + 1}
                  </span>
                  {anime.coverImage ? (
                    <img src={anime.coverImage} loading="lazy" className="h-16 w-11 shrink-0 rounded-lg object-cover shadow-md ring-1 ring-white/10 transition group-hover:ring-accent/50" alt="" />
                  ) : (
                    <div className="h-16 w-11 shrink-0 rounded-lg bg-white/5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-semibold leading-tight text-white/90 group-hover:text-white">{anime.title}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] font-semibold">
                      {anime.averageScore != null && (
                        <span className="flex items-center gap-0.5 text-amber-300">
                          <Star size={10} fill="currentColor" /> {(anime.averageScore / 10).toFixed(1)}
                        </span>
                      )}
                      <span className="truncate text-ink-3">
                        {[anime.format ? FORMAT_LABELS[anime.format] ?? anime.format : null, anime.year].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
