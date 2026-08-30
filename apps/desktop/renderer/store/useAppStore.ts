import { create, type StoreApi } from "zustand";
import { pullAndMerge } from "../lib/supabase-sync";
import { selectRecommendationSeedIds } from "../../../../packages/shared/recommendations";
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
  const seedIds = selectRecommendationSeedIds(list.map((item) => ({
    id: item.entry.animeId,
    status: item.entry.status,
    score: item.entry.score,
    updatedAt: item.entry.updatedAt,
    year: item.anime?.year,
  })));
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
    // Commit each independent result as soon as it lands. The old allSettled
    // batch held instant local rows behind the slowest startup network call.
    const tasks = [
      latestPromise,
      window.api.mal.state().then((mal) => set({ mal })),
      window.api.al.state().then((al) => set({ al })),
      window.api.anilist.trending().then((trending) => set({ trending })),
      window.api.list.continueWatching().then((continueWatching) => set({ continueWatching })),
      window.api.list.getAll().then((list) => {
        set({ list });
        void loadRecommendations(set, list);
      }),
    ];
    await Promise.allSettled(tasks);
    set({ loading: false });
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
