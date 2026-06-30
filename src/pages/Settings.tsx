import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useAppStore } from "../store/useAppStore";
import { RefreshCcw } from "lucide-react";
import type { AniListAuthState } from "../../shared/types";
import { getSyncConfig, setSyncConfig, clearSyncConfig, pullAndMerge, pushAllProgress } from "../lib/supabase-sync";

export default function Settings() {
  const mal = useAppStore((s) => s.mal);
  const al = useAppStore((s) => s.al);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const setScanStatus = useAppStore((s) => s.setScanStatus);
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingAuth, setAwaitingAuth] = useState(false);

  // AnimePahe URL
  const [paheUrl, setPaheUrl] = useState("https://animepahe.pw");
  const [paheUrlSaved, setPaheUrlSaved] = useState(false);
  const [paheUrlError, setPaheUrlError] = useState<string | null>(null);
  useEffect(() => { window.api.pahe.getUrl().then(setPaheUrl); }, []);

  // Updater
  type UpdateState =
    | { phase: "idle" }
    | { phase: "checking" }
    | { phase: "not-available" }
    | { phase: "available"; version: string }
    | { phase: "downloading"; percent: number }
    | { phase: "ready"; version: string }
    | { phase: "error"; message: string };
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: "idle" });

  useEffect(() => {
    const unAvail = window.api.on("update:available", (info: unknown) => {
      const v = (info as any)?.version ?? "?";
      setUpdateState({ phase: "available", version: v });
    });
    const unNot = window.api.on("update:not-available", () => {
      setUpdateState({ phase: "not-available" });
    });
    const unProg = window.api.on("update:progress", (info: unknown) => {
      setUpdateState({ phase: "downloading", percent: (info as any)?.percent ?? 0 });
    });
    const unDone = window.api.on("update:downloaded", (info: unknown) => {
      const v = (info as any)?.version ?? "?";
      setUpdateState({ phase: "ready", version: v });
    });
    const unErr = window.api.on("update:error", (msg: unknown) => {
      setUpdateState({ phase: "error", message: String(msg) });
    });
    return () => { unAvail(); unNot(); unProg(); unDone(); unErr(); };
  }, []);

  async function checkForUpdates() {
    setUpdateState({ phase: "checking" });
    const r = await window.api.updater.check();
    if (!r.ok) setUpdateState({ phase: "error", message: r.reason ?? "Unknown error" });
    // result arrives via events above
  }

  // AniList state
  const [alClientId, setAlClientId] = useState("");
  const [alState, setAlState] = useState<AniListAuthState>(al);
  const [alAwaitingAuth, setAlAwaitingAuth] = useState(false);
  const [alAuthError, setAlAuthError] = useState<string | null>(null);

  // Supabase sync
  const cfg = getSyncConfig();
  const [supaUrl,    setSupaUrl]    = useState(cfg?.url    ?? "");
  const [supaKey,    setSupaKey]    = useState(cfg?.key    ?? "");
  const [supaUser,   setSupaUser]   = useState(cfg?.userId ?? "");
  const [supaSaved,  setSupaSaved]  = useState(false);
  const [supaStatus, setSupaStatus] = useState<string | null>(null);
  const [supaError,  setSupaError]  = useState<string | null>(null);

  // Auto-fill user ID from MAL username when connecting for the first time
  useEffect(() => {
    if (!supaUser && mal.username) setSupaUser(mal.username);
  }, [mal.username, supaUser]);

  // MAL custom client ID
  const [malClientId, setMalClientIdInput] = useState("");
  const [malUsingCustom, setMalUsingCustom] = useState(false);
  const [malClientSaved, setMalClientSaved] = useState(false);
  const [showMalAdvanced, setShowMalAdvanced] = useState(false);
  useEffect(() => {
    window.api.mal.clientInfo().then((info) => {
      setMalUsingCustom(info.usingCustom);
      if (info.clientId) setMalClientIdInput(info.clientId);
    });
  }, []);

  useEffect(() => {
    window.api.al.state().then(setAlState);

    // Listen for MAL auth completion from the HTTP callback server.
    const unsub = window.api.on("mal:auth-complete", () => {
      setAwaitingAuth(false);
      refreshAll();
    });
    const unsubErr = window.api.on("mal:auth-error", (msg: unknown) => {
      setAwaitingAuth(false);
      setAuthError(String(msg));
    });
    const unsubAl = window.api.on("al:auth-complete", (state: unknown) => {
      setAlAwaitingAuth(false);
      setAlState(state as AniListAuthState);
      refreshAll();
    });
    const unsubAlErr = window.api.on("al:auth-error", (msg: unknown) => {
      setAlAwaitingAuth(false);
      setAlAuthError(String(msg));
    });
    return () => { unsub(); unsubErr(); unsubAl(); unsubAlErr(); };
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

  async function connectAniList() {
    if (!alClientId.trim()) {
      setAlAuthError("Paste your AniList client ID first.");
      return;
    }
    setAlAuthError(null);
    const saved = await window.api.al.setClientId(alClientId.trim());
    setAlState(saved);
    const r = await window.api.al.beginAuth();
    if (!r.ok) { setAlAuthError(r.reason ?? "Failed to start auth"); return; }
    setAlAwaitingAuth(true);
  }

  async function pullAniList() {
    setBusy(true);
    setScanStatus("Pulling list from AniList...");
    try {
      const r = await window.api.al.pull();
      setScanStatus(`Imported ${r.imported} entries from AniList`);
      await refreshAll();
    } catch (e) {
      setScanStatus(`AniList pull failed: ${(e as Error).message}`);
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

        <div className="mt-4 border-t border-white/5 pt-3">
          <button
            onClick={() => setShowMalAdvanced((v) => !v)}
            className="text-xs text-muted hover:text-white"
          >
            {showMalAdvanced ? "▾" : "▸"} Advanced
          </button>
          {showMalAdvanced && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted">
                Custom MAL client ID. Leave blank to use the built-in shared one.
                Create your own at <span className="text-white/60">myanimelist.net/apiconfig</span> (App Type: Other, Redirect URL: <span className="font-mono">https://malsync.moe/mal/oauth</span>).
                {malUsingCustom && <span className="ml-1 text-green-400">Currently using custom.</span>}
              </p>
              <div className="flex gap-2">
                <input
                  value={malClientId}
                  onChange={(e) => { setMalClientIdInput(e.target.value); setMalClientSaved(false); }}
                  placeholder="MAL Client ID (optional)"
                  className="flex-1 rounded-md border border-white/10 bg-bg-elev px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none"
                />
                <button
                  onClick={async () => {
                    const r = await window.api.mal.setClientId(malClientId);
                    setMalUsingCustom(r.usingCustom);
                    setMalClientSaved(true);
                    setTimeout(() => setMalClientSaved(false), 2000);
                  }}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent-hover"
                >
                  {malClientSaved ? "Saved ✓" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mb-10 rounded-lg border border-white/10 bg-bg-card p-6">
        <h2 className="mb-2 text-xl font-semibold">AniList</h2>
        <p className="mb-4 text-sm text-muted">
          Sync your watch list with AniList. You need a free AniList API client ID —
          create one at <span className="text-white/60">anilist.co/settings/developer</span> with
          redirect URL set to <span className="font-mono text-white/60">http://localhost</span>.
        </p>

        {alState.connected ? (
          <div className="flex items-center justify-between rounded-md bg-bg-elev px-4 py-3">
            <div>
              <div className="text-sm text-muted">Connected as</div>
              <div className="font-medium">{alState.username || "(unknown)"}</div>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={pullAniList}
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
              >
                <RefreshCcw size={14} />
                Sync from AniList
              </button>
              <button
                onClick={async () => {
                  await window.api.al.disconnect();
                  const s = await window.api.al.state();
                  setAlState(s);
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
            {!alState.hasClientId && (
              <div className="flex gap-2">
                <input
                  value={alClientId}
                  onChange={(e) => setAlClientId(e.target.value)}
                  placeholder="AniList Client ID"
                  className="flex-1 rounded-md border border-white/10 bg-bg-elev px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
              </div>
            )}
            <button
              onClick={connectAniList}
              disabled={alAwaitingAuth}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
            >
              {alAwaitingAuth ? "Waiting for browser…" : "Connect AniList"}
            </button>
            {alAwaitingAuth && (
              <div className="text-sm text-muted">
                Complete the sign-in in the popup window — the app will update automatically.
              </div>
            )}
            {alAuthError && (
              <div className="text-sm text-red-400">{alAuthError}</div>
            )}
          </div>
        )}
      </section>

      <section className="mb-10 rounded-lg border border-white/10 bg-bg-card p-6">
        <h2 className="mb-2 text-xl font-semibold">AnimePahe URL</h2>
        <p className="mb-4 text-sm text-muted">
          If AnimePahe moves to a new domain (e.g. .si, .cx), update it here.
          The app will reconnect immediately — no restart needed.
        </p>
        <div className="flex gap-2">
          <input
            value={paheUrl}
            onChange={(e) => { setPaheUrl(e.target.value); setPaheUrlSaved(false); setPaheUrlError(null); }}
            placeholder="https://animepahe.pw"
            className="flex-1 rounded-md border border-white/10 bg-bg-elev px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none"
          />
          <button
            onClick={async () => {
              const r = await window.api.pahe.setUrl(paheUrl);
              if (!r.ok) {
                setPaheUrlError(r.reason ?? "Invalid URL");
                return;
              }
              setPaheUrl(r.url);
              setPaheUrlError(null);
              setPaheUrlSaved(true);
              setTimeout(() => setPaheUrlSaved(false), 2000);
            }}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent-hover"
          >
            {paheUrlSaved ? "Saved ✓" : "Save"}
          </button>
        </div>
        {paheUrlError && (
          <div className="mt-2 text-sm text-red-400">{paheUrlError}</div>
        )}
      </section>

      <section className="mb-10 rounded-lg border border-white/10 bg-bg-card p-6">
        <h2 className="mb-2 text-xl font-semibold">Updates</h2>
        <p className="mb-4 text-sm text-muted">
          AniTrack checks for updates automatically on startup. You can also check manually here.
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={checkForUpdates}
            disabled={updateState.phase === "checking" || updateState.phase === "downloading"}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
          >
            {updateState.phase === "checking" ? "Checking…" : "Check for Updates"}
          </button>

          {updateState.phase === "not-available" && (
            <span className="text-sm text-green-400">You're up to date.</span>
          )}
          {updateState.phase === "available" && (
            <span className="text-sm text-muted">v{updateState.version} found — downloading…</span>
          )}
          {updateState.phase === "downloading" && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${updateState.percent}%` }} />
              </div>
              <span className="text-sm text-muted">{updateState.percent}%</span>
            </div>
          )}
          {updateState.phase === "ready" && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-400">v{updateState.version} ready to install.</span>
              <button
                onClick={() => window.api.updater.install()}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium hover:bg-accent-hover"
              >
                {Capacitor.isNativePlatform() ? "Download Update" : "Restart Now"}
              </button>
              <button
                onClick={() => setUpdateState({ phase: "idle" })}
                className="rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
              >
                Later
              </button>
            </div>
          )}
          {updateState.phase === "error" && (
            <span className="text-sm text-red-400">{updateState.message}</span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-bg-card p-6">
        <h2 className="mb-4 text-xl font-semibold">Cross-device Sync</h2>
        <p className="mb-4 text-sm text-muted">
          Syncs your continue-watching progress across desktop and Android via your own Supabase project.
          Create a free project at <span className="font-mono text-white/70">supabase.com</span>, run the SQL below
          in the SQL Editor, then paste your project URL and anon key here.
        </p>
        <pre className="mb-4 overflow-x-auto rounded bg-black/40 p-3 text-xs text-white/60">{`create table sync_playback (
  user_id text not null,
  anime_id integer not null,
  episode integer not null,
  position_sec real not null default 0,
  duration_sec real not null default 0,
  anime_title text,
  anime_cover_url text,
  animepahe_session text,
  updated_at bigint not null,
  primary key (user_id, anime_id, episode)
);
alter table sync_playback enable row level security;
create policy "anon all" on sync_playback for all to anon using (true) with check (true);`}</pre>
        <div className="space-y-3">
          {(["Project URL", "Anon Key", "Sync User ID"] as const).map((label, i) => {
            const [val, setter] = [
              [supaUrl, setSupaUrl],
              [supaKey, setSupaKey],
              [supaUser, setSupaUser],
            ][i] as [string, (v: string) => void];
            return (
              <div key={label}>
                <label className="mb-1 block text-xs text-muted">{label}</label>
                <input
                  type={label === "Anon Key" ? "password" : "text"}
                  value={val}
                  onChange={(e) => setter(e.target.value)}
                  placeholder={label === "Project URL" ? "https://xxxx.supabase.co" : label === "Anon Key" ? "eyJ..." : "your-mal-username"}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            );
          })}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => {
                setSyncConfig({ url: supaUrl, key: supaKey, userId: supaUser });
                setSupaSaved(true);
                setSupaStatus(null);
                setTimeout(() => setSupaSaved(false), 2000);
              }}
              disabled={!supaUrl || !supaKey || !supaUser}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent-hover disabled:opacity-50"
            >
              {supaSaved ? "Saved ✓" : "Save"}
            </button>
            <button
              onClick={async () => {
                setSupaStatus("Pulling…");
                setSupaError(null);
                try {
                  const n = await pullAndMerge();
                  await refreshAll();
                  setSupaStatus(`Pulled ${n} updated entries`);
                } catch (e) {
                  setSupaStatus(null);
                  setSupaError(`Pull failed: ${(e as Error).message}`);
                }
              }}
              disabled={!supaUrl || !supaKey || !supaUser}
              className="flex items-center gap-2 rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
            >
              <RefreshCcw size={14} /> Pull now
            </button>
            <button
              onClick={async () => {
                setSupaStatus("Pushing all local data…");
                setSupaError(null);
                try {
                  const n = await pushAllProgress();
                  setSupaStatus(`Pushed ${n} entries to cloud`);
                } catch (e) {
                  setSupaStatus(null);
                  setSupaError(`Push failed: ${(e as Error).message}`);
                }
              }}
              disabled={!supaUrl || !supaKey || !supaUser}
              className="rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
            >
              Push all to cloud
            </button>
            {getSyncConfig() && (
              <button
                onClick={() => { clearSyncConfig(); setSupaUrl(""); setSupaKey(""); setSupaUser(""); }}
                className="rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
              >
                Disconnect
              </button>
            )}
          </div>
          {supaStatus && <p className="text-sm text-muted">{supaStatus}</p>}
          {supaError  && <p className="text-sm text-red-400">{supaError}</p>}
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-bg-card p-6">
        <h2 className="mb-2 text-xl font-semibold">About</h2>
        <p className="mb-3 text-sm text-muted">
          AniTrack is a personal anime tracker with a Netflix-style UI, MAL two-way sync, and a local file player.
          It is not affiliated with MyAnimeList or any streaming service. For streaming, use a licensed provider
          via the "Watch on" menu on each show.
        </p>
        <div className="inline-flex items-center gap-2 rounded-md bg-white/5 px-3 py-1.5 text-sm">
          <span className="text-muted">Version</span>
          <span className="font-mono font-medium">{__APP_VERSION__}</span>
        </div>
      </section>
    </div>
  );
}
