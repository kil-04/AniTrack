import { BrowserWindow, net, session } from "electron";
import { StreamProvider, AnimeInfo, EpisodeInfo, StreamLink, StreamData } from "./types";

const BASE_URL = "https://anikototv.to";

// Origin of the player iframe that served the most-recently-resolved stream
// (e.g. https://vidtube.site). The segment CDNs (mewstream.buzz, nekostream.site)
// hotlink-check Referer against this embedding player, and it rotates — so we
// capture it at resolve time and main.ts reads it via getAnikotoPlayerOrigin()
// to spoof the correct Referer/Origin on CDN requests.
let _lastPlayerOrigin = "";
export function getAnikotoPlayerOrigin(): string { return _lastPlayerOrigin; }

let _anikotoWin: BrowserWindow | null = null;
let _anikotoReady = false;
let _anikotoReadyPromise: Promise<void> | null = null;
let _anikotoTimeout: NodeJS.Timeout | null = null;

function resetAnikotoTimeout() {
  if (_anikotoTimeout) {
    clearTimeout(_anikotoTimeout);
  }
  _anikotoTimeout = setTimeout(() => {
    if (_anikotoWin && !_anikotoWin.isDestroyed()) {
      console.log("[Anikoto] Destroying idle prewarmed window to save memory");
      _anikotoWin.destroy();
    }
    _anikotoWin = null;
    _anikotoReady = false;
    _anikotoReadyPromise = null;
    _anikotoTimeout = null;
  }, 120_000); // 2 minutes
}

export function getAnikotoWindow(): Promise<BrowserWindow> {
  resetAnikotoTimeout();
  if (_anikotoWin && !_anikotoWin.isDestroyed() && _anikotoReady) {
    return Promise.resolve(_anikotoWin);
  }
  if (_anikotoReadyPromise && _anikotoWin && !_anikotoWin.isDestroyed()) {
    return _anikotoReadyPromise.then(() => {
      if (!_anikotoWin || _anikotoWin.isDestroyed()) throw new Error("Anikoto window closed during init");
      return _anikotoWin;
    });
  }

  _anikotoReady = false;
  _anikotoWin = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: "persist:anikoto",
    },
  });

  _anikotoReadyPromise = new Promise<void>((resolve) => {
    let resolved = false;
    function done() {
      if (resolved) return;
      resolved = true;
      _anikotoReady = true;
      resolve();
    }
    _anikotoWin!.webContents.on("did-finish-load", done);
    setTimeout(done, 15_000);
    _anikotoWin!.loadURL(BASE_URL + "/");
    _anikotoWin!.on("closed", () => {
      _anikotoWin = null;
      _anikotoReady = false;
      _anikotoReadyPromise = null;
    });
  });

  return _anikotoReadyPromise.then(() => {
    if (!_anikotoWin || _anikotoWin.isDestroyed()) throw new Error("Anikoto window closed during init");
    return _anikotoWin;
  });
}

export function prewarmAnikoto(): void {
  getAnikotoWindow().catch(() => {
    /* ignore */
  });
}

async function anikotoFetch(url: string, options: any = {}, retried = false): Promise<any> {
  const win = await getAnikotoWindow();
  const sess = session.fromPartition("persist:anikoto");
  
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(options.headers || {})
  };

  const resp = await (net.fetch as any)(url, {
    ...options,
    session: sess,
    headers
  });

  if (!resp.ok) {
    if (!retried && (resp.status === 403 || resp.status === 503 || resp.status === 429)) {
      console.log(`[Anikoto] Fetch failed with status ${resp.status}. Refreshing session...`);
      if (_anikotoWin && !_anikotoWin.isDestroyed()) {
        _anikotoWin.destroy();
      }
      _anikotoWin = null;
      _anikotoReady = false;
      _anikotoReadyPromise = null;
      return anikotoFetch(url, options, true);
    }
  }
  return resp;
}

// Parse Anikoto's home-page "Top anime" sidebar into day/week/month lists.
export function parseAnikotoTop(html: string): { day: any[]; week: any[]; month: any[] } {
  const out: { day: any[]; week: any[]; month: any[] } = { day: [], week: [], month: [] };
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
  return out;
}

export async function getAnikotoTop(): Promise<{ day: any[]; week: any[]; month: any[] }> {
  try {
    const resp = await anikotoFetch(`${BASE_URL}/home`);
    const html = await resp.text();
    return parseAnikotoTop(html);
  } catch (e) {
    console.warn("[Anikoto] getAnikotoTop failed", e);
    return { day: [], week: [], month: [] };
  }
}

export class AnikotoProvider implements StreamProvider {
  id = "anikoto";
  name = "Anikoto";

  private episodesCache = new Map<string, { episodes: EpisodeInfo[]; total: number; timestamp: number }>();
  private readonly EPISODES_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private episodesPending = new Map<string, Promise<{ data: EpisodeInfo[]; total: number; lastPage: number }>>();

  // MAL id per slug, harvested from the episode list's data-mal attribute.
  // Anikoto entries can be MISLABELED (their "City Hunter" is actually City
  // Hunter '91's episodes) — the embedded MAL id is the only reliable truth,
  // so match verification uses this instead of trusting titles.
  private malIdCache = new Map<string, number | null>();

  private resolveCache = new Map<string, { data: StreamData; timestamp: number }>();
  private readonly RESOLVE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  private resolvePending = new Map<string, Promise<StreamData>>();

  private cacheResolve(linkId: string, data: StreamData) {
    if (this.resolveCache.size >= 200) {
      const firstKey = this.resolveCache.keys().next().value;
      if (firstKey !== undefined) this.resolveCache.delete(firstKey);
    }
    this.resolveCache.set(linkId, { data, timestamp: Date.now() });
  }

  async search(query: string): Promise<AnimeInfo[]> {
    const results: AnimeInfo[] = [];
    
    const fetchPage = async (pageNo: number) => {
      try {
        const resp = await anikotoFetch(`${BASE_URL}/filter?keyword=${encodeURIComponent(query)}&page=${pageNo}`);
        if (!resp.ok) return;
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
          // Anikoto cards also carry per-language availability badges.
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
        console.error(`[Anikoto] Fetching page ${pageNo} failed:`, err);
      }
    };

    await Promise.all([fetchPage(1), fetchPage(2)]);
    return results;
  }

  async getEpisodes(animeId: string, page = 1): Promise<{ data: EpisodeInfo[]; total: number; lastPage: number }> {
    // 1. Check episodes list cache
    const cached = this.episodesCache.get(animeId);
    if (cached && (Date.now() - cached.timestamp < this.EPISODES_CACHE_TTL)) {
      console.log(`[Anikoto] getEpisodes cache HIT for: ${animeId}`);
      return {
        data: cached.episodes,
        total: cached.total,
        lastPage: 1
      };
    }

    // 2. Check in-flight requests deduplication
    if (this.episodesPending.has(animeId)) {
      console.log(`[Anikoto] getEpisodes hit in-flight request deduplication for: ${animeId}`);
      return this.episodesPending.get(animeId)!;
    }

    const promise = (async () => {
      console.log(`[Anikoto] Fetching watch page HTML for showId: ${animeId}`);
      const resp = await anikotoFetch(`${BASE_URL}/watch/${animeId}`);
      if (!resp.ok) throw new Error(`Failed to load watch page: status ${resp.status}`);
      const html = await resp.text();

      // Extract show/anime ID (data-id) from watch page HTML
      const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
      if (!idMatch) throw new Error("Failed to extract anime show ID from watch page HTML");
      const showId = idMatch[1];
      console.log(`[Anikoto] Extracted showId: ${showId} for ${animeId}`);

      // Direct AJAX fetch to get episodes list
      const listResp = await anikotoFetch(`${BASE_URL}/ajax/episode/list/${showId}`, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (!listResp.ok) throw new Error(`Failed to fetch episodes list AJAX: status ${listResp.status}`);
      const listJson = (await listResp.json()) as any;
      const listHtml = listJson.result || "";

      // Harvest the MAL id the episode anchors carry (data-mal) — used to
      // verify search matches against AniList/MAL ids.
      const malM = /data-mal="(\d+)"/.exec(listHtml);
      this.malIdCache.set(animeId, malM ? parseInt(malM[1], 10) : null);

      // Parse episodes from returned HTML using fast regex
      const episodes: EpisodeInfo[] = [];
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
        
        // Extract the server list parameter 'data-ids'
        const idsM = /data-ids="([^"]*)"/.exec(tag);
        const serversParam = idsM ? idsM[1] : "";
        
        const slugStr = `ep-${dataSlug}`;
        // Encode: slug:dataId:serversParam
        const id = `${slugStr}:${dataId}:${serversParam}`;
        
        episodes.push({
          id,
          episodeNumber: parseFloat(num) || 0,
          title
        });
      }

      console.log(`[Anikoto] Parsed ${episodes.length} episodes browserlessly for ${animeId}`);

      // Cache episodes (bounded — evict the oldest entry once full)
      if (this.episodesCache.size >= 200) {
        const firstKey = this.episodesCache.keys().next().value;
        if (firstKey !== undefined) this.episodesCache.delete(firstKey);
      }
      this.episodesCache.set(animeId, {
        episodes,
        total: episodes.length,
        timestamp: Date.now()
      });

      return {
        data: episodes,
        total: episodes.length,
        lastPage: 1
      };
    })();

    this.episodesPending.set(animeId, promise);
    // .catch on the derived chain so a rejected fetch doesn't surface as an
    // unhandled rejection — the caller still receives the original rejection.
    promise.finally(() => this.episodesPending.delete(animeId)).catch(() => {});
    return promise;
  }

  /** External ids for a slug — the MAL id embedded in the episode list. Reuses
   *  the episode fetch (cache + in-flight dedup), so verifying a match costs at
   *  most one episodes load that the player would do anyway. */
  async getAnimeIds(animeId: string): Promise<{ malId?: number; anilistId?: number }> {
    if (!this.malIdCache.has(animeId)) {
      try { await this.getEpisodes(animeId, 1); } catch { /* unreachable page */ }
    }
    const mal = this.malIdCache.get(animeId);
    return mal != null ? { malId: mal } : {};
  }

  async getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]> {
    const parts = episodeId.split(':');
    const serversParam = parts[2] || "";
    if (!serversParam) {
      return [
        {
          id: JSON.stringify({ episodeId, animeId, subType: "soft" }),
          quality: "Auto (Soft Sub)",
          audio: "jpn"
        }
      ];
    }

    try {
      const serversResp = await anikotoFetch(`${BASE_URL}/ajax/server/list?servers=${encodeURIComponent(serversParam)}`, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (!serversResp.ok) throw new Error(`Status ${serversResp.status}`);
      const serversJson = await serversResp.json() as any;
      const serversHtml = serversJson.result || "";

      const labels: string[] = [];
      const labelRe = /<label[^>]*>([\s\S]*?)<\/label>/g;
      let match;
      while ((match = labelRe.exec(serversHtml)) !== null) {
        labels.push(match[1].replace(/<[^>]+>/g, '').trim().toUpperCase());
      }

      const links: StreamLink[] = [];
      
      const hasSub = labels.some(l => l.includes("SUB") && !l.includes("H-SUB") && !l.includes("HSUB") && !l.includes("HARDSUB") && !l.includes("HARD SUB"));
      const hasHSub = labels.some(l => l.includes("H-SUB") || l.includes("HSUB") || l.includes("HARDSUB") || l.includes("HARD SUB"));

      // Dub is intentionally not offered — only soft/hard subs.
      if (hasSub || !hasHSub) {
        links.push({
          id: JSON.stringify({ episodeId, animeId, subType: "soft" }),
          quality: "Auto (Soft Sub)",
          audio: "jpn"
        });
      }
      if (hasHSub) {
        links.push({
          id: JSON.stringify({ episodeId, animeId, subType: "hard" }),
          quality: "Auto (Hard Sub)",
          audio: "jpn"
        });
      }

      return links;
    } catch (err) {
      console.error("[Anikoto] Failed to fetch server options in getStreamLinks:", err);
      return [
        {
          id: JSON.stringify({ episodeId, animeId, subType: "soft" }),
          quality: "Auto (Soft Sub)",
          audio: "jpn"
        }
      ];
    }
  }

  async resolveStream(linkId: string): Promise<StreamData> {
    // 1. Check resolved stream cache
    const cached = this.resolveCache.get(linkId);
    if (cached && (Date.now() - cached.timestamp < this.RESOLVE_CACHE_TTL)) {
      console.log(`[Anikoto] resolveStream cache HIT for: ${linkId}`);
      return cached.data;
    }

    // 2. Check in-flight resolves deduplication
    if (this.resolvePending.has(linkId)) {
      console.log(`[Anikoto] resolveStream hit in-flight request deduplication for: ${linkId}`);
      return this.resolvePending.get(linkId)!;
    }

    const promise = (async () => {
      const { episodeId, animeId, subType = "soft" } = JSON.parse(linkId);

      const parts = episodeId.split(':');
      const slug = parts[0];
      const dataId = parts[1];
      let serversParam = parts[2] || "";

      // Fallback: If serversParam is missing (should not happen in browserless flow), fetch watch page list
      if (!serversParam) {
        console.log(`[Anikoto] Fallback: serversParam missing from episodeId. Fetching list...`);
        const resp = await anikotoFetch(`${BASE_URL}/watch/${animeId}`);
        if (resp.ok) {
          const html = await resp.text();
          const idMatch = html.match(/id="watch-main"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
          if (idMatch) {
            const showId = idMatch[1];
            const listResp = await anikotoFetch(`${BASE_URL}/ajax/episode/list/${showId}`, {
              headers: {
                'X-Requested-With': 'XMLHttpRequest'
              }
            });
            if (listResp.ok) {
              const listJson = await listResp.json() as any;
              const listHtml = listJson.result || "";
              const targetRe = new RegExp(`<a[^>]+data-id="${dataId}"[^>]*>`);
              const tagMatch = targetRe.exec(listHtml);
              if (tagMatch) {
                const idsM = /data-ids="([^"]*)"/.exec(tagMatch[0]);
                if (idsM) {
                  serversParam = idsM[1];
                }
              }
            }
          }
        }
      }

      if (!serversParam) {
        throw new Error(`Failed to obtain servers token (data-ids) for episode: ${dataId}`);
      }

      // Fetch server list AJAX
      console.log(`[Anikoto] Fetching servers list for episode: ${dataId}`);
      const serversResp = await anikotoFetch(`${BASE_URL}/ajax/server/list?servers=${encodeURIComponent(serversParam)}`, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (!serversResp.ok) throw new Error(`Failed to fetch servers list AJAX: status ${serversResp.status}`);
      const serversJson = (await serversResp.json()) as any;
      const serversHtml = serversJson.result || "";

      // Parse types and servers
      const types: { label: string; items: { linkId: string; name: string }[] }[] = [];
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

      const isDubLabel = (labelStr: string) => {
        const l = labelStr.toUpperCase();
        return l.includes("DUB");
      };

      // Find best server matching subtype selection
      const targetType = types.find(t => {
        if (subType === "hard") return isHardLabel(t.label);
        if (subType === "dub") return isDubLabel(t.label);
        return isSoftLabel(t.label);
      });
      
      // Build the ordered list of candidate servers to try. Each sub-type lists
      // several servers (VidPlay, HD, Vidstream, VidCloud, …); the first is often
      // down for a given episode, so we fall through to the next until one yields
      // a playable stream — that flakiness is why soft sub failed on some episodes.
      const chosenType = (targetType && targetType.items.length > 0)
        ? targetType
        : types.find(t => t.items.length > 0);
      if (!chosenType || chosenType.items.length === 0) {
        throw new Error(`Failed to find server matching subtitle subtype: ${subType}`);
      }
      let isActualHardSub = isHardLabel(chosenType.label);
      const candidateLinkIds = chosenType.items.map(it => it.linkId);

      let iframeUrl = "";
      let serverGetJson: any = null;

      if (subType === "hard" && !isActualHardSub) {
        console.log(`[Anikoto] H-SUB not found in AJAX response. Falling back to BrowserWindow resolving...`);
        const win = await getAnikotoWindow();
        
        // Load watch page if not already loaded
        const watchUrl = `${BASE_URL}/watch/${animeId}`;
        const currentUrl = win.webContents.getURL();
        if (!currentUrl.includes(`/watch/${animeId}`)) {
          console.log(`[Anikoto] Browser loading watch page: ${watchUrl}`);
          await win.loadURL(watchUrl);
        }
        
        // Wait for page to be ready and execute interaction script
        console.log(`[Anikoto] Interacting with page to select episode ${dataId} and H-SUB server...`);
        const resolvedIframeUrl = await win.webContents.executeJavaScript(`
          new Promise((resolve, reject) => {
            // 1. Click the episode link
            const epBtn = document.querySelector('.episodes a[data-id="${dataId}"]');
            if (epBtn) {
              epBtn.click();
            } else {
              // Fallback: search by href or text if data-id mismatches
              const allLinks = Array.from(document.querySelectorAll('.episodes a'));
              const matchLink = allLinks.find(a => a.getAttribute('data-id') === "${dataId}" || a.href.includes("/${slug}"));
              if (matchLink) matchLink.click();
            }

            // 2. Wait for servers container
            let attempts = 0;
            const checkServers = () => {
              const servers = document.querySelector('.servers');
              if (servers) {
                const types = Array.from(document.querySelectorAll('.servers .type'));
                const targetType = types.find(t => {
                  const label = t.querySelector('label');
                  const text = label ? label.textContent.trim().toUpperCase() : '';
                  return text.includes("H-SUB") || text.includes("HARDSUB") || text.includes("HARD SUB");
                });

                if (targetType) {
                  const li = targetType.querySelector('ul li[data-link-id]');
                  if (li) {
                    const iframe = document.querySelector('#player iframe');
                    const oldSrc = iframe ? iframe.src : '';
                    
                    // Click H-SUB server!
                    li.click();
                    
                    // Wait for iframe src to change and not be blank
                    let srcAttempts = 0;
                    const waitIframe = () => {
                      const newIframe = document.querySelector('#player iframe');
                      const newSrc = newIframe ? newIframe.src : '';
                      if (newIframe && newSrc && newSrc !== oldSrc && (newSrc.includes('megaplay') || newSrc.includes('plyr.php') || newSrc.includes('mewcdn.online'))) {
                        resolve(newSrc);
                      } else if (srcAttempts < 30) {
                        srcAttempts++;
                        setTimeout(waitIframe, 200);
                      } else {
                        // Return whatever iframe src we have currently
                        resolve(newSrc || oldSrc);
                      }
                    };
                    setTimeout(waitIframe, 100);
                    return;
                  }
                }
                reject(new Error("H-SUB server element not found in DOM"));
              } else if (attempts < 40) {
                attempts++;
                setTimeout(checkServers, 250);
              } else {
                reject(new Error("Servers panel failed to load in DOM"));
              }
            };
            setTimeout(checkServers, 100);
          });
        `).catch(err => {
          console.error("[Anikoto] BrowserWindow resolving error:", err);
          return "";
        });

        if (resolvedIframeUrl) {
          console.log(`[Anikoto] BrowserWindow successfully resolved player URL: ${resolvedIframeUrl}`);
          iframeUrl = resolvedIframeUrl;
          isActualHardSub = true;
        }
      }

      // Resolve a single player iframe → { data, playerOrigin }: either the
      // base64-hash path (plyr.php/mewcdn) or fetch the Megaplay iframe + call
      // getSources. Throws on failure so the caller can try the next server.
      // Returns playerOrigin so the caller sets the global Referer hint to match
      // the CHOSEN stream rather than whichever attempt happened to run last.
      const attempt = async (attIframeUrl: string, attServerGetJson: any): Promise<{ data: StreamData; playerOrigin: string }> => {
        // getSources/segment CDN lives on the SAME origin as the iframe; the host
        // rotates (megaplay.buzz → vidtube.site → …) so derive it rather than
        // hardcode a dead domain (a stale host 302s to an ad → ERR_BLOCKED_BY_CLIENT).
        let playerOrigin = "https://megaplay.buzz";
        try { playerOrigin = new URL(attIframeUrl).origin; } catch { /* keep default */ }

        // H-SUB encoding from hash
        if (attIframeUrl.includes('plyr.php') || attIframeUrl.includes('mewcdn.online/player/')) {
          const parts = attIframeUrl.split('#');
          if (parts.length >= 2) {
            const decodedUrl = Buffer.from(parts[1], 'base64').toString('utf-8');
            console.log(`[Anikoto] Decoded H-SUB stream URL from hash: ${decodedUrl}`);
            return {
              data: {
                url: decodedUrl,
                subtitles: [],
                intro: attServerGetJson?.result?.skip_data?.intro?.end > 0 ? attServerGetJson.result.skip_data.intro : undefined,
                outro: attServerGetJson?.result?.skip_data?.outro?.end > 0 ? attServerGetJson.result.skip_data.outro : undefined,
                referer: playerOrigin,
              },
              playerOrigin,
            };
          }
        }

        // Extract Megaplay ID by fetching the player iframe page HTML.
        const megaplayResp = await anikotoFetch(attIframeUrl, { headers: { 'Referer': `${BASE_URL}/` } });
        if (!megaplayResp.ok) throw new Error(`Failed to fetch Megaplay iframe: status ${megaplayResp.status}`);
        const megaplayHtml = await megaplayResp.text();
        const m = megaplayHtml.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || megaplayHtml.match(/data-id="([^"]+)"/);
        if (!m) throw new Error("Failed to extract data-id from Megaplay iframe HTML");
        const megaplayId = m[1];
        console.log(`[Anikoto] Extracted Megaplay player source ID: ${megaplayId}`);

        const sourcesResp = await anikotoFetch(`${playerOrigin}/stream/getSources?id=${megaplayId}`, {
          headers: { 'Referer': attIframeUrl, 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!sourcesResp.ok) throw new Error(`getSources failed: status ${sourcesResp.status}`);
        const json = (await sourcesResp.json()) as any;
        const streamUrl = json.sources?.file || "";
        if (!streamUrl) throw new Error("Failed to extract Megaplay stream URL from sources JSON");
        console.log(`[Anikoto] Resolved stream URL: ${streamUrl}`);
        const subs = isActualHardSub ? [] : (json.tracks || []).filter((t: any) => t.kind === "captions");
        const intro = json.intro?.end > 0 ? json.intro : (attServerGetJson?.result?.skip_data?.intro?.end > 0 ? attServerGetJson.result.skip_data.intro : undefined);
        const outro = json.outro?.end > 0 ? json.outro : (attServerGetJson?.result?.skip_data?.outro?.end > 0 ? attServerGetJson.result.skip_data.outro : undefined);
        return { data: { url: streamUrl, subtitles: subs, intro, outro, referer: playerOrigin }, playerOrigin };
      };

      let result: StreamData | null = null;

      if (iframeUrl) {
        // The H-SUB BrowserWindow path already produced an iframe — use it directly.
        const a = await attempt(iframeUrl, serverGetJson);
        result = a.data;
        _lastPlayerOrigin = a.playerOrigin;
      } else {
        // Try each server in the matched sub-type until one resolves. The first
        // server is frequently dead for a given episode — that's what made soft
        // sub fail intermittently; falling through to the next fixes it.
        //
        // For soft sub we also prefer a server that returns real caption tracks:
        // a SUB server with no tracks is serving a hard-subbed video, so we keep
        // looking before settling for it — that's why soft sub sometimes showed
        // burned-in (hard) subs.
        let lastErr: any = null;
        let firstResolved: { data: StreamData; playerOrigin: string } | null = null;
        for (const cand of candidateLinkIds) {
          try {
            const serverGetResp = await anikotoFetch(`${BASE_URL}/ajax/server?get=${encodeURIComponent(cand)}`, {
              headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
            if (!serverGetResp.ok) throw new Error(`server iframe status ${serverGetResp.status}`);
            const sgJson = (await serverGetResp.json()) as any;
            const candIframe = sgJson.result?.url || "";
            if (!candIframe) throw new Error("Server iframe URL not found in AJAX response");
            console.log(`[Anikoto] Found player iframe URL: ${candIframe}`);
            const a = await attempt(candIframe, sgJson);
            if (!firstResolved) firstResolved = a;
            // Accept immediately unless we're on soft sub and this stream has no
            // caption tracks (= hard-subbed); in that case keep trying.
            if (subType !== "soft" || (a.data.subtitles && a.data.subtitles.length > 0)) {
              result = a.data;
              _lastPlayerOrigin = a.playerOrigin;
              break;
            }
            console.log(`[Anikoto] Soft-sub server has no caption tracks (hard-subbed); trying next…`);
          } catch (e: any) {
            lastErr = e;
            console.warn(`[Anikoto] server attempt failed (${String(e?.message ?? e)}); trying next…`);
          }
        }
        if (!result && firstResolved) {
          // No soft-sub-with-tracks server found — fall back to the first that resolved.
          result = firstResolved.data;
          _lastPlayerOrigin = firstResolved.playerOrigin;
        }
        if (!result) throw lastErr ?? new Error("All Anikoto servers failed to resolve");
      }

      this.cacheResolve(linkId, result);
      return result;
    })();

    this.resolvePending.set(linkId, promise);
    promise.finally(() => this.resolvePending.delete(linkId)).catch(() => {});
    return promise;
  }
}
