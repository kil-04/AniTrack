/**
 * MPV process manager.
 *
 * Spawns mpv as a child process, embeds it into a native window handle via
 * --wid, and communicates with it over a JSON IPC socket (named pipe on
 * Windows, Unix socket on macOS/Linux).
 *
 * Usage:
 *   import { mpv } from './mpv';
 *   await mpv.launch(wid);          // spawn mpv attached to a window
 *   await mpv.loadFile(url);         // load + start playing
 *   mpv.on('time-pos', cb);          // listen to playback position
 *   mpv.on('end-file', cb);          // fires when file ends
 *   await mpv.quit();                // shut down
 */

import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

const IS_WIN = process.platform === "win32";

// Named pipe on Windows, Unix domain socket everywhere else.
const IPC_PATH = IS_WIN
  ? "\\\\.\\pipe\\anitrack-mpv"
  : path.join(os.tmpdir(), "anitrack-mpv.sock");

// Resolve mpv executable.
// Priority:
//   1. Bundled copy in <app>/resources/mpv/mpv.exe  (production & dev)
//   2. "mpv" on system PATH as a last resort.
function resolveMpvExe(): string {
  // In dev: __dirname is dist-electron/electron/services, so walk up to project root.
  // In production: process.resourcesPath points to the app's resources/ folder.
  const candidates: string[] = [];

  if (IS_WIN) {
    // Packaged app: resources/ lives at process.resourcesPath
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, "mpv", "mpv.exe"));
    }
    // Dev: walk up from dist-electron/electron/services → project root
    candidates.push(path.join(__dirname, "..", "..", "..", "resources", "mpv", "mpv.exe"));
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Fallback: rely on PATH
  return IS_WIN ? "mpv.exe" : "mpv";
}

const MPV_EXE = resolveMpvExe();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MpvPropertyEvent {
  name: string;
  data: unknown;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class MpvService extends EventEmitter {
  private proc: ChildProcess | null = null;
  private sock: net.Socket | null = null;
  private reqId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buf = "";

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Spawn mpv and position its window over the given screen rectangle.
   * Uses --geometry instead of --wid to avoid Electron compositor conflicts.
   * Resolves once the IPC socket is ready and initial observers are set up.
   */
  /**
   * url    — the stream URL to play immediately (passed as a positional arg,
   *          which avoids the "idle window" crash on some Windows setups).
   * bounds — screen rectangle where mpv should appear.
   */
  async launch(
    url: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): Promise<void> {
    // Clean up any previous instance first.
    await this.quit();

    const geo = `${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`;
    const mpvDir = path.dirname(MPV_EXE);

    const args = [
      url,                    // play this URL immediately — no idle window crash
      "--no-border",          // no OS title bar / frame
      `--geometry=${geo}`,    // position over the video area of the main window
      `--input-ipc-server=${IPC_PATH}`,
      "--osc=yes",            // built-in seek / pause overlay on hover
      "--hr-seek=yes",
      "--keep-open=yes",      // don't close window when file ends (we handle next)
      "--network-timeout=30",
      "--referrer=https://animepahe.pw/",  // kwik streams need this
      "--no-terminal",
    ];

    console.log("[mpv] exe:", MPV_EXE);
    console.log("[mpv] args:", args.join(" "));

    this.proc = spawn(MPV_EXE, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: mpvDir,   // run from its own folder so DLLs are resolved
      env: { ...process.env, PATH: `${mpvDir}${path.delimiter}${process.env.PATH ?? ""}` },
    });

    this.proc.stdout?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.log("[mpv out]", line);
    });
    this.proc.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.error("[mpv err]", line);
    });

    this.proc.on("error", (err) => {
      console.error("[mpv] spawn error:", err.message);
      this.emit("spawn-error", err);
    });

    this.proc.on("exit", (code, signal) => {
      console.log("[mpv] process exited, code:", code, "signal:", signal);
      this.sock = null;
      this.buf = "";
      this.pending.forEach(({ reject }) => reject(new Error("mpv exited")));
      this.pending.clear();
      this.emit("exit", code);
    });

    // Wait for mpv to create the IPC socket (may take a moment).
    await this._connectSocket();

    // Start observing the properties we care about.
    // Each observer gets a numeric ID; mpv sends property-change events for them.
    await this._observe(1, "time-pos");
    await this._observe(2, "duration");
    await this._observe(3, "pause");
  }

  // ── Playback control ───────────────────────────────────────────────────────

  /** Load a URL or file path and start playing immediately. */
  async loadFile(url: string): Promise<void> {
    await this._cmd("loadfile", url, "replace");
    // Un-pause in case mpv started idle/paused.
    await this.play().catch(() => {});
  }

  async play(): Promise<void> {
    await this._setProp("pause", false);
  }

  async pause(): Promise<void> {
    await this._setProp("pause", true);
  }

  async togglePause(): Promise<void> {
    await this._cmd("cycle", "pause");
  }

  /** Seek to an absolute position in seconds. */
  async seek(seconds: number): Promise<void> {
    await this._cmd("seek", seconds, "absolute+exact");
  }

  /** vol is 0–1; mpv uses 0–100. */
  async setVolume(vol: number): Promise<void> {
    await this._setProp("volume", Math.round(Math.max(0, Math.min(1, vol)) * 100));
  }

  async getTimePos(): Promise<number> {
    return (await this._getProp("time-pos").catch(() => 0)) as number ?? 0;
  }

  async getDuration(): Promise<number> {
    return (await this._getProp("duration").catch(() => 0)) as number ?? 0;
  }

  async quit(): Promise<void> {
    if (this.sock) {
      try {
        await this._cmd("quit");
      } catch {
        // Ignore — process may already be dying.
      }
      this.sock.destroy();
      this.sock = null;
    }
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
      this.proc = null;
    }
    this.buf = "";
    this.pending.forEach(({ reject }) => reject(new Error("mpv quit")));
    this.pending.clear();
  }

  isRunning(): boolean {
    return !!this.proc && !this.proc.killed && !!this.sock;
  }

  // ── IPC internals ──────────────────────────────────────────────────────────

  private _connectSocket(retries = 40, delayMs = 150): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const tryOnce = () => {
        const sock = net.createConnection(IPC_PATH);

        sock.once("connect", () => {
          this.sock = sock;
          this.buf = "";
          sock.setEncoding("utf8");
          sock.on("data", (chunk: string) => this._onData(chunk));
          sock.on("close", () => {
            this.sock = null;
          });
          sock.on("error", (err) => {
            console.warn("[mpv] socket error:", err.message);
          });
          resolve();
        });

        sock.once("error", () => {
          sock.destroy();
          if (++attempts < retries) {
            setTimeout(tryOnce, delayMs);
          } else {
            reject(new Error("MPV IPC socket did not appear in time. Is mpv installed?"));
          }
        });
      };

      tryOnce();
    });
  }

  private _onData(chunk: string): void {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }

      // Reply to a pending request.
      const reqId = msg.request_id as number | undefined;
      if (reqId !== undefined && this.pending.has(reqId)) {
        const { resolve, reject } = this.pending.get(reqId)!;
        this.pending.delete(reqId);
        if (msg.error === "success") {
          resolve(msg.data);
        } else {
          reject(new Error((msg.error as string) ?? "mpv error"));
        }
        continue;
      }

      // Async event from mpv.
      const event = msg.event as string | undefined;
      if (!event) continue;

      if (event === "property-change") {
        // Forward as both a generic 'property-change' and a named event for convenience.
        const ev: MpvPropertyEvent = {
          name: msg.name as string,
          data: msg.data,
        };
        this.emit("property-change", ev);
        this.emit(msg.name as string, msg.data);
      } else if (event === "end-file") {
        this.emit("end-file", msg.reason);
      } else {
        this.emit(event, msg);
      }
    }
  }

  private _send(obj: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.sock) {
        reject(new Error("MPV IPC socket is not connected"));
        return;
      }
      const id = this.reqId++;
      this.pending.set(id, { resolve, reject });
      this.sock.write(JSON.stringify({ ...obj, request_id: id }) + "\n");
    });
  }

  private _cmd(command: string, ...args: unknown[]): Promise<unknown> {
    return this._send({ command: [command, ...args] });
  }

  private _getProp(prop: string): Promise<unknown> {
    return this._send({ command: ["get_property", prop] });
  }

  private _setProp(prop: string, value: unknown): Promise<unknown> {
    return this._send({ command: ["set_property", prop, value] });
  }

  private async _observe(id: number, prop: string): Promise<void> {
    await this._send({ command: ["observe_property", id, prop] });
  }
}

// Singleton — the main process creates one mpv instance at a time.
export const mpv = new MpvService();
