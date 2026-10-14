#!/usr/bin/env node
/**
 * Offline Electron integration: local synthetic HTTP responses, no providers.
 * Run: node scripts/electron-native-media-smoke.cjs --run
 * Requires the current compiled Electron modules (`npm run build:electron`).
 * This verifies request classification/receipt IPC, not the complete React UI.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const isEntry = require.main === module || (process.versions.electron && process.argv[1]
  && path.resolve(process.argv[1]).toLowerCase() === __filename.toLowerCase());
if (isEntry && (process.argv.length !== 3 || process.argv[2] !== "--run")) {
  console.log("Offline local-only integration requires --run; no provider is contacted.");
  process.exitCode = 1;
} else if (isEntry && !process.versions.electron) {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const result = require("node:child_process").spawnSync(require("electron"), [__filename, "--run"], {
      env: environment, stdio: "inherit", windowsHide: true, timeout: 45_000,
    });
    process.exitCode = result.status ?? 1;
} else if (isEntry) {
  run().catch(() => {
    // Never print an exception/URL/profile path. Failed assertions still fail.
    console.error("[native-media] Local Electron receipt integration failed.");
    require("electron").app.exit(1);
  });
}

async function run() {
  const { app, BrowserWindow, ipcMain } = require("electron");
  const { NativeMediaAccessObserver } = require("../dist-electron/apps/desktop/main/services/providers/native-media-access");
  const { StreamAuthorizationRegistry } = require("../dist-electron/apps/desktop/main/services/providers/stream-authorization");
  app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "anitrack-native-media-fixture-")));
  let window, server, heldResponse, externalRequests = 0;
  const timer = setTimeout(() => app.exit(1), 35_000);
  const registry = new StreamAuthorizationRegistry(60_000);
  const observedTypes = new Set();
  const completions = new Map();
  const pending = new Map();
  const publicUrl = name => `https://fixture.example/${name}`;
  const register = (name, id) => registry.remember(publicUrl(name), { scope: "exact", mediaAccessId: id });
  const waitFor = async predicate => {
    const deadline = Date.now() + 5_000;
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error("Fixture deadline");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    await app.whenReady();
    server = http.createServer((request, response) => {
      if (request.url === "/") {
        response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        response.end('<!doctype html><meta charset="utf-8"><title>Local media fixture</title><video id="media" preload="auto"></video>');
      } else if (request.url === "/held.mp4") heldResponse = response;
      else {
        response.writeHead(request.url === "/denied.mp4" ? 403 : request.url === "/limited.mp4" ? 429 : 404,
          { "Content-Type": "video/mp4", "Cache-Control": "no-store" });
        response.end();
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    window = new BrowserWindow({ show: false, webPreferences: {
      partition: "native-media-fixture", preload: path.join(__dirname, "electron-native-media-smoke-preload.cjs"),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
    } });
    const contents = window.webContents;
    const isolated = contents.session;
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.on("will-download", event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => { if (url !== `${origin}/`) event.preventDefault(); });
    contents.on("will-redirect", event => event.preventDefault());

    // A declared test projection maps only this fixture's exact loopback paths
    // to synthetic public authorizations. Production private-host checks remain
    // unchanged and are also asserted below. No connector is imported.
    const observer = new NativeMediaAccessObserver(url => {
      const parsed = new URL(url);
      return parsed.origin === origin ? registry.get(publicUrl(parsed.pathname.slice(1))) : null;
    }, (mediaAccessId, status) => {
      if (registry.recordMediaAccessRejection(mediaAccessId, status)) {
        contents.send("providers:media-access-rejected", { mediaAccessId, status });
      }
    });
    isolated.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      const permitted = details.url.startsWith(`${origin}/`);
      if (!permitted) externalRequests++;
      callback({ cancel: !permitted });
    });
    isolated.webRequest.onBeforeSendHeaders({ urls: ["<all_urls>"] }, (details, callback) => {
      observer.begin(details, contents.id);
      if (details.url.endsWith(".mp4")) { observedTypes.add(details.resourceType); pending.set(details.url, details.id); }
      callback({ requestHeaders: details.requestHeaders });
    });
    isolated.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
      observer.response(details);
      callback({ responseHeaders: details.responseHeaders });
    });
    const complete = details => { observer.finish(details.id); completions.set(details.id, true); };
    isolated.webRequest.onCompleted({ urls: ["<all_urls>"] }, complete);
    isolated.webRequest.onErrorOccurred({ urls: ["<all_urls>"] }, complete);
    ipcMain.handle("providers:media-access-status", (event, id) => {
      if (event.sender !== contents) throw new Error("Untrusted fixture sender");
      return registry.mediaAccessStatus(id);
    });
    assert.throws(() => registry.remember(`${origin}/denied.mp4`, { mediaAccessId: "forbidden" }));
    await window.loadURL(`${origin}/`);
    const localHelpers = require("typescript").transpileModule(fs.readFileSync(
      path.join(__dirname, "../apps/desktop/renderer/components/player/playbackRequests.ts"), "utf8"),
      { compilerOptions: { module: require("typescript").ModuleKind.CommonJS } }).outputText;
    await contents.executeJavaScript(`(() => {
      const exports = {}; ${localHelpers}
      window.fixture = { current: null, events: [], selected: [], errors: 0 };
      window.mediaFixture.onRejected(value => {
        window.fixture.events.push(value);
        const status = exports.currentMediaAccessRejection(value, window.fixture.current);
        if (status !== null) window.fixture.selected.push(status);
      });
      document.getElementById('media').addEventListener('error', () => window.fixture.errors++);
    })()`);
    const load = (name, id) => contents.executeJavaScript(`window.fixture.current=${JSON.stringify(id)};
      document.getElementById('media').src=${JSON.stringify(`${origin}/${name}`)};
      document.getElementById('media').load();`);
    const snapshot = () => contents.executeJavaScript("JSON.parse(JSON.stringify(window.fixture))");

    for (const [name, id, status] of [["denied.mp4", "denied", 403], ["limited.mp4", "limited", 429]]) {
      register(name, id);
      await load(name, id);
      await waitFor(async () => (await snapshot()).selected.includes(status));
      const observed = await contents.executeJavaScript(`window.mediaFixture.status(${JSON.stringify(id)})`);
      assert.equal(observed, status);
      await waitFor(() => completions.has(pending.get(`${origin}/${name}`)));
    }
    register("held.mp4", "old-resolution");
    await load("held.mp4", "old-resolution");
    await waitFor(() => !!heldResponse && pending.has(`${origin}/held.mp4`));
    register("held.mp4", "new-resolution");
    await contents.executeJavaScript("window.fixture.current='new-resolution'");
    heldResponse.writeHead(403, { "Content-Type": "video/mp4", "Cache-Control": "no-store" });
    heldResponse.end();
    await waitFor(() => completions.has(pending.get(`${origin}/held.mp4`)));
    assert.equal(registry.mediaAccessStatus("new-resolution"), null);
    // An already queued old event must likewise not stop the new selection.
    contents.send("providers:media-access-rejected", { mediaAccessId: "old-resolution", status: 403 });
    await waitFor(async () => (await snapshot()).events.length >= 3);
    assert.deepEqual((await snapshot()).selected, [403, 429]);
    assert.deepEqual([...observedTypes], ["media"]);
    assert.equal(externalRequests, 0);
    console.log("[native-media] Passed: real Electron native-media 403/429, receipt event/query and stale-resolution isolation; zero external requests.");
  } finally {
    clearTimeout(timer);
    ipcMain.removeHandler("providers:media-access-status");
    if (window && !window.isDestroyed()) window.destroy();
    server?.closeAllConnections();
    server?.close();
  }
  app.exit(0);
}
