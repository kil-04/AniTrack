import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { useAppStore } from "../store/useAppStore";
import { BookMarked, Cloud, DownloadCloud, GitBranch as Github, Globe, Info, Library, Music2, Palette, RefreshCcw, Settings as SettingsIcon, ShieldCheck, type LucideIcon } from "lucide-react";
import BrandMark from "../components/BrandMark";
import { BackgroundMusicSettings } from "../components/BackgroundMusic";
import BrowserNotifications from "../components/BrowserNotifications";
import SourceOverview from "../components/SourceOverview";
import { PixelBanner, PixelSceneCanvas } from "../components/PixelScene";
import { setMotion, setPalette, setSkin, useMotion, usePalette, useSkin, type PixelPalette } from "../lib/skin";
import type { AniListAuthState } from "../../../../packages/shared/types";
import type { RuntimeConfigStatus } from "../../../../packages/shared/runtime-config";
import type { AccountSyncStatus } from "../../../../../lib/account-sync";
import { getSyncConfig, setSyncConfig, clearSyncConfig, pullAndMerge, pushAllProgress } from "../lib/supabase-sync";
import { syncMangaReading } from "../lib/manga-sync";
import { syncNovelReading } from "../lib/novel-sync";

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "mal", label: "MyAnimeList", icon: BookMarked },
  { id: "anilist", label: "AniList", icon: Library },
  { id: "pahe", label: "AnimePahe URL", icon: Globe },
  { id: "updates", label: "Updates", icon: DownloadCloud },
  { id: "providers", label: "Provider fixes", icon: ShieldCheck },
  { id: "sync", label: "Cross-device Sync", icon: Cloud },
  { id: "music", label: "Background music", icon: Music2 },
  { id: "reminders", label: "Episode reminders", icon: Info },
  { id: "sources", label: "Sources", icon: Globe },
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

/** Pixel mode: retrowave pixel art across the app, with a preview of its banner. */
function AppearanceSettings() {
  const pixel = useSkin() === "pixel";
  const palette = usePalette();
  const motion = useMotion();
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="pixel-preview" aria-hidden="true"><PixelSceneCanvas scene="sakura" pixel={2} /></div>
      <div className="min-w-0 flex-1">
        <button
          role="switch"
          aria-checked={pixel}
          onClick={() => setSkin(pixel ? "default" : "pixel")}
          className="flex items-center gap-3 text-sm font-semibold text-white"
        >
          <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${pixel ? "bg-accent" : "bg-white/20"}`}>
            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${pixel ? "left-6" : "left-1"}`} />
          </span>
          Pixel mode
        </button>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-3">
          Retrowave pixel art across the app: square corners, a pixel font for headings and a pixel-art banner on
          every page, in neon colours or a retrowave AniTrack blue. Saved on this device.
        </p>
        {pixel && (
          <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Pixel mode colours">
            <span className="mr-1 text-xs text-ink-3">Colours</span>
            {([["neon", "Neon"], ["blue", "AniTrack blue"]] as [PixelPalette, string][]).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={palette === id} onClick={() => setPalette(id)} className={`chip ${palette === id ? "chip-active" : ""}`}>
                <span className={`h-2.5 w-2.5 ${id === "neon" ? "bg-[#ff2a9d]" : "bg-[#3d8bff]"}`} />
                {label}
              </button>
            ))}
          </div>
        )}
        {pixel && (
          <button
            role="switch"
            aria-checked={motion}
            onClick={() => setMotion(!motion)}
            className="mt-4 flex items-center gap-3 text-sm font-semibold text-white"
            title="Twinkling stars, a blinking skyline, a passing cat and shooting stars behind the pages"
          >
            <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${motion ? "bg-accent" : "bg-white/20"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${motion ? "left-[18px]" : "left-0.5"}`} />
            </span>
            Animated background
          </button>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const pixel = useSkin() === "pixel";
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
  const [accountSync, setAccountSync] = useState<AccountSyncStatus | null>(null);
  const [accountSyncBusy, setAccountSyncBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void window.api.accountSync?.status().then(value => { if (active) setAccountSync(value); });
    const off = window.api.on("account-sync:state", value => { if (active) setAccountSync(value as AccountSyncStatus); });
    return () => { active = false; off(); };
  }, []);

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
    const unsubAlState = window.api.on("al:state-changed", value => setAlState(value as AniListAuthState));
    return () => { unsub(); unsubErr(); unsubAl(); unsubAlErr(); unsubAlState(); };
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

  async function pushLocalMalList() {
    setBusy(true);
    setScanStatus('Sending the local list to MAL…');
    try {
      const result = await window.api.mal.push();
      setScanStatus(`Sent ${result.pushed} entries to MAL${result.errors ? `; ${result.errors} waiting for retry` : ''}`);
    } catch (error) {
      setScanStatus(`MAL sync failed: ${(error as Error).message}`);
    } finally {setBusy(false);}
  }

  async function connectAniList() {
    if (!alClientId.trim() && !alState.hasClientId) {
      setAlAuthError("Paste your AniList client ID first.");
      return;
    }
    setAlAuthError(null);
    if (alClientId.trim()) {
      const saved = await window.api.al.setClientId(alClientId.trim());
      setAlState(saved);
    }
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
      <section className="rounded-2xl border border-accent/20 bg-accent/[0.06] p-5">
        <h2 className="text-base font-bold">AniTrack Web</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">The same AniTrack interface, with your web library, reading progress, and downloads saved in this browser. Keep this site's storage to keep your saved files. Cross-device sync uses the same optional private GitHub gist.</p>
        <details className="mt-3 text-sm text-ink-2"><summary className="cursor-pointer font-semibold text-white">Browser connections and source availability</summary>
          <p className="mt-3">Web account sign-in uses a separate OAuth client registration. Register your public client ID with callback <code className="break-all">{location.origin}/</code>, then enter it below. MyAnimeList web clients that require a client secret also need the site's private server configuration.</p>
          <p className="mt-3">XComic, NovelBuddy, NovelArchive, City Pop, and shonen.to use their normal source APIs. Existing MangaBall links remain recognized, but its image host currently declines delivery from this website host. A source can decline requests from the website host. AnimePahe, Anikoto, Miruro, MKissa, MangaDot, and Comix depend on app-managed website sessions; those sessions cannot be copied into a hosted website. Use the installed apps for those connections.</p>
          <p className="mt-3">Internet Archive downloads and supported episodes and chapters are stored locally. Downloads need the tab to stay open. Browser autoplay and storage limits still apply; YouTube playback remains online only.</p>
        </details>
      </section>
      {pixel ? (
        <header className="mb-2"><PixelBanner scene="terminal" icon={SettingsIcon} title="Settings" subtitle="Appearance, accounts, sync, providers, music and updates" /></header>
      ) : (
        <header className="mb-2 flex items-center gap-4">
          <BrandMark size={52} />
          <div>
            <h1 className="text-[32px] font-extrabold leading-tight tracking-tight">Settings</h1>
            <p className="text-sm text-ink-3">Appearance, accounts, sync, providers, music and updates</p>
          </div>
        </header>
      )}

      <section id="appearance" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={Palette} title="Appearance" />
        <AppearanceSettings />
      </section>

      {accountSync && (
        <section className="panel p-6" aria-label="Account sync status">
          <SettingsHead icon={Cloud} title="Account sync" />
          <p className="text-sm text-ink-2" role="status">
            {accountSync.syncing ? "Sending saved account changes…" : accountSync.pending ? `${accountSync.pending} account change${accountSync.pending === 1 ? " is" : "s are"} waiting. They retry when you reconnect.` : "Your account changes are saved. Connected lists sync automatically."}
          </p>
          {Object.entries(accountSync.errors).map(([service, message]) => <p key={service} className="mt-2 text-sm text-amber-300">{service === "al" ? "AniList" : "MyAnimeList"}: {message}</p>)}
          {accountSync.pending > 0 && <button className="btn btn-secondary mt-4" disabled={accountSyncBusy || accountSync.syncing} onClick={async () => {
            setAccountSyncBusy(true);
            try { const state = await window.api.accountSync!.retry(); setAccountSync(state); }
            finally { setAccountSyncBusy(false); }
          }}><RefreshCcw size={14} /> Retry waiting changes</button>}
        </section>
      )}

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
              <button disabled={busy} onClick={pushLocalMalList} className="btn btn-secondary">Send local list</button>
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
                A shared web client can be configured for this site. Leave your custom ID blank to use it.
                The installed app's shared client uses a different callback.
                Create your own at <span className="text-white/60">myanimelist.net/apiconfig</span> (App Type: Other, Redirect URL: <span className="font-mono">{location.origin}/</span>).
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
          Sync your watch list with AniList. {alState.hasClientId ? "A web client is configured, so you can connect directly. To use your own, create one" : "This site needs a web client ID. Create one"} at <span className="text-white/60">anilist.co/settings/developer</span> with
          redirect URL set to <span className="break-all font-mono text-white/60">{location.origin}/</span>.
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
              <div className="flex gap-2">
                <input
                  value={alClientId}
                  onChange={(e) => setAlClientId(e.target.value)}
                  placeholder={alState.hasClientId ? "AniList Client ID (leave blank to use saved)" : "AniList Client ID"}
                  className="input flex-1"
                />
              </div>
            <button
              onClick={connectAniList}
              disabled={alAwaitingAuth}
              className="btn btn-primary"
            >
              {alAwaitingAuth ? "Waiting for browser…" : "Connect AniList"}
            </button>
            {alAwaitingAuth && (
              <div className="text-sm text-muted">
                Complete the sign-in; this tab will return to AniTrack automatically.
              </div>
            )}
            {alAuthError && (
              <div className="text-sm text-red-300">{alAuthError}</div>
            )}
          </div>
        )}
      </section>

      <section id="pahe" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={Globe} title="AnimePahe website link" />
        <p className="mb-5 text-sm leading-relaxed text-ink-2">
          Playback availability is shown on Sources. This address changes the link that opens AnimePahe's website.
          <a href={paheUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-accent underline">Open website ↗</a>
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
          Reload the website to open the latest deployed version. Your saved library and downloads stay in this browser.
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => location.reload()}
            disabled={updateState.phase === "checking" || updateState.phase === "downloading"}
            className="btn btn-primary"
          >
            Reload website
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

      <section id="reminders" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={Info} title="Episode reminders" />
        <BrowserNotifications />
      </section>

      <section id="sources" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={Globe} title="Sources" />
        <details><summary className="cursor-pointer text-sm font-semibold text-accent">See every anime and manga source</summary><div className="mt-5"><SourceOverview /></div></details>
      </section>

      <section id="about" className="panel scroll-mt-6 p-6">
        <SettingsHead icon={Info} title="About" />
        <p className="mb-2 text-sm leading-relaxed text-ink-2">
          AniTrack keeps anime, manga and novels in one place. Stream episodes, read chapters and save
          supported media offline. Connect MyAnimeList or AniList to sync your lists, or set up
          Cross-device Sync to share reading and watch progress with the installed apps.
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
