import { create } from "zustand";
import type { MangaChapter, MangaMeta, SourceTitle } from "../../../../packages/shared/manga";

/** What the reader opens: a title on a source, its chapters (one per number) and where to start. */
export interface ReaderSession {
  manga: MangaMeta;
  title: SourceTitle;
  chapters: MangaChapter[];
  index: number;
  startPage: number;
  /** Where leaving the reader returns (the title's page when unset). */
  back?: string;
}

interface MangaReaderState {
  session: ReaderSession | null;
  open: (session: ReaderSession) => void;
  /** Moves to another chapter of the open session, from its first page. */
  go: (index: number) => void;
  close: () => void;
}

export const useMangaReader = create<MangaReaderState>((set, get) => ({
  session: null,
  open: (session) => set({ session }),
  go: (index) => {
    const session = get().session;
    if (!session || index < 0 || index >= session.chapters.length) return;
    set({ session: { ...session, index, startPage: 0 } });
  },
  close: () => set({ session: null }),
}));
