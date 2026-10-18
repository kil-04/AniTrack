/**
 * Cross-device novel sync (progress, the list, linked sources), in its own file
 * of the Continue Watching gist. Merge rules: packages/shared/novel-sync.ts;
 * Android runs the same rules in NovelSyncMerge.kt.
 *
 * The local tables are each device's source of truth: every reconcile reads them
 * whole (through the main process), merges them with the gist file and writes
 * back both ways, so a missed or failed upload is simply repeated next time.
 * Removals made here wait in the main process's novel_sync_removed table until
 * an upload carried them.
 */
import { NOVEL_SYNC_FILE, parseNovelSyncDoc, planNovelSync, serializeNovelSyncDoc } from "../../../../packages/shared/novel-sync";
import { ghHeaders, readGistFile, syncGist } from "./supabase-sync";
import { hasNovelMode, novelApi } from "./novel-api";

const GH = "https://api.github.com";
const DEBOUNCE_MS = 7_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<number> | null = null;
let again = false;
const listeners = new Set<() => void>();

async function reconcile(): Promise<number> {
  if (!hasNovelMode()) return 0;
  const gist = await syncGist();
  if (!gist) return 0;
  const remote = parseNovelSyncDoc(await readGistFile(gist.token, gist.gistId, NOVEL_SYNC_FILE));
  const { pending, ...local } = await novelApi().syncSnapshot();
  const plan = planNovelSync(local, remote, pending, Date.now());
  let changed = 0;
  if (plan.reading.upsert.length || plan.reading.remove.length || plan.list.upsert.length || plan.list.remove.length || plan.titles.length) {
    changed = (await novelApi().syncApply({ reading: plan.reading, list: plan.list, titles: plan.titles })).applied;
  }
  if (plan.changed) {
    const res = await fetch(`${GH}/gists/${gist.gistId}`, {
      method: "PATCH",
      headers: ghHeaders(gist.token),
      body: JSON.stringify({ files: { [NOVEL_SYNC_FILE]: { content: serializeNovelSyncDoc(plan.doc) } } }),
    });
    if (!res.ok) throw new Error(`GitHub rejected the novel sync update (${res.status}).`);
  }
  // The removals this upload carried are done (one made meanwhile stays pending), and the
  // ones the gist holds are remembered so a later mark is never dated under one.
  await novelApi().syncAck(pending, plan.doc.deleted);
  if (changed) for (const listener of listeners) listener();
  return changed;
}

/**
 * Two-way reconcile now. Resolves to how many local rows changed. Concurrent calls
 * share one run; a request during a run starts one more afterwards.
 */
export function syncNovelReading(): Promise<number> {
  if (running) { again = true; return running; }
  running = reconcile().finally(() => {
    running = null;
    if (again) { again = false; scheduleNovelSync(0); }
  });
  return running;
}

function scheduleNovelSync(delay = DEBOUNCE_MS) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNovelReading().catch(() => {}); }, delay);
}

/** Progress, marks, the list or links changed here: upload shortly (batched). */
export function novelReadingChanged(): void {
  scheduleNovelSync();
}

/** Something was removed here (Continue Reading, a read mark, the list): upload it now. */
export function novelRemoved(): void {
  scheduleNovelSync(0);
}

/** Runs [listener] after a reconcile changed local rows; returns the unsubscribe. */
export function onNovelSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
