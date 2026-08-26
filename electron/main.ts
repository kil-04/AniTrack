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
import { IPC } from "../shared/types";
import { flushDirty } from "./services/mal";
import {
  getPaheBaseUrl,
  getAuthorizedPaheRequestHeaders,
} from "./services/providers/animepahe";
import { providerManager } from "./services/providers";
import { registerProviderIpc } from "./ipc/providers";
import { registerAuthIpc } from "./ipc/auth";
import { registerDbIpc } from "./ipc/db";
import { registerDownloadsIpc } from "./ipc/downloads";
import { downloadsDir } from "./services/downloads";
import {
  getAnikotoPlayerOrigin,
  getAnikotoPlayerOriginForUrl,
} from "./services/providers/anikoto";
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

// Strip "Electron/x.y" and the app name from the User-Agent. Cloudflare
// fingerprints the Electron token and challenge-blocks AnimePahe API calls;
// the cf_clearance cookie is also validated against the UA, so the hidden
// challenge window and net.fetch must present the same clean Chrome UA.
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
  const anikotoRules = runtime.providers.anikoto;
  const paheStreamingEnabled = paheRules.enabled && runtime.features.animepaheStreaming;
  const anikotoStreamingEnabled = anikotoRules.enabled && runtime.features.anikotoStreaming;

  const parseRequestUrl = (raw: string) => {
    try {
      const parsed = new URL(raw);
      return { host: parsed.hostname.toLowerCase(), path: parsed.pathname.toLowerCase() };
    } catch {
      return { host: "", path: "" };
    }
  };
  const matchesHostRule = (host: string, rule: string, allowBareFamilyLabels = false) => {
    const value = rule.toLowerCase();
    if (!host || !value) return false;
    if (value.endsWith(".")) return host.startsWith(value);
    if (value.includes(".")) return host === value || host.endsWith(`.${value}`);
    return allowBareFamilyLabels && host.split(".").some((label) => label === value || label.startsWith(`${value}-`));
  };
  const matchesAnyHostRule = (host: string, rules: string[], allowBareFamilyLabels = false) =>
    rules.some((rule) => matchesHostRule(host, rule, allowBareFamilyLabels));
  const hasMediaExtension = (pathname: string, extensions: string[]) =>
    extensions.some((extension) => pathname.endsWith(extension));

  // Derive the current AnimePahe host from settings so domain hops (.pw → .si)
  // don't need a release.
  let paheHost = "animepahe.pw";
  try { paheHost = new URL(getPaheBaseUrl()).hostname; } catch {}

  // Snapshot thumbnails — derive from the current host, plus known historical
  // hosts so old DB references keep working after a domain switch.
  const snapshotHosts = new Set([
    `i.${paheHost}`,
    ...paheRules.baseUrls.map((base) => {
      try { return `i.${new URL(base).hostname.toLowerCase()}`; } catch { return ""; }
    }).filter(Boolean),
    "i.animepahe.ru",
    "i.animepahe.pw",
    "i.animepahe.si",
    "i.animepahe.cx",
  ]);
  // Spoof Referer + Origin on outgoing requests to the stream CDN.
  // NOTE: Electron's webRequest API supports only ONE listener per event per
  // session — registering twice replaces the first listener. Snapshot
  // thumbnail handling therefore lives inside this single handler.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: ["*://*/*"],
    },
    (details, callback) => {
      // Snapshot thumbnails need a Referer from the AnimePahe site.
      const parsedRequest = parseRequestUrl(details.url);
      const urlHost = parsedRequest.host;
      if (snapshotHosts.has(urlHost)) {
        const headers: Record<string, string> = { ...details.requestHeaders as Record<string, string> };
        headers["Referer"] = `https://${paheHost}/`;
        callback({ requestHeaders: headers });
        return;
      }

      const isPaheCdn = paheStreamingEnabled &&
        (matchesAnyHostRule(urlHost, paheRules.streamHostFragments) || urlHost === `cdn.${paheHost}`);

      const isKwik = paheStreamingEnabled &&
        matchesAnyHostRule(urlHost, paheRules.streamHostFragments.filter((rule) => rule.startsWith("kwik.")));

      const apiHosts = [
        "myanimelist.net", "malsync.moe", "anilist.co",
        ...anikotoRules.baseUrls.map((base) => new URL(base).hostname),
        ...paheRules.baseUrls.map((base) => new URL(base).hostname),
      ];
      const isApiHost = apiHosts.some((host) => urlHost === host || urlHost.endsWith(`.${host}`));

      // Megaplay / Kiwi-Stream rotating CDN domains
      const mappedPlayerOrigin = getAnikotoPlayerOriginForUrl(details.url);
      const isMegaplayStream =
        anikotoStreamingEnabled && !isApiHost && (
          Boolean(mappedPlayerOrigin) ||
          matchesAnyHostRule(urlHost, anikotoRules.streamHostFragments, true) ||
          parsedRequest.path.includes("/anime/") ||
          parsedRequest.path.includes("subtitles") ||
          parsedRequest.path.includes("/public/stream/") ||
          (Boolean(getAnikotoPlayerOrigin()) && hasMediaExtension(parsedRequest.path, anikotoRules.mediaExtensions))
        );

      if (isPaheCdn || isKwik || isMegaplayStream) {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(details.requestHeaders)) {
          if (k.toLowerCase() === "origin") continue;

          // Cloudflare WAF bypass: Spoof Client Hints to hide Electron
          if (k.toLowerCase() === "sec-ch-ua") {
            headers[k] = '"Google Chrome";v="120", "Chromium";v="120", "Not_A Brand";v="8"';
            continue;
          }
          if (k.toLowerCase() === "sec-ch-ua-mobile") {
            headers[k] = "?0";
            continue;
          }
          if (k.toLowerCase() === "sec-ch-ua-platform") {
            headers[k] = '"Windows"';
            continue;
          }

          headers[k] = v as string;
        }

        if (isMegaplayStream) {
          // The Anikoto player host rotates (megaplay.buzz → vidtube.site → …)
          // and so do its segment CDNs (mewstream.buzz, nekostream.site, …).
          // These CDNs hotlink-check Referer against the player iframe that
          // embedded the stream — which we captured at resolve time. Use it so
          // the spoofed Referer stays correct across domain hops; fall back to
          // per-family defaults if no resolve has happened yet this session.
          const playerOrigin = mappedPlayerOrigin || getAnikotoPlayerOrigin();
          if (playerOrigin) {
            headers["Referer"] = playerOrigin + "/";
            headers["Origin"] = playerOrigin;
          } else if (details.url.includes("mewcdn") || details.url.includes("mewstream") || details.url.includes("vibeplayer") || details.url.includes("vibe")) {
            headers["Referer"] = "https://mewcdn.online/";
            headers["Origin"] = "https://mewcdn.online";
          } else {
            headers["Referer"] = "https://megaplay.buzz/";
            headers["Origin"] = "https://megaplay.buzz";
          }
        } else {
          const authorization = getAuthorizedPaheRequestHeaders(details.url);
          const kwikOrigin = authorization?.referer || "https://kwik.cx";
          headers["Referer"] = kwikOrigin + "/";
          headers["Origin"] = kwikOrigin;
          // Cookies are intentionally copied across origins for AnimePahe's
          // hotlink protection, but only to a concrete stream host captured
          // from a successful resolver result — never merely to a broad rule.
          if (authorization?.cookie) headers["Cookie"] = authorization.cookie;
        }

        callback({ requestHeaders: headers });
      } else {
        callback({ requestHeaders: details.requestHeaders });
      }
    },
  );

  // Inject CORS headers into CDN responses for hls.js.
  session.defaultSession.webRequest.onHeadersReceived(
    {
      urls: ["*://*/*"],
    },
    (details, callback) => {
      const parsedRequest = parseRequestUrl(details.url);
      const isPaheCdn = paheStreamingEnabled &&
        (matchesAnyHostRule(parsedRequest.host, paheRules.streamHostFragments) ||
          parsedRequest.host === `cdn.${paheHost}`);

      const apiHosts = [
        "myanimelist.net", "malsync.moe", "anilist.co",
        ...anikotoRules.baseUrls.map((base) => new URL(base).hostname),
        ...paheRules.baseUrls.map((base) => new URL(base).hostname),
      ];
      const isApiHost = apiHosts.some((host) => parsedRequest.host === host || parsedRequest.host.endsWith(`.${host}`));

      const mappedPlayerOrigin = getAnikotoPlayerOriginForUrl(details.url);
      const isMegaplayStream =
        anikotoStreamingEnabled && !isApiHost && (
          Boolean(mappedPlayerOrigin) ||
          matchesAnyHostRule(parsedRequest.host, anikotoRules.streamHostFragments, true) ||
          parsedRequest.path.includes("/anime/") ||
          parsedRequest.path.includes("subtitles") ||
          parsedRequest.path.includes("/public/stream/") ||
          (Boolean(getAnikotoPlayerOrigin()) && hasMediaExtension(parsedRequest.path, anikotoRules.mediaExtensions))
        );

      if (isPaheCdn || isMegaplayStream) {
        const headers: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(details.responseHeaders ?? {})) {
          if (k.toLowerCase().startsWith("access-control-")) continue;
          headers[k] = Array.isArray(v) ? v : [v as string];
        }
        headers["Access-Control-Allow-Origin"] = ["*"];
        headers["Access-Control-Allow-Methods"] = ["GET, HEAD, OPTIONS"];
        headers["Access-Control-Allow-Headers"] = ["*"];
        headers["Access-Control-Expose-Headers"] = ["*"];
        callback({ responseHeaders: headers });
      } else {
        callback({ responseHeaders: details.responseHeaders });
      }
    },
  );
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
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
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
  subscribeRuntimeConfig((configStatus) => {
    sendToRenderer("automation:status", configStatus);
    providerManager.notifyConfigChanged();
    // Electron permits one listener per webRequest event. Re-registering here
    // atomically replaces both handlers with rules from the new revision.
    registerWebRequestHandlers();
  });

  // Serve offline downloads: anitrack-dl://d/<folder>/<file> → userData/anitrack_downloads/<folder>/<file>
  protocol.handle("anitrack-dl", async (req) => {
    try {
      const u = new URL(req.url);
      const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
      const root = path.resolve(downloadsDir());
      const filePath = path.resolve(root, rel);
      const relative = path.relative(root, filePath);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
        return new Response("", { status: 404 });
      }
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
      return new Response(fs.readFileSync(filePath), {
        headers: { "Content-Type": type, "Access-Control-Allow-Origin": "*" },
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
      ? path.join(__dirname, "../../build/icon.ico")
      : path.join(process.resourcesPath, "icon.ico"),
    path.join(__dirname, "../../build/icon.ico"),
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
