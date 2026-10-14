import { create } from "zustand";
import { applyDownloadEvent, type MangaDownload } from "../../../../packages/shared/manga";
import { hasMangaMode, mangaApi } from "../lib/manga-api";

interface MangaDownloadsState {
  items: MangaDownload[];
  /** The list has come back from the main process at least once. */
  loaded: boolean;
}

/** Offline chapters and their progress, mirrored from the main process. */
export const useMangaDownloads = create<MangaDownloadsState>(() => ({ items: [], loaded: false }));

let following = false;

/** Loads the downloads once and keeps following them (pages showing downloads call this). */
export function followMangaDownloads() {
  if (following || !hasMangaMode()) return;
  following = true;
  // Subscribe first: the list answer then already includes anything that changed before it.
  mangaApi().onDownload((event) => useMangaDownloads.setState((state) => ({ items: applyDownloadEvent(state.items, event) })));
  mangaApi().downloads()
    .then((items) => useMangaDownloads.setState({ items, loaded: true }))
    .catch(() => useMangaDownloads.setState({ loaded: true }));
}
