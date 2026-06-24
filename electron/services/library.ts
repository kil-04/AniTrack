import fs from "node:fs/promises";
import path from "node:path";
import { searchAnime } from "./anilist";
import {
  findAnimeByTitle,
  listLibraryFolders,
  removeStaleLocalEpisodes,
  runInTransaction,
  upsertAnime,
  upsertLocalEpisode,
} from "./db";
import type { AnimeMeta } from "../../shared/types";

const VIDEO_EXT = new Set([
  ".mkv",
  ".mp4",
  ".avi",
  ".mov",
  ".webm",
  ".m4v",
  ".ts",
  ".wmv",
]);

// Very simple anitomy-style filename parser. Not perfect, but handles
// the common cases: "[Group] Show Name - 03 [1080p].mkv" / "Show.Name.S01E04.mkv".
export interface ParsedFilename {
  title: string;
  episode: number | null;
}

export function parseFilename(name: string): ParsedFilename {
  // Strip extension and bracketed tags ([Group], (Source), {info}).
  let s = name.replace(/\.[^.]+$/, "");
  s = s.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/\{[^}]*\}/g, " ");

  // Look for SxxExx pattern first.
  let episode: number | null = null;
  const se = s.match(/S(\d{1,2})E(\d{1,3})/i);
  if (se) {
    episode = parseInt(se[2], 10);
    s = s.replace(/S\d{1,2}E\d{1,3}.*$/i, "");
  } else {
    // " - 03 " style
    const dash = s.match(/-\s*(\d{1,3})(?!\d)/);
    if (dash) {
      episode = parseInt(dash[1], 10);
      s = s.slice(0, dash.index);
    } else {
      // Trailing number "Show Name 12"
      const trail = s.match(/(.*?)[\s_.]+(\d{1,3})\s*$/);
      if (trail) {
        episode = parseInt(trail[2], 10);
        s = trail[1];
      }
    }
  }
  const title = s
    .replace(/[._]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { title, episode };
}

async function walk(
  dir: string,
  out: string[] = [],
  status: { ok: boolean } = { ok: true },
): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    status.ok = false; // a folder/subfolder couldn't be read (offline drive, perms)
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out, status);
    else if (e.isFile() && VIDEO_EXT.has(path.extname(e.name).toLowerCase()))
      out.push(full);
  }
  return out;
}

// Group files by parsed title, then resolve each group to an AniList anime once.
export async function scanAll(
  onProgress?: (cur: number, total: number, label: string) => void,
): Promise<{ shows: number; episodes: number }> {
  const folders = listLibraryFolders();
  const files: string[] = [];
  const scanStatus = { ok: true };
  for (const f of folders) await walk(f, files, scanStatus);

  // Bucket by best-guess title.
  const buckets = new Map<string, { episode: number; filePath: string }[]>();
  for (const fp of files) {
    const parsed = parseFilename(path.basename(fp));
    const ep = parsed.episode ?? 1;
    const key = parsed.title.toLowerCase();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push({ episode: ep, filePath: fp });
  }

  // Track every file path we found so we can prune stale DB entries at the end.
  const validPaths = new Set<string>(files);

  const titleEntries = [...buckets.entries()];
  let shows = 0;
  let episodes = 0;
  for (let i = 0; i < titleEntries.length; i++) {
    const [titleKey, items] = titleEntries[i];
    onProgress?.(i + 1, titleEntries.length, titleKey);

    // Check the local DB before hitting AniList — avoids the network call and
    // the 250 ms rate-limit delay for any title we've already resolved.
    let match: AnimeMeta | null = findAnimeByTitle(titleKey);

    if (!match) {
      try {
        const results = await searchAnime(titleKey);
        match = results[0] ?? null;
      } catch (e) {
        console.warn("AniList search failed for", titleKey, e);
      }
      if (!match) {
        const id = -hashTitle(titleKey);
        match = {
          id,
          malId: null,
          title: titleKey.replace(/\b\w/g, (c) => c.toUpperCase()),
          episodes: items.length,
          coverImage: null,
          genres: [],
          studios: [],
        };
      }
      upsertAnime(match);
      // Be polite to AniList only when we actually called it.
      await new Promise((r) => setTimeout(r, 250));
    }

    const finalMatch = match;
    runInTransaction(() => {
      for (const it of items) {
        upsertLocalEpisode({
          animeId: finalMatch.id,
          episode: it.episode,
          filePath: it.filePath,
          durationSec: null,
        });
        episodes++;
      }
    });
    shows++;
  }

  // Remove DB rows for files that no longer exist on disk (incremental update).
  // Only prune when every folder was fully readable — otherwise a transiently
  // offline drive would wipe its episodes from the library.
  if (scanStatus.ok) removeStaleLocalEpisodes(validPaths);
  else console.warn("[scan] some library folders were unreadable — skipping stale-episode prune to avoid data loss");

  return { shows, episodes };
}

function hashTitle(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
