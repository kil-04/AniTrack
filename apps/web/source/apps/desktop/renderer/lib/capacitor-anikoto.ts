import { AniTrackPahe } from "./capacitor-plugins";

// ── Anikoto Provider (Browserless HTTP Scraper) ────────────────────────────────

const ANIKOTO_BASE_URL = "https://anikoto.cz";

// MAL id per anikoto slug, harvested from the episode list (see getEpisodes).
export const anikotoMalIds = new Map<string, number | null>();
// Episode-list cache + in-flight dedup for the Android anikoto provider.
const _anikotoEpsCache = new Map<string, { value: any; expires: number }>();
const _anikotoEpsPending = new Map<string, Promise<any>>();

async function anikotoFetch(url: string, options: RequestInit = {}): Promise<any> {
  const fullUrl = url.startsWith("http") ? url : `${ANIKOTO_BASE_URL}${url}`;

  let reqHeaders: Record<string, string> = {};
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((val, key) => {
        reqHeaders[key] = val;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [key, val] of options.headers) {
        reqHeaders[key] = val;
      }
    } else {
      reqHeaders = options.headers as Record<string, string>;
    }
  }

  // Route requests via native OkHttp client on Android to bypass WebView CORS restrictions
  const res = await AniTrackPahe.fetchUrl({
    url: fullUrl,
    binary: false,
    headers: reqHeaders
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Anikoto fetch failed: ${res.status}`);
  }

  return {
    ok: true,
    status: res.status,
    text: async () => res.data,
    json: async () => JSON.parse(res.data)
  };
}

export const anikotoProvider = {
  id: "anikoto",
  name: "Anikoto",

  async getTop(): Promise<{ day: any[]; week: any[]; month: any[] }> {
    const out: { day: any[]; week: any[]; month: any[] } = { day: [], week: [], month: [] };
    try {
      const resp = await anikotoFetch(`/home`);
      const html = await resp.text();
      const secStart = html.indexOf('id="top-anime"');
      if (secStart < 0) return out;
      const sec = html.slice(secStart, secStart + 80000);
      const markers = [...sec.matchAll(/<div class="tab-content" data-name="(day|week|month)"/g)];
      for (let i = 0; i < markers.length; i++) {
        const name = markers[i][1] as "day" | "week" | "month";
        const start = markers[i].index!;
        const end = i + 1 < markers.length ? markers[i + 1].index! : sec.length;
        const block = sec.slice(start, end);
        const items: any[] = [];
        for (const p of block.split(/<a class="item/).slice(1, 11)) {
          const href = (p.match(/href="([^"]+)"/) || [])[1] || "";
          const slug = (href.match(/\/watch\/([^"?/]+)/) || [])[1] || "";
          const poster = (p.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
          const alt = (p.match(/alt="([^"]*)"/) || [])[1] || "";
          const nameM = p.match(/class="name[^"]*"[^>]*>\s*([^<]+?)\s*</);
          const title = ((nameM && nameM[1]) || alt).trim();
          const titleJp = (p.match(/data-jp="([^"]*)"/) || [])[1] || "";
          const showId = (p.match(/data-tip="([^"]*)"/) || [])[1] || "";
          const sub = (p.match(/ep-status sub[\s\S]*?<span>\s*(\d+)/) || [])[1];
          const dub = (p.match(/ep-status dub[\s\S]*?<span>\s*(\d+)/) || [])[1];
          if (title) items.push({ slug, showId, title, titleJp, poster, sub: sub ? +sub : null, dub: dub ? +dub : null });
        }
        out[name] = items;
      }
    } catch (e) {
      console.warn("[Anikoto Capacitor] getTop failed", e);
    }
    return out;
  },

  async search(query: string) {
    try {
      const results: any[] = [];

      const fetchPage = async (pageNo: number) => {
        try {
          const resp = await anikotoFetch(`/filter?keyword=${encodeURIComponent(query)}&page=${pageNo}`);
          const html = await resp.text();

          const blocks = html.split(/<div class="item\s*/);
          for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i];

            const hrefM = /href="[^"]*\/watch\/([^/"]+)/.exec(block);
            const href = hrefM ? hrefM[1] : null;
            if (!href) continue;

            const imgM = /<img src="([^"]+)" alt="([^"]+)"/.exec(block);
            const imgSrc = imgM ? imgM[1] : null;
            const imgAlt = imgM ? imgM[2] : null;

            const jpM = /data-jp="([^"]+)"/.exec(block);
            const dataJp = jpM ? jpM[1].replace(/&#039;/g, "'") : null;

            const totalM = /class="ep-status total"[^>]*>\s*<span>\s*(\d+)\s*<\/span>/.exec(block);
            const totalEps = totalM ? parseInt(totalM[1], 10) : undefined;
            const subM = /class="ep-status sub"[^>]*>\s*<span>\s*(\d+)\s*<\/span>/.exec(block);
            const dubM = /class="ep-status dub"[^>]*>\s*<span>\s*(\d+)\s*<\/span>/.exec(block);
            const subCount = subM ? parseInt(subM[1], 10) : undefined;
            const dubCount = dubM ? parseInt(dubM[1], 10) : undefined;

            const title = dataJp || imgAlt || "Untitled";

            // Extract year from title if possible
            let parsedYear: number | undefined;
            const clean = title.trim();
            const y4Match = clean.match(/\b(19\d\d|20[0-2]\d)\b/);
            if (y4Match) {
              parsedYear = parseInt(y4Match[1], 10);
            } else {
              const y2Match = clean.match(/'(\d{2})\b/);
              if (y2Match) {
                const yy = parseInt(y2Match[1], 10);
                parsedYear = yy >= 50 ? 1900 + yy : 2000 + yy;
              } else {
                const end2Match = clean.match(/\b([5-9]\d|0\d|1\d|2[0-5])\b\s*$/);
                if (end2Match) {
                  const yy = parseInt(end2Match[1], 10);
                  parsedYear = yy >= 50 ? 1900 + yy : 2000 + yy;
                }
              }
            }

            results.push({
              id: href,
              providerId: this.id,
              poster: imgSrc || "",
              title: title,
              episodes: totalEps,
              subCount,
              dubCount,
              year: parsedYear,
            });
          }
        } catch (err) {
          console.error(`[Anikoto Capacitor] Page ${pageNo} search failed:`, err);
        }
      };

      await Promise.all([fetchPage(1), fetchPage(2)]);
      return results;
    } catch (err) {
      console.error("[Anikoto Capacitor] Search failed:", err);
      return [];
    }
  },

  async getEpisodes(animeId: string, page = 1) {
    // Cache + in-flight dedup (mirrors the desktop provider): id verification
    // and playback both need this list — they must share ONE fetch, or bursts
    // trip the site's anti-bot limit and everything starts timing out.
    const cached = _anikotoEpsCache.get(animeId);
    if (cached && Date.now() < cached.expires) return cached.value;
    const pending = _anikotoEpsPending.get(animeId);
    if (pending) return pending;
    const promise = this._getEpisodesUncached(animeId, page)
      .then((value: any) => {
        _anikotoEpsCache.set(animeId, { value, expires: Date.now() + 15 * 60 * 1000 });
        if (_anikotoEpsCache.size > 100) {
          const oldest = _anikotoEpsCache.keys().next().value;
          if (oldest !== undefined) _anikotoEpsCache.delete(oldest);
        }
        return value;
      })
      .finally(() => _anikotoEpsPending.delete(animeId));
    _anikotoEpsPending.set(animeId, promise);
    promise.catch(() => {});
    return promise;
  },

  async _getEpisodesUncached(animeId: string, _page = 1) {
    console.log(`[Anikoto Capacitor] Fetching watch page HTML for showId: ${animeId}`);
    const resp = await anikotoFetch(`/watch/${animeId}`);
    const html = await resp.text();

    const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
    if (!idMatch) throw new Error("Failed to extract anime show ID from watch page HTML");
    const showId = idMatch[1];
    console.log(`[Anikoto Capacitor] Extracted showId: ${showId} for ${animeId}`);

    const listResp = await anikotoFetch(`/ajax/episode/list/${showId}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const listJson = await listResp.json() as any;
    const listHtml = listJson.result || "";

    // Harvest the MAL id from the episode anchors (data-mal) — anikoto entries
    // can be mislabeled, and this id is the only reliable identity check.
    const malM = /data-mal="(\d+)"/.exec(listHtml);
    if (anikotoMalIds.size >= 100) {
      const oldest = anikotoMalIds.keys().next().value;
      if (oldest !== undefined) anikotoMalIds.delete(oldest);
    }
    anikotoMalIds.set(animeId, malM ? parseInt(malM[1], 10) : null);

    const episodes = [];
    const regex = /<a[^>]+data-id="([^"]+)"[^>]+data-slug="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = regex.exec(listHtml)) !== null) {
      const dataId = match[1];
      const dataSlug = match[2];
      const text = match[3].trim();

      const tag = match[0];
      const numM = /data-num="([^"]*)"/.exec(tag);
      const titleM = /title="([^"]*)"/.exec(tag);

      const num = numM ? numM[1] : text;
      const title = titleM ? titleM[1] : `Episode ${num}`;

      const idsM = /data-ids="([^"]*)"/.exec(tag);
      const serversParam = idsM ? idsM[1] : "";

      const slugStr = `ep-${dataSlug}`;
      const id = `${slugStr}:${dataId}:${serversParam}`;

      episodes.push({
        id,
        episodeNumber: parseFloat(num) || 0,
        title
      });
    }

    console.log(`[Anikoto Capacitor] Parsed ${episodes.length} episodes browserlessly for ${animeId}`);
    return {
      data: episodes,
      total: episodes.length,
      lastPage: 1
    };
  },

  async getStreamLinks(episodeId: string, animeId: string) {
    return [
      {
        id: JSON.stringify({ episodeId, animeId, subType: "soft" }),
        quality: "Auto (Soft Sub)",
        audio: "jpn"
      }
    ];
  },

  async resolveStream(linkId: string) {
    const { episodeId, animeId, subType = "soft" } = JSON.parse(linkId);

    const parts = episodeId.split(':');
    const slug = parts[0];
    const dataId = parts[1];
    let serversParam = parts[2] || "";

    if (!serversParam) {
      console.log(`[Anikoto Capacitor] Fallback: serversParam missing from episodeId. Fetching list...`);
      const resp = await anikotoFetch(`/watch/${animeId}`);
      const html = await resp.text();
      const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
      if (idMatch) {
        const showId = idMatch[1];
        const listResp = await anikotoFetch(`/ajax/episode/list/${showId}`, {
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const listJson = await listResp.json() as any;
        const listHtml = listJson.result || "";
        const tagMatch = new RegExp(`<a[^>]+data-id="${dataId}"[^>]*>`).exec(listHtml);
        if (tagMatch) {
          const idsM = /data-ids="([^"]*)"/.exec(tagMatch[0]);
          if (idsM) serversParam = idsM[1];
        }
      }
    }

    if (!serversParam) {
      throw new Error(`Failed to obtain servers token (data-ids) for episode: ${dataId}`);
    }

    // Ensure we load watch page first to set cookies natively
    await anikotoFetch(`/watch/${animeId}`);

    console.log(`[Anikoto Capacitor] Fetching servers list for episode: ${dataId}`);
    const serversResp = await anikotoFetch(`/ajax/server/list?servers=${encodeURIComponent(serversParam)}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const serversJson = await serversResp.json() as any;
    const serversHtml = serversJson.result || "";

    const types = [];
    const typeRe = /<div class="type"[^>]*>([\s\S]*?)<\/ul>\s*<\/div>/g;
    let typeMatch;
    while ((typeMatch = typeRe.exec(serversHtml)) !== null) {
      const typeHtml = typeMatch[1];
      const labelM = /<label[^>]*>([\s\S]*?)<\/label>/.exec(typeHtml);
      const label = labelM ? labelM[1].replace(/<[^>]+>/g, '').trim() : '';

      const liRe = /<li[^>]+data-link-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g;
      let liMatch;
      const items = [];
      while ((liMatch = liRe.exec(typeHtml)) !== null) {
        items.push({
          linkId: liMatch[1],
          name: liMatch[2].replace(/<[^>]+>/g, '').trim()
        });
      }
      types.push({ label, items });
    }

    const isHardLabel = (labelStr: string) => {
      const l = labelStr.toUpperCase();
      return l.includes("H-SUB") || l.includes("H SUB") || l.includes("HARDSUB") || l.includes("HARD SUB") || l.includes("HSUB");
    };

    const isSoftLabel = (labelStr: string) => {
      const l = labelStr.toUpperCase();
      return l.includes("SUB") && !isHardLabel(labelStr);
    };

    const targetType = types.find(t => {
      return subType === "hard" ? isHardLabel(t.label) : isSoftLabel(t.label);
    });

    let isActualHardSub = false;
    let ajaxLinkId = "";

    if (targetType && targetType.items.length > 0) {
      ajaxLinkId = targetType.items[0].linkId;
      isActualHardSub = isHardLabel(targetType.label);
    }

    if (!ajaxLinkId) {
      if (types.length > 0 && types[0].items.length > 0) {
        ajaxLinkId = types[0].items[0].linkId;
        isActualHardSub = isHardLabel(types[0].label);
      }
    }

    if (!ajaxLinkId) {
      throw new Error(`Failed to find server matching subtitle subtype: ${subType}`);
    }

    console.log(`[Anikoto Capacitor] Resolving player server url browserlessly for linkId: ${ajaxLinkId.substring(0, 20)}...`);
    const serverGetResp = await anikotoFetch(`/ajax/server?get=${encodeURIComponent(ajaxLinkId)}`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const serverGetJson = await serverGetResp.json() as any;
    let iframeUrl = serverGetJson.result?.url || "";
    if (!iframeUrl) throw new Error("Server iframe URL not found in AJAX response");
    console.log(`[Anikoto Capacitor] Found player iframe URL: ${iframeUrl}`);

    // Decode base64 hash if plyr.php or mewcdn
    if (iframeUrl.includes('plyr.php') || iframeUrl.includes('mewcdn.online/player/')) {
      const hashParts = iframeUrl.split('#');
      if (hashParts.length >= 2) {
        try {
          const decodedUrl = atob(hashParts[1]);
          console.log(`[Anikoto Capacitor] Decoded H-SUB stream URL from hash: ${decodedUrl}`);
          return {
            url: decodedUrl,
            subtitles: [],
            intro: serverGetJson?.result?.skip_data?.intro?.end > 0 ? serverGetJson.result.skip_data.intro : undefined,
            outro: serverGetJson?.result?.skip_data?.outro?.end > 0 ? serverGetJson.result.skip_data.outro : undefined
          };
        } catch (err) {
          console.error('[Anikoto Capacitor] Failed to decode base64 hash:', err);
        }
      }
    }

    const megaplayResp = await anikotoFetch(iframeUrl, {
      headers: {
        'Referer': `${ANIKOTO_BASE_URL}/`
      }
    });
    const megaplayHtml = await megaplayResp.text();
    const match = megaplayHtml.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || megaplayHtml.match(/data-id="([^"]+)"/);
    if (!match) {
      throw new Error("Failed to extract data-id from Megaplay iframe HTML");
    }

    const megaplayId = match[1];
    console.log(`[Anikoto Capacitor] Extracted Megaplay player source ID: ${megaplayId}`);

    // getSources lives on the SAME origin as the player iframe; the host rotates
    // (megaplay.buzz → vidtube.site → …) so derive it instead of hardcoding a
    // dead domain (a stale host 302s to an ad and the fetch fails).
    let playerOrigin = "https://megaplay.buzz";
    try { playerOrigin = new URL(iframeUrl).origin; } catch { /* keep default */ }
    const resp = await anikotoFetch(`${playerOrigin}/stream/getSources?id=${megaplayId}`, {
      headers: {
        'Referer': iframeUrl,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const json = await resp.json() as any;

    const streamUrl = json.sources?.file || "";
    const subs = isActualHardSub ? [] : (json.tracks || []).filter((t: any) => t.kind === "captions").map((t: any) => ({
      ...t,
      url: t.file,
      label: t.label || t.name || "English"
    }));

    const intro = json.intro?.end > 0 ? json.intro : (serverGetJson?.result?.skip_data?.intro?.end > 0 ? serverGetJson.result.skip_data.intro : undefined);
    const outro = json.outro?.end > 0 ? json.outro : (serverGetJson?.result?.skip_data?.outro?.end > 0 ? serverGetJson.result.skip_data.outro : undefined);

    return {
      url: streamUrl,
      subtitles: subs,
      intro,
      outro,
      // Player origin (e.g. https://vidtube.site) — the segment CDN (nekostream)
      // hotlink-checks Referer against this. On Android there's no webRequest
      // header injection, so the HLS loader must send it explicitly.
      referer: playerOrigin,
    };
  }
};
