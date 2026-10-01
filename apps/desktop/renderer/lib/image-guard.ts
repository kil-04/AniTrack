import type { SyntheticEvent } from "react";

// AniList banners are normally ~1900x400. A few uploads are absurd (one live
// banner was 136800x28800, 3.9 gigapixels): decoding it for a 204x115 card
// spiked GPU and renderer memory. Larger images fall back to the cover art and
// are remembered, so they are never downloaded or decoded again.
const MAX_IMAGE_PIXELS = 24_000_000;
const STORAGE_KEY = "anitrack:oversized-images";
const MAX_REMEMBERED = 200;

let oversized: Set<string> | null = null;

function remembered(): Set<string> {
  if (!oversized) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      oversized = new Set(Array.isArray(saved) ? saved.filter((url) => typeof url === "string") : []);
    } catch {
      oversized = new Set();
    }
  }
  return oversized;
}

/** The preferred image unless it is known to be oversized, else the fallback. */
export function safeImageSrc(preferred?: string | null, fallback?: string | null): string | undefined {
  if (preferred && !remembered().has(preferred)) return preferred;
  return fallback || undefined;
}

/** onLoad handler: swap an oversized image for the fallback (or hide it). */
export function rejectOversizedImage(event: SyntheticEvent<HTMLImageElement>, fallback?: string | null): void {
  const img = event.currentTarget;
  if (img.naturalWidth * img.naturalHeight <= MAX_IMAGE_PIXELS) return;
  const url = img.getAttribute("src") || img.currentSrc;
  const known = remembered();
  known.add(url);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...known].slice(-MAX_REMEMBERED)));
  } catch { /* the in-memory set still protects this session */ }
  if (fallback && fallback !== url && !known.has(fallback)) img.src = fallback;
  else {
    img.removeAttribute("src");
    img.style.visibility = "hidden";
  }
}
