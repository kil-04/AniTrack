import { BrowserWindow, net, session } from "electron";
import type { StreamData } from "./types";
import {
  anikotoBaseUrl,
  anikotoBases,
  selectAnikotoBase,
} from "./anikoto-config";

// Origin of the player iframe that served the most-recently-resolved stream
// (e.g. https://vidtube.site). The segment CDNs (mewstream.buzz, nekostream.site)
// hotlink-check Referer against this embedding player, and it rotates — so we
// capture it at resolve time and main.ts reads it via getAnikotoPlayerOrigin()
// to spoof the correct Referer/Origin on CDN requests.
let _lastPlayerOrigin = "";
export function getAnikotoPlayerOrigin(): string { return _lastPlayerOrigin; }
const streamOrigins = new Map<string, { origin: string; expiresAt: number }>();

export function rememberAnikotoStreamOrigin(data: StreamData, playerOrigin: string) {
  _lastPlayerOrigin = playerOrigin;
  const expiresAt = Date.now() + 45 * 60 * 1000;
  if (streamOrigins.size >= 100) {
    const now = Date.now();
    for (const [host, value] of streamOrigins) {
      if (value.expiresAt <= now) streamOrigins.delete(host);
    }
    while (streamOrigins.size >= 100) {
      const oldest = streamOrigins.keys().next().value;
      if (oldest === undefined) break;
      streamOrigins.delete(oldest);
    }
  }
  for (const candidate of [data.url, ...(data.subtitles ?? []).map((track: any) => track.file ?? track.src ?? "")]) {
    try { streamOrigins.set(new URL(candidate).hostname.toLowerCase(), { origin: playerOrigin, expiresAt }); } catch {}
  }
}

export function getAnikotoPlayerOriginForUrl(url: string): string {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return ""; }
  const mapped = streamOrigins.get(host);
  if (!mapped) return "";
  if (mapped.expiresAt <= Date.now()) {
    streamOrigins.delete(host);
    return "";
  }
  return mapped.origin;
}

let _anikotoWin: BrowserWindow | null = null;
let _anikotoReady = false;
let _anikotoReadyPromise: Promise<void> | null = null;
let _anikotoTimeout: NodeJS.Timeout | null = null;

function resetAnikotoWindow() {
  if (_anikotoWin && !_anikotoWin.isDestroyed()) _anikotoWin.destroy();
  _anikotoWin = null;
  _anikotoReady = false;
  _anikotoReadyPromise = null;
}

function activateAnikotoBase(base: string) {
  if (selectAnikotoBase(base)) resetAnikotoWindow();
}

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
  const baseUrl = anikotoBaseUrl();
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
    _anikotoWin!.loadURL(baseUrl + "/");
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

export async function anikotoFetch(url: string, options: any = {}): Promise<any> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(options.headers || {})
  };

  const bases = anikotoBases();
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch {}
  const providerRequest = parsed ? bases.includes(parsed.origin) : false;
  const orderedBases = providerRequest
    ? [anikotoBaseUrl(), ...bases.filter((base) => base !== anikotoBaseUrl())]
    : [""];
  let lastResponse: any = null;
  let lastError: unknown = null;
  for (const candidateBase of orderedBases) {
    const candidateUrl = providerRequest && parsed
      ? `${candidateBase}${parsed.pathname}${parsed.search}${parsed.hash}`
      : url;
    if (providerRequest) activateAnikotoBase(candidateBase);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await getAnikotoWindow();
        const candidateHeaders = { ...headers } as Record<string, string>;
        for (const [name, value] of Object.entries(candidateHeaders)) {
          if (name.toLowerCase() !== "referer") continue;
          try {
            const referer = new URL(value);
            if (bases.includes(referer.origin) && providerRequest) {
              candidateHeaders[name] = `${candidateBase}${referer.pathname}${referer.search}${referer.hash}`;
            }
          } catch {}
        }
        const resp = await (net.fetch as any)(candidateUrl, {
          ...options,
          session: session.fromPartition("persist:anikoto"),
          headers: candidateHeaders,
        });
        lastResponse = resp;
        if (resp.ok) return resp;
        const retryable = resp.status === 403 || resp.status === 429 || resp.status === 503;
        if (attempt === 0 && retryable) {
          console.log(`[Anikoto] ${candidateBase || "stream host"} returned ${resp.status}; refreshing session.`);
          resetAnikotoWindow();
          continue;
        }
        if (!providerRequest || (resp.status < 500 && !retryable && resp.status !== 404)) return resp;
        break;
      } catch (error) {
        lastError = error;
        resetAnikotoWindow();
        if (attempt === 0) continue;
        break;
      }
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("Every signed Anikoto origin failed");
}
