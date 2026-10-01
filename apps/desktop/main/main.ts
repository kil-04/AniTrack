import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  session,
  Tray,
  Menu,
  nativeImage,
  shell,
} from "electron";
import path from "node:path";
import fs from "node:fs";
import { Readable } from "node:stream";
import { IPC } from "../../../packages/shared/types";
import { flushDirty } from "./services/mal";
import {
  getPaheBaseUrl,
  getAuthorizedPaheRequestHeaders,
} from "./services/providers/animepahe";
import { providerManager } from "./services/providers";
import { getResolvedStreamAuthorization } from "./services/providers/stream-authorization";
import { registerProviderIpc } from "./ipc/providers";
import { registerAuthIpc } from "./ipc/auth";
import { registerDbIpc } from "./ipc/db";
import { registerDownloadsIpc } from "./ipc/downloads";
import { downloadsDir } from "./services/downloads";
import {
  getRuntimeConfig,
  getRuntimeConfigStatus,
  initRuntimeConfig,
  refreshRuntimeConfig,
  subscribeRuntimeConfig,
} from "./services/remote-config";
import {
  checkForDesktopUpdates,
  getDesktopUpdateState,
  initDesktopUpdater,
  installDesktopUpdate,
  stopDesktopUpdater,
} from "./services/updater";

const isDev = process.env.NODE_ENV === "development";

// Disable Chromium Sandbox to prevent EXCEPTION_BREAKPOINT (0x80000003) crashes on certain Windows setups.
app.commandLine.appendSwitch("no-sandbox");

// Use the same Chromium identity for provider windows and network requests.
// Do not claim a different Chrome version through hard-coded client hints.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/[\d.]+/i, "")
  .replace(/\s?anitrack\/[\d.]+/i, "");

let mainWindow: BrowserWindow | null = null;
let malFlushTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
let isQuitting = false;

function sendToRenderer(channel: string, payload?: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Web request interceptors — installed once at startup, re-installed when the
// AnimePahe base URL changes (so the snapshot/CDN host derivations stay current).
function registerWebRequestHandlers() {
  const runtime = getRuntimeConfig();
  const paheRules = runtime.providers.animepahe;
  const paheEnabled = paheRules.enabled && runtime.features.animepaheStreaming;
  let paheHost = "animepahe.pw";
  try { paheHost = new URL(getPaheBaseUrl()).hostname; } catch {}
  const snapshotHosts = new Set([
    `i.${paheHost}`,
    ...paheRules.baseUrls.map((base) => {
      try { return `i.${new URL(base).hostname.toLowerCase()}`; } catch { return ""; }
    }).filter(Boolean),
    "i.animepahe.ru", "i.animepahe.pw", "i.animepahe.si", "i.animepahe.cx",
  ]);

  const authorizationFor = (url: string) => {
    const resolved = getResolvedStreamAuthorization(url);
    if (resolved) return resolved;
    const pahe = paheEnabled ? getAuthorizedPaheRequestHeaders(url) : null;
    if (!pahe) return null;
    return {
      headers: {
        Referer: `${pahe.referer}/`, Origin: pahe.referer,
        ...(pahe.cookie ? { Cookie: pahe.cookie } : {}),
      } as Record<string, string>,
      cors: true,
    };
  };

  // Electron permits one listener per session event. Keep thumbnails and
  // per-stream credentials together; never use the last resolved player's
  // origin for unrelated media sharing a CDN or a .m3u8 extension.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ["*://*/*"] }, (details, callback) => {
    const headers: Record<string, string> = { ...details.requestHeaders as Record<string, string> };
    let host = "";
    try { host = new URL(details.url).hostname.toLowerCase(); } catch {}
    const overrides = authorizationFor(details.url)?.headers
      ?? (snapshotHosts.has(host) ? { Referer: `https://${paheHost}/` } : null);
    if (overrides) {
      for (const [name, value] of Object.entries(overrides)) {
        for (const existing of Object.keys(headers)) {
          if (existing.toLowerCase() === name.toLowerCase()) delete headers[existing];
        }
        headers[name] = value;
      }
    }
    callback({ requestHeaders: headers });
  });

  session.defaultSession.webRequest.onHeadersReceived({ urls: ["*://*/*"] }, (details, callback) => {
    if (!authorizationFor(details.url)?.cors) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers: Record<string, string[]> = {};
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      if (!name.toLowerCase().startsWith("access-control-")) {
        headers[name] = Array.isArray(value) ? value : [value as string];
      }
    }
    headers["Access-Control-Allow-Origin"] = ["*"];
    headers["Access-Control-Allow-Methods"] = ["GET, HEAD, OPTIONS"];
    headers["Access-Control-Allow-Headers"] = ["*"];
    headers["Access-Control-Expose-Headers"] = ["*"];
    callback({ responseHeaders: headers });
  });
}

// Allow our app to be the default handler for anitrack:// URLs.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("anitrack", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("anitrack");
}

// Privileged scheme for serving offline downloads to the in-app hls.js player.
// Must be registered before app `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "anitrack-dl",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true },
  },
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b0b0f",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  // Keep the trusted window on its own origin. The preload re-injects window.api on
  // every load, so any navigation to a remote page would hand a remote origin the
  // full IPC bridge. Block off-origin navigations + new windows (open them in the
  // user's browser instead). Internal React Router uses history/pushState, which
  // doesn't trigger will-navigate, so app routing is unaffected.
  const isAppOrigin = (u: string) =>
    isDev ? u.startsWith("http://localhost:5173") : u.startsWith("file://");
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!isAppOrigin(url)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.webContents.send("app:window-hidden");
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

// Single-instance lock so the OAuth callback always reaches the running app.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    // Windows: callback URL arrives as the last argv entry.
    const cbUrl = argv.find((a) => a.startsWith("anitrack://"));
    if (cbUrl) handleProtocolUrl(cbUrl);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

app.on("open-url", (e, url) => {
  e.preventDefault();
  handleProtocolUrl(url);
});

function handleProtocolUrl(_url: string) {
  // Custom protocol callback is no longer used — auth is handled via
  // the in-app BrowserWindow approach in mal.ts.
}

app.whenReady().then(async () => {
  // Load a previously verified automation config first, then make one bounded
  // refresh attempt before providers and request interception are initialized.
  await initRuntimeConfig();
  registerWebRequestHandlers();
  let appliedRuntimeRevision = getRuntimeConfig().revision;
  subscribeRuntimeConfig((configStatus) => {
    sendToRenderer("automation:status", configStatus);
    if (configStatus.revision !== appliedRuntimeRevision) {
      appliedRuntimeRevision = configStatus.revision;
      providerManager.notifyConfigChanged();
      // Electron permits one listener per webRequest event. Re-register only
      // for a genuinely new signed revision; a 304/error status must not clear
      // credentials from a stream that is currently playing.
      registerWebRequestHandlers();
    }
  });

  // Serve offline downloads: anitrack-dl://d/<folder>/<file> → userData/anitrack_downloads/<folder>/<file>
  protocol.handle("anitrack-dl", async (req) => {
    try {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
      const root = path.resolve(downloadsDir());
      const filePath = path.resolve(root, rel);
      const relative = path.relative(root, filePath);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return new Response("", { status: 404 });
      }
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat?.isFile()) return new Response("", { status: 404 });
      const ext = path.extname(filePath).toLowerCase();
      const type = ext === ".m3u8" ? "application/vnd.apple.mpegurl"
        : ext === ".vtt" ? "text/vtt"
        : ext === ".ts" ? "video/mp2t"
        : ext === ".m4s" ? "video/iso.segment"
        : ext === ".mp4" ? "video/mp4"
        : ext === ".aac" ? "audio/aac"
        : ext === ".mp3" ? "audio/mpeg"
        : ext === ".key" ? "application/octet-stream"
        : "application/octet-stream";
      // Stream rather than readFileSync: multi-MB segments must not block the
      // main process (and every IPC call) while offline playback buffers.
      return new Response(Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream, {
        headers: { "Content-Type": type, "Content-Length": String(stat.size), "Access-Control-Allow-Origin": "*" },
      });
    } catch {
      return new Response("", { status: 500 });
    }
  });

  registerIpc();
  createWindow();

  // System tray — keep the app alive when the window is closed.
  // In production the icon is copied to resources/ via extraResources.
  const iconCandidates = [
    isDev
      ? path.join(app.getAppPath(), "apps", "desktop", "build", "icon.ico")
      : path.join(process.resourcesPath, "icon.ico"),
    path.join(app.getAppPath(), "apps", "desktop", "build", "icon.ico"),
    path.join(process.resourcesPath ?? "", "icon.ico"),
  ];
  let trayIcon = nativeImage.createEmpty();
  for (const candidate of iconCandidates) {
    if (!candidate) continue;
    const img = nativeImage.createFromPath(candidate);
    if (!img.isEmpty()) { trayIcon = img; break; }
  }
  tray = new Tray(trayIcon);
  tray.setToolTip("AniTrack");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Show AniTrack",
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) createWindow();
          else { mainWindow.show(); mainWindow.focus(); }
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => { isQuitting = true; app.quit(); },
      },
    ]),
  );
  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else if (mainWindow.isVisible()) mainWindow.focus();
    else mainWindow.show();
  });

  // Pre-warm the AnimePahe hidden window so the Cloudflare session is
  // established before the user opens a show detail page.
  providerManager.prewarmAll();

  initDesktopUpdater(sendToRenderer);

  // Background flush of dirty list entries to MAL every 30s.
  malFlushTimer = setInterval(() => {
    if (getRuntimeConfig().features.malSync) {
      flushDirty().catch((e) => console.warn("MAL flush failed", e));
    }
  }, 30_000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopDesktopUpdater();
  // Move CWD away from the install directory so autoInstallOnAppQuit
  // doesn't fail with a directory lock when the NSIS installer runs.
  if (process.platform === "win32") {
    try { process.chdir(app.getPath("temp")); } catch {}
  }
  // Destroy the hidden AnimePahe BrowserWindow (and any others) so their
  // file handles on DLLs inside the install dir are released.
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.destroy(); } catch {}
  }
  if (tray) { try { tray.destroy(); } catch {} tray = null; }
});

app.on("window-all-closed", () => {
  // Keep the app running in the tray on Windows; only quit when explicitly requested.
  if (isQuitting) {
    if (malFlushTimer) clearInterval(malFlushTimer);
    if (process.platform !== "darwin") app.quit();
  }
});

// ----------------- IPC handlers -----------------

function registerIpc() {
  const getMainWindow = () => mainWindow;

  registerAuthIpc(getMainWindow);
  registerDbIpc(getMainWindow);
  registerProviderIpc(registerWebRequestHandlers);
  registerDownloadsIpc(getMainWindow);

  ipcMain.handle(IPC.UPDATE_CHECK, () => checkForDesktopUpdates(true));
  ipcMain.handle(IPC.UPDATE_STATUS, () => getDesktopUpdateState());
  ipcMain.handle(IPC.UPDATE_INSTALL, () => {
    if (getDesktopUpdateState().phase !== "ready") return false;
    isQuitting = true;
    if (malFlushTimer) { clearInterval(malFlushTimer); malFlushTimer = null; }
    if (process.platform === "win32") {
      try { process.chdir(app.getPath("temp")); } catch {}
    }
    return installDesktopUpdate();
  });
  ipcMain.handle(IPC.AUTOMATION_STATUS, () => getRuntimeConfigStatus());
  ipcMain.handle(IPC.AUTOMATION_REFRESH, () => refreshRuntimeConfig());
}
