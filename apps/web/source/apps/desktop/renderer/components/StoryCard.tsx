import { Link } from "react-router-dom";
import { BookOpen, ExternalLink } from "lucide-react";
import { hasMangaMode } from "../lib/manga-api";
import type { PrintMeta, PrintRelation, StoryPlan } from "../../../../packages/shared/story-bridge";

const RELATION_LABELS: Record<string, string> = {
  SOURCE: "Source", ADAPTATION: "Adaptation", ALTERNATIVE: "Retelling", SPIN_OFF: "Spin-off",
  SIDE_STORY: "Side story", CHARACTER: "Character", SUMMARY: "Summary", PARENT: "Parent",
  PREQUEL: "Prequel", SEQUEL: "Sequel", COMPILATION: "Compilation", CONTAINS: "Contains", OTHER: "Other",
};

function kindLabel(book: PrintMeta): string | null {
  if (book.format === "MANGA") return book.country === "KR" ? "Manhwa" : book.country === "CN" ? "Manhua" : "Manga";
  if (book.format === "ONE_SHOT") return "One-shot";
  if (book.format === "NOVEL") return "Novel";
  return book.format;
}

function publishLabel(status: string | null): string | null {
  switch (status) {
    case "RELEASING": return "Publishing";
    case "FINISHED": return "Complete";
    case "HIATUS": return "On hiatus";
    case "NOT_YET_RELEASED": return "Not yet published";
    case "CANCELLED": return "Cancelled";
    default: return null;
  }
}

function sourceNoun(source: string | null): string {
  if (source === "LIGHT_NOVEL") return "light novel";
  if (source === "WEB_NOVEL") return "web novel";
  return "novel";
}

const anilistUrl = (book: PrintMeta) => `https://anilist.co/manga/${book.id}`;

function metaLine(book: PrintMeta): string {
  const length = book.chapters ? `${book.chapters} ch` : book.volumes ? `${book.volumes} vol` : null;
  return [kindLabel(book), book.year?.toString(), publishLabel(book.status), length].filter(Boolean).join(" · ");
}

/** The manga (or novel) this anime comes from, like the Android app's card. */
export function StoryCard({ plan, finishedAnime }: { plan: StoryPlan; finishedAnime: boolean }) {
  const book = plan.primary;
  if (!book || !plan.kind) return null;
  const readable = plan.readable;
  const eyebrow = plan.kind === "source-manga"
    ? finishedAnime ? "You finished the anime" : "Continue the story"
    : plan.kind === "source-novel" ? `Based on the ${sourceNoun(plan.source)}` : "Also a manga";
  const message = plan.kind === "source-manga"
    ? finishedAnime
      ? "The story comes from this manga. Keep going in print."
      : book.status === "RELEASING"
        ? "The anime adapts this manga, which is still being published."
        : `The anime adapts this manga${book.chapters ? `, complete in ${book.chapters} chapters` : ""}.`
    : plan.kind === "source-novel"
      ? readable ? `Read it as a manga: ${readable.title}.` : "There's no manga version to read yet."
      : `The story retold as a manga${book.chapters ? ` in ${book.chapters} chapters` : ""}.`;
  return (
    <section className="mt-8 px-8">
      <div className="flex max-w-3xl items-center gap-5 rounded-2xl border border-amber-200/20 bg-gradient-to-r from-amber-200/10 to-white/[0.03] p-4">
        {book.coverImage ? (
          <img src={book.coverImage} alt="" className="h-36 w-24 flex-shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="h-36 w-24 flex-shrink-0 rounded-lg bg-white/5" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200">
            <BookOpen size={13} /> {eyebrow}
          </div>
          <h3 className="mt-1 line-clamp-2 text-lg font-bold leading-tight">{book.title}</h3>
          <div className="mt-0.5 text-xs text-white/45">{metaLine(book)}</div>
          <p className="mt-2 text-sm text-white/65">{message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {hasMangaMode() && readable && (
              <Link
                to={`/manga/${readable.id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black transition hover:bg-white/85"
              >
                <BookOpen size={13} /> Read the manga
              </Link>
            )}
            <a
              href={anilistUrl(book)}
              target="_blank"
              rel="noreferrer"
              className={hasMangaMode() && readable
                ? "inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
                : "inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black transition hover:bg-white/85"}
            >
              <ExternalLink size={13} /> View on AniList
            </a>
            {!hasMangaMode() && readable && readable.id !== book.id && (
              <a
                href={anilistUrl(readable)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
              >
                <BookOpen size={13} /> The manga version
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Other manga and novels from the franchise: spin-offs, side stories, retellings. */
export function MoreInPrint({ more }: { more: PrintRelation[] }) {
  if (!more.length) return null;
  return (
    <div className="mt-8 px-8">
      <h2 className="mb-3 text-lg font-semibold">More in print</h2>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {more.map(({ relationType, book }) => (
          <a
            key={book.id}
            href={hasMangaMode() ? `#/manga/${book.id}` : anilistUrl(book)}
            target={hasMangaMode() ? undefined : "_blank"}
            rel="noreferrer"
            title={`${book.title} — ${metaLine(book)}`}
            className="group w-28 flex-shrink-0 text-left"
          >
            <div className="relative overflow-hidden rounded-lg">
              {book.coverImage ? (
                <img src={book.coverImage} alt={book.title} className="h-40 w-28 object-cover transition group-hover:scale-105" />
              ) : (
                <div className="h-40 w-28 rounded-lg bg-white/5" />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1 text-[10px] text-white/70">
                {RELATION_LABELS[relationType] ?? relationType.toLowerCase().replace(/_/g, " ")}
              </div>
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-tight text-white/70 transition group-hover:text-white">{book.title}</p>
            <p className="text-[10px] text-white/35">{[kindLabel(book), book.year].filter(Boolean).join(" · ")}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
