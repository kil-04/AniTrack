import { create } from "zustand";
import { pullAndMerge } from "../lib/supabase-sync";
import type {
  AniListAuthState,
  AnimeMeta,
  ContinueWatchingItem,
  ListEntry,
  MalAuthState,
} from "../../shared/types";

interface AppState {
  mal: MalAuthState;
  al: AniListAuthState;
  trending: AnimeMeta[];
  latestEpisodes: any[];
  latestPage: number;
  latestLastPage: number;
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
  latestLastPage: 1,
  continueWatching: [],
  list: [],
  loading: false,
  latestLoading: false,
  scanStatus: null,

  refreshAll: async () => {
    set({ loading: true });
    // Pull remote playback progress from Supabase before refreshing the UI.
    // Runs silently — a missing/misconfigured Supabase just returns 0.
    await pullAndMerge().catch(() => {});
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

    // Fetch latest episodes separately (slower, CF-gated); always resets to page 1
    try {
      set({ latestLoading: true, latestPage: 1 });
      const result = await window.api.pahe.latest(1);
      set({ latestEpisodes: result.data, latestLastPage: result.lastPage });
    } catch (e) {
      console.error("latest episodes fetch failed", e);
    } finally {
      set({ latestLoading: false });
    }
  },

  refreshLatest: async (page = 1) => {
    set({ latestLoading: true, latestPage: page });
    try {
      const result = await window.api.pahe.latest(page);
      set({ latestEpisodes: result.data, latestLastPage: result.lastPage });
    } catch (e) {
      console.error(e);
    } finally {
      set({ latestLoading: false });
    }
  },

  refreshContinue: async () => {
    try {
      await pullAndMerge().catch(() => {});
      const cw = await window.api.list.continueWatching();
      set({ continueWatching: cw });
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
