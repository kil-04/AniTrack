import { app, BrowserWindow, Menu } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  COMIX_CHAPTER_PAGE_INTERVAL_MS, COMIX_ORIGIN, COMIX_MAX_RESPONSE, comixIsChapterList, comixNetworkAllowed, comixPublicConnectionPage,
  comixRetryAfterMs, comixValidRequest, type ComixParams,
} from "./comix-protocol";

// Inspect only ordinary DOM state. A challenge's message/event never grants readiness.
const normalPageProbe = `(() => {
  if (location.origin !== ${JSON.stringify(COMIX_ORIGIN)} || location.pathname === '/@waf/challenge' || location.pathname.startsWith('/cdn-cgi/')) return false;
  if (/security check|just a moment|verify you are human|attention required|performing security verification|enable javascript and cookies to continue/i.test(document.title + ' ' + (document.body?.innerText || '').slice(0, 1200))) return false;
  for (const frame of document.querySelectorAll('iframe')) {
    let source;
    try { source = new URL(frame.src || frame.getAttribute('src') || '', location.href); } catch { continue; }
    if (!(source.origin === ${JSON.stringify(COMIX_ORIGIN)} && source.pathname === '/@waf/challenge') && source.origin !== 'https://challenges.cloudflare.com') continue;
    const bounds = frame.getBoundingClientRect(), style = getComputedStyle(frame);
    if (bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse') return false;
  }
  return true;
})()`;
const homepageProbe = `${normalPageProbe} && (() => {
  if (location.pathname !== '/' || location.search || location.hash) return false;
  const node = document.querySelector('script#initial-data');
  if (!node || !node.textContent || node.textContent.length > 2000000) return false;
  try {
    const data = JSON.parse(node.textContent), queries = data?.queries;
    return !!data && typeof data === 'object' && !Array.isArray(data) && !!queries && typeof queries === 'object' && !Array.isArray(queries);
  } catch { return false; }
})()`;

export class ComixSessionError extends Error {
  readonly verify: boolean;
  constructor(message: string, verify = false) {
    super(message);
    this.name = "ComixSessionError";
    this.verify = verify;
  }
}

/** Website modules stay in a dedicated sandboxed profile, never Node or the app renderer. */
export class ComixSiteSession {
  private win: BrowserWindow | null = null;
  private connecting = false;
  private ready = false;
  private nativeRefused = false;
  private generation = 0;
  private connection: Promise<boolean> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastChapterPageAt = Number.NEGATIVE_INFINITY;
  /** Set from the website's own Retry-After; reads fail fast until then, with no automatic retry. */
  private cooldownUntil = 0;
  private readonly script: () => string;
  private readonly connectionHelp: () => string;

  constructor(options: { script?: () => string; connectionHelp?: () => string } = {}) {
    this.script = options.script ?? (() => readFileSync(join(app.getAppPath(), "apps/android/app/src/main/assets/comix_transport.js"), "utf8"));
    this.connectionHelp = options.connectionHelp ?? (() => readFileSync(join(app.getAppPath(), "apps/android/app/src/main/assets/comix_connection_help.js"), "utf8"));
  }

  /** Explicit user connection. A normal homepage needs no unnecessary verification click. */
  connect(parent: BrowserWindow | null = null): Promise<boolean> {
    if (this.ready && this.win && !this.win.isDestroyed()) return Promise.resolve(true);
    if (this.connection) {
      this.win?.show();
      this.win?.focus();
      return this.connection;
    }
    const existing = this.win;
    if (existing && !existing.isDestroyed()) existing.destroy();
    const win = new BrowserWindow({
      show: true, width: 1000, height: 760, parent: parent ?? undefined,
      title: "Connect Comix — complete any website check yourself; use AniTrack → Continue",
      autoHideMenuBar: false,
      webPreferences: { partition: "persist:comix", nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    this.win = win;
    this.connecting = true;
    this.ready = false;
    const generation = ++this.generation;
    const session = win.webContents.session;
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.webRequest.onBeforeRequest((details, callback) => callback({
      cancel: (!this.connecting && this.nativeRefused)
        || !comixNetworkAllowed(details.url, details.method, details.resourceType === "mainFrame", this.connecting),
    }));
    session.webRequest.onHeadersReceived((details, callback) => {
      if (new URL(details.url).pathname.startsWith("/api/v1/")) {
        const header = Object.entries(details.responseHeaders ?? {}).find(([name]) => name.toLowerCase() === "retry-after")?.[1]?.[0];
        const wait = comixRetryAfterMs(details.statusCode, header);
        if (wait !== null) this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + wait);
      }
      if ([401, 403, 429].includes(details.statusCode) && new URL(details.url).pathname.startsWith("/api/v1/") && !this.connecting) {
        this.ready = false;
        this.nativeRefused = true;
      }
      callback({});
    });
    const denyDownload = (event: Electron.Event) => event.preventDefault();
    session.on("will-download", denyDownload);
    win.webContents.on("will-navigate", (event, url) => {
      if (!comixNetworkAllowed(url, "GET", true, this.connecting)) event.preventDefault();
    });
    win.webContents.on("did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace && !this.connecting) this.ready = false;
    });

    this.connection = new Promise<boolean>((resolve) => {
      let settled = false;
      let inspecting = false;
      // A first normal homepage connects automatically. After a rejected native
      // read, leave the website visible for user-operated title/challenge access.
      let returnRequested = !this.nativeRefused;
      let timer: NodeJS.Timeout;
      let poll: NodeJS.Timeout | undefined;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(poll);
        this.connection = null;
        this.connecting = false;
        this.ready = ok && this.win === win && !win.isDestroyed();
        if (this.ready) {
          this.nativeRefused = false;
          win.hide();
        }
        else if (!win.isDestroyed()) win.destroy();
        resolve(this.ready);
      };
      timer = setTimeout(() => finish(false), 3 * 60_000);
      const check = async () => {
        if (settled || inspecting || this.win !== win || win.isDestroyed()) return;
        inspecting = true;
        try {
          if (!returnRequested || win.webContents.getURL() !== `${COMIX_ORIGIN}/`) return;
          const normal: boolean = await win.webContents.executeJavaScript(homepageProbe);
          if (!normal || generation !== this.generation || this.win !== win || win.isDestroyed() || win.webContents.getURL() !== `${COMIX_ORIGIN}/`) return;
          const script = this.script();
          if (!script || Buffer.byteLength(script) > 128_000) throw new Error("Invalid bundled transport");
          await win.webContents.executeJavaScript(script);
          const initialized: boolean = await win.webContents.executeJavaScript("typeof window.__anitrackComix === 'object'");
          if (generation !== this.generation || this.win !== win || win.isDestroyed() || win.webContents.getURL() !== `${COMIX_ORIGIN}/`) return;
          if (initialized && !await win.webContents.executeJavaScript(homepageProbe)) return;
          await win.webContents.executeJavaScript("window.__anitrackComixConnectionHelp?.disable?.()");
          finish(initialized);
        } catch { finish(false); }
        finally { inspecting = false; }
      };
      const continueToApp = async () => {
        if (settled || inspecting || this.win !== win || win.isDestroyed()) return;
        const current = win.webContents.getURL();
        if (!comixPublicConnectionPage(current)) return;
        inspecting = true;
        try {
          // Do not dismiss a visible check, even if the user clicks our menu.
          const normal: boolean = await win.webContents.executeJavaScript(normalPageProbe);
          if (!normal || settled || generation !== this.generation || this.win !== win || win.isDestroyed() || win.webContents.getURL() !== current) return;
          returnRequested = true;
          if (current !== `${COMIX_ORIGIN}/`) await win.loadURL(`${COMIX_ORIGIN}/`);
        } catch { finish(false); }
        finally { inspecting = false; }
        await check();
      };
      win.setMenu(Menu.buildFromTemplate([{
        label: "AniTrack", submenu: [
          { label: "Continue to AniTrack", click: () => { void continueToApp(); } },
          { label: "Cancel connection", click: () => finish(false) },
        ],
      }]));
      const scheduleCheck = () => {
        if (settled) return;
        poll = setTimeout(() => { void check().finally(scheduleCheck); }, 500);
      };
      scheduleCheck();
      win.webContents.on("did-finish-load", async () => {
        if (settled || !this.connecting || this.win !== win || win.isDestroyed()) return;
        if (comixPublicConnectionPage(win.webContents.getURL())) {
          try {
            const help = this.connectionHelp();
            if (!help || Buffer.byteLength(help) > 16_000) throw new Error("Invalid bundled connection UI");
            await win.webContents.executeJavaScript(help);
          } catch { finish(false); return; }
        }
        await check();
      });
      win.webContents.on("render-process-gone", () => {
        this.ready = false;
        this.generation++;
        if (!win.isDestroyed()) win.destroy();
        finish(false);
      });
      win.on("closed", () => {
        session.removeListener("will-download", denyDownload);
        session.webRequest.onBeforeRequest(null);
        session.webRequest.onHeadersReceived(null);
        if (this.win === win) {
          this.win = null;
          this.ready = false;
          this.generation++;
        }
        finish(false);
      });
      void win.loadURL(`${COMIX_ORIGIN}/`).catch(() => finish(false));
    });
    return this.connection;
  }

  read(path: string, params: ComixParams): Promise<Record<string, unknown>> {
    if (!comixValidRequest(path, params)) return Promise.reject(new ComixSessionError("Unsupported Comix catalogue request."));
    const task = this.queue.then(() => this.readOne(path, params));
    this.queue = task.catch(() => {});
    return task;
  }

  /** Seconds left in a website-requested pause, or 0. */
  cooldownSeconds(): number {
    return Math.max(0, Math.ceil((this.cooldownUntil - Date.now()) / 1000));
  }

  private limited(): ComixSessionError {
    return new ComixSessionError(`Comix is limiting requests. Try again in ${Math.max(1, this.cooldownSeconds())} s.`);
  }

  private async readOne(path: string, params: ComixParams): Promise<Record<string, unknown>> {
    const win = this.win;
    if (!this.ready || !win || win.isDestroyed() || win.webContents.getURL() !== `${COMIX_ORIGIN}/`) {
      throw new ComixSessionError("Connect Comix to load its catalogue.", true);
    }
    if (this.cooldownSeconds() > 0) throw this.limited();
    if (comixIsChapterList(path)) {
      const wait = this.lastChapterPageAt + COMIX_CHAPTER_PAGE_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastChapterPageAt = Date.now();
    }
    const generation = this.generation;
    const id = randomUUID();
    const quoted = JSON.stringify(id);
    const deadline = Date.now() + 35_000;
    const evaluate = async (code: string): Promise<unknown> => {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          win.webContents.executeJavaScript(code),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new ComixSessionError("Comix catalogue timed out. Retry manually.")), Math.max(1, deadline - Date.now()));
          }),
        ]);
      } finally { clearTimeout(timer); }
    };
    try {
      if (await evaluate(`window.__anitrackComix?.start(${quoted},${JSON.stringify(path)},${JSON.stringify(params)})`) !== true) {
        throw new ComixSessionError("Comix is busy or its session changed. Retry manually.");
      }
      while (Date.now() < deadline) {
        if (!this.ready || this.win !== win || win.isDestroyed() || generation !== this.generation) {
          throw new ComixSessionError("Comix requires a fresh connection.", true);
        }
        const result = await evaluate(`window.__anitrackComix?.take(${quoted})`);
        if (result !== null) {
          if (typeof result !== "string" || Buffer.byteLength(result) > COMIX_MAX_RESPONSE) throw new ComixSessionError("Invalid Comix catalogue response.");
          let body: { ok?: boolean; status?: number; error?: string; value?: unknown };
          try { body = JSON.parse(result); } catch { throw new ComixSessionError("Invalid Comix catalogue response."); }
          if (body.ok !== true) {
            if (this.cooldownSeconds() > 0) throw this.limited();
            const verify = [401, 403, 429].includes(Number(body.status));
            if (verify) {
              this.ready = false;
              this.nativeRefused = true;
            }
            // The reviewed transport exports only fixed, redacted error categories.
            const message = typeof body.error === "string" && /^Comix [a-zA-Z0-9 .;()_-]{1,140}$/.test(body.error) ? body.error : "Comix catalogue did not complete. Retry manually.";
            throw new ComixSessionError(message, verify);
          }
          if (!body.value || typeof body.value !== "object" || Array.isArray(body.value)) throw new ComixSessionError("Invalid Comix catalogue response.");
          return body.value as Record<string, unknown>;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new ComixSessionError("Comix catalogue timed out. Retry manually.");
    } finally {
      if (this.win === win && !win.isDestroyed()) {
        void win.webContents.executeJavaScript(`window.__anitrackComix?.cancel(${quoted})`).catch(() => {});
      }
    }
  }

  close(): void {
    this.ready = false;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}

export const comixSession = new ComixSiteSession();
