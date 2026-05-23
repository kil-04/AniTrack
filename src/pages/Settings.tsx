import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { Folder, FolderPlus, RefreshCcw, X } from "lucide-react";

export default function Settings() {
  const mal = useAppStore((s) => s.mal);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const setScanStatus = useAppStore((s) => s.setScanStatus);
  const [folders, setFolders] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingAuth, setAwaitingAuth] = useState(false);

  useEffect(() => {
    window.api.library.listFolders().then(setFolders);

    // Listen for MAL auth completion from the HTTP callback server.
    const unsub = window.api.on("mal:auth-complete", () => {
      setAwaitingAuth(false);
      refreshAll();
    });
    const unsubErr = window.api.on("mal:auth-error", (msg: unknown) => {
      setAwaitingAuth(false);
      setAuthError(String(msg));
    });
    return () => { unsub(); unsubErr(); };
  }, [refreshAll]);

  // Poll MAL state while waiting for the browser OAuth flow to complete.
  useEffect(() => {
    if (!awaitingAuth) return;
    const interval = setInterval(async () => {
      const state = await window.api.mal.state();
      if (state.connected) {
        setAwaitingAuth(false);
        refreshAll();
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [awaitingAuth, refreshAll]);

  async function connectMal() {
    setAuthError(null);
    const r = await window.api.mal.beginAuth();
    if (!r.ok) {
      setAuthError(r.reason ?? "Failed to start auth");
      return;
    }
    setAwaitingAuth(true);
  }

  async function pull() {
    setBusy(true);
    setScanStatus("Pulling list from MAL...");
    try {
      const r = await window.api.mal.pull();
      setScanStatus(`Imported ${r.imported} entries from MAL`);
      await refreshAll();
    } catch (e) {
      setScanStatus(`MAL pull failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setBusy(true);
    setScanStatus("Scanning library...");
    try {
      const r = await window.api.library.scan();
      setScanStatus(`Scan complete: ${r.shows} shows, ${r.episodes} episodes`);
      await refreshAll();
    } catch (e) {
      setScanStatus(`Scan failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-8 py-8">
      <h1 className="mb-8 text-3xl font-bold">Settings</h1>

      <section className="mb-10 rounded-lg border border-white/10 bg-bg-card p-6">
        <h2 className="mb-2 text-xl font-semibold">MyAnimeList</h2>
        <p className="mb-4 text-sm text-muted">
          Two-way sync with your MAL list. Sign in with your MyAnimeList account to import
          your anime list and keep progress in sync automatically.
        </p>

        {mal.connected ? (
          <div className="flex items-center justify-between rounded-md bg-bg-elev px-4 py-3">
            <div>
              <div className="text-sm text-muted">Connected as</div>
              <div className="font-medium">{mal.username || "(unknown)"}</div>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={pull}
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
              >
                <RefreshCcw size={14} />
                Sync from MAL
              </button>
              <button
                onClick={async () => {
                  await window.api.mal.disconnect();
                  refreshAll();
                }}
                className="rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={connectMal}
              disabled={awaitingAuth}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
            >
              {awaitingAuth ? "Waiting for browser…" : "Connect MyAnimeList"}
            </button>
            {awaitingAuth && (
              <div className="text-sm text-muted">
                Complete the sign-in in your browser — the app will update automatically.
              </div>
            )}
            {authError && (
              <div className="text-sm text-red-400">{authError}</div>
            )}
          </div>
        )}
      </section>

      <section className="mb-10 rounded-lg border border-white/10 bg-bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Library folders</h2>
            <p className="text-sm text-muted">
              Folders containing your anime video files. Subfolders are scanned recursively.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={async () => setFolders(await window.api.library.addFolder())}
              className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
            >
              <FolderPlus size={14} /> Add folder
            </button>
            <button
              disabled={busy || folders.length === 0}
              onClick={scan}
              className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm hover:bg-accent-hover disabled:opacity-50"
            >
              <RefreshCcw size={14} /> Scan library
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {folders.length === 0 && (
            <div className="rounded-md border border-dashed border-white/10 p-4 text-sm text-muted">
              No folders added yet.
            </div>
          )}
          {folders.map((f) => (
            <div
              key={f}
              className="flex items-center justify-between rounded-md bg-bg-elev px-3 py-2"
            >
              <div className="flex items-center gap-2 truncate text-sm">
                <Folder size={14} className="shrink-0 text-muted" />
                <span className="truncate font-mono">{f}</span>
              </div>
              <button
                onClick={async () =>
                  setFolders(await window.api.library.removeFolder(f))
                }
                className="text-muted hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-bg-card p-6">
        <h2 className="mb-2 text-xl font-semibold">About</h2>
        <p className="text-sm text-muted">
          AniTrack is a personal anime tracker with a Netflix-style UI, MAL two-way sync, and a local file player.
          It is not affiliated with MyAnimeList or any streaming service. For streaming, use a licensed provider
          via the "Watch on" menu on each show.
        </p>
      </section>
    </div>
  );
}
