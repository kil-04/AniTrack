#!/usr/bin/env node
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");
const { createMediaProbe, safeMessage } = require("./electron-provider-smoke-common");

const smokeArgs = process.argv.slice(2);
const positional = smokeArgs.filter((value) => !value.startsWith("--"));
const title = positional[0] || "City Hunter 2";
const episodeNumber = Number(positional[1] || 5);
const providerId = (positional[2] || "animepahe").toLowerCase();
const slug = smokeArgs.find((value) => value.startsWith("--slug="))?.slice("--slug=".length);
const downloadSmoke = process.argv.includes("--download");
const runnableProviderIds = new Set(["anikoto", "animepahe"]);
let currentStage = "startup";
let awaitingUser = false;
const log = console.log.bind(console);
const logError = console.error.bind(console);
// Connector debug logs can contain short-lived URLs and player coordinates.
// Emit only the stages below, whose results deliberately omit those values.
console.log = console.warn = console.error = () => {};

function report(name, detail) { log(`[smoke] ${providerId} ${name}: ${safeMessage(detail)}`); }

async function stage(name, action, summary = () => "passed") {
  currentStage = name;
  report(name, "started");
  const started = Date.now();
  const result = await action();
  report(name, `${summary(result)} (${Date.now() - started} ms)`);
  return result;
}

const watchdog = setTimeout(() => {
  logError(awaitingUser
    ? "[smoke] Verification window closed after the 120-second limit. Complete the check yourself and rerun the smoke test."
    : `[smoke] Stopped after 120 seconds during ${currentStage}. No further requests will be sent.`);
  app.exit(1);
}, 120_000);

app.setPath("userData", path.join(os.tmpdir(), "anitrack-provider-smoke"));
// Mirror main.ts: providers bind website clearance to the browser identity, so
// the smoke must present the same User-Agent as the app.
app.userAgentFallback = app.userAgentFallback
  .replace(/\s?Electron\/[\d.]+/i, "")
  .replace(/\s?anitrack\/[\d.]+/i, "");
// This is a dedicated diagnostic profile, never the installed app's profile.
// A user-visible verification window may remain open until the watchdog.
app.on("window-all-closed", () => {});

async function main() {
  if (providerId === "mkissa") {
    throw new Error("MKissa smoke is disabled until its direct-media and seeking verification gate passes");
  }
  if (!runnableProviderIds.has(providerId)) {
    throw new Error("Unknown smoke provider; select anikoto or animepahe");
  }
  if (!Number.isFinite(episodeNumber) || episodeNumber <= 0 || episodeNumber > 100_000) {
    throw new Error("Episode number must be a positive finite number");
  }
  if (slug != null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(slug)) {
    throw new Error("Known slug must be a provider show identifier, not a URL");
  }
  await stage("Electron ready", () => app.whenReady());
  const { initRuntimeConfig } = require("../dist-electron/apps/desktop/main/services/remote-config");
  const {
    AnimePaheProvider,
    getAuthorizedPaheRequestHeaders,
  } = require("../dist-electron/apps/desktop/main/services/providers/animepahe");
  const { AnikotoProvider } = require("../dist-electron/apps/desktop/main/services/providers/anikoto");
  const { authorizeResolvedStream, getResolvedStreamAuthorization } = require("../dist-electron/apps/desktop/main/services/providers/stream-authorization");
  const {
    removeDownload,
    setDownloadEmitter,
    startDownload,
  } = require("../dist-electron/apps/desktop/main/services/downloads");
  await stage("configuration", initRuntimeConfig);
  const provider = providerId === "anikoto" ? new AnikotoProvider() : new AnimePaheProvider();
  let anime;
  if (slug) {
    anime = { id: slug, title, providerId };
    report("search", "skipped; using known provider slug");
  } else {
    const results = await stage("search", () => provider.search(title), (items) => `${items.length} matches`);
    anime = results.find((item) => item.title.toLowerCase() === title.toLowerCase()) || results[0];
  }
  if (!anime) throw new Error(`${provider.name} search returned no matching show`);
  const pageSize = provider.capabilities.episodePageSize || 30;
  const page = Math.max(1, Math.floor((episodeNumber - 1) / pageSize) + 1);
  const episodes = await stage("episodes", () => provider.getEpisodes(anime.id, page), (result) => `${result.data.length} episodes returned`);
  const episode = episodes.data.find((item) => Number(item.episodeNumber) === episodeNumber);
  if (!episode) throw new Error(`Episode ${episodeNumber} was not returned`);
  const links = await stage("stream choices", () => provider.getStreamLinks(episode.id, anime.id), (items) => `${items.length} choices returned`);
  const best = [...links].sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0))[0];
  if (!best) throw new Error(`${provider.name} returned no stream links`);
  const stream = await stage("resolve", () => provider.resolveStream(best.id));
  authorizeResolvedStream(stream);
  const mediaSession = session.fromPartition(providerId === "animepahe" ? "persist:kwik" : "persist:anikoto");
  const mediaProbe = createMediaProbe({
    fetch: (url, options) => mediaSession.fetch(url, options),
    authorization(url) {
      if (providerId !== "animepahe") return getResolvedStreamAuthorization(url);
      const scoped = getAuthorizedPaheRequestHeaders(url);
      if (!scoped?.cookie) throw new Error("AnimePahe authorization does not cover this media URI; resolve a fresh stream");
      return { headers: { Referer: `${scoped.referer}/`, Origin: new URL(scoped.referer).origin, Cookie: scoped.cookie } };
    },
    report,
  });
  const verified = await stage("media verification", () => mediaProbe.verifyHls(stream.url),
    (result) => `${result.manifestDepth} manifest levels, first/last media checked, range HTTP ${result.rangeStatus}`);
  report("result", `${provider.name} episode ${episodeNumber} passed; media hosts ${verified.firstHost}, ${verified.lastHost}`);
  if (downloadSmoke) {
    // Keep the same numeric anime:episode schema used by the renderer so the
    // IPC/service validation exercised here matches production.
    const id = `0:${Date.now()}`;
    await stage("downloader", () => new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        removeDownload(id);
        if (error) reject(error); else resolve();
      };
      const timeout = setTimeout(() => finish(new Error("Downloader smoke timed out")), 45_000);
      setDownloadEmitter((item) => {
        if (item.id !== id) return;
        if (item.status === "failed") finish(new Error(item.error || "Downloader failed"));
        else if (item.doneSegments >= 1) finish();
      });
      startDownload({
        id,
        animeId: 0,
        episode: episodeNumber,
        title: `Smoke - ${anime.title}`,
        providerId,
        hlsUrl: stream.url,
        referer: stream.referer,
        cookies: stream.cookies,
        requestHeaders: stream.requestHeaders,
        authorizationScope: stream.authorizationScope,
        cors: stream.cors,
      });
    }), () => "media files written; diagnostic download cancelled and removed");
  }
}

main().then(() => {
  clearTimeout(watchdog);
  app.quit();
}).catch((error) => {
  logError(`[smoke] ${providerId} ${currentStage} failed: ${safeMessage(error)}`);
  const manualCheck = /PAHE_SECURITY_CHECK/.test(String(error?.message ?? ""))
    && BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isVisible());
  if (manualCheck) {
    awaitingUser = true;
    report("verification required", "Complete the opened website check yourself, then rerun smoke. This run stops here and sends no further requests; the window remains open for up to 120 seconds.");
    return;
  }
  clearTimeout(watchdog);
  app.exit(1);
});
