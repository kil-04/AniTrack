import { BrowserWindow, net, session } from "electron";
import { StreamProvider, AnimeInfo, EpisodeInfo, StreamLink, StreamData } from "./types";

const BASE_URL = "https://anikoto.cz";

let _anikotoWin: BrowserWindow | null = null;
let _anikotoReady = false;
let _anikotoReadyPromise: Promise<void> | null = null;

export function getAnikotoWindow(): Promise<BrowserWindow> {
  if (_anikotoWin && !_anikotoWin.isDestroyed() && _anikotoReady) {
    return Promise.resolve(_anikotoWin);
  }
  if (_anikotoReadyPromise && _anikotoWin && !_anikotoWin.isDestroyed()) {
    return _anikotoReadyPromise.then(() => _anikotoWin!);
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

  return _anikotoReadyPromise.then(() => _anikotoWin!);
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
      console.log(`[Anikoto] Fetch failed with status \${resp.status}. Refreshing session...`);
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

export class AnikotoProvider implements StreamProvider {
  id = "anikoto";
  name = "Anikoto";

  private episodesCache = new Map<string, { episodes: EpisodeInfo[]; total: number; timestamp: number }>();
  private readonly EPISODES_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private episodesPending = new Map<string, Promise<{ data: EpisodeInfo[]; total: number; lastPage: number }>>();

  private resolveCache = new Map<string, { data: StreamData; timestamp: number }>();
  private readonly RESOLVE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  private resolvePending = new Map<string, Promise<StreamData>>();

  async search(query: string): Promise<AnimeInfo[]> {
    const resp = await anikotoFetch(`${BASE_URL}/filter?keyword=${encodeURIComponent(query)}`);
    if (!resp.ok) return [];
    const html = await resp.text();
    
    const results: AnimeInfo[] = [];
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
        year: parsedYear,
      });
    }
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

      // Cache episodes
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
    promise.finally(() => this.episodesPending.delete(animeId));
    return promise;
  }

  async getStreamLinks(episodeId: string, animeId: string): Promise<StreamLink[]> {
    return [
      {
        id: JSON.stringify({ episodeId, animeId, subType: "soft" }),
        quality: "Auto (Soft Sub)",
        audio: "jpn"
      }
    ];
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

      // Find best server matching subtype selection
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
        // Fallback: take first available
        if (types.length > 0 && types[0].items.length > 0) {
          ajaxLinkId = types[0].items[0].linkId;
          isActualHardSub = isHardLabel(types[0].label);
        }
      }

      if (!ajaxLinkId) {
        throw new Error(`Failed to find server matching subtitle subtype: ${subType}`);
      }

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

      if (!iframeUrl) {
        // Fetch the actual server iframe URL browserlessly
        console.log(`[Anikoto] Resolving player server url browserlessly for linkId: ${ajaxLinkId.substring(0, 20)}...`);
        const serverGetResp = await anikotoFetch(`${BASE_URL}/ajax/server?get=${encodeURIComponent(ajaxLinkId)}`, {
          headers: {
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        if (!serverGetResp.ok) throw new Error(`Failed to fetch server iframe URL: status ${serverGetResp.status}`);
        serverGetJson = (await serverGetResp.json()) as any;
        iframeUrl = serverGetJson.result?.url || "";
        if (!iframeUrl) throw new Error("Server iframe URL not found in AJAX response");
        console.log(`[Anikoto] Found player iframe URL: ${iframeUrl}`);
      }

      // H-SUB encoding from hash
      if (iframeUrl.includes('plyr.php') || iframeUrl.includes('mewcdn.online/player/')) {
        const parts = iframeUrl.split('#');
        if (parts.length >= 2) {
          try {
            const decodedUrl = Buffer.from(parts[1], 'base64').toString('utf-8');
            console.log(`[Anikoto] Decoded H-SUB stream URL from hash: ${decodedUrl}`);
            const result = {
              url: decodedUrl,
              subtitles: [],
              intro: serverGetJson?.result?.skip_data?.intro?.end > 0 ? serverGetJson.result.skip_data.intro : undefined,
              outro: serverGetJson?.result?.skip_data?.outro?.end > 0 ? serverGetJson.result.skip_data.outro : undefined
            };
            this.resolveCache.set(linkId, { data: result, timestamp: Date.now() });
            return result;
          } catch (err) {
            console.error('[Anikoto] Failed to decode base64 hash:', err);
          }
        }
      }

      // Extract Megaplay ID by fetching the player iframe page HTML
      const megaplayResp = await anikotoFetch(iframeUrl, {
        headers: {
          'Referer': `${BASE_URL}/`
        }
      });
      if (!megaplayResp.ok) {
        throw new Error(`Failed to fetch Megaplay iframe: status ${megaplayResp.status}`);
      }

      const megaplayHtml = await megaplayResp.text();
      const match = megaplayHtml.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || megaplayHtml.match(/data-id="([^"]+)"/);
      if (!match) {
        throw new Error("Failed to extract data-id from Megaplay iframe HTML");
      }
      
      const megaplayId = match[1];
      console.log(`[Anikoto] Extracted Megaplay player source ID: ${megaplayId}`);

      // REST API call to fetch sources directly
      const resp = await anikotoFetch(`https://megaplay.buzz/stream/getSources?id=${megaplayId}`, {
        headers: {
          'Referer': iframeUrl,
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      if (!resp.ok) throw new Error(`Megaplay getSources failed: status ${resp.status}`);
      const json = (await resp.json()) as any;
      
      const streamUrl = json.sources?.file || "";
      if (!streamUrl) {
        throw new Error("Failed to extract Megaplay stream URL from sources JSON");
      }
      const subs = isActualHardSub ? [] : (json.tracks || []).filter((t: any) => t.kind === "captions");
      
      // Use skip_data from server endpoint if getSources doesn't contain it
      const intro = json.intro?.end > 0 ? json.intro : (serverGetJson?.result?.skip_data?.intro?.end > 0 ? serverGetJson.result.skip_data.intro : undefined);
      const outro = json.outro?.end > 0 ? json.outro : (serverGetJson?.result?.skip_data?.outro?.end > 0 ? serverGetJson.result.skip_data.outro : undefined);

      const result = {
        url: streamUrl,
        subtitles: subs,
        intro,
        outro
      };

      this.resolveCache.set(linkId, { data: result, timestamp: Date.now() });
      return result;
    })();

    this.resolvePending.set(linkId, promise);
    promise.finally(() => this.resolvePending.delete(linkId));
    return promise;
  }
}
