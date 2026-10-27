#!/usr/bin/env node
const fs = require("fs");
const {
  CONFIG_PATH,
  validateRemoteConfig,
  readJsonFile,
} = require("./automation-common");

const MAX_RESPONSE_BYTES = 512 * 1024;
const TIMEOUT_MS = 18_000;
const USER_AGENT = "AniTrack-Provider-Health/1.0 (+https://github.com/kil-04/AniTrack)";

function expandRoute(template, values = {}) {
  const route = template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, key) => {
    if (!(key in values)) throw new Error(`Missing route value: ${key}`);
    return encodeURIComponent(String(values[key]));
  });
  if (route.includes("{")) throw new Error("Route contains an unresolved placeholder");
  return route;
}

async function readBounded(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/json, text/html, text/plain, */*",
        "User-Agent": USER_AGENT,
        "Cache-Control": "no-cache",
      },
    });
    if (!response.url.startsWith("https://")) throw new Error("probe redirected away from HTTPS");
    const body = await readBounded(response);
    return { status: response.status, finalUrl: response.url, body };
  } finally {
    clearTimeout(timer);
  }
}

function result(provider, baseUrl, state, detail, status = null, finalUrl = null) {
  return { provider, baseUrl, state, detail, status, finalUrl };
}

async function probeAnikoto(config, baseUrl) {
  const route = expandRoute(config.routes.search, { query: "one piece", page: 1 });
  try {
    const response = await probe(baseUrl + route);
    if (response.status < 200 || response.status >= 300) {
      return result("anikoto", baseUrl, "failed", `HTTP ${response.status}`, response.status, response.finalUrl);
    }
    const itemClass = config.selectors.searchItemClass;
    const titleAttribute = config.selectors.searchTitleAttribute;
    const itemPattern = new RegExp(`class=["'][^"']*\\b${itemClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (!itemPattern.test(response.body) || !response.body.includes(`${titleAttribute}=`)) {
      return result("anikoto", baseUrl, "failed", "search HTML no longer matches signed selectors", response.status, response.finalUrl);
    }
    return result("anikoto", baseUrl, "healthy", "search route and selectors passed", response.status, response.finalUrl);
  } catch (error) {
    return result("anikoto", baseUrl, "failed", error.message || String(error));
  }
}

async function probeAnimePahe(config, baseUrl) {
  const route = expandRoute(config.routes.search, { query: "one piece" });
  try {
    const response = await probe(baseUrl + route);
    if (response.status >= 200 && response.status < 300) {
      try {
        const json = JSON.parse(response.body);
        if (Array.isArray(json.data)) {
          return result("animepahe", baseUrl, "healthy", "search API returned data", response.status, response.finalUrl);
        }
      } catch {}
      return result("animepahe", baseUrl, "degraded", "reachable but search response shape changed", response.status, response.finalUrl);
    }
    if ([403, 429, 503].includes(response.status) &&
        /cloudflare|just a moment|verify (?:you are )?human|attention required/i.test(response.body)) {
      return result("animepahe", baseUrl, "challenge", "reachable; GitHub runner received an anti-bot challenge", response.status, response.finalUrl);
    }
    return result("animepahe", baseUrl, "failed", `HTTP ${response.status}`, response.status, response.finalUrl);
  } catch (error) {
    return result("animepahe", baseUrl, "failed", error.message || String(error));
  }
}

/**
 * shonen.to (packages/shared/shonen.ts): search, one episode's sources, then that
 * episode's HLS playlist. It relays other sites' streams, so a reachable site with a
 * dead playlist is "degraded", not healthy.
 */
async function probeShonen(config, baseUrl) {
  try {
    const search = await probe(baseUrl + expandRoute(config.routes.search, { query: "one piece" }));
    // Since 21 Oct 2026 Cloudflare refuses GitHub's runners (403) while home connections
    // pass search, sources and playlist: a refusal page is the runner's problem, not an outage.
    if ([403, 429, 503].includes(search.status) &&
        /cloudflare|just a moment|verify (?:you are )?human|attention required|you have been blocked/i.test(search.body)) {
      return result("shonen", baseUrl, "challenge", "reachable; GitHub runner received an anti-bot challenge", search.status, search.finalUrl);
    }
    if (search.status < 200 || search.status >= 300) {
      return result("shonen", baseUrl, "failed", `search HTTP ${search.status}`, search.status, search.finalUrl);
    }
    if (!/href="\/anime\/21"/.test(search.body)) {
      return result("shonen", baseUrl, "failed", "search HTML no longer lists AniList-keyed cards", search.status, search.finalUrl);
    }
    const sources = await probe(baseUrl + expandRoute(config.routes.sources, { animeId: 21, episode: 1, language: "sub" }));
    let file = null;
    try {
      const json = JSON.parse(sources.body);
      const hls = Array.isArray(json?.data?.sources) ? json.data.sources.find((s) => s && s.type === "hls") : null;
      // Since 20 Oct 2026 the files are same-origin /api/v1/shonen-media links.
      const url = typeof hls?.file === "string" ? new URL(hls.file, baseUrl) : null;
      file = url && url.protocol === "https:" ? url.toString() : null;
    } catch {}
    if (!file) {
      return result("shonen", baseUrl, "failed", `sources HTTP ${sources.status} without an HLS stream`, sources.status, sources.finalUrl);
    }
    const playlist = await probe(file);
    if (playlist.status < 200 || playlist.status >= 300 || !playlist.body.startsWith("#EXTM3U")) {
      return result("shonen", baseUrl, "degraded", `search and sources work, but the stream playlist answered HTTP ${playlist.status}`, playlist.status, null);
    }
    return result("shonen", baseUrl, "healthy", "search, sources and stream playlist passed", sources.status, sources.finalUrl);
  } catch (error) {
    return result("shonen", baseUrl, "failed", error.message || String(error));
  }
}

/**
 * AniChan (packages/shared/anichan.ts): AniList-keyed search, then a title's catalogue
 * with its availability arrays. Server lists need the website's own watch session, so
 * streams are not probed here. Cowboy Bebop keeps the catalogue under the size limit.
 */
async function probeAniChan(config, baseUrl) {
  try {
    const search = await probe(baseUrl + expandRoute(config.routes.search, { query: "cowboy bebop" }));
    let hit = false;
    try {
      const json = JSON.parse(search.body);
      hit = Array.isArray(json?.results) && json.results.some((entry) => entry && entry.id === 1);
    } catch {}
    if (!hit) {
      return result("anichan", baseUrl, "failed", `search HTTP ${search.status} no longer lists AniList-keyed results`, search.status, search.finalUrl);
    }
    const anime = await probe(baseUrl + expandRoute(config.routes.anime, { animeId: 1 }));
    let episodes = 0;
    try {
      const json = JSON.parse(anime.body);
      const lists = [json?.selfhost?.cached_eps, json?.selfhost?.cached_sub, json?.available_eps?.sub];
      episodes = Math.max(0, ...lists.map((list) => (Array.isArray(list) ? list.length : 0)));
    } catch {}
    if (episodes === 0) {
      return result("anichan", baseUrl, "failed", `catalogue HTTP ${anime.status} without available episodes`, anime.status, anime.finalUrl);
    }
    return result("anichan", baseUrl, "healthy", `search and catalogue passed (${episodes} episodes); streams need a website session and are not probed`, anime.status, anime.finalUrl);
  } catch (error) {
    return result("anichan", baseUrl, "failed", error.message || String(error));
  }
}

function markdown(config, results) {
  const rows = results.map((entry) =>
    `| ${entry.provider} | ${entry.baseUrl} | ${entry.state} | ${String(entry.detail).replace(/\|/g, "\\|")} |`,
  );
  return [
    `## AniTrack provider health — config revision ${config.revision}`,
    "",
    "| Provider | Signed origin | State | Detail |",
    "|---|---|---|---|",
    ...rows,
    "",
    `Checked at ${new Date().toISOString()}.`,
  ].join("\n");
}

async function main() {
  const config = readJsonFile(CONFIG_PATH, validateRemoteConfig, "automation/remote-config.json");
  const jobs = [];
  for (const provider of config.providerOrder) {
    const providerConfig = config.providers[provider];
    const featureEnabled = provider === "anikoto" ? config.features.anikotoStreaming
      : provider === "animepahe" ? config.features.animepaheStreaming
      : true;

    if (!providerConfig.enabled || !featureEnabled) {
      const reason = !providerConfig.enabled
        ? "disabled in signed provider configuration; no request sent"
        : "disabled by signed feature configuration; no request sent";
      for (const base of providerConfig.baseUrls) {
        jobs.push(Promise.resolve(result(provider, base, "disabled", reason)));
      }
      continue;
    }

    if (provider === "anikoto") {
      for (const base of providerConfig.baseUrls) jobs.push(probeAnikoto(providerConfig, base));
    } else if (provider === "animepahe") {
      for (const base of providerConfig.baseUrls) jobs.push(probeAnimePahe(providerConfig, base));
    } else if (provider === "shonen") {
      for (const base of providerConfig.baseUrls) jobs.push(probeShonen(providerConfig, base));
    } else if (provider === "anichan") {
      for (const base of providerConfig.baseUrls) jobs.push(probeAniChan(providerConfig, base));
    } else {
      for (const base of providerConfig.baseUrls) {
        jobs.push(Promise.resolve(result(
          provider,
          base,
          "failed",
          "provider is enabled but has no reviewed automated health probe",
        )));
      }
    }
  }
  const results = await Promise.all(jobs);
  const report = markdown(config, results);
  console.log(process.argv.includes("--json") ? JSON.stringify({ revision: config.revision, results }, null, 2) : report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");

  const providerFailed = config.providerOrder.some((provider) => {
    if (!config.providers[provider].enabled) return false;
    const providerResults = results.filter((entry) => entry.provider === provider);
    return providerResults.length > 0 && providerResults.every((entry) => entry.state === "failed");
  });
  if (providerFailed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

module.exports = { expandRoute, readBounded, probeAnikoto, probeAnimePahe, probeShonen, probeAniChan };
