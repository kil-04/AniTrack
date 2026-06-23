import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
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
// Install the Capacitor shim before React renders.
if ((window as any).Capacitor) {
  import("./lib/api-capacitor").then(async ({ installCapacitorApiBridge }) => {
    await installCapacitorApiBridge();
    renderApp();
  });
} else {
  renderApp();
}
