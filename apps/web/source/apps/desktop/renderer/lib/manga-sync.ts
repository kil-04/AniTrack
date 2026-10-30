/**
 * Cross-device manga reading sync (Continue Reading and read marks), in its own
 * file of the Continue Watching gist. Merge rules: packages/shared/manga-sync.ts;
 * Android runs the same rules in MangaSyncMerge.kt.
 *
 * The local reading table is each device's source of truth: every reconcile reads
 * it whole, merges it with the gist file and writes back both ways, so a missed
 * or failed upload is simply repeated by the next reconcile.
 */
import {
  MANGA_SYNC_FILE,
  parseMangaSyncDoc,
  planMangaSync,
  readingKey,
  serializeMangaSyncDoc,
} from "../../../../packages/shared/manga-sync";
import { ghHeaders, readGistFile, syncGist } from "./supabase-sync";
import { hasMangaMode, mangaApi } from "./manga-api";

const GH = "https://api.github.com";
const PENDING_KEY = "manga_sync_pending";
const DEBOUNCE_MS = 7_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<number> | null = null;
let again = false;
const listeners = new Set<() => void>();

/** Removals made here that the gist may not have yet: key → when. */
function pending(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function savePending(value: Record<string, number>) {
  try {
    if (Object.keys(value).length) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage unavailable: the next removal retries */ }
}

function addPending(keys: string[]) {
  const value = pending();
  const now = Date.now();
  for (const key of keys) value[key] = now;
  savePending(value);
}

async function reconcile(): Promise<number> {
  if (!hasMangaMode()) return 0;
  const gist = await syncGist();
  if (!gist) return 0;
  const remote = parseMangaSyncDoc(await readGistFile(gist.token, gist.gistId, MANGA_SYNC_FILE));
  const sent = pending();
  const local = await mangaApi().readingAll();
  const plan = planMangaSync(local, remote, sent, Date.now());
  let changed = 0;
  if (plan.upsert.length || plan.remove.length) {
    const result = await mangaApi().applyReading(plan.upsert, plan.remove);
    changed = result.applied + result.removed;
  }
  if (plan.changed) {
    const res = await fetch(`${GH}/gists/${gist.gistId}`, {
      method: "PATCH",
      headers: ghHeaders(gist.token),
      body: JSON.stringify({ files: { [MANGA_SYNC_FILE]: { content: serializeMangaSyncDoc(plan.doc) } } }),
    });
    if (!res.ok) throw new Error(`GitHub rejected the manga sync update (${res.status}).`);
  }
  // Only removals this upload carried are done; one made meanwhile stays pending.
  const left = pending();
  for (const [key, ts] of Object.entries(sent)) if (left[key] === ts) delete left[key];
  savePending(left);
  if (changed) for (const listener of listeners) listener();
  return changed;
}

/**
 * Two-way reconcile now. Resolves to how many local rows changed. Concurrent calls
 * share one run; a request during a run starts one more afterwards.
 */
export function syncMangaReading(): Promise<number> {
  if (running) { again = true; return running; }
  running = reconcile().finally(() => {
    running = null;
    if (again) { again = false; scheduleMangaSync(0); }
  });
  return running;
}

function scheduleMangaSync(delay = DEBOUNCE_MS) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncMangaReading().catch(() => {}); }, delay);
}

/** Reading progress or read marks changed here: upload them shortly (batched). */
export function mangaReadingChanged(): void {
  scheduleMangaSync();
}

/** Removed from Continue Reading here: hide it on other devices too. */
export function forgetMangaReading(mangaId: number): void {
  addPending([String(mangaId)]);
  scheduleMangaSync(0);
}

/** Chapters marked unread here: hide those reads on other devices too. */
export function unmarkMangaChapters(mangaId: number, chapters: number[]): void {
  addPending(chapters.map((chapter) => readingKey(mangaId, chapter)));
  scheduleMangaSync(0);
}

/** Runs [listener] after a reconcile changed local reading rows; returns the unsubscribe. */
export function onMangaSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
