import { shell } from "electron";
import type { AnimeMeta, StreamingServiceLink } from "../../shared/types";

// Each service has a search URL builder. "deep" links require an ID we don't
// reliably have, so we default to high-quality title search URLs.
const services: { name: string; build: (title: string) => string }[] = [
  {
    name: "Crunchyroll",
    build: (t) =>
      `https://www.crunchyroll.com/search?q=${encodeURIComponent(t)}`,
  },
  {
    name: "Netflix",
    build: (t) => `https://www.netflix.com/search?q=${encodeURIComponent(t)}`,
  },
  {
    name: "HiDive",
    build: (t) =>
      `https://www.hidive.com/search?q=${encodeURIComponent(t)}`,
  },
  {
    name: "Hulu",
    build: (t) =>
      `https://www.hulu.com/search?q=${encodeURIComponent(t)}`,
  },
  {
    name: "Disney+",
    build: (t) =>
      `https://www.disneyplus.com/search?q=${encodeURIComponent(t)}`,
  },
  {
    name: "Amazon Prime",
    build: (t) =>
      `https://www.amazon.com/s?k=${encodeURIComponent(t)}&i=instant-video`,
  },
  {
    name: "YouTube",
    build: (t) =>
      `https://www.youtube.com/results?search_query=${encodeURIComponent(
        t + " anime",
      )}`,
  },
  {
    name: "Anikoto",
    build: (t) =>
      `https://anikoto.cz/filter?keyword=${encodeURIComponent(t)}`,
  },
];

export function linksFor(anime: AnimeMeta): StreamingServiceLink[] {
  const title = anime.titleEnglish || anime.title || anime.titleRomaji || "";
  return services.map((s) => ({
    service: s.name,
    url: s.build(title),
    kind: "search" as const,
  }));
}

export function openLink(url: string) {
  // Only allow http/https — never invoke shell.openExternal on arbitrary schemes
  // (avoids accidentally launching native apps from a crafted URL).
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Refusing to open non-http URL: ${url}`);
  }
  shell.openExternal(url);
}
