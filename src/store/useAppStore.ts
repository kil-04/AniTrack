import { create } from "zustand";
import type {
  AnimeMeta,
  ContinueWatchingItem,
  ListEntry,
  MalAuthState,
} from "../../shared/types";

interface AppState {
  mal: MalAuthState;
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
    try {
      const [mal, trending, cw, list] = await Promise.all([
        window.api.mal.state(),
        window.api.anilist.trending(),
        window.api.list.continueWatching(),
        window.api.list.getAll(),
      ]);
      set({ mal, trending, continueWatching: cw, list });
    } catch (e) {
      console.error(e);
    } finally {
      set({ loading: false });
    }
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
