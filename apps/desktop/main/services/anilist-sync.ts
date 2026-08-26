// AniList OAuth (implicit grant) + list sync.
//
// Setup (one-time):
//  1. Go to anilist.co/settings/developer → Create New Client
//  2. Set Redirect URL to:  http://localhost
//  3. Copy the Client ID → paste into AniTrack Settings

import { BrowserWindow } from "electron";
import { SimpleStore } from "./store";
import { getListEntry, runInTransaction, setListEntry, upsertAnime } from "./db";
import type { WatchStatus } from "../../../../packages/shared/types";

const AUTH_BASE    = "https://anilist.co/api/v2/oauth";
const REDIRECT_URI = "http://localhost";
const GQL_URL      = "https://graphql.anilist.co";

interface AlTokens {
  access_token: string;
  expires_at: number;
  userId?: number;
  username?: string;
}

interface StoreShape {
  alTokens?: AlTokens;
  alClientId?: string;
}

const store = new SimpleStore<StoreShape>("anitrack-al-auth");

export function setClientId(id: string) { store.set("alClientId", id.trim()); }
export function getClientId(): string | undefined { return store.get("alClientId"); }

export function getState() {
  const t = store.get("alTokens");
  return {
    connected: !!t && Date.now() < (t.expires_at ?? 0),
    username:  t?.username ?? null,
    userId:    t?.userId   ?? null,
    expiresAt: t?.expires_at ?? null,
    hasClientId: !!store.get("alClientId"),
  };
}

export function disconnect() { store.delete("alTokens"); }

export function beginAuth(mainWindow: BrowserWindow): { ok: boolean; reason?: string } {
  const clientId = store.get("alClientId");
  if (!clientId) return { ok: false, reason: "No client ID saved — paste yours in Settings first." };

  const url =
    `${AUTH_BASE}/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=token`;

  const authWin = new BrowserWindow({
    width: 520, height: 720,
    title: "Connect to AniList",
    autoHideMenuBar: true,
    parent: mainWindow,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  authWin.loadURL(url);

  // AniList implicit flow: after approval, server 302s to
  //   http://localhost#access_token=...&expires_in=...
  // will-navigate fires synchronously — we prevent the navigation so the
  // browser never tries to connect to localhost (which would show an error).
  // will-navigate, did-navigate and did-navigate-in-page can all fire for the
  // same redirect, so latch to process the token exactly once.
  let handled = false;
  function handleNav(event: { preventDefault?: () => void }, navUrl: string) {
    if (!navUrl.startsWith(REDIRECT_URI)) return;
    event.preventDefault?.();
    if (handled) return;
    handled = true;

    // Fragment comes after '#'. URL API can't parse fragments so we replace '#' → '?'.
    const frag = navUrl.includes("#")
      ? new URLSearchParams(navUrl.split("#")[1])
      : new URLSearchParams();
    const token     = frag.get("access_token");
    const expiresIn = Number(frag.get("expires_in") ?? 31536000);

    if (!token) {
      if (!authWin.isDestroyed()) authWin.destroy();
      mainWindow.webContents.send("al:auth-error", "No access token in redirect");
      return;
    }
    if (!authWin.isDestroyed()) authWin.destroy();

    (async () => {
      try {
        const tokens: AlTokens = { access_token: token, expires_at: Date.now() + expiresIn * 1000 };
        const viewer = await gql(token, `{ Viewer { id name } }`);
        tokens.userId   = viewer.data?.Viewer?.id;
        tokens.username = viewer.data?.Viewer?.name;
        store.set("alTokens", tokens);
        mainWindow.webContents.send("al:auth-complete", getState());
      } catch (e) {
        mainWindow.webContents.send("al:auth-error", (e as Error).message);
      }
    })();
  }

  authWin.webContents.on("will-navigate",       (ev, u) => handleNav(ev, u));
  authWin.webContents.on("did-navigate",         (_e, u) => handleNav({}, u));
  authWin.webContents.on("did-navigate-in-page", (_e, u) => handleNav({}, u));

  const timeout = setTimeout(() => { if (!authWin.isDestroyed()) authWin.destroy(); }, 10 * 60_000);
  authWin.on("closed", () => clearTimeout(timeout));
  return { ok: true };
}

// ── GraphQL helper ────────────────────────────────────────────────────────────

async function gql(token: string | null, query: string, variables: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList GQL ${res.status}: ${await res.text().catch(() => "")}`);
  const json = await res.json() as any;
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json;
}

function getToken(): string | null {
  const t = store.get("alTokens");
  if (!t || Date.now() > t.expires_at - 60_000) return null;
  return t.access_token;
}

// ── Status mapping ────────────────────────────────────────────────────────────

const TO_AL: Record<WatchStatus, string> = {
  watching:       "CURRENT",
  completed:      "COMPLETED",
  on_hold:        "PAUSED",
  dropped:        "DROPPED",
  plan_to_watch:  "PLANNING",
};

const FROM_AL: Record<string, WatchStatus> = {
  CURRENT:   "watching",
  COMPLETED: "completed",
  PAUSED:    "on_hold",
  DROPPED:   "dropped",
  PLANNING:  "plan_to_watch",
  REPEATING: "watching",
};

// ── Push one entry ────────────────────────────────────────────────────────────

export async function pushEntry(
  anilistId: number,
  status: WatchStatus,
  progress: number,
  score?: number | null,
  startedAt?: string,    // "YYYY-MM-DD"
  completedAt?: string,  // "YYYY-MM-DD"
): Promise<void> {
  const token = getToken();
  if (!token || anilistId <= 0) return;

  const vars: Record<string, unknown> = {
    mediaId:  anilistId,
    status:   TO_AL[status],
    progress,
  };
  // AniList scoreRaw is 0-100; our score is 0-10
  if (score != null) vars.scoreRaw = Math.round(score * 10);

  function dateObj(iso: string) {
    const [y, m, d] = iso.split("-").map(Number);
    return { year: y, month: m, day: d };
  }
  if (startedAt)   vars.startedAt   = dateObj(startedAt);
  if (completedAt) vars.completedAt = dateObj(completedAt);

  const mutation = `
    mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$scoreRaw:Int,$startedAt:FuzzyDateInput,$completedAt:FuzzyDateInput){
      SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$scoreRaw,startedAt:$startedAt,completedAt:$completedAt){
        id status progress score
      }
    }
  `;
  await gql(token, mutation, vars);
}

// ── Pull full list ────────────────────────────────────────────────────────────

export async function pullList(onProgress?: (n: number) => void): Promise<{ imported: number }> {
  const token  = getToken();
  if (!token) throw new Error("Not connected to AniList");
  const userId = store.get("alTokens")?.userId;
  if (!userId) throw new Error("No user ID — reconnect AniList");

  const query = `
    query($userId:Int){
      MediaListCollection(userId:$userId,type:ANIME){
        lists{entries{
          media{
            id idMal
            title{romaji english}
            episodes status
            coverImage{large}
            meanScore
            startDate{year}
            genres
            studios(isMain:true){nodes{name}}
          }
          status progress score updatedAt
        }}
      }
    }
  `;

  const data  = await gql(token, query, { userId });
  const lists = (data.data?.MediaListCollection?.lists ?? []) as any[];
  let count   = 0;

  runInTransaction(() => {
    for (const list of lists) {
      for (const entry of (list.entries ?? []) as any[]) {
        const m = entry.media;
        upsertAnime({
          id:           m.id,
          malId:        m.idMal ?? null,
          title:        m.title?.romaji ?? m.title?.english ?? "",
          titleEnglish: m.title?.english ?? null,
          episodes:     m.episodes ?? null,
          coverImage:   m.coverImage?.large ?? null,
          averageScore: m.meanScore ?? null,
          status:       m.status ?? null,
          year:         m.startDate?.year ?? null,
          genres:       m.genres ?? [],
          studios:      (m.studios?.nodes ?? []).map((s: any) => s.name),
        });
        setListEntry({
          animeId:         m.id,
          status:          FROM_AL[entry.status] ?? "plan_to_watch",
          episodesWatched: entry.progress ?? 0,
          score:           entry.score || null,
          updatedAt:       (entry.updatedAt ?? 0) * 1000,
        });
        count++;
        onProgress?.(count);
      }
    }
  });
  return { imported: count };
}

// ── markEpisodeWatched equivalent for AniList ─────────────────────────────────

export async function alMarkEpisodeWatched(anilistId: number, episode: number): Promise<void> {
  if (!getToken() || anilistId <= 0 || anilistId >= 1_000_000_000) return;
  try {
    // Don't override a "dropped" status — user explicitly stopped watching.
    const existing = getListEntry(anilistId);
    if (existing?.status === "dropped") return;
    // We push "watching" with the episode count. AniList figures out
    // completion automatically when progress === total episodes.
    // Only send the start date on the FIRST episode — otherwise every mark would
    // overwrite AniList's "started" date with today's.
    const isStart = !existing || (existing.episodesWatched ?? 0) === 0;
    const today = new Date().toISOString().slice(0, 10);
    await pushEntry(anilistId, "watching", episode, undefined, isStart ? today : undefined);
  } catch (e) {
    console.warn("[al] markEpisodeWatched failed", e);
  }
}
