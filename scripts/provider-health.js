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
  if (config.providers.anikoto.enabled && config.features.anikotoStreaming) {
    for (const base of config.providers.anikoto.baseUrls) jobs.push(probeAnikoto(config.providers.anikoto, base));
  }
  if (config.providers.animepahe.enabled && config.features.animepaheStreaming) {
    for (const base of config.providers.animepahe.baseUrls) jobs.push(probeAnimePahe(config.providers.animepahe, base));
  }
  const results = await Promise.all(jobs);
  const report = markdown(config, results);
  console.log(process.argv.includes("--json") ? JSON.stringify({ revision: config.revision, results }, null, 2) : report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");

  const providerFailed = ["anikoto", "animepahe"].some((provider) => {
    const providerResults = results.filter((entry) => entry.provider === provider);
    return providerResults.length > 0 && providerResults.every((entry) => entry.state === "failed");
  });
  if (providerFailed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

module.exports = { expandRoute, readBounded, probeAnikoto, probeAnimePahe };
