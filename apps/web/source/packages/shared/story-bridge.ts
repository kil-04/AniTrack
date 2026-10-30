/**
 * Picks what to read after an anime from its AniList print relations: the manga it
 * adapts, or for novel-based shows the novel and its manga version. Mirrors the
 * Android app's StoryBridge.
 *
 * AniList labels these edges loosely (a show's source manga is usually an
 * "ADAPTATION" edge, rarely "SOURCE"), so the anime's own source type decides what
 * the books are, and popularity picks the main series over one-shots and anthologies.
 */

/** A manga, one-shot or novel on AniList. */
export interface PrintMeta {
  id: number;
  title: string;
  coverImage: string | null;
  format: string | null;
  status: string | null;
  chapters: number | null;
  volumes: number | null;
  year: number | null;
  popularity: number | null;
  country: string | null;
}

export interface PrintRelation {
  relationType: string;
  book: PrintMeta;
}

export type StoryKind = "source-manga" | "source-novel" | "manga-version";

export interface StoryPlan {
  /** The anime's AniList source type (MANGA, LIGHT_NOVEL, ORIGINAL…). */
  source: string | null;
  kind: StoryKind | null;
  /** The headline book; null when nothing in print tells this story. */
  primary: PrintMeta | null;
  /** The comic to read: the primary book itself, or a novel's manga version. */
  readable: PrintMeta | null;
  /** Everything else in print, most popular first. */
  more: PrintRelation[];
}

const STORY_EDGES = new Set(["SOURCE", "ADAPTATION"]);
const COMICS = new Set(["MANGA", "ONE_SHOT"]);
const NOVEL_SOURCES = new Set(["LIGHT_NOVEL", "NOVEL", "WEB_NOVEL"]);
const COMIC_SOURCES = new Set(["MANGA", "COMIC", "DOUJINSHI"]);
const MORE_LIMIT = 15;

function best(links: PrintRelation[], formats: Set<string>): PrintMeta | null {
  let pick: PrintMeta | null = null;
  for (const { book } of links) {
    if (!book.format || !formats.has(book.format)) continue;
    if (!pick || (book.popularity ?? 0) > (pick.popularity ?? 0)) pick = book;
  }
  return pick;
}

/** The best match from the first pool that has one. */
function bestOf(formats: Set<string>, ...pools: PrintRelation[][]): PrintMeta | null {
  for (const pool of pools) {
    const pick = best(pool, formats);
    if (pick) return pick;
  }
  return null;
}

/**
 * `links` carry AniList's version-2 relation types where available, which mark the
 * material an anime adapts as SOURCE; version-1 data labels it ADAPTATION.
 */
export function planStory(source: string | null, links: PrintRelation[]): StoryPlan {
  const seen = new Set<number>();
  const usable = links.filter((link) => !seen.has(link.book.id) && seen.add(link.book.id));
  const sourced = usable.filter((link) => link.relationType === "SOURCE");
  const story = usable.filter((link) => STORY_EDGES.has(link.relationType));
  const retold = usable.filter((link) => link.relationType === "ALTERNATIVE");
  const manga = new Set(["MANGA"]);
  let kind: StoryKind | null = null;
  let primary: PrintMeta | null = null;
  let readable: PrintMeta | null = null;
  if (source && COMIC_SOURCES.has(source)) {
    primary = bestOf(COMICS, sourced, story, retold);
    if (primary) kind = "source-manga";
    readable = primary;
  } else if (source && NOVEL_SOURCES.has(source)) {
    const novel = bestOf(new Set(["NOVEL"]), sourced, story, retold);
    const comic = best([...story, ...retold], manga);
    if (novel) {
      primary = novel;
      kind = "source-novel";
    } else if (comic) {
      primary = comic;
      kind = "manga-version";
    }
    readable = comic;
  } else {
    primary = best([...story, ...retold], manga);
    if (primary) kind = "manga-version";
    readable = primary;
  }
  const shown = new Set([primary?.id, readable?.id].filter((id): id is number => id != null));
  const more = usable
    .filter((link) => !shown.has(link.book.id))
    .sort((a, b) => (b.book.popularity ?? 0) - (a.book.popularity ?? 0))
    .slice(0, MORE_LIMIT);
  return { source, kind, primary, readable, more };
}
