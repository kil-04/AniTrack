import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  X,
  Home,
  Loader2,
} from "lucide-react";

export default function StreamingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const startUrl = params.get("url") ?? "https://anikototv.to/";

  const webviewRef = useRef<HTMLElement & {
    src: string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    reload(): void;
    stop(): void;
    getURL(): string;
    getTitle(): string;
    loadURL(url: string): void;
    addEventListener(event: string, fn: (e: any) => void): void;
    removeEventListener(event: string, fn: (e: any) => void): void;
  }>(null);

  const [url, setUrl] = useState(startUrl);
  const [inputUrl, setInputUrl] = useState(startUrl);
  const [loading, setLoading] = useState(true);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  function updateNavState() {
    const wv = webviewRef.current;
    if (!wv) return;
    setCanBack(wv.canGoBack());
    setCanForward(wv.canGoForward());
    const current = wv.getURL();
    if (current) {
      setUrl(current);
      setInputUrl(current);
    }
  }

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onStartLoad = () => setLoading(true);
    const onFinishLoad = () => { setLoading(false); updateNavState(); };
    const onNavigate = (e: any) => { setInputUrl(e.url); setUrl(e.url); updateNavState(); };
    const onNavInPage = () => { updateNavState(); };

    wv.addEventListener("did-start-loading", onStartLoad);
    wv.addEventListener("did-finish-load", onFinishLoad);
    wv.addEventListener("did-stop-loading", onFinishLoad);
    wv.addEventListener("did-navigate", onNavigate);
    wv.addEventListener("did-navigate-in-page", onNavInPage);

    return () => {
      wv.removeEventListener("did-start-loading", onStartLoad);
      wv.removeEventListener("did-finish-load", onFinishLoad);
      wv.removeEventListener("did-stop-loading", onFinishLoad);
      wv.removeEventListener("did-navigate", onNavigate);
      wv.removeEventListener("did-navigate-in-page", onNavInPage);
    };
  }, []);

  function handleGo(e: React.FormEvent) {
    e.preventDefault();
    let target = inputUrl.trim();
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      // treat as search if no dots, otherwise prepend https
      target = target.includes(".")
        ? `https://${target}`
        : `https://anikototv.to/filter?keyword=${encodeURIComponent(target)}`;
    }
    webviewRef.current?.loadURL(target);
    setInputUrl(target);
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#000000]">
      {/* Browser toolbar */}
      <div className="flex h-11 flex-shrink-0 items-center gap-1 border-b border-white/10 bg-[#000000] px-2">
        {/* Nav buttons */}
        <button
          onClick={() => webviewRef.current?.goBack()}
          disabled={!canBack}
          className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          onClick={() => webviewRef.current?.goForward()}
          disabled={!canForward}
          className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10 disabled:opacity-30"
        >
          <ArrowRight size={15} />
        </button>
        <button
          onClick={() => webviewRef.current?.reload()}
          className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
        </button>
        <button
          onClick={() => webviewRef.current?.loadURL("https://anikototv.to/")}
          className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10"
        >
          <Home size={14} />
        </button>

        {/* URL bar */}
        <form onSubmit={handleGo} className="mx-2 flex-1">
          <input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80 outline-none focus:border-white/30 focus:bg-white/10"
            spellCheck={false}
          />
        </form>

        {/* Close â€” go back to previous page */}
        <button
          onClick={() => navigate(-1)}
          className="flex h-7 w-7 items-center justify-center rounded text-white/60 hover:bg-white/10"
        >
          <X size={15} />
        </button>
      </div>

      {/* Webview */}
      {/* @ts-ignore â€” webview is an Electron-only element not in React's JSX types */}
      <webview
        ref={webviewRef}
        src={startUrl}
        partition="persist:streaming"
        allowpopups
        style={{ flex: 1, width: "100%", height: "100%" }}
      />
    </div>
  );
}
