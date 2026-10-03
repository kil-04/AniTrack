import { BrowserWindow } from "electron";

/**
 * A provider homepage opened in an app-owned window so the user can complete
 * the website's own check themselves. The verified page then serves fixed,
 * reviewed same-origin GETs from an isolated world: page scripts cannot replace
 * that fetch, nothing downloaded is executed, and only the configured origin is
 * reachable. Video never plays in this window.
 */

export interface VerifiedPageResponse {
  status: number;
  body: string | null;
  headers: Record<string, string>;
}

export interface VerifiedPageSessionOptions {
  origin: string;
  partition: string;
  label: string;
  /** Isolated world id, distinct per provider. */
  world: number;
  homePath?: string;
  /** How long a shown website check may take the user. */
  verificationWaitMs?: number;
  idleCloseMs?: number;
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
}

const CHALLENGE_TITLE = /just a moment|attention required|checking your browser|verify you are human/i;

export class PageVerificationError extends Error {
  readonly code = "SECURITY_CHECK" as const;
  constructor(message: string) {
    super(message);
    this.name = "PageVerificationError";
  }
}

export class VerifiedPageSession {
  private win: BrowserWindow | null = null;
  private ready: Promise<BrowserWindow> | null = null;
  private verified = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly options: Required<VerifiedPageSessionOptions>;

  constructor(options: VerifiedPageSessionOptions) {
    const origin = new URL(options.origin);
    if (origin.protocol !== "https:" || origin.origin !== options.origin) throw new Error("Verified page origin must be an HTTPS origin");
    this.options = {
      homePath: "/",
      verificationWaitMs: 3 * 60_000,
      idleCloseMs: 10 * 60_000,
      requestTimeoutMs: 15_000,
      maxBodyBytes: 2 * 1024 * 1024,
      ...options,
    };
  }

  /** One same-origin GET from the verified page. User-initiated callers only. */
  async get(url: string, accept: string, headerNames: string[] = []): Promise<VerifiedPageResponse> {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.origin !== this.options.origin || target.username || target.password) {
      throw new Error(`${this.options.label} request left its approved site.`);
    }
    const win = await this.open();
    if (new URL(win.webContents.getURL()).origin !== this.options.origin) {
      throw new Error(`${this.options.label} request left its approved site.`);
    }
    this.touch();
    const request = {
      path: target.pathname + target.search,
      accept,
      headers: headerNames.map((name) => name.toLowerCase()),
      limit: this.options.maxBodyBytes,
      timeout: this.options.requestTimeoutMs,
    };
    // `request` is passed as data; the code around it is fixed. No top-level
    // declarations: the isolated world keeps its globals between calls.
    const code = `(async (request) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeout);
  try {
    const response = await fetch(request.path, {
      headers: { Accept: request.accept }, credentials: "same-origin", cache: "no-store", signal: controller.signal,
    });
    if (new URL(response.url).origin !== location.origin) return { status: 0, body: "", headers: {} };
    const headers = {};
    for (const name of request.headers) { const value = response.headers.get(name); if (value !== null) headers[name] = value; }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > request.limit) { await reader.cancel(); return { status: response.status, body: null, headers }; }
      chunks.push(value);
    }
    return { status: response.status, body: await new Blob(chunks).text(), headers };
  } finally { clearTimeout(timer); }
})(
/* request */ ${JSON.stringify(request)}
)`;
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        win.webContents.executeJavaScriptInIsolatedWorld(this.options.world, [{ code }]),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), this.options.requestTimeoutMs + 5_000); }),
      ]);
      if (!result || typeof result.status !== "number" || (result.body !== null && typeof result.body !== "string")
        || !result.headers || typeof result.headers !== "object") throw new Error("malformed");
      if (result.status === 0) throw new Error("left origin");
      return { status: result.status, body: result.body, headers: result.headers };
    } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
      console.warn(`[${this.options.label}] Session request failed:`, reason.replace(/https?:\/\/\S+/g, "[url]").slice(0, 160));
      throw new Error(`${this.options.label} request did not complete. Retry or choose another provider.`);
    } finally {
      clearTimeout(timer);
      this.touch();
    }
  }

  /**
   * A request was answered with a website check: show the page, reloaded once
   * without cache so the check itself is visible, for the user to complete.
   * The failed request is not retried.
   */
  requireVerification(): PageVerificationError {
    this.verified = false;
    const win = this.win;
    if (win && !win.isDestroyed()) {
      this.show(win);
      win.webContents.reloadIgnoringCache();
    }
    return new PageVerificationError(`${this.options.label} needs verification. Complete the check in the opened window, then retry.`);
  }

  close(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // Never close a page the user is completing a check in.
      if (this.win && !this.win.isDestroyed() && !this.win.isVisible() && this.verified) this.win.destroy();
    }, this.options.idleCloseMs);
    this.idleTimer.unref?.();
  }

  private show(win: BrowserWindow): void {
    if (win.isDestroyed()) return;
    win.setTitle(`${this.options.label} — complete the website check; AniTrack continues automatically`);
    win.show();
    win.focus();
  }

  private open(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed() && this.verified) return Promise.resolve(this.win);
    if (this.ready && this.win && !this.win.isDestroyed()) return this.ready;
    const { origin, partition, label } = this.options;
    const win = new BrowserWindow({
      show: false, width: 900, height: 700,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition },
    });
    this.win = win;
    this.verified = false;
    win.webContents.setAudioMuted(true);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const session = win.webContents.session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    const denyDownload = (event: Electron.Event, _item: Electron.DownloadItem, contents?: Electron.WebContents) => {
      if (contents === win.webContents) event.preventDefault();
    };
    session.on("will-download", denyDownload);
    win.webContents.on("will-navigate", (event, target) => {
      try { if (new URL(target).origin !== origin) event.preventDefault(); } catch { event.preventDefault(); }
    });

    this.ready = new Promise<BrowserWindow>((resolve, reject) => {
      let settled = false;
      let deadline = setTimeout(() => finish(new Error(`${label} did not finish loading. Retry or choose another provider.`)), 30_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        this.ready = null;
        if (error) {
          reject(error);
          if (!(error instanceof PageVerificationError) && !win.isDestroyed()) win.destroy();
        } else resolve(win);
      };
      const checkLoad = async () => {
        if (win.isDestroyed() || this.win !== win) return;
        try {
          const title: string = await win.webContents.executeJavaScript("document.title", true);
          if (CHALLENGE_TITLE.test(title)) {
            this.verified = false;
            if (!settled) {
              // Wait for the user, not for an automatic retry.
              clearTimeout(deadline);
              deadline = setTimeout(() => finish(new PageVerificationError(
                `${label} verification was not completed. Complete the check in its window, then retry.`)), this.options.verificationWaitMs);
            }
            this.show(win);
            return;
          }
          if (!title || new URL(win.webContents.getURL()).origin !== origin) return;
          this.verified = true;
          if (win.isVisible()) win.hide();
          this.touch();
          finish();
        } catch { /* page mid-navigation: wait for the next load */ }
      };
      win.webContents.on("did-finish-load", checkLoad);
      win.on("closed", () => {
        session.removeListener("will-download", denyDownload);
        finish(new PageVerificationError(`${label} window was closed. Retry to reconnect.`));
        if (this.win === win) {
          this.win = null;
          this.verified = false;
          this.ready = null;
        }
      });
      // A cached homepage could render while the network copy is behind a check.
      win.loadURL(origin + this.options.homePath, { extraHeaders: "Cache-Control: no-cache\n" }).catch(() => {
        finish(new Error(`${label} could not be loaded. Retry or choose another provider.`));
      });
    });
    return this.ready;
  }
}
