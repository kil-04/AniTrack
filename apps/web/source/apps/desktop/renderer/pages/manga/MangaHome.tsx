import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Flame, Library, Star, X } from "lucide-react";
import SectionHeader from "../../components/SectionHeader";
import { chapterLabel, isFinished, mangaKind, publishLabel, type MangaFeed, type ReadingRow } from "../../../../../packages/shared/manga";
import { MangaRow } from "../../components/manga/MangaCards";
import { mangaApi } from "../../lib/manga-api";
import { forgetMangaReading, onMangaSync, syncMangaReading } from "../../lib/manga-sync";
import { useSkin } from "../../lib/skin";
import { PixelInterlude } from "../../components/PixelScene";

const FEED_KEY = "anitrack.manga.feed.v1";
const FEED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The last feed, so Home paints at once (like the anime Home's snapshot) while a fresh one loads. */
function savedFeed(): MangaFeed | null {
  try {
    const saved = JSON.parse(localStorage.getItem(FEED_KEY) ?? "null") as { at: number; feed: MangaFeed } | null;
    return saved && Date.now() - saved.at < FEED_MAX_AGE_MS && Array.isArray(saved.feed?.trending) ? saved.feed : null;
  } catch {
    return null;
  }
}

function saveFeed(feed: MangaFeed) {
  try { localStorage.setItem(FEED_KEY, JSON.stringify({ at: Date.now(), feed })); } catch { /* storage full or unavailable */ }
}

export default function MangaHome() {
  const pixel = useSkin() === "pixel";
  const [feed, setFeed] = useState<MangaFeed | null>(savedFeed);
  const [failed, setFailed] = useState(false);
  const [reading, setReading] = useState<ReadingRow[]>([]);

  useEffect(() => {
    let alive = true;
    mangaApi().feed()
      .then((value) => { saveFeed(value); if (alive) setFeed(value); })
      .catch(() => { if (alive) setFailed(true); });
    const loadReading = () => { mangaApi().continueReading().then((rows) => { if (alive) setReading(rows); }).catch(() => {}); };
    loadReading();
    // Continue Reading follows other devices: reconcile now and whenever the window
    // regains focus, and repaint when that changed anything.
    const stopSync = onMangaSync(loadReading);
    const reconcile = () => { void syncMangaReading().catch(() => {}); };
    reconcile();
    window.addEventListener("focus", reconcile);
    // Warm the title page and reader so the first open doesn't wait for their code.
    const warm = () => { void import("./MangaDetail"); void import("./MangaReader"); };
    const idle = window.requestIdleCallback?.(warm, { timeout: 3000 });
    const timer = idle == null ? window.setTimeout(warm, 1500) : null;
    return () => {
      alive = false;
      stopSync();
      window.removeEventListener("focus", reconcile);
      if (idle != null) window.cancelIdleCallback?.(idle);
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  const hero = feed?.trending.find((m) => m.banner) ?? feed?.trending[0];

  return (
    <div className="pb-16">
      {hero ? (
        <section className="relative mx-8 mb-12 mt-6 h-[min(56vh,540px)] min-h-[400px] overflow-hidden rounded-[28px] bg-surface-1 shadow-pop ring-1 ring-white/[0.07]">
          {hero.banner || hero.cover ? (
            <img src={hero.banner ?? hero.cover!} alt="" className="absolute inset-0 h-full w-full scale-[1.04] object-cover object-center" />
          ) : null}
          <div className="absolute inset-0 bg-scrim-l" />
          <div className="absolute inset-0 bg-scrim-b" />
          <div className="absolute inset-0 bg-[radial-gradient(70%_65%_at_0%_100%,rgb(var(--accent)/0.24),transparent_70%)]" />
          <div className="relative flex h-full max-w-[700px] flex-col justify-end p-10 pb-12 xl:p-14">
            <div className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/30 bg-accent/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-accent backdrop-blur-md">
              <Flame size={13} strokeWidth={2.4} /> #1 trending in manga
            </div>
            <h1 className="mb-4 line-clamp-2 text-[40px] font-extrabold leading-[1.04] tracking-tight text-white drop-shadow-[0_4px_24px_rgb(0_0_0/0.6)] xl:text-[52px]">{hero.title}</h1>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {hero.score != null && (
                <span className="chip border-amber-300/25 bg-amber-300/10 text-amber-200">
                  <Star size={12} fill="currentColor" /> {(hero.score / 10).toFixed(1)}
                </span>
              )}
              {[mangaKind(hero), hero.year, publishLabel(hero.status), hero.chapters ? `${hero.chapters} chapters` : null]
                .filter(Boolean)
                .map((label) => <span key={String(label)} className="chip">{label}</span>)}
            </div>
            {hero.synopsis && <p className="mb-7 line-clamp-3 max-w-[600px] text-[15px] leading-relaxed text-white/70">{hero.synopsis}</p>}
            <div className="flex gap-3">
              <Link to={`/manga/${hero.id}`} className="btn btn-primary btn-lg">
                <BookOpen size={18} /> Read now
              </Link>
              <Link to="/manga/list" className="btn btn-secondary btn-lg">
                <Library size={18} /> My list
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <div className={`mx-8 mb-12 mt-6 h-[min(56vh,540px)] min-h-[400px] rounded-[28px] ${failed ? "panel" : "skeleton"}`}>
          {failed && <p className="px-10 pt-24 text-sm text-ink-3">AniList didn't answer. Check your connection, then reopen this page.</p>}
        </div>
      )}

      {reading.length > 0 && (
        <section className="mb-12">
          <SectionHeader icon={BookOpen} title="Continue Reading" to="/manga/list" className="px-8" />
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-8 pb-4 pt-2">
            {reading.map((row) => {
              const done = isFinished(row);
              return (
                <div key={row.mangaId} className="group relative w-40 flex-shrink-0">
                  <Link to={`/manga/${row.mangaId}`} className="block">
                    <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-surface-1 shadow-card ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-glow-lg group-hover:ring-2 group-hover:ring-accent/70">
                      {row.cover && <img src={row.cover} alt="" className="h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.07]" />}
                      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 to-transparent" />
                      <span className="badge badge-accent absolute bottom-3 left-2 normal-case tracking-normal">
                        {done ? `Ch ${chapterLabel(row.chapter)} read` : `Ch ${chapterLabel(row.chapter)} · p${row.page + 1}/${row.pageCount}`}
                      </span>
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                        <div className="h-full rounded-r-full bg-accent-gradient" style={{ width: `${Math.round(((row.page + 1) / Math.max(1, row.pageCount)) * 100)}%` }} />
                      </div>
                    </div>
                    <div className="mt-2.5 line-clamp-2 text-sm font-semibold leading-tight text-white/90 transition-colors group-hover:text-white">{row.title}</div>
                  </Link>
                  <button
                    onClick={() => {
                      void mangaApi().forgetReading(row.mangaId).then(() => {
                        forgetMangaReading(row.mangaId);
                        setReading((rows) => rows.filter((r) => r.mangaId !== row.mangaId));
                      });
                    }}
                    className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white/80 backdrop-blur-md transition hover:scale-110 hover:bg-red-500 hover:text-white group-hover:flex"
                    title="Remove from Continue Reading"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {feed && (
        <>
          <MangaRow title="Trending now" items={feed.trending} />
          <MangaRow title="Publishing now" items={feed.publishing} />
          {pixel && <PixelInterlude scene="manga-street" title="Your shelf" subtitle="Every manga you follow, in one place" to="/manga/list" />}
          <MangaRow title="All-time popular" items={feed.popular} />
          <MangaRow title="Top rated" items={feed.topRated} />
          <MangaRow title="Trending manhwa" items={feed.manhwa} />
        </>
      )}
    </div>
  );
}
