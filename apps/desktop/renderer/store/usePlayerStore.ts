import { create } from "zustand";

/**
 * Global player session — lets StreamPlayer outlive the /stream-player route so
 * it keeps playing as a floating mini-player when the user navigates away
 * (YouTube-style). `search` is the player's query string (leading "?");
 * null = no active session.
 */
interface PlayerState {
  search: string | null;
  open: (search: string) => void;
  close: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  search: null,
  open: (search) => {
    const s = search.startsWith("?") ? search : `?${search}`;
    if (get().search !== s) set({ search: s });
  },
  close: () => set({ search: null }),
}));
