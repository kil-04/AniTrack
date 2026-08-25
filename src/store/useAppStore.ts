import { create } from "zustand";
import { pullAndMerge } from "../lib/supabase-sync";
import type {
  AniListAuthState,
  AnimeMeta,
  ContinueWatchingItem,
  ListEntry,
  MalAuthState,
  RecentEpisode,
} from "../../shared/types";

interface AppState {
  mal: MalAuthState;
  al: AniListAuthState;
  trending: AnimeMeta[];
  latestEpisodes: RecentEpisode[];
  latestPage: number;
  latestHasNextPage: boolean;
  continueWatching: ContinueWatchingItem[];
  list: { entry: ListEntry; anime: AnimeMeta | null }[];
  loading: boolean;
  latestLoading: boolean;
  scanStatus: string | null;

  refreshAll: () => Promise<void>;
  refreshLatest: (page?: number) => Promise<void>;
  refreshContinue: () => Promise<void>;
  refreshList: () => Promise<void>;
  setScanStatus: (s: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  mal: { connected: false },
  al: { connected: false },
  trending: [],
  latestEpisodes: [],
  latestPage: 1,
  latestHasNextPage: false,
  continueWatching: [],
  list: [],
  loading: false,
  latestLoading: false,
  scanStatus: null,

  refreshAll: async () => {
    set({ loading: true });
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
    if (results[4].status === "fulfilled") next.list = results[4].value;
    set({ ...next, loading: false });

    // Fetch the same AniList recent-airing feed used by native Android.
    try {
      set({ latestLoading: true, latestPage: 1 });
      const result = await window.api.anilist.recent(1);
      set({ latestEpisodes: result.data, latestHasNextPage: result.hasNextPage });
    } catch (e) {
      console.error("latest episodes fetch failed", e);
    } finally {
      set({ latestLoading: false });
    }
  },

  refreshLatest: async (page = 1) => {
    set({ latestLoading: true, latestPage: page });
    try {
      const result = await window.api.anilist.recent(page);
      set({
        latestEpisodes: result.data,
        latestPage: result.page,
        latestHasNextPage: result.hasNextPage,
      });
    } catch (e) {
      console.error(e);
    } finally {
      set({ latestLoading: false });
    }
  },

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
  },

  setScanStatus: (s) => set({ scanStatus: s }),
}));
