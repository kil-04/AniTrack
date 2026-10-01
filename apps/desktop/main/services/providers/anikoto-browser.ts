import { BrowserWindow, session } from "electron";
import type { StreamData } from "./types";
import { anikotoBaseUrl } from "./anikoto-config";
import { createAnikotoTransport } from "./anikoto-transport";

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

interface AnikotoWindowState {
  window: BrowserWindow;
  base: string;
  initialization: Promise<BrowserWindow> | null;
  idleTimer: NodeJS.Timeout | null;
}
let currentWindow: AnikotoWindowState | null = null;

function closeAnikotoWindow(state: AnikotoWindowState, destroy = true) {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = null;
  // A closed old window must never clear a replacement window's state.
  if (currentWindow === state) currentWindow = null;
  if (destroy && !state.window.isDestroyed()) state.window.destroy();
}

function resetAnikotoTimeout(state: AnikotoWindowState) {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => closeAnikotoWindow(state), 120_000);
}

export function getAnikotoWindow(): Promise<BrowserWindow> {
  const base = anikotoBaseUrl();
  if (currentWindow && (currentWindow.base !== base || currentWindow.window.isDestroyed())) {
    closeAnikotoWindow(currentWindow);
  }
  if (currentWindow?.initialization) {
    resetAnikotoTimeout(currentWindow);
    return currentWindow.initialization;
  }
  const window = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: "persist:anikoto",
    },
  });

  const state: AnikotoWindowState = { window, base, initialization: null, idleTimer: null };
  currentWindow = state;
  state.initialization = new Promise<BrowserWindow>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Anikoto homepage did not load in time")), 15_000);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error || currentWindow !== state || window.isDestroyed()) {
        closeAnikotoWindow(state);
        reject(error ?? new Error("Anikoto window closed during initialization"));
      } else {
        resolve(window);
      }
    }
    window.once("closed", () => {
      closeAnikotoWindow(state, false);
      finish(new Error("Anikoto window closed during initialization"));
    });
    void window.loadURL(`${base}/`).then(
      () => finish(),
      () => finish(new Error("Unable to load Anikoto homepage")),
    );
  });
  resetAnikotoTimeout(state);
  return state.initialization;
}

export function prewarmAnikoto(): void {
  session.fromPartition("persist:anikoto");
}

// Ordinary public/session requests should not wait for a hidden homepage or
// rotate through identities/origins when a server rejects them.
export const anikotoFetch = createAnikotoTransport((url, options) =>
  session.fromPartition("persist:anikoto").fetch(url, options));
