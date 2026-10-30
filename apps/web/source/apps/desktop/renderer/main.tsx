import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { lastMode, modeHome } from "./lib/manga-api";
import { applySkin } from "./lib/skin";
import "./index.css";

// Pixel mode (or not) before the first paint, so the app never flashes the other look.
applySkin();

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <App />
        </HashRouter>
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

// On Android (Capacitor), window.api is not provided by a preload script.
// Install the Capacitor shim before React renders. Use the native-platform check
// (not just `window.Capacitor`, which @capacitor/core defines on desktop too).
if ((window as any).Capacitor?.isNativePlatform?.()) {
  import("./lib/api-capacitor").then(async ({ installCapacitorApiBridge }) => {
    await installCapacitorApiBridge();
    renderApp();
  });
} else {
  // Reopen in manga or novels mode before the first render: redirecting afterwards mounted
  // the anime Home, whose AniList requests then ran ahead of that mode's feed.
  const mode = lastMode();
  const available = mode === "manga" ? !!window.api?.manga : mode === "novel" ? !!window.api?.novel : false;
  if (available && /^#?\/?$/.test(window.location.hash)) window.location.replace(`#${modeHome(mode)}`);
  renderApp();
}
