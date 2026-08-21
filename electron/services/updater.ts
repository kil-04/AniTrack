import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { DesktopUpdateState } from "../../shared/types";

type Broadcast = (channel: string, payload?: unknown) => void;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 8_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

let state: DesktopUpdateState = { phase: "idle" };
let broadcast: Broadcast = () => {};
let checkTimer: NodeJS.Timeout | null = null;
let retryIndex = 0;
let initialized = false;

function setState(next: DesktopUpdateState, legacyChannel?: string, legacyPayload?: unknown) {
  state = next;
  broadcast("update:state", state);
  if (legacyChannel) broadcast(legacyChannel, legacyPayload);
}

function schedule(delay: number) {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => { void checkForDesktopUpdates(false); }, delay);
  checkTimer.unref();
}

function scheduleRetry() {
  const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
  retryIndex += 1;
  schedule(delay);
}

export function initDesktopUpdater(send: Broadcast) {
  if (initialized) return;
  initialized = true;
  broadcast = send;

  if (!app.isPackaged) {
    setState({ phase: "disabled", message: "Updates are available only in packaged builds." });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Register every listener before the first check so fast GitHub responses
  // cannot race past Settings and leave it with stale state.
  autoUpdater.on("checking-for-update", () => {
    setState({ phase: "checking", checkedAt: Date.now() });
  });
  autoUpdater.on("update-available", (info) => {
    retryIndex = 0;
    setState(
      { phase: "available", version: info.version, checkedAt: Date.now() },
      "update:available",
      { version: info.version },
    );
  });
  autoUpdater.on("update-not-available", () => {
    retryIndex = 0;
    setState(
      { phase: "idle", checkedAt: Date.now() },
      "update:not-available",
    );
    schedule(CHECK_INTERVAL_MS);
  });
  autoUpdater.on("download-progress", (progress) => {
    setState(
      { phase: "downloading", percent: Math.round(progress.percent), version: state.version },
      "update:progress",
      { percent: Math.round(progress.percent) },
    );
  });
  autoUpdater.on("update-downloaded", (info) => {
    setState(
      { phase: "ready", version: info.version, checkedAt: Date.now() },
      "update:downloaded",
      { version: info.version },
    );
  });
  autoUpdater.on("error", (error) => {
    setState(
      { phase: "error", message: error.message || "Update check failed", checkedAt: Date.now() },
      "update:error",
      error.message,
    );
    scheduleRetry();
  });

  schedule(STARTUP_DELAY_MS);
}

export async function checkForDesktopUpdates(manual = true): Promise<{
  ok: boolean;
  version?: string | null;
  reason?: string;
}> {
  if (!app.isPackaged) {
    return { ok: false, reason: "Update checks are disabled in development builds." };
  }
  try {
    if (manual) setState({ phase: "checking", checkedAt: Date.now() });
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version ?? null };
  } catch (error) {
    const reason = (error as Error).message || "Update check failed";
    // Some updater failures emit their own error event; retaining state here
    // also covers providers that reject without emitting it.
    if (state.phase !== "error") {
      setState({ phase: "error", message: reason, checkedAt: Date.now() }, "update:error", reason);
      scheduleRetry();
    }
    return { ok: false, reason };
  }
}

export function getDesktopUpdateState(): DesktopUpdateState {
  return { ...state };
}

export function installDesktopUpdate(): boolean {
  if (!app.isPackaged || state.phase !== "ready") return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

export function stopDesktopUpdater() {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = null;
}
