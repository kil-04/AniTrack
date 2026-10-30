/**
 * Airing schedule + new-episode notifications for tracked shows.
 *
 * AniList's `nextAiringEpisode` is always the NEXT (future) episode, so we detect
 * "an episode just dropped" by watching the next-episode number advance between
 * checks (a weekly show goes ep 5 → ep 6 once ep 5 airs). The first run only
 * seeds the baseline so we never spam on launch.
 */
import { isCapacitor } from "./platform";
import type { AiringInfo } from "../../../../packages/shared/types";

const SEEN_KEY = "airing_seen"; // { [animeId]: lastSeenNextEpisode }
export const WEB_REMINDERS_KEY = 'anitrack.web.reminders';

export function webRemindersEnabled(): boolean {
  try { return typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem(WEB_REMINDERS_KEY) !== 'off'; }
  catch { return false; }
}

function loadSeen(): Record<number, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function saveSeen(s: Record<number, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(s));
  } catch {
    /* quota — ignore */
  }
}

/** AniList ids the user actively tracks (watching / plan-to-watch, real ids only). */
async function trackedIds(): Promise<number[]> {
  const all = await window.api.list.getAll().catch(() => []);
  return (all as any[])
    .map((x) => x?.entry)
    .filter((e) => e && (e.status === "watching" || e.status === "plan_to_watch"))
    .map((e) => e.animeId)
    .filter((id) => Number.isInteger(id) && id > 0 && id < 1_000_000_000);
}

/** Next-airing info for every tracked, still-releasing show, soonest first. */
export async function getTrackedAiring(): Promise<AiringInfo[]> {
  const ids = await trackedIds();
  if (!ids.length) return [];
  const list = await window.api.anilist.airing(ids).catch(() => [] as AiringInfo[]);
  return [...list].sort((a, b) => a.airingAt - b.airingAt);
}

function fireNotification(title: string, body: string, icon?: string | null) {
  // Android WebView notifications need a native plugin — that's a follow-up.
  // On desktop (Electron) the HTML5 Notification API works without a prompt.
  if (isCapacitor) return;
  try {
    if (!webRemindersEnabled()) return;
    const show = () => {
      new Notification(title, { body, icon: icon ?? undefined });
    };
    show();
  } catch {
    /* ignore */
  }
}

/**
 * Check tracked shows and notify for any episode that has dropped since the last
 * check. Safe to call repeatedly; de-dupes via the persisted "seen" baseline.
 */
export async function checkAiringNotifications(): Promise<void> {
  let airing: AiringInfo[];
  try {
    airing = await getTrackedAiring();
  } catch {
    return;
  }
  if (!airing.length) return;

  const seen = loadSeen();
  const firstRun = Object.keys(seen).length === 0;

  for (const a of airing) {
    const prev = seen[a.animeId];
    // Episode number advanced → the episode before the new "next" just aired.
    if (prev != null && a.episode > prev) {
      const airedEpisode = a.episode - 1;
      if (airedEpisode >= 1 && !firstRun) {
        fireNotification(a.title, `Episode ${airedEpisode} is out!`, a.coverImage);
      }
    }
    seen[a.animeId] = a.episode;
  }

  // Prune ids that are no longer tracked/releasing so the map can't grow forever.
  const liveIds = new Set(airing.map((a) => a.animeId));
  for (const k of Object.keys(seen)) {
    if (!liveIds.has(Number(k))) delete seen[Number(k)];
  }
  saveSeen(seen);
}
