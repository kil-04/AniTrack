#!/usr/bin/env node
const os = require("node:os");
const path = require("node:path");
const { app, net } = require("electron");

const title = process.argv[2] || "City Hunter 2";
const episodeNumber = Number(process.argv[3] || 5);
const providerId = (process.argv[4] || "animepahe").toLowerCase();
const downloadSmoke = process.argv.includes("--download");

app.setPath("userData", path.join(os.tmpdir(), "anitrack-provider-smoke"));

function requestHeaders(authorization) {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    Referer: authorization.referer + "/",
    Origin: authorization.referer,
    Cookie: authorization.cookie,
  };
}

function streamHeaders(stream) {
  if (!stream.referer) throw new Error("Resolver returned no stream referer");
  const referer = new URL(stream.referer).origin;
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
    Referer: referer + "/",
    Origin: referer,
  };
}

async function fetchManifestAndMedia(streamUrl, headers, expectedHost) {
  let manifestUrl = streamUrl;
  for (let depth = 0; depth < 2; depth += 1) {
    const manifestResponse = await net.fetch(manifestUrl, { headers });
    if (!manifestResponse.ok) throw new Error(`Authorized manifest returned HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.text();
    if (!manifest.includes("#EXTM3U")) throw new Error("Authorized response was not an HLS manifest");
    const firstUri = manifest.split(/\r?\n/).map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (!firstUri) throw new Error("HLS manifest contained no media URI");
    const nextUrl = new URL(firstUri, manifestUrl);
    if (expectedHost && nextUrl.hostname.toLowerCase() !== expectedHost) {
      throw new Error("HLS media unexpectedly crossed to an unauthorized host");
    }
    if (/\.m3u8(?:$|\?)/i.test(nextUrl.pathname + nextUrl.search)) {
      manifestUrl = nextUrl.toString();
      continue;
    }
    const mediaResponse = await net.fetch(nextUrl.toString(), { headers });
    if (!mediaResponse.ok) throw new Error(`Authorized media request returned HTTP ${mediaResponse.status}`);
    await mediaResponse.body?.cancel();
    return nextUrl.hostname.toLowerCase();
  }
  throw new Error("HLS master playlist did not lead to a media segment");
}

async function main() {
  await app.whenReady();
  const { initRuntimeConfig } = require("../dist-electron/apps/desktop/main/services/remote-config");
  const {
    AnimePaheProvider,
    getAuthorizedPaheRequestHeaders,
  } = require("../dist-electron/apps/desktop/main/services/providers/animepahe");
  const { AnikotoProvider } = require("../dist-electron/apps/desktop/main/services/providers/anikoto");
  const {
    removeDownload,
    setDownloadEmitter,
    startDownload,
  } = require("../dist-electron/apps/desktop/main/services/downloads");
  await initRuntimeConfig();
  const provider = providerId === "anikoto" ? new AnikotoProvider() : new AnimePaheProvider();
  const results = await provider.search(title);
  const anime = results.find((item) => item.title.toLowerCase() === title.toLowerCase()) || results[0];
  if (!anime) throw new Error(`AnimePahe search returned no result for ${title}`);
  const episodes = await provider.getEpisodes(anime.id, 1);
  const episode = episodes.data.find((item) => Number(item.episodeNumber) === episodeNumber);
  if (!episode) throw new Error(`Episode ${episodeNumber} was not returned for ${anime.title}`);
  const links = await provider.getStreamLinks(episode.id, anime.id);
  const best = [...links].sort((a, b) => Number(b.quality) - Number(a.quality))[0];
  if (!best) throw new Error(`${provider.name} returned no stream links`);
  const stream = await provider.resolveStream(best.id);
  const authorization = providerId === "animepahe"
    ? getAuthorizedPaheRequestHeaders(stream.url)
    : null;
  if (providerId === "animepahe" && !authorization?.cookie) {
    throw new Error("Resolver returned no authorized CDN cookies");
  }
  const headers = authorization ? requestHeaders(authorization) : streamHeaders(stream);
  const host = await fetchManifestAndMedia(stream.url, headers, authorization?.host);
  console.log(
    `${provider.name} smoke passed: ${anime.title} episode ${episodeNumber}, ` +
    `manifest/media HTTP 200, host ${host}.`,
  );
  if (downloadSmoke) {
    // Keep the same numeric anime:episode schema used by the renderer so the
    // IPC/service validation exercised here matches production.
    const id = `0:${Date.now()}`;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        removeDownload(id);
        if (error) reject(error); else resolve();
      };
      const timeout = setTimeout(() => finish(new Error("Downloader smoke timed out")), 90_000);
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
      });
    });
    console.log(`${provider.name} downloader smoke passed: authenticated media files were written.`);
  }
}

main().then(() => app.quit()).catch((error) => {
  console.error(error.message || error);
  app.exit(1);
});
