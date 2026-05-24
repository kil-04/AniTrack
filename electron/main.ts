import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  shell,
  net,
  Tray,
  Menu,
  nativeImage,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  addLibraryFolder,
  deleteListEntry,
  dismissFromContinueWatching,
  getAllListEntries,
  getAnime,
  getContinueWatching,
  getContinueWatchingPaged,
  getEpisodesFor,
  getListEntry,
  getProgress,
  getProgressForAnime,
  listLibraryFolders,
  removeLibraryFolder,
  setListEntry,
  setProgress,
  upsertAnime,
} from "./services/db";
import {
  beginAuth,
  disconnect as malDisconnect,
  flushDirty,
  getState,
  getMalClientInfo,
  markEpisodeWatched,
  pullList,
  setMalClientId,
} from "./services/mal";
import { getById, getRelations, searchAnime, trending } from "./services/anilist";
import {
  beginAuth as alBeginAuth,
  disconnect as alDisconnect,
  getState as alGetState,
  pullList as alPullList,
  setClientId as alSetClientId,
  alMarkEpisodeWatched,
} from "./services/anilist-sync";
import { scanAll } from "./services/library";
import { linksFor, openLink } from "./services/legal-sites";
import {
  search as paheSearch,
  getEpisodes as paheEpisodes,
  getStreamLinks as paheLinks,
  getLatestEpisodes as paheLatest,
  getAnimeIds as paheGetIds,
  findByExternalId as paheFindById,
  resolveKwik,
  prefetchKwik,
  prewarm as pahePrewarm,
  getKwikCookies,
  getPaheBaseUrl,
  setPaheBaseUrl,
} from "./services/animepahe";
import { IPC } from "../shared/types";
import { autoUpdater } from "electron-updater";

const isDev = process.env.NODE_ENV === "development";
let mainWindow: BrowserWindow | null = null;
let malFlushTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Web request interceptors — installed once at startup, re-installed when the
// AnimePahe base URL changes (so the snapshot/CDN host derivations stay current).
function registerWebRequestHandlers() {
  // Derive the current AnimePahe host from settings so domain hops (.pw → .si)
  // don't need a release.
  let paheHost = "animepahe.pw";
  try { paheHost = new URL(getPaheBaseUrl()).hostname; } catch {}

  // CDN domains that serve the actual video segments/manifests.
  // AnimePahe rotates between several CDN backends — add any new ones here.
  const CDN_URLS = [
    "*://*.owocdn.top/*",
    "*://*.owocdn.com/*",
    "*://*.uwucdn.top/*",
    "*://*.llnwi.net/*",
    `*://*.cdn.${paheHost}/*`,
  ];

  // Snapshot thumbnails — derive from the current host, plus known historical
  // hosts so old DB references keep working after a domain switch.
  const snapshotHosts = new Set([
    `i.${paheHost}`,
    "i.animepahe.ru",
    "i.animepahe.pw",
    "i.animepahe.si",
    "i.animepahe.cx",
  ]);
  const SNAPSHOT_URLS = Array.from(snapshotHosts).map((h) => `*://${h}/*`);

  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: SNAPSHOT_URLS },
    (details, callback) => {
      const headers: Record<string, string> = { ...details.requestHeaders as Record<string, string> };
      headers["Referer"] = `https://${paheHost}/`;
      callback({ requestHeaders: headers });
    },
  );

  // Spoof Referer + Origin on outgoing requests to the stream CDN.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [...CDN_URLS, "*://*.kwik.si/*", "*://*.kwik.cx/*", "*://kwik.si/*", "*://kwik.cx/*"] },
    (details, callback) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(details.requestHeaders)) {
        if (k.toLowerCase() === "origin") continue;
        headers[k] = v as string;
      }
      headers["Referer"] = "https://kwik.cx/";
      headers["Origin"] = "https://kwik.cx";
      const kwikCookies = getKwikCookies();
      if (kwikCookies) headers["Cookie"] = kwikCookies;
      callback({ requestHeaders: headers });
    },
  );

  // Inject CORS headers into CDN responses for hls.js.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: CDN_URLS },
    (details, callback) => {
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

// Privileged scheme registration must happen before app `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-video",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
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
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
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

app.whenReady().then(() => {
  registerWebRequestHandlers();

  // Serve local files through a custom protocol so the renderer can <video src="local-video://...">.
  protocol.handle("local-video", (req) => {
    // local-video:///absolute/path/to/file.mkv
    const u = new URL(req.url);
    const filePath = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    return net.fetch(pathToFileURL(filePath).toString());
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
  pahePrewarm();

  // Auto-updater
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.checkForUpdates().catch(() => {});

  function sendToRenderer(channel: string, payload?: unknown) {
    mainWindow?.webContents.send(channel, payload);
  }

  autoUpdater.on("update-available", (info) => {
    sendToRenderer("update:available", { version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    sendToRenderer("update:not-available");
  });
  autoUpdater.on("download-progress", (p) => {
    sendToRenderer("update:progress", { percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendToRenderer("update:downloaded", { version: info.version });
  });
  autoUpdater.on("error", (err) => {
    sendToRenderer("update:error", err.message);
  });

  // Background flush of dirty list entries to MAL every 30s.
  malFlushTimer = setInterval(() => {
    flushDirty().catch((e) => console.warn("MAL flush failed", e));
  }, 30_000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => { isQuitting = true; });

app.on("window-all-closed", () => {
  // Keep the app running in the tray on Windows; only quit when explicitly requested.
  if (isQuitting) {
    if (malFlushTimer) clearInterval(malFlushTimer);
    if (process.platform !== "darwin") app.quit();
  }
});

// ----------------- IPC handlers -----------------

function registerIpc() {
  // MAL
  ipcMain.handle(IPC.MAL_BEGIN_AUTH, () => {
    if (!mainWindow) return { ok: false, reason: "no window" };
    return beginAuth(mainWindow);
  });
  ipcMain.handle(IPC.MAL_STATE, () => getState());
  ipcMain.handle(IPC.MAL_DISCONNECT, () => {
    malDisconnect();
    return getState();
  });
  ipcMain.handle(IPC.MAL_PULL, async () => {
    const r = await pullList((n) =>
      mainWindow?.webContents.send("mal:pull-progress", n),
    );
    return r;
  });
  ipcMain.handle(IPC.MAL_PUSH_PROGRESS, async () => flushDirty());
  ipcMain.handle(IPC.MAL_SET_CLIENT_ID, (_e, id: string) => setMalClientId(id));
  ipcMain.handle(IPC.MAL_CLIENT_INFO, () => getMalClientInfo());


  // AniList sync
  ipcMain.handle(IPC.AL_BEGIN_AUTH, () => {
    if (!mainWindow) return { ok: false, reason: "no window" };
    return alBeginAuth(mainWindow);
  });
  ipcMain.handle(IPC.AL_STATE, () => alGetState());
  ipcMain.handle(IPC.AL_DISCONNECT, () => { alDisconnect(); return alGetState(); });
  ipcMain.handle(IPC.AL_PULL, async () => {
    return alPullList((n) => mainWindow?.webContents.send("al:pull-progress", n));
  });
  ipcMain.handle(IPC.AL_SET_CLIENT_ID, (_e, id: string) => {
    alSetClientId(id);
    return alGetState();
  });

  // AniList metadata
  ipcMain.handle(IPC.ANILIST_SEARCH, (_e, q: string) => searchAnime(q));
  ipcMain.handle(IPC.ANILIST_TRENDING, () => trending());
  ipcMain.handle(IPC.ANILIST_RELATIONS, (_e, id: number) => getRelations(id));
  ipcMain.handle(IPC.ANILIST_GET, async (_e, id: number) => {
    // Skip AniList for synthetic IDs:
    //   - Negative IDs: paheSession hashes (StreamPlayer) + library title hashes
    //   - id > 1_000_000_000: MAL-only stubs
    // For these, only the local DB has any meaningful data.
    if (id <= 0 || id > 1_000_000_000) {
      return getAnime(id);
    }
    // Try local cache first so we don't hit AniList unnecessarily.
    const cached = getAnime(id);
    // If we have a cover image it's likely a fully-hydrated record — return it.
    if (cached?.coverImage) return cached;
    // Otherwise fetch fresh from AniList and cache.
    try {
      const anime = await getById(id);
      if (anime) upsertAnime(anime);
      return anime ?? cached ?? null;
    } catch {
      return cached ?? null;
    }
  });

  // Library
  ipcMain.handle(IPC.LIBRARY_ADD_FOLDER, async () => {
    if (!mainWindow) return [];
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "multiSelections"],
    });
    if (r.canceled) return listLibraryFolders();
    for (const p of r.filePaths) addLibraryFolder(p);
    return listLibraryFolders();
  });
  ipcMain.handle(IPC.LIBRARY_REMOVE_FOLDER, (_e, p: string) => {
    removeLibraryFolder(p);
    return listLibraryFolders();
  });
  ipcMain.handle(IPC.LIBRARY_LIST_FOLDERS, () => listLibraryFolders());
  ipcMain.handle(IPC.LIBRARY_SCAN, async () => {
    const r = await scanAll((c, t, label) =>
      mainWindow?.webContents.send("library:scan-progress", { c, t, label }),
    );
    return r;
  });
  ipcMain.handle(IPC.LIBRARY_EPISODES_FOR, (_e, id: number) =>
    getEpisodesFor(id),
  );

  // List + progress
  ipcMain.handle(IPC.LIST_GET_ALL, () => {
    const entries = getAllListEntries();
    return entries.map((e) => ({ entry: e, anime: getAnime(e.animeId) }));
  });
  ipcMain.handle(IPC.LIST_SET, (_e, entry: any) => {
    setListEntry(entry, { markDirty: true });
    return getAllListEntries();
  });
  ipcMain.handle(IPC.CONTINUE_WATCHING, () => getContinueWatching());
  ipcMain.handle(IPC.CW_PAGED, (_e, page: number, pageSize: number) =>
    getContinueWatchingPaged(page, pageSize),
  );
  ipcMain.handle(IPC.CW_DISMISS, (_e, animeId: number) => {
    dismissFromContinueWatching(animeId);
    return { ok: true };
  });
  ipcMain.handle(IPC.PROGRESS_GET, (_e, id: number, ep: number) =>
    getProgress(id, ep),
  );
  ipcMain.handle(IPC.PROGRESS_GET_FOR_ANIME, (_e, id: number) =>
    getProgressForAnime(id),
  );
  ipcMain.handle(IPC.PROGRESS_SET, async (_e, p: any) => {
    // Ensure the anime row exists so getContinueWatching()'s JOIN succeeds.
    if (p.animeTitle) {
      const existing = getAnime(p.animeId);
      if (!existing) {
        // Create a stub immediately so continue-watching works right away.
        upsertAnime({ id: p.animeId, title: p.animeTitle, coverImage: p.animeCoverUrl ?? null });

        // Fire-and-forget: resolve to the real AniList entry so MAL sync works.
        // This runs for both pahe-only (negative animeId) and real-ID watches.
        if (p.animePaheSession) {
          (async () => {
            try {
              const results = await searchAnime(p.animeTitle);
              const hit = results.find(
                (a) =>
                  a.title.toLowerCase() === p.animeTitle.toLowerCase() ||
                  (a.titleEnglish ?? "").toLowerCase() === p.animeTitle.toLowerCase(),
              );
              if (!hit) return;

              // Save the full AniList record (includes malId, episodes, etc.)
              upsertAnime(hit);

              // If we were tracking under a stub/negative ID, migrate the list
              // entry to the real AniList ID so flushDirty can push to MAL.
              if (hit.id !== p.animeId) {
                const stubEntry = getListEntry(p.animeId);
                if (stubEntry) {
                  setListEntry(
                    { ...stubEntry, animeId: hit.id },
                    { markDirty: !!hit.malId },
                  );
                  // Remove the stale stub list entry so it doesn't linger.
                  deleteListEntry(p.animeId);
                }
              }
            } catch { /* best-effort */ }
          })();
        }
      } else if (!existing.coverImage && p.animeCoverUrl) {
        upsertAnime({ ...existing, coverImage: p.animeCoverUrl });
      }
    }

    // Read existing progress BEFORE writing so we can detect the threshold crossing.
    const prev = getProgress(p.animeId, p.episode);
    setProgress(p);

    // Auto-mark watched on the FIRST crossing of 85%. Avoids firing MAL/AL push
    // on every 10-second timer tick once past the threshold.
    if (p.animeId !== 0 && p.durationSec) {
      const prevPct = prev && prev.durationSec ? prev.positionSec / prev.durationSec : 0;
      const newPct = p.positionSec / p.durationSec;
      const justCrossed = prevPct < 0.85 && newPct >= 0.85;
      if (justCrossed) {
        try {
          await markEpisodeWatched(p.animeId, p.episode);
        } catch (e) {
          console.warn("markEpisodeWatched failed", e);
        }
        try {
          await alMarkEpisodeWatched(p.animeId, p.episode);
        } catch (e) {
          console.warn("alMarkEpisodeWatched failed", e);
        }
      }
    }
    return { ok: true };
  });

  // Player
  ipcMain.handle(IPC.PLAYER_RESOLVE_FILE, (_e, filePath: string) => {
    // Returns a URL the renderer can <video src=...> with.
    return `local-video:///${encodeURI(filePath.replace(/\\/g, "/"))}`;
  });

  // AnimePahe
  ipcMain.handle(IPC.PAHE_LATEST, (_e, page = 1) => paheLatest(30, page));
  ipcMain.handle(IPC.PAHE_SEARCH, (_e, q: string) => paheSearch(q));
  ipcMain.handle(IPC.PAHE_EPISODES, (_e, session: string, page: number) =>
    paheEpisodes(session, page),
  );
  ipcMain.handle(IPC.PAHE_LINKS, (_e, epSession: string, animeSession: string) =>
    paheLinks(epSession, animeSession),
  );
  ipcMain.handle(IPC.PAHE_RESOLVE, (_e, kwikUrl: string) =>
    resolveKwik(kwikUrl),
  );
  ipcMain.handle(IPC.PAHE_PREFETCH, (_e, kwikUrl: string) => {
    prefetchKwik(kwikUrl);
    return { ok: true };
  });
  ipcMain.handle(IPC.PAHE_GET_IDS, (_e, paheId: number, session: string) => paheGetIds(paheId, session));
  ipcMain.handle(IPC.PAHE_FIND_BY_ID, (_e, anilistId: number | undefined, malId: number | undefined) =>
    paheFindById(anilistId, malId),
  );
  ipcMain.handle(IPC.PAHE_GET_URL, () => getPaheBaseUrl());
  ipcMain.handle(IPC.PAHE_SET_URL, (_e, url: string) => {
    try {
      setPaheBaseUrl(url);
      registerWebRequestHandlers(); // re-derive CDN/snapshot hosts from new URL
      return { ok: true, url: getPaheBaseUrl() };
    } catch (e: any) {
      return { ok: false, url: getPaheBaseUrl(), reason: e.message };
    }
  });

  // Legal
  ipcMain.handle(IPC.LEGAL_LINKS, (_e, id: number) => {
    const anime = getAnime(id);
    if (!anime) return [];
    return linksFor(anime);
  });
  ipcMain.handle(IPC.LEGAL_OPEN, (_e, url: string) => {
    openLink(url);
  });

  ipcMain.handle(IPC.UPDATE_CHECK, async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, version: result?.updateInfo?.version ?? null };
    } catch (e: any) {
      return { ok: false, reason: e.message };
    }
  });
  ipcMain.handle(IPC.UPDATE_INSTALL, () => {
    autoUpdater.quitAndInstall();
  });
}
