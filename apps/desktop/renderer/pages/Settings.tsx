import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useAppStore } from "../store/useAppStore";
import { BookMarked, Cloud, DownloadCloud, Github, Globe, Info, Library, Music2, RefreshCcw, ShieldCheck, type LucideIcon } from "lucide-react";
import BrandMark from "../components/BrandMark";
import { BackgroundMusicSettings } from "../components/BackgroundMusic";
import type { AniListAuthState } from "../../../../packages/shared/types";
import type { RuntimeConfigStatus } from "../../../../packages/shared/runtime-config";
import { getSyncConfig, setSyncConfig, clearSyncConfig, pullAndMerge, pushAllProgress } from "../lib/supabase-sync";
import { syncMangaReading } from "../lib/manga-sync";
import { syncNovelReading } from "../lib/novel-sync";

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "mal", label: "MyAnimeList", icon: BookMarked },
  { id: "anilist", label: "AniList", icon: Library },
  { id: "pahe", label: "AnimePahe URL", icon: Globe },
  { id: "updates", label: "Updates", icon: DownloadCloud },
  { id: "providers", label: "Provider fixes", icon: ShieldCheck },
  { id: "sync", label: "Cross-device Sync", icon: Cloud },
  { id: "music", label: "Background music", icon: Music2 },
  { id: "about", label: "About", icon: Info },
];

function SettingsHead({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="icon-tile"><Icon size={18} strokeWidth={2.1} /></span>
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
    </div>
  );
}

export default function Settings() {
  const mal = useAppStore((s) => s.mal);
  const al = useAppStore((s) => s.al);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const setScanStatus = useAppStore((s) => s.setScanStatus);
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "/settings#music" (the top bar's music button) opens at that section.
  const { hash } = useLocation();
  useEffect(() => {
    const id = hash.slice(1);
    if (!id) return;
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    return () => clearTimeout(timer);
  }, [hash]);
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
  const [automationStatus, setAutomationStatus] = useState<RuntimeConfigStatus | null>(null);
  const [automationBusy, setAutomationBusy] = useState(false);

  useEffect(() => {
    const applySnapshot = (snapshot: any) => {
      switch (snapshot?.phase) {
        case "checking": setUpdateState({ phase: "checking" }); break;
        case "available": setUpdateState({ phase: "available", version: snapshot.version ?? "?" }); break;
        case "downloading": setUpdateState({ phase: "downloading", percent: snapshot.percent ?? 0 }); break;
        case "ready": setUpdateState({ phase: "ready", version: snapshot.version ?? "?" }); break;
        case "error": setUpdateState({ phase: "error", message: snapshot.message ?? "Update failed" }); break;
        case "idle": if (snapshot.checkedAt) setUpdateState({ phase: "not-available" }); break;
      }
    };
    (window.api.updater as any).status?.().then(applySnapshot).catch(() => {});
    const unState = window.api.on("update:state", applySnapshot);
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
    return () => { unState(); unAvail(); unNot(); unProg(); unDone(); unErr(); };
  }, []);

  useEffect(() => {
    if (!window.api.automation) return;
    window.api.automation.status().then(setAutomationStatus).catch(() => {});
    return window.api.on("automation:status", (value: unknown) => {
      setAutomationStatus(value as RuntimeConfigStatus);
    });
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

  // Cross-device sync (GitHub Gist)
  const cfg = getSyncConfig();
  const [gistToken, setGistToken] = useState(cfg?.token ?? "");
  const [supaSaved,  setSupaSaved]  = useState(false);
  const [supaStatus, setSupaStatus] = useState<string | null>(null);
  const [supaError,  setSupaError]  = useState<string | null>(null);

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
    <div className="mx-auto flex max-w-[1240px] gap-10 px-8 py-8">
      <nav className="sticky top-6 hidden h-fit w-56 shrink-0 lg:block">
        <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-3">On this page</div>
        {SECTIONS.filter((x) => (x.id !== "providers" || (window.api.automation && automationStatus)) && (x.id !== "music" || window.api.music)).map((x) => (
          <button
            key={x.id}
            onClick={() => document.getElementById(x.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13.5px] font-medium text-ink-2 transition hover:bg-white/[0.05] hover:text-white"
          >
            <x.icon size={16} className="text-ink-3" />
            {x.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 space-y-6">
      <header className="mb-2 flex items-center gap-4">
        <BrandMark size={52} />
        <div>
          <h1 className="text-[32px] font-extrabold leading-tight tracking-tight">Settings</h1>
          <p className="text-sm text-ink-3">Accounts, sync, providers, music and updates</p>
        </div>
      </header>

      <section id="mal" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={BookMarked} title="MyAnimeList" />
        <p className="mb-5 text-sm leading-relaxed text-ink-2">
          Two-way sync with your MAL list. Sign in with your MyAnimeList account to import
          your anime list and keep progress in sync automatically.
        </p>

        {mal.connected ? (
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <div>
              <div className="text-sm text-muted">Connected as</div>
              <div className="font-medium">{mal.username || "(unknown)"}</div>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={pull}
                className="btn btn-primary"
              >
                <RefreshCcw size={14} />
                Sync from MAL
              </button>
              <button
                onClick={async () => {
                  await window.api.mal.disconnect();
                  refreshAll();
                }}
                className="btn btn-secondary"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {mal.needsReconnect && !awaitingAuth && (
              <div className="text-sm text-amber-300">
                MyAnimeList signed AniTrack out, so list changes are waiting here. Reconnect to send them.
              </div>
            )}
            <button
              onClick={connectMal}
              disabled={awaitingAuth}
              className="btn btn-primary"
            >
              {awaitingAuth ? "Waiting for browser…" : mal.needsReconnect ? "Reconnect MyAnimeList" : "Connect MyAnimeList"}
            </button>
            {awaitingAuth && (
              <div className="text-sm text-muted">
                Complete the sign-in in your browser — the app will update automatically.
              </div>
            )}
            {authError && (
              <div className="text-sm text-red-300">{authError}</div>
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
                {malUsingCustom && <span className="ml-1 text-emerald-400">Currently using custom.</span>}
              </p>
              <div className="flex gap-2">
                <input
                  value={malClientId}
                  onChange={(e) => { setMalClientIdInput(e.target.value); setMalClientSaved(false); }}
                  placeholder="MAL Client ID (optional)"
                  className="input flex-1 font-mono"
                />
                <button
                  onClick={async () => {
                    const r = await window.api.mal.setClientId(malClientId);
                    setMalUsingCustom(r.usingCustom);
                    setMalClientSaved(true);
                    setTimeout(() => setMalClientSaved(false), 2000);
                  }}
                  className="btn btn-primary"
                >
                  {malClientSaved ? "Saved ✓" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section id="anilist" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={Library} title="AniList" />
        <p className="mb-5 text-sm leading-relaxed text-ink-2">
          Sync your watch list with AniList. You need a free AniList API client ID —
          create one at <span className="text-white/60">anilist.co/settings/developer</span> with
          redirect URL set to <span className="font-mono text-white/60">http://localhost</span>.
        </p>

        {alState.connected ? (
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <div>
              <div className="text-sm text-muted">Connected as</div>
              <div className="font-medium">{alState.username || "(unknown)"}</div>
            </div>
            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={pullAniList}
                className="btn btn-primary"
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
                className="btn btn-secondary"
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
                  className="input flex-1"
                />
              </div>
            )}
            <button
              onClick={connectAniList}
              disabled={alAwaitingAuth}
              className="btn btn-primary"
            >
              {alAwaitingAuth ? "Waiting for browser…" : "Connect AniList"}
            </button>
            {alAwaitingAuth && (
              <div className="text-sm text-muted">
                Complete the sign-in in the popup window — the app will update automatically.
              </div>
            )}
            {alAuthError && (
              <div className="text-sm text-red-300">{alAuthError}</div>
            )}
          </div>
        )}
      </section>

      <section id="pahe" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={Globe} title="AnimePahe URL" />
        <p className="mb-5 text-sm leading-relaxed text-ink-2">
          If AnimePahe moves to a new domain (e.g. .si, .cx), update it here.
          The app will reconnect immediately — no restart needed.
        </p>
        <div className="flex gap-2">
          <input
            value={paheUrl}
            onChange={(e) => { setPaheUrl(e.target.value); setPaheUrlSaved(false); setPaheUrlError(null); }}
            placeholder="https://animepahe.pw"
            className="input flex-1 font-mono"
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
            className="btn btn-primary"
          >
            {paheUrlSaved ? "Saved ✓" : "Save"}
          </button>
        </div>
        {paheUrlError && (
          <div className="mt-2 text-sm text-red-300">{paheUrlError}</div>
        )}
      </section>

      <section id="updates" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={DownloadCloud} title="Updates" />
        <p className="mb-5 text-sm leading-relaxed text-ink-2">
          AniTrack checks for updates automatically on startup. You can also check manually here.
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={checkForUpdates}
            disabled={updateState.phase === "checking" || updateState.phase === "downloading"}
            className="btn btn-primary"
          >
            {updateState.phase === "checking" ? "Checking…" : "Check for Updates"}
          </button>

          {updateState.phase === "not-available" && (
            <span className="text-sm text-emerald-400">You're up to date.</span>
          )}
          {updateState.phase === "available" && (
            <span className="text-sm text-muted">v{updateState.version} found — downloading…</span>
          )}
          {updateState.phase === "downloading" && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-accent-gradient transition-all" style={{ width: `${updateState.percent}%` }} />
              </div>
              <span className="text-sm text-muted">{updateState.percent}%</span>
            </div>
          )}
          {updateState.phase === "ready" && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-emerald-400">v{updateState.version} ready to install.</span>
              <button
                onClick={() => window.api.updater.install()}
                className="btn btn-primary btn-sm"
              >
                {Capacitor.isNativePlatform() ? "Download Update" : "Restart Now"}
              </button>
              <button
                onClick={() => setUpdateState({ phase: "idle" })}
                className="btn btn-secondary btn-sm"
              >
                Later
              </button>
            </div>
          )}
          {updateState.phase === "error" && (
            <span className="text-sm text-red-300">{updateState.message}</span>
          )}
        </div>
      </section>

      {window.api.automation && automationStatus && (
        <section id="providers" className="panel scroll-mt-6 p-6">
          <SettingsHead icon={ShieldCheck} title="Automatic Provider Fixes" />
          <p className="mb-5 text-sm leading-relaxed text-ink-2">
            Signed provider and network rules update independently of the desktop installer. The last verified
            configuration remains active if an update cannot be verified.
          </p>
          <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
            <div><span className="text-muted">Revision:</span> {automationStatus.revision} ({automationStatus.source})</div>
            {automationStatus.config.providerOrder.map((providerId) => {
              const provider = automationStatus.config.providers[providerId];
              const label = providerId === "animepahe"
                ? "AnimePahe"
                : providerId.charAt(0).toUpperCase() + providerId.slice(1);
              return (
                <div key={providerId}>
                  <span className="text-muted">{label}:</span>{" "}
                  {provider.enabled ? provider.baseUrls[0] : "Disabled until verified"}
                </div>
              );
            })}
            <div>
              <span className="text-muted">Last checked:</span>{" "}
              {automationStatus.lastCheckedAt ? new Date(automationStatus.lastCheckedAt).toLocaleString() : "Not yet"}
            </div>
          </div>
          <button
            disabled={automationBusy}
            onClick={async () => {
              setAutomationBusy(true);
              try { setAutomationStatus(await window.api.automation!.refresh()); }
              finally { setAutomationBusy(false); }
            }}
            className="btn btn-secondary"
          >
            {automationBusy ? "Refreshing…" : "Refresh provider fixes"}
          </button>
          {automationStatus.error && (
            <p className="mt-3 text-sm text-amber-400">
              Refresh failed; continuing with the last verified rules. {automationStatus.error}
            </p>
          )}
          {automationStatus.config.notice && (
            <p className="mt-3 text-sm text-muted">{automationStatus.config.notice}</p>
          )}
        </section>
      )}

      <section id="sync" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={Cloud} title="Cross-device Sync" />
        <p className="mb-5 text-sm leading-relaxed text-ink-2">
          Syncs your continue-watching progress across desktop and Android via a private GitHub Gist —
          nothing to host and it never expires. Create a token at{" "}
          <span className="font-mono text-white/70">github.com/settings/tokens</span> with the{" "}
          <span className="font-mono text-white/70">gist</span> scope, then paste it here on each device
          (the gist is created/found automatically — use the same token on both).
        </p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted">GitHub Token (gist scope)</label>
            <input
              type="password"
              value={gistToken}
              onChange={(e) => setGistToken(e.target.value)}
              placeholder="ghp_… or github_pat_…"
              className="input"
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => {
                setSyncConfig({ token: gistToken.trim(), gistId: "" });
                setSupaSaved(true);
                setSupaStatus(null);
                setSupaError(null);
                setTimeout(() => setSupaSaved(false), 2000);
              }}
              disabled={!gistToken.trim()}
              className="btn btn-primary"
            >
              {supaSaved ? "Saved ✓" : "Save"}
            </button>
            <button
              onClick={async () => {
                setSupaStatus("Pulling…");
                setSupaError(null);
                try {
                  const n = await pullAndMerge();
                  const m = await syncMangaReading();
                  const v = await syncNovelReading();
                  await refreshAll();
                  setSupaStatus(`Pulled ${n} updated entries${m ? ` and ${m} manga reading changes` : ""}${v ? ` and ${v} novel changes` : ""}`);
                } catch (e) {
                  setSupaStatus(null);
                  setSupaError(`Pull failed: ${(e as Error).message}`);
                }
              }}
              disabled={!getSyncConfig()}
              className="btn btn-secondary"
            >
              <RefreshCcw size={14} /> Pull now
            </button>
            <button
              onClick={async () => {
                setSupaStatus("Pushing all local data…");
                setSupaError(null);
                try {
                  const n = await pushAllProgress();
                  // Manga and novel reading are reconciled whole, which uploads every local row.
                  await syncMangaReading();
                  await syncNovelReading();
                  setSupaStatus(`Pushed ${n} entries to cloud, with manga and novel reading`);
                } catch (e) {
                  setSupaStatus(null);
                  setSupaError(`Push failed: ${(e as Error).message}`);
                }
              }}
              disabled={!getSyncConfig()}
              className="btn btn-secondary"
            >
              Push all to cloud
            </button>
            {getSyncConfig() && (
              <button
                onClick={() => { clearSyncConfig(); setGistToken(""); setSupaStatus(null); setSupaError(null); }}
                className="btn btn-secondary"
              >
                Disconnect
              </button>
            )}
          </div>
          {supaStatus && <p className="text-sm text-muted">{supaStatus}</p>}
          {supaError  && <p className="text-sm text-red-300">{supaError}</p>}
        </div>
      </section>

      {window.api.music && (
        <section id="music" className="panel scroll-mt-6 p-6">
          <SettingsHead icon={Music2} title="Background music" />
          <BackgroundMusicSettings />
        </section>
      )}

      <section id="about" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={Info} title="About" />
        <p className="mb-2 text-sm leading-relaxed text-ink-2">
          AniTrack keeps your anime and manga in one place. Your MyAnimeList and AniList lists stay in sync,
          episodes play and download right here, manga reads online or offline, and your progress follows you to
          the Android app.
        </p>
        <p className="mb-4 text-xs leading-relaxed text-ink-3">
          An unofficial personal project, not affiliated with MyAnimeList, AniList or any streaming or manga site.
          AniTrack doesn't host any media: everything is loaded from the sites you use.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="chip h-8 text-sm">
            <span className="text-muted">Version</span>
            <span className="font-mono font-medium">{__APP_VERSION__}</span>
          </div>
          <a href="https://github.com/kil-04/AniTrack" target="_blank" rel="noreferrer" className="chip h-8 text-sm">
            <Github size={14} />
            Source and releases
          </a>
        </div>
      </section>
      </div>
    </div>
  );
}
