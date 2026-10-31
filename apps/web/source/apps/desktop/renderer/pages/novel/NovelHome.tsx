import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, BookText, ChevronLeft, ChevronRight, CloudOff, Flame, Info, RefreshCw, Shapes, Star, X } from "lucide-react";
import SectionHeader from "../../components/SectionHeader";
import {
  isChapterFinished,
  NOVEL_HOME_NOTICES,
  type NovelCard as Card,
  type NovelHome as Feed,
  type NovelReadingRow,
  type NovelUpdate,
} from "../../../../../packages/shared/novel";
import { NovelCover, NovelRow } from "../../components/novel/NovelCards";
import { novelApi, novelReaderPath, novelTitlePath, unwrap } from "../../lib/novel-api";
import { novelRemoved, onNovelSync, syncNovelReading } from "../../lib/novel-sync";
import { useSkin } from "../../lib/skin";
import { PixelInterlude } from "../../components/PixelScene";

const FEED_KEY = "anitrack.novel.feed.v2";
const FEED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const HERO_COUNT = 6;
const GENRES = ["Fantasy", "Action", "Romance", "Martial Arts", "Xianxia", "Sci-fi", "Mystery", "Comedy", "Drama", "Horror", "Slice of Life", "Historical"];

/** The last feed, so Home paints at once while a fresh one loads. */
function savedFeed(): Feed | null {
  try {
    const saved = JSON.parse(localStorage.getItem(FEED_KEY) ?? "null") as { at: number; feed: Feed } | null;
    // A stand-in feed (a source was down) isn't kept: its notice would outlive the outage.
    return saved && Date.now() - saved.at < FEED_MAX_AGE_MS && Array.isArray(saved.feed?.trending) && !saved.feed.notice ? saved.feed : null;
  } catch {
    return null;
  }
}

function saveFeed(feed: Feed) {
  if (feed.notice) return;
  try { localStorage.setItem(FEED_KEY, JSON.stringify({ at: Date.now(), feed })); } catch { /* storage full or unavailable */ }
}

export default function NovelHome() {
  const pixel = useSkin() === "pixel";
  const [feed, setFeed] = useState<Feed | null>(savedFeed);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [reading, setReading] = useState<NovelReadingRow[]>([]);
  const [updates, setUpdates] = useState<NovelUpdate[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setFailed(null);
    unwrap(novelApi().home())
      .then((value) => { saveFeed(value); if (alive) setFeed(value); })
      // The feed already on screen stays, marked as saved earlier.
      .catch((error: Error) => { if (alive) setFailed(error.message); });
    return () => { alive = false; };
  }, [attempt]);

  useEffect(() => {
    let alive = true;
    const loadReading = () => {
      novelApi().continueReading().then((rows) => { if (alive) setReading(rows); }).catch(() => {});
      // New chapters are checked in the background (slow lane, cached for a while).
      novelApi().updates().then((r) => { if (alive && r.ok) setUpdates(r.value); }).catch(() => {});
    };
    loadReading();
    // Continue Reading follows other devices: reconcile now and whenever the window
    // regains focus, and repaint when that changed anything.
    const stopSync = onNovelSync(loadReading);
    const reconcile = () => { void syncNovelReading().catch(() => {}); };
    reconcile();
    window.addEventListener("focus", loadReading);
    window.addEventListener("focus", reconcile);
    // Warm the title page and reader so the first open doesn't wait for their code.
    const warm = () => { void import("./NovelDetail"); void import("./NovelReader"); };
    const idle = window.requestIdleCallback?.(warm, { timeout: 3000 });
    const timer = idle == null ? window.setTimeout(warm, 1500) : null;
    return () => {
      alive = false;
      window.removeEventListener("focus", loadReading);
      window.removeEventListener("focus", reconcile);
      stopSync();
      if (idle != null) window.cancelIdleCallback?.(idle);
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  const newFor = (row: NovelReadingRow) => updates.find((u) => u.sourceId === row.sourceId && u.titleId === row.titleId)?.newCount ?? 0;
  const heroes = (feed?.trending ?? []).slice(0, HERO_COUNT);
  const notice = feed?.notice ?? (failed && feed ? NOVEL_HOME_NOTICES.saved : null);

  return (
    <div className="pb-16">
      {heroes.length ? (
        <HeroCarousel items={heroes} reading={reading} />
      ) : (
        <div className={`mx-8 mb-12 mt-6 h-[min(52vh,500px)] min-h-[380px] rounded-[28px] ${failed ? "panel" : "skeleton"}`}>
          {failed && (
            <div className="px-10 pt-24">
              <p className="flex items-center gap-2 text-base font-bold text-white"><CloudOff size={18} className="text-amber-300" /> Novel sources unavailable</p>
              <p className="mt-2 max-w-[640px] text-sm text-ink-3">{failed} NovelBuddy and NovelArchive both failed to answer. Continue Reading and your lists still work.</p>
              <button onClick={() => setAttempt((n) => n + 1)} className="btn btn-secondary mt-5"><RefreshCw size={16} /> Try again</button>
            </div>
          )}
        </div>
      )}

      {notice && (
        <div className="mx-8 -mt-6 mb-10 flex items-center gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-sm text-amber-100">
          <CloudOff size={17} className="shrink-0 text-amber-300" />
          <span className="flex-1">{notice}</span>
        </div>
      )}

      {reading.length > 0 && (
        <section className="mb-12">
          <SectionHeader icon={BookText} title="Continue Reading" to="/novels/list" className="px-8" />
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-8 pb-4 pt-2">
            {reading.map((row) => {
              const done = isChapterFinished(row);
              const fresh = newFor(row);
              const pct = row.paragraphCount ? Math.round(((row.paragraph + 1) / row.paragraphCount) * 100) : 0;
              return (
                <div key={`${row.sourceId}:${row.titleId}`} className="group relative w-40 flex-shrink-0">
                  <Link to={done ? novelTitlePath(row.sourceId, row.titleId) : novelReaderPath(row.sourceId, row.titleId, row.chapterId, row.paragraph)} className="block">
                    <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-surface-1 shadow-card ring-1 ring-white/[0.06] transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-glow-lg group-hover:ring-2 group-hover:ring-accent/70">
                      <NovelCover cover={row.cover} title={row.title} />
                      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 to-transparent" />
                      {fresh > 0 && (
                        <span className="badge absolute left-2 top-2 border border-emerald-300/30 bg-emerald-500/85 text-white shadow-[0_0_16px_rgb(16_185_129/0.45)]">
                          +{fresh.toLocaleString()} new
                        </span>
                      )}
                      <span className="badge badge-accent absolute bottom-3 left-2 max-w-[calc(100%-1rem)] truncate normal-case tracking-normal">
                        {done ? `${row.chapterLabel} read` : `${row.chapterLabel} · ${pct}%`}
                      </span>
                      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                        <div className="h-full rounded-r-full bg-accent-gradient" style={{ width: `${done ? 100 : pct}%` }} />
                      </div>
                    </div>
                    <div className="mt-2.5 line-clamp-2 text-sm font-semibold leading-tight text-white/90 transition-colors group-hover:text-white">{row.title}</div>
                  </Link>
                  <button
                    onClick={() => {
                      void novelApi().forgetReading(row.sourceId, row.titleId).then(() => {
                        novelRemoved();
                        setReading((rows) => rows.filter((r) => !(r.sourceId === row.sourceId && r.titleId === row.titleId)));
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

      {pixel && <PixelInterlude scene="moon-bench" title="Your reading list" subtitle="The novels you follow, chapter by chapter" to="/novels/list" />}
      <section className="mb-10 px-8">
        <SectionHeader icon={Shapes} title="Browse by genre" to="/novels/search" />
        <div className="flex flex-wrap gap-2 pt-1">
          {GENRES.map((genre) => (
            <button
              key={genre}
              onClick={() => navigate(`/novels/search?genre=${encodeURIComponent(genre)}`)}
              className="rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-2 text-sm font-semibold text-ink-2 transition hover:border-accent/40 hover:bg-accent/15 hover:text-white"
            >
              {genre}
            </button>
          ))}
        </div>
      </section>

      {feed && (
        <>
          <NovelRow title="Trending now" items={feed.trending.slice(HERO_COUNT)} />
          <NovelRow title="Recently updated" items={feed.latest} />
          <NovelRow title="Fan favourites" items={feed.favourites ?? []} />
          <NovelRow title="Most read" items={feed.popular} />
          <NovelRow title="Finished series" items={feed.completed} />
        </>
      )}
    </div>
  );
}

/** The top of Home: the most-read novels right now, one at a time, with their blurbs. */
function HeroCarousel({ items, reading }: { items: Card[]; reading: NovelReadingRow[] }) {
  const [index, setIndex] = useState(0);
  const paused = useRef(false);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!paused.current) setIndex((i) => (i + 1) % items.length); }, 8000);
    return () => window.clearInterval(timer);
  }, [items.length]);
  const hero = items[Math.min(index, items.length - 1)];
  const inProgress = reading.find((r) => r.sourceId === hero.sourceId && r.titleId === hero.id);
  const step = (d: number) => setIndex((i) => (i + d + items.length) % items.length);

  return (
    <section
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; }}
      className="group/hero relative mx-8 mb-12 mt-6 h-[min(54vh,520px)] min-h-[400px] overflow-hidden rounded-[28px] bg-surface-1 shadow-pop ring-1 ring-white/[0.07]"
    >
      {items.map((item, i) => (
        item.cover ? (
          <img
            key={item.id}
            src={item.cover}
            alt=""
            referrerPolicy="no-referrer"
            className={`absolute inset-0 h-full w-full scale-125 object-cover blur-3xl transition-opacity duration-700 ${i === index ? "opacity-45" : "opacity-0"}`}
          />
        ) : null
      ))}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(var(--bg))_0%,rgb(var(--bg)/0.86)_42%,rgb(var(--bg)/0.35)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(70%_65%_at_0%_100%,rgb(var(--accent)/0.28),transparent_70%)]" />

      <div className="relative flex h-full items-center gap-12 px-10 py-10 xl:px-14">
        <div key={hero.id} className="min-w-0 max-w-[660px] flex-1 animate-fade-in">
          <div className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-accent/30 bg-accent/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-accent backdrop-blur-md">
            <Flame size={13} strokeWidth={2.4} /> #{index + 1} trending novel
          </div>
          <h1 className="mb-4 line-clamp-2 text-[38px] font-extrabold leading-[1.06] tracking-tight text-white drop-shadow-[0_4px_24px_rgb(0_0_0/0.6)] xl:text-[48px]">{hero.title}</h1>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {hero.rating != null && (
              <span className="chip border-amber-300/25 bg-amber-300/10 text-amber-200">
                <Star size={12} fill="currentColor" /> {hero.rating.toFixed(1)}
              </span>
            )}
            {[hero.status === "completed" ? "Complete" : hero.status === "ongoing" ? "Ongoing" : null, hero.chapters ? `${hero.chapters.toLocaleString()} chapters` : null, ...hero.genres.slice(0, 3)]
              .filter(Boolean)
              .map((label) => <span key={String(label)} className="chip">{label}</span>)}
          </div>
          {hero.synopsis && <p className="mb-7 line-clamp-3 max-w-[600px] text-[15px] leading-relaxed text-white/70">{hero.synopsis}</p>}
          <div className="flex gap-3">
            {inProgress ? (
              <Link to={novelReaderPath(inProgress.sourceId, inProgress.titleId, inProgress.chapterId, inProgress.paragraph)} className="btn btn-primary btn-lg">
                <BookOpen size={18} /> Continue · {inProgress.chapterLabel}
              </Link>
            ) : (
              <Link to={novelTitlePath(hero.sourceId, hero.id)} className="btn btn-primary btn-lg">
                <BookOpen size={18} /> Start reading
              </Link>
            )}
            <Link to={novelTitlePath(hero.sourceId, hero.id)} className="btn btn-secondary btn-lg">
              <Info size={18} /> Details
            </Link>
          </div>
        </div>
        <Link
          to={novelTitlePath(hero.sourceId, hero.id)}
          className="relative hidden aspect-[2/3] w-[230px] shrink-0 rotate-[2deg] overflow-hidden rounded-2xl shadow-[0_30px_80px_-20px_rgb(0_0_0/0.9)] ring-1 ring-white/15 transition duration-500 hover:rotate-0 hover:scale-[1.02] lg:ml-auto lg:mr-6 lg:block"
        >
          <NovelCover cover={hero.cover} title={hero.title} />
        </Link>
      </div>

      <div className="absolute bottom-6 right-8 flex items-center gap-3">
        <button onClick={() => step(-1)} className="grid h-9 w-9 place-items-center rounded-full glass opacity-0 transition group-hover/hero:opacity-100" aria-label="Previous">
          <ChevronLeft size={18} />
        </button>
        <div className="flex gap-1.5">
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={() => setIndex(i)}
              aria-label={`Show ${item.title}`}
              className={`h-1.5 rounded-full transition-all ${i === index ? "w-7 bg-accent" : "w-1.5 bg-white/30 hover:bg-white/60"}`}
            />
          ))}
        </div>
        <button onClick={() => step(1)} className="grid h-9 w-9 place-items-center rounded-full glass opacity-0 transition group-hover/hero:opacity-100" aria-label="Next">
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}
