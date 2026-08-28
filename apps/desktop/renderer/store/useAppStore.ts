import { create, type StoreApi } from "zustand";
import { pullAndMerge } from "../lib/supabase-sync";
import type {
  AniListAuthState,
  AnimeRecommendation,
  AnimeMeta,
  ContinueWatchingItem,
  ListEntry,
  MalAuthState,
  RecentEpisode,
} from "../../../../packages/shared/types";

interface AppState {
  mal: MalAuthState;
  al: AniListAuthState;
  trending: AnimeMeta[];
  recommendations: AnimeRecommendation[];
  latestEpisodes: RecentEpisode[];
  latestPage: number;
  latestHasNextPage: boolean;
  continueWatching: ContinueWatchingItem[];
  list: { entry: ListEntry; anime: AnimeMeta | null }[];
  loading: boolean;
  latestLoading: boolean;
  recommendationsLoading: boolean;
  scanStatus: string | null;

  refreshAll: () => Promise<void>;
  refreshLatest: (page?: number) => Promise<void>;
  refreshContinue: () => Promise<void>;
  refreshList: () => Promise<void>;
  setScanStatus: (s: string | null) => void;
}

let latestRequestId = 0;
let recommendationRequestId = 0;

type LocalListItem = { entry: ListEntry; anime: AnimeMeta | null };

async function loadRecommendations(
  set: StoreApi<AppState>["setState"],
  list: LocalListItem[],
): Promise<void> {
  const requestId = ++recommendationRequestId;
  const excludedIds = list.map((item) => item.entry.animeId).filter((id) => id > 0);
  const seedIds = list
    .filter((item) => item.anime && ["completed", "watching"].includes(item.entry.status))
    .sort((a, b) => (b.entry.score ?? 0) - (a.entry.score ?? 0)
      || b.entry.updatedAt - a.entry.updatedAt)
    .map((item) => item.entry.animeId)
    .filter((id) => id > 0)
    .slice(0, 8);
  if (seedIds.length === 0) {
    set({ recommendations: [], recommendationsLoading: false });
    return;
  }

  set({ recommendationsLoading: true });
  try {
    const recommendations = await window.api.anilist.recommendations(seedIds, excludedIds);
    if (requestId === recommendationRequestId) set({ recommendations });
  } catch (e) {
    if (requestId === recommendationRequestId) {
      console.error("recommendations fetch failed", e);
    }
  } finally {
    if (requestId === recommendationRequestId) set({ recommendationsLoading: false });
  }
}

async function loadLatest(
  set: StoreApi<AppState>["setState"],
  page = 1,
): Promise<void> {
  const requestId = ++latestRequestId;
  set({ latestLoading: true, latestPage: page });
  try {
    const result = await window.api.anilist.recent(page);
    // A pagination click may supersede an older startup/refresh request.
    if (requestId !== latestRequestId) return;
    set({
      latestEpisodes: result.data,
      latestPage: result.page,
      latestHasNextPage: result.hasNextPage,
    });
  } catch (e) {
    if (requestId === latestRequestId) {
      console.error("latest episodes fetch failed", e);
    }
  } finally {
    if (requestId === latestRequestId) set({ latestLoading: false });
  }
}

export const useAppStore = create<AppState>((set) => ({
  mal: { connected: false },
  al: { connected: false },
  trending: [],
  recommendations: [],
  latestEpisodes: [],
  latestPage: 1,
  latestHasNextPage: false,
  continueWatching: [],
  list: [],
  loading: false,
  latestLoading: false,
  recommendationsLoading: false,
  scanStatus: null,

  refreshAll: async () => {
    set({ loading: true });
    // Latest Episodes is independent from the rest of home startup. Start it
    // immediately instead of waiting for auth, library, and trending first.
    const latestPromise = loadLatest(set, 1);
    // Two-way gist sync runs in the BACKGROUND — the UI paints from local data
    // immediately instead of waiting on a GitHub round-trip. If the pull
    // brought anything new, Continue Watching refreshes itself afterwards.
    pullAndMerge()
      .then(async (n) => {
        if (n > 0) {
          const cw = await window.api.list.continueWatching();
          set({ continueWatching: cw });
        }
      })
      .catch(() => {});
    // Resolve each call independently so one slow/failing fetch doesn't block
    // the others. Promise.allSettled lets us partially populate the UI.
    const results = await Promise.allSettled([
      window.api.mal.state(),
      window.api.al.state(),
      window.api.anilist.trending(),
      window.api.list.continueWatching(),
      window.api.list.getAll(),
    ]);
    const next: Partial<AppState> = {};
    if (results[0].status === "fulfilled") next.mal = results[0].value;
    if (results[1].status === "fulfilled") next.al = results[1].value;
    if (results[2].status === "fulfilled") next.trending = results[2].value;
    if (results[3].status === "fulfilled") next.continueWatching = results[3].value;
    if (results[4].status === "fulfilled") {
      next.list = results[4].value;
      void loadRecommendations(set, results[4].value);
    }
    set({ ...next, loading: false });
    await latestPromise;
  },

  refreshLatest: (page = 1) => loadLatest(set, page),

  refreshContinue: async () => {
    try {
      // Local list first (instant), cloud reconcile after — refresh again only
      // if the pull actually changed something.
      const cw = await window.api.list.continueWatching();
      set({ continueWatching: cw });
      pullAndMerge()
        .then(async (n) => {
          if (n > 0) {
            const cw2 = await window.api.list.continueWatching();
            set({ continueWatching: cw2 });
          }
        })
        .catch(() => {});
    } catch (e) {
      console.error("refreshContinue failed", e);
    }
  },

  refreshList: async () => {
    const list = await window.api.list.getAll();
    set({ list });
    await loadRecommendations(set, list);
  },

  setScanStatus: (s) => set({ scanStatus: s }),
}));
