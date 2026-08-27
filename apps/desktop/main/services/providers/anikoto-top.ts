import {
  anikotoSelector,
  anikotoUrl,
  escapeRegex,
  extractRouteValue,
  htmlAttribute,
} from "./anikoto-config";
import { anikotoFetch } from "./anikoto-browser";

export interface AnikotoTopItem {
  slug: string;
  showId: string;
  title: string;
  titleJp: string;
  poster: string;
  sub: number | null;
  dub: number | null;
}

export interface AnikotoTopResult {
  day: AnikotoTopItem[];
  week: AnikotoTopItem[];
  month: AnikotoTopItem[];
}

// Parse Anikoto's home-page "Top anime" sidebar into day/week/month lists.
export function parseAnikotoTop(html: string): AnikotoTopResult {
  const out: AnikotoTopResult = { day: [], week: [], month: [] };
  const secStart = html.indexOf('id="top-anime"');
  if (secStart < 0) return out;
  const sec = html.slice(secStart, secStart + 80000);
  const markers = [...sec.matchAll(/<div class="tab-content" data-name="(day|week|month)"/g)];
  for (let i = 0; i < markers.length; i++) {
    const name = markers[i][1] as "day" | "week" | "month";
    const start = markers[i].index!;
    const end = i + 1 < markers.length ? markers[i + 1].index! : sec.length;
    const block = sec.slice(start, end);
    const items: AnikotoTopItem[] = [];
    const itemClass = escapeRegex(anikotoSelector("searchItemClass"));
    const itemStart = new RegExp(`<a\\s+class=["'][^"']*\\b${itemClass}\\b[^"']*["']`, "i");
    for (const p of block.split(itemStart).slice(1, 11)) {
      const href = (p.match(/href="([^"]+)"/) || [])[1] || "";
      const slug = extractRouteValue(href, "watch", "animeId") || "";
      const poster = (p.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
      const alt = (p.match(/alt="([^"]*)"/) || [])[1] || "";
      const nameM = p.match(/class="name[^"]*"[^>]*>\s*([^<]+?)\s*</);
      const title = ((nameM && nameM[1]) || alt).trim();
      const titleJp = htmlAttribute(p, anikotoSelector("searchTitleAttribute")) || "";
      const showId = (p.match(/data-tip="([^"]*)"/) || [])[1] || "";
      const sub = (p.match(/ep-status sub[\s\S]*?<span>\s*(\d+)/) || [])[1];
      const dub = (p.match(/ep-status dub[\s\S]*?<span>\s*(\d+)/) || [])[1];
      if (title) items.push({ slug, showId, title, titleJp, poster, sub: sub ? +sub : null, dub: dub ? +dub : null });
    }
    out[name] = items;
  }
  return out;
}

export async function getAnikotoTop(): Promise<AnikotoTopResult> {
  try {
    const resp = await anikotoFetch(anikotoUrl("home"));
    const html = await resp.text();
    return parseAnikotoTop(html);
  } catch (e) {
    console.warn("[Anikoto] getAnikotoTop failed", e);
    return { day: [], week: [], month: [] };
  }
}
