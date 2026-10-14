import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { lastModeWasManga } from "./lib/manga-api";
import "./index.css";

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
  // Reopen in manga mode before the first render: redirecting afterwards mounted the
  // anime Home, whose AniList requests then ran ahead of the manga feed.
  if (window.api?.manga && lastModeWasManga() && /^#?\/?$/.test(window.location.hash)) window.location.replace("#/manga");
  renderApp();
}
